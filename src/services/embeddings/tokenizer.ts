import * as FileSystem from 'expo-file-system/legacy';

const METASPACE = '\u2581';
const EXPECTED_SPECIAL_IDS = {
  '<s>': 0,
  '<pad>': 1,
  '</s>': 2,
  '<unk>': 3,
} as const;

export interface TokenizerResult {
  inputIds: BigInt64Array;
  attentionMask: BigInt64Array;
  tokenIdsNumber: number[];
}

interface PrecompiledCharsMap {
  readonly trie: Uint32Array;
  readonly normalized: Uint8Array;
}

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64(value: string): Uint8Array {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const output = new Uint8Array(Math.floor((value.length * 3) / 4) - padding);
  let outputIndex = 0;

  for (let i = 0; i < value.length; i += 4) {
    const first = BASE64_ALPHABET.indexOf(value[i]);
    const second = BASE64_ALPHABET.indexOf(value[i + 1]);
    const third = value[i + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[i + 2]);
    const fourth = value[i + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[i + 3]);
    if (first < 0 || second < 0 || third < 0 || fourth < 0) {
      throw new Error('Invalid base64 precompiled character map.');
    }

    const word = (first << 18) | (second << 12) | (third << 6) | fourth;
    if (outputIndex < output.length) {
      output[outputIndex] = (word >>> 16) & 0xff;
      outputIndex += 1;
    }
    if (outputIndex < output.length) {
      output[outputIndex] = (word >>> 8) & 0xff;
      outputIndex += 1;
    }
    if (outputIndex < output.length) {
      output[outputIndex] = word & 0xff;
      outputIndex += 1;
    }
  }
  return output;
}

function parsePrecompiledCharsMap(encoded: string): PrecompiledCharsMap {
  const bytes = decodeBase64(encoded);
  if (bytes.length < 8) {
    throw new Error('Invalid tokenizer.json: precompiled character map is too short.');
  }

  const trieSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getUint32(0, true);
  if (
    trieSize < 1024 ||
    trieSize % 1024 !== 0 ||
    trieSize + 4 >= bytes.length
  ) {
    throw new Error('Invalid tokenizer.json: precompiled character map has an invalid trie.');
  }

  const trie = new Uint32Array(
    bytes.buffer,
    bytes.byteOffset + 4,
    trieSize / Uint32Array.BYTES_PER_ELEMENT,
  );
  const normalized = bytes.subarray(4 + trieSize);
  if (normalized[normalized.length - 1] !== 0) {
    throw new Error('Invalid tokenizer.json: precompiled character map is not null-terminated.');
  }
  return { trie, normalized };
}

function encodeUtf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const first = text.charCodeAt(i);
    let codePoint = first;
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = text.charCodeAt(i + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        codePoint = 0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00);
        i += 1;
      } else {
        codePoint = 0xfffd;
      }
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      codePoint = 0xfffd;
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function decodeUtf8(bytes: readonly number[]): string {
  const characters: string[] = [];
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i];
    let codePoint: number;
    let count: number;
    if (first < 0x80) {
      codePoint = first;
      count = 1;
    } else if ((first & 0xe0) === 0xc0 && i + 1 < bytes.length) {
      codePoint = ((first & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      count = 2;
    } else if ((first & 0xf0) === 0xe0 && i + 2 < bytes.length) {
      codePoint =
        ((first & 0x0f) << 12) |
        ((bytes[i + 1] & 0x3f) << 6) |
        (bytes[i + 2] & 0x3f);
      count = 3;
    } else if ((first & 0xf8) === 0xf0 && i + 3 < bytes.length) {
      codePoint =
        ((first & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      count = 4;
    } else {
      codePoint = 0xfffd;
      count = 1;
    }
    characters.push(String.fromCodePoint(codePoint));
    i += count;
  }
  return characters.join('');
}

function getTrieOffset(unit: number): number {
  const shift = (unit & 0x200) >>> 6;
  return ((unit >>> 10) << shift) >>> 0;
}

function normalizeWithPrecompiledMap(
  text: string,
  charsMap: PrecompiledCharsMap,
): string {
  const input = encodeUtf8(text);
  const output: number[] = [];
  let inputOffset = 0;

  while (inputOffset < input.length) {
    let nodePosition = 0;
    let unit = charsMap.trie[nodePosition];
    nodePosition ^= getTrieOffset(unit);
    let matchedLength = 0;
    let matchedValue = 0;

    for (let i = inputOffset; i < input.length; i += 1) {
      const label = input[i];
      nodePosition ^= label;
      if (nodePosition >= charsMap.trie.length) {
        break;
      }
      unit = charsMap.trie[nodePosition];
      if ((unit & 0x800000ff) >>> 0 !== label) {
        break;
      }

      nodePosition ^= getTrieOffset(unit);
      if ((unit & 0x100) !== 0) {
        if (nodePosition >= charsMap.trie.length) {
          throw new Error('Invalid tokenizer.json: character map trie leaf is out of bounds.');
        }
        matchedLength = i - inputOffset + 1;
        matchedValue = charsMap.trie[nodePosition] & 0x7fffffff;
      }
    }

    if (matchedLength === 0) {
      output.push(input[inputOffset]);
      inputOffset += 1;
      continue;
    }

    if (matchedValue >= charsMap.normalized.length) {
      throw new Error('Invalid tokenizer.json: character map output is out of bounds.');
    }
    for (
      let outputOffset = matchedValue;
      outputOffset < charsMap.normalized.length &&
      charsMap.normalized[outputOffset] !== 0;
      outputOffset += 1
    ) {
      output.push(charsMap.normalized[outputOffset]);
    }
    inputOffset += matchedLength;
  }

  return decodeUtf8(output);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Invalid tokenizer.json: ${label} must be an object.`);
  }
  return value;
}

function asInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Invalid tokenizer.json: ${label} must be an integer.`);
  }
  return value;
}

export class SentencePieceTokenizer {
  private readonly vocab: Map<string, number>;
  private readonly scores: Float64Array;
  private readonly unkId: number;
  private readonly unknownScore: number;
  private readonly maxPieceLength: number;
  private readonly precompiledCharsMap: PrecompiledCharsMap;
  private readonly collapseRepeatedSpaces: boolean;
  private readonly addPrefixSpace: boolean;

  private constructor(
    vocab: Map<string, number>,
    scores: Float64Array,
    unkId: number,
    unknownScore: number,
    maxPieceLength: number,
    precompiledCharsMap: PrecompiledCharsMap,
    collapseRepeatedSpaces: boolean,
    addPrefixSpace: boolean,
  ) {
    this.vocab = vocab;
    this.scores = scores;
    this.unkId = unkId;
    this.unknownScore = unknownScore;
    this.maxPieceLength = maxPieceLength;
    this.precompiledCharsMap = precompiledCharsMap;
    this.collapseRepeatedSpaces = collapseRepeatedSpaces;
    this.addPrefixSpace = addPrefixSpace;
  }

  static async fromFile(uri: string): Promise<SentencePieceTokenizer> {
    const raw = await FileSystem.readAsStringAsync(uri);
    return SentencePieceTokenizer.fromJson(raw);
  }

  static fromJson(json: string): SentencePieceTokenizer {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json) as unknown;
    } catch (error) {
      throw new Error(
        `Could not parse tokenizer.json: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const root = asRecord(parsed, 'root');
    const model = asRecord(root.model, 'model');
    if (model.type !== 'Unigram' || !Array.isArray(model.vocab)) {
      throw new Error('Unsupported tokenizer.json: expected a Unigram model.');
    }

    const vocabData = model.vocab;
    const vocab = new Map<string, number>();
    const scores = new Float64Array(vocabData.length);
    let minScore = Number.POSITIVE_INFINITY;
    let maxPieceLength = 0;

    for (let id = 0; id < vocabData.length; id += 1) {
      const item: unknown = vocabData[id];
      if (!Array.isArray(item) || item.length < 2) {
        throw new Error(`Invalid tokenizer.json: model.vocab[${id}] is malformed.`);
      }

      const piece: unknown = item[0];
      const score: unknown = item[1];
      if (typeof piece !== 'string' || typeof score !== 'number' || !Number.isFinite(score)) {
        throw new Error(`Invalid tokenizer.json: model.vocab[${id}] is malformed.`);
      }

      vocab.set(piece, id);
      scores[id] = score;
      if (id > EXPECTED_SPECIAL_IDS['<unk>']) {
        minScore = Math.min(minScore, score);
      }
      maxPieceLength = Math.max(maxPieceLength, piece.length);
    }

    const unkId = asInteger(model.unk_id, 'model.unk_id');
    if (unkId < 0 || unkId >= vocabData.length) {
      throw new Error('Invalid tokenizer.json: model.unk_id is outside model.vocab.');
    }

    const addedTokens = Array.isArray(root.added_tokens) ? root.added_tokens : [];
    for (const [piece, expectedId] of Object.entries(EXPECTED_SPECIAL_IDS)) {
      let actualId = vocab.get(piece);
      for (const tokenValue of addedTokens) {
        if (!isRecord(tokenValue) || tokenValue.content !== piece) {
          continue;
        }
        actualId = asInteger(tokenValue.id, `added_tokens.${piece}.id`);
        break;
      }
      if (actualId !== expectedId) {
        throw new Error(
          `Unsupported tokenizer vocabulary: ${piece} has ID ${String(actualId)}, expected ${expectedId}.`,
        );
      }
      vocab.set(piece, expectedId);
    }

    const normalizer = asRecord(root.normalizer, 'normalizer');
    const normalizerSteps =
      normalizer.type === 'Sequence' && Array.isArray(normalizer.normalizers)
        ? normalizer.normalizers
        : [normalizer];
    let precompiledCharsMap: PrecompiledCharsMap | null = null;
    let collapseRepeatedSpaces = false;

    for (const stepValue of normalizerSteps) {
      const step = asRecord(stepValue, 'normalizer step');
      if (step.type === 'Precompiled') {
        if (typeof step.precompiled_charsmap !== 'string') {
          throw new Error('Invalid tokenizer.json: missing precompiled character map.');
        }
        precompiledCharsMap = parsePrecompiledCharsMap(step.precompiled_charsmap);
      } else if (step.type === 'Replace') {
        const pattern = asRecord(step.pattern, 'normalizer Replace.pattern');
        if (pattern.Regex !== ' {2,}' || step.content !== ' ') {
          throw new Error('Unsupported tokenizer.json: unrecognized Replace normalizer.');
        }
        collapseRepeatedSpaces = true;
      } else {
        throw new Error(`Unsupported tokenizer normalizer: ${String(step.type)}.`);
      }
    }

    const preTokenizer = asRecord(root.pre_tokenizer, 'pre_tokenizer');
    if (preTokenizer.type !== 'Metaspace' || preTokenizer.replacement !== METASPACE) {
      throw new Error('Unsupported tokenizer.json: expected a Metaspace pre-tokenizer.');
    }

    const addPrefixSpace = preTokenizer.add_prefix_space === true;
    if (!Number.isFinite(minScore)) {
      throw new Error('Invalid tokenizer.json: Unigram vocabulary has no regular tokens.');
    }
    if (!precompiledCharsMap) {
      throw new Error('Unsupported tokenizer.json: expected a Precompiled normalizer.');
    }

    return new SentencePieceTokenizer(
      vocab,
      scores,
      unkId,
      minScore - 10,
      maxPieceLength,
      precompiledCharsMap,
      collapseRepeatedSpaces,
      addPrefixSpace,
    );
  }

  encode(text: string, maxLength = 512): TokenizerResult {
    if (!Number.isInteger(maxLength) || maxLength < 2) {
      throw new RangeError('maxLength must be an integer greater than or equal to 2.');
    }

    const normalized = this.normalize(text);
    const prepared = this.applyMetaspace(normalized);
    const bodyTokenIds = this.segment(prepared);
    const tokenIdsNumber = [
      EXPECTED_SPECIAL_IDS['<s>'],
      ...bodyTokenIds.slice(0, maxLength - 2),
      EXPECTED_SPECIAL_IDS['</s>'],
    ];
    const inputIds = new BigInt64Array(tokenIdsNumber.length);
    const attentionMask = new BigInt64Array(tokenIdsNumber.length);

    for (let i = 0; i < tokenIdsNumber.length; i += 1) {
      inputIds[i] = BigInt(tokenIdsNumber[i]);
      attentionMask[i] = 1n;
    }

    return { inputIds, attentionMask, tokenIdsNumber };
  }

  private normalize(text: string): string {
    const normalized = normalizeWithPrecompiledMap(text, this.precompiledCharsMap);
    return this.collapseRepeatedSpaces
      ? normalized.replace(/ {2,}/gu, ' ')
      : normalized;
  }

  private applyMetaspace(text: string): string {
    if (text.length === 0) {
      return '';
    }
    const hasLeadingSpace = text.startsWith(' ');
    const withPrefix =
      this.addPrefixSpace && !hasLeadingSpace ? ` ${text}` : text;
    return withPrefix.replace(/ /gu, METASPACE);
  }

  private segment(text: string): number[] {
    if (text.length === 0) {
      return [];
    }

    const characters = Array.from(text);
    const offsets = new Int32Array(characters.length + 1);
    for (let i = 0; i < characters.length; i += 1) {
      offsets[i + 1] = offsets[i] + characters[i].length;
    }

    const bestScore = new Float64Array(characters.length + 1);
    bestScore.fill(Number.NEGATIVE_INFINITY);
    bestScore[0] = 0;
    const previousPosition = new Int32Array(characters.length + 1);
    previousPosition.fill(-1);
    const previousToken = new Int32Array(characters.length + 1);
    previousToken.fill(-1);

    for (let start = 0; start < characters.length; start += 1) {
      if (!Number.isFinite(bestScore[start])) {
        continue;
      }

      const lastEnd = Math.min(
        characters.length,
        start + this.maxPieceLength,
      );
      let hasMatchingPiece = false;
      for (let end = start + 1; end <= lastEnd; end += 1) {
        const piece = text.slice(offsets[start], offsets[end]);
        const tokenId = this.vocab.get(piece);
        if (tokenId === undefined || tokenId === this.unkId) {
          continue;
        }

        hasMatchingPiece = true;
        const candidateScore = bestScore[start] + this.scores[tokenId];
        if (candidateScore > bestScore[end]) {
          bestScore[end] = candidateScore;
          previousPosition[end] = start;
          previousToken[end] = tokenId;
        }
      }

      const next = start + 1;
      const unknownScore = bestScore[start] + this.unknownScore;
      if (!hasMatchingPiece || unknownScore > bestScore[next]) {
        bestScore[next] = unknownScore;
        previousPosition[next] = start;
        previousToken[next] = this.unkId;
      }
    }

    const tokenIds: number[] = [];
    let position = characters.length;
    while (position > 0) {
      const previous = previousPosition[position];
      const tokenId = previousToken[position];
      if (previous < 0 || tokenId < 0) {
        throw new Error(`Could not segment normalized text at character ${position}.`);
      }
      tokenIds.push(tokenId);
      position = previous;
    }
    tokenIds.reverse();
    return tokenIds;
  }
}

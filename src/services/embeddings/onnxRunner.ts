import * as FileSystem from 'expo-file-system/legacy';

import type { TokenizerResult } from './tokenizer';

const MODEL_DIRECTORY = 'models/e5-small/';
const MODEL_FILE = 'model_quantized.onnx';
const TOKENIZER_FILE = 'tokenizer.json';
const MODEL_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
const MODEL_SIZE_BYTES = 118_308_185;
const TOKENIZER_SIZE_BYTES = 17_082_730;
const HIDDEN_SIZE = 384;
const BASE_URL = `https://huggingface.co/Xenova/multilingual-e5-small/resolve/${MODEL_REVISION}`;

export interface ModelFileStatus {
  readonly uri: string;
  readonly exists: boolean;
  readonly sizeBytes: number | null;
  readonly expectedSizeBytes: number;
  readonly isValid: boolean;
}

export interface ModelFilesStatus {
  readonly model: ModelFileStatus;
  readonly tokenizer: ModelFileStatus;
  readonly ready: boolean;
}

export interface DownloadProgress {
  readonly file: 'model' | 'tokenizer';
  readonly bytesWritten: number;
  readonly bytesExpected: number;
  readonly fraction: number | null;
}

export interface EmbeddingResult {
  readonly embedding: Float32Array;
  readonly inferenceTimeMs: number;
}

function getModelDirectoryUri(): string {
  const documentDirectory = FileSystem.documentDirectory;
  if (!documentDirectory) {
    throw new Error('Expo document directory is unavailable on this platform.');
  }
  return `${documentDirectory}${MODEL_DIRECTORY}`;
}

async function getFileStatus(
  uri: string,
  expectedSizeBytes: number,
): Promise<ModelFileStatus> {
  const info = await FileSystem.getInfoAsync(uri);
  const sizeBytes = info.exists && !info.isDirectory ? info.size ?? null : null;
  return {
    uri,
    exists: info.exists && !info.isDirectory,
    sizeBytes,
    expectedSizeBytes,
    isValid: sizeBytes === expectedSizeBytes,
  };
}

export async function getModelFilesStatus(): Promise<ModelFilesStatus> {
  const directoryUri = getModelDirectoryUri();
  const [model, tokenizer] = await Promise.all([
    getFileStatus(`${directoryUri}${MODEL_FILE}`, MODEL_SIZE_BYTES),
    getFileStatus(`${directoryUri}${TOKENIZER_FILE}`, TOKENIZER_SIZE_BYTES),
  ]);
  return { model, tokenizer, ready: model.isValid && tokenizer.isValid };
}

async function downloadFile(
  url: string,
  uri: string,
  expectedSizeBytes: number,
  file: DownloadProgress['file'],
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  const existing = await getFileStatus(uri, expectedSizeBytes);
  if (existing.isValid) {
    return;
  }
  if (existing.exists) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }

  const task = FileSystem.createDownloadResumable(
    url,
    uri,
    {},
    ({ totalBytesExpectedToWrite, totalBytesWritten }) => {
      const fraction =
        totalBytesExpectedToWrite > 0
          ? Math.min(1, totalBytesWritten / totalBytesExpectedToWrite)
          : null;
      onProgress?.({
        file,
        bytesWritten: totalBytesWritten,
        bytesExpected: totalBytesExpectedToWrite,
        fraction,
      });
    },
  );

  let result: FileSystem.FileSystemDownloadResult | undefined;
  try {
    result = await task.downloadAsync();
  } catch (error) {
    throw new Error(
      `Failed to download ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!result) {
    throw new Error(`Download of ${file} was cancelled.`);
  }
  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    throw new Error(`Download of ${file} failed with HTTP ${result.status}.`);
  }

  const downloaded = await getFileStatus(uri, expectedSizeBytes);
  if (!downloaded.isValid) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    throw new Error(
      `Downloaded ${file} has an unexpected size: ${String(downloaded.sizeBytes)} bytes.`,
    );
  }
}

export async function downloadModelFiles(
  onProgress?: (progress: DownloadProgress) => void,
): Promise<ModelFilesStatus> {
  const directoryUri = getModelDirectoryUri();
  await FileSystem.makeDirectoryAsync(directoryUri, { intermediates: true });

  await downloadFile(
    `${BASE_URL}/onnx/${MODEL_FILE}?download=true`,
    `${directoryUri}${MODEL_FILE}`,
    MODEL_SIZE_BYTES,
    'model',
    onProgress,
  );
  await downloadFile(
    `${BASE_URL}/${TOKENIZER_FILE}?download=true`,
    `${directoryUri}${TOKENIZER_FILE}`,
    TOKENIZER_SIZE_BYTES,
    'tokenizer',
    onProgress,
  );
  return getModelFilesStatus();
}

export class OnnxEmbeddingRunner {
  private session: import('onnxruntime-react-native').InferenceSession | null = null;
  private ort: typeof import('onnxruntime-react-native') | null = null;

  get isInitialized(): boolean {
    return this.session !== null;
  }

  async initialize(modelUri?: string): Promise<number> {
    if (this.session) {
      return 0;
    }

    const modelFile = modelUri
      ? await getFileStatus(modelUri, MODEL_SIZE_BYTES)
      : (await getModelFilesStatus()).model;
    if (!modelFile.isValid) {
      throw new Error('The ONNX model is missing or has an invalid size. Download it first.');
    }

    const startedAt = Date.now();
    let ort: typeof import('onnxruntime-react-native');
    try {
      ort = await import('onnxruntime-react-native');
    } catch (error) {
      throw new Error(
        `Could not load the ONNX Runtime native module. Rebuild the Android development client after prebuild. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const session = await ort.InferenceSession.create(modelFile.uri);
    this.ort = ort;
    this.session = session;
    return Date.now() - startedAt;
  }

  async embed(tokens: TokenizerResult): Promise<EmbeddingResult> {
    const session = this.session;
    if (!session) {
      throw new Error('ONNX session is not initialized.');
    }
    const ort = this.ort;
    if (!ort) {
      throw new Error('ONNX Runtime module is not loaded.');
    }

    const sequenceLength = tokens.inputIds.length;
    if (
      sequenceLength === 0 ||
      tokens.attentionMask.length !== sequenceLength ||
      tokens.tokenIdsNumber.length !== sequenceLength
    ) {
      throw new Error('Token IDs and attention mask must have the same non-zero length.');
    }

    const inputNames = new Set(session.inputNames);
    if (!inputNames.has('input_ids') || !inputNames.has('attention_mask')) {
      throw new Error(
        `Unsupported ONNX inputs: ${session.inputNames.join(', ')}.`,
      );
    }

    const dims = [1, sequenceLength];
    const feeds: Record<string, import('onnxruntime-react-native').Tensor> = {
      input_ids: new ort.Tensor('int64', tokens.inputIds, dims),
      attention_mask: new ort.Tensor('int64', tokens.attentionMask, dims),
    };
    if (inputNames.has('token_type_ids')) {
      feeds.token_type_ids = new ort.Tensor(
        'int64',
        new BigInt64Array(sequenceLength),
        dims,
      );
    }
    for (const inputName of inputNames) {
      if (!Object.prototype.hasOwnProperty.call(feeds, inputName)) {
        throw new Error(`Unsupported required ONNX input: ${inputName}.`);
      }
    }

    const startedAt = Date.now();
    const outputs = await session.run(feeds);
    const inferenceTimeMs = Date.now() - startedAt;
    let hiddenState: import('onnxruntime-react-native').Tensor | undefined;

    for (const outputName of session.outputNames) {
      const output = outputs[outputName];
      if (!output || output.type !== 'float32') {
        continue;
      }
      if (
        output.dims.length === 3 &&
        output.dims[0] === 1 &&
        output.dims[1] === sequenceLength &&
        output.dims[2] === HIDDEN_SIZE
      ) {
        hiddenState = output;
        break;
      }
    }

    if (!hiddenState || !(hiddenState.data instanceof Float32Array)) {
      throw new Error(
        `Could not find a float32 [1, ${sequenceLength}, ${HIDDEN_SIZE}] hidden-state output. ` +
          `Available outputs: ${session.outputNames.join(', ')}.`,
      );
    }

    let attendedTokens = 0;
    const pooled = new Float32Array(HIDDEN_SIZE);
    for (let tokenIndex = 0; tokenIndex < sequenceLength; tokenIndex += 1) {
      if (tokens.attentionMask[tokenIndex] === 0n) {
        continue;
      }
      attendedTokens += 1;
      const offset = tokenIndex * HIDDEN_SIZE;
      for (let dimension = 0; dimension < HIDDEN_SIZE; dimension += 1) {
        pooled[dimension] += hiddenState.data[offset + dimension];
      }
    }
    if (attendedTokens === 0) {
      throw new Error('Cannot pool an embedding with an empty attention mask.');
    }

    let squaredNorm = 0;
    for (let dimension = 0; dimension < HIDDEN_SIZE; dimension += 1) {
      pooled[dimension] /= attendedTokens;
      squaredNorm += pooled[dimension] * pooled[dimension];
    }
    const norm = Math.sqrt(squaredNorm);
    if (!Number.isFinite(norm) || norm === 0) {
      throw new Error('The pooled embedding has an invalid L2 norm.');
    }
    for (let dimension = 0; dimension < HIDDEN_SIZE; dimension += 1) {
      pooled[dimension] /= norm;
    }

    return { embedding: pooled, inferenceTimeMs };
  }
}

export function cosineSimilarity(
  a: Float32Array,
  b: Float32Array,
): number {
  if (a.length !== b.length) {
    throw new RangeError('Vectors must have the same dimension.');
  }
  if (a.length === 0) {
    throw new RangeError('Vectors must not be empty.');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    throw new RangeError('Cosine similarity is undefined for zero vectors.');
  }
  return dotProduct / Math.sqrt(normA * normB);
}

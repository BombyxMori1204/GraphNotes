import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  cosineSimilarity,
  downloadModelFiles,
  getModelFilesStatus,
  OnnxEmbeddingRunner,
  type DownloadProgress,
  type ModelFilesStatus,
} from '@/services/embeddings/onnxRunner';
import {
  SentencePieceTokenizer,
  type TokenizerResult,
} from '@/services/embeddings/tokenizer';

const TEST_PHRASES = [
  'query: как настроить локальный поиск на телефоне',
  'passage: полнотекстовый поиск SQLite FTS5 и векторные эмбеддинги работают офлайн на Android',
  'passage: рецепт тонких блинов на молоке с яйцами и мукой',
  'query: offline semantic search mobile database',
] as const;

interface PhraseResult {
  readonly phrase: string;
  readonly tokens: TokenizerResult;
  readonly tokenizationTimeMs: number;
  readonly embedding: Float32Array;
  readonly inferenceTimeMs: number;
}

interface InitializationTimings {
  readonly tokenizerMs: number;
  readonly sessionMs: number;
}

function formatMegabytes(sizeBytes: number | null): string {
  return sizeBytes === null ? '—' : `${(sizeBytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function measureNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function formatProgress(progress: DownloadProgress): string {
  const fileLabel = progress.file === 'model' ? 'Модель' : 'Токенизатор';
  const written = formatMegabytes(progress.bytesWritten);
  const expected =
    progress.bytesExpected > 0
      ? formatMegabytes(progress.bytesExpected)
      : 'размер неизвестен';
  const percentage =
    progress.fraction === null
      ? ''
      : ` (${Math.round(progress.fraction * 100)}%)`;
  return `${fileLabel}: ${written} / ${expected}${percentage}`;
}

function norm(vector: Float32Array): number {
  let squaredNorm = 0;
  for (const value of vector) {
    squaredNorm += value * value;
  }
  return Math.sqrt(squaredNorm);
}

export default function EmbeddingsPrototypeScreen() {
  const runnerRef = useRef(new OnnxEmbeddingRunner());
  const tokenizerRef = useRef<SentencePieceTokenizer | null>(null);
  const [filesStatus, setFilesStatus] = useState<ModelFilesStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState('');
  const [initialization, setInitialization] =
    useState<InitializationTimings | null>(null);
  const [results, setResults] = useState<PhraseResult[] | null>(null);
  const [manualText, setManualText] = useState('');
  const [manualResult, setManualResult] = useState<PhraseResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    void getModelFilesStatus()
      .then((status) => {
        if (isMounted) {
          setFilesStatus(status);
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setErrorMessage(getErrorMessage(error));
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const refreshFilesStatus = async (): Promise<ModelFilesStatus> => {
    const status = await getModelFilesStatus();
    setFilesStatus(status);
    return status;
  };

  const onDownload = async () => {
    setBusy(true);
    setErrorMessage(null);
    setDownloadMessage('Подготовка загрузки…');
    try {
      const status = await downloadModelFiles((progress) => {
        setDownloadMessage(formatProgress(progress));
      });
      setFilesStatus(status);
      setDownloadMessage(
        status.ready ? 'Файлы модели загружены и проверены.' : 'Файлы загружены не полностью.',
      );
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const onInitialize = async () => {
    setBusy(true);
    setErrorMessage(null);
    try {
      const status = await refreshFilesStatus();
      if (!status.ready) {
        throw new Error('Сначала скачайте оба файла модели.');
      }

      const tokenizerStartedAt = measureNow();
      const tokenizer = await SentencePieceTokenizer.fromFile(status.tokenizer.uri);
      const tokenizerMs = measureNow() - tokenizerStartedAt;
      tokenizerRef.current = tokenizer;

      const sessionMs = await runnerRef.current.initialize(status.model.uri);
      setInitialization({ tokenizerMs, sessionMs });
      setResults(null);
      setManualResult(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const runPhrase = async (
    phrase: string,
    tokenizer: SentencePieceTokenizer,
  ): Promise<PhraseResult> => {
    const tokenizationStartedAt = measureNow();
    const tokens = tokenizer.encode(phrase);
    const tokenizationTimeMs = measureNow() - tokenizationStartedAt;
    const inference = await runnerRef.current.embed(tokens);
    return {
      phrase,
      tokens,
      tokenizationTimeMs,
      embedding: inference.embedding,
      inferenceTimeMs: inference.inferenceTimeMs,
    };
  };

  const onRunTests = async () => {
    const tokenizer = tokenizerRef.current;
    if (!tokenizer || !runnerRef.current.isInitialized) {
      setErrorMessage('Сначала инициализируйте токенизатор и ONNX-сессию.');
      return;
    }

    setBusy(true);
    setErrorMessage(null);
    try {
      const nextResults: PhraseResult[] = [];
      for (const phrase of TEST_PHRASES) {
        nextResults.push(await runPhrase(phrase, tokenizer));
      }
      setResults(nextResults);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const onRunManual = async () => {
    const tokenizer = tokenizerRef.current;
    if (!tokenizer || !runnerRef.current.isInitialized) {
      setErrorMessage('Сначала инициализируйте токенизатор и ONNX-сессию.');
      return;
    }
    if (manualText.trim().length === 0) {
      setErrorMessage('Введите фразу для вычисления эмбеддинга.');
      return;
    }

    setBusy(true);
    setErrorMessage(null);
    try {
      setManualResult(await runPhrase(manualText, tokenizer));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async () => {
    setErrorMessage(null);
    try {
      await refreshFilesStatus();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/');
              }
            }}
            style={styles.backButton}
          >
            <Text style={styles.backButtonText}>Назад</Text>
          </Pressable>
          <Text style={styles.title}>Диагностика эмбеддингов</Text>
          <Text style={styles.subtitle}>multilingual-e5-small · ONNX INT8</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Файлы модели</Text>
          <Text style={styles.statusLine}>
            ONNX: {filesStatus?.model.isValid ? 'готов' : 'не загружен'} ·{' '}
            {formatMegabytes(filesStatus?.model.sizeBytes ?? null)}
          </Text>
          <Text style={styles.statusLine}>
            Tokenizer: {filesStatus?.tokenizer.isValid ? 'готов' : 'не загружен'} ·{' '}
            {formatMegabytes(filesStatus?.tokenizer.sizeBytes ?? null)}
          </Text>
          <View style={styles.buttonRow}>
            <ActionButton
              disabled={busy}
              label="1. Скачать файлы модели"
              onPress={() => void onDownload()}
            />
            <ActionButton
              disabled={busy}
              label="Обновить статус"
              onPress={() => void updateStatus()}
              secondary
            />
          </View>
          {downloadMessage ? <Text style={styles.detail}>{downloadMessage}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Инициализация</Text>
          <ActionButton
            disabled={busy}
            label="2. Инициализировать (холодный старт)"
            onPress={() => void onInitialize()}
          />
          {initialization ? (
            <View style={styles.metrics}>
              <Text style={styles.detail}>
                Чтение и парсинг tokenizer.json: {initialization.tokenizerMs.toFixed(1)} мс
              </Text>
              <Text style={styles.detail}>
                Создание ONNX-сессии: {initialization.sessionMs.toFixed(1)} мс
              </Text>
              {initialization.sessionMs === 0 ? (
                <Text style={styles.hint}>Сессия уже была создана в этом экране.</Text>
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Фиксированный набор</Text>
          <ActionButton
            disabled={busy}
            label="3. Прогнать тест эмбеддингов"
            onPress={() => void onRunTests()}
          />
          {results ? (
            <>
              {results.map((result, index) => (
                <PhraseCard
                  key={result.phrase}
                  index={index + 1}
                  result={result}
                />
              ))}
              <View style={styles.similarities}>
                <Text style={styles.subsectionTitle}>Косинусная близость</Text>
                <Text style={styles.detail}>
                  sim(1, 2): {cosineSimilarity(results[0].embedding, results[1].embedding).toFixed(4)}
                </Text>
                <Text style={styles.detail}>
                  sim(1, 3): {cosineSimilarity(results[0].embedding, results[2].embedding).toFixed(4)}
                </Text>
                <Text style={styles.detail}>
                  sim(4, 2): {cosineSimilarity(results[3].embedding, results[1].embedding).toFixed(4)}
                </Text>
              </View>
            </>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Ручной ввод</Text>
          <TextInput
            accessibilityLabel="Фраза для эмбеддинга"
            multiline
            onChangeText={setManualText}
            placeholder="Введите фразу (для E5 используйте query: или passage:)"
            placeholderTextColor="#718096"
            style={styles.input}
            value={manualText}
          />
          <ActionButton
            disabled={busy}
            label="Вычислить эмбеддинг"
            onPress={() => void onRunManual()}
          />
          {manualResult ? <PhraseCard index={null} result={manualResult} /> : null}
        </View>

        {busy ? (
          <View style={styles.loading}>
            <ActivityIndicator />
            <Text style={styles.detail}>Выполняется…</Text>
          </View>
        ) : null}
        {errorMessage ? (
          <View accessibilityRole="alert" style={styles.error}>
            <Text style={styles.errorTitle}>Ошибка</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

interface ActionButtonProps {
  readonly disabled: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly secondary?: boolean;
}

function ActionButton({
  disabled,
  label,
  onPress,
  secondary = false,
}: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        secondary ? styles.secondaryButton : null,
        disabled ? styles.disabledButton : null,
      ]}
    >
      <Text style={[styles.buttonText, secondary ? styles.secondaryButtonText : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

interface PhraseCardProps {
  readonly index: number | null;
  readonly result: PhraseResult;
}

function PhraseCard({ index, result }: PhraseCardProps) {
  return (
    <View style={styles.resultCard}>
      <Text style={styles.subsectionTitle}>
        {index === null ? 'Ручная фраза' : `Фраза ${index}`}
      </Text>
      <Text selectable style={styles.phrase}>{result.phrase}</Text>
      <Text selectable style={styles.detail}>
        tokenIds: [{result.tokens.tokenIdsNumber.join(', ')}]
      </Text>
      <Text style={styles.detail}>
        Токенизация: {result.tokenizationTimeMs.toFixed(1)} мс · Инференс:{' '}
        {result.inferenceTimeMs.toFixed(1)} мс
      </Text>
      <Text style={styles.detail}>L2-норма: {norm(result.embedding).toFixed(4)}</Text>
      <Text selectable style={styles.detail}>
        Первые 5 значений: {Array.from(result.embedding.slice(0, 5), (value) => value.toFixed(6)).join(', ')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F3F5F9',
  },
  content: {
    gap: 14,
    padding: 16,
    paddingBottom: 36,
  },
  header: {
    gap: 6,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  backButtonText: {
    color: '#2457D6',
    fontWeight: '600',
  },
  title: {
    color: '#152238',
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: '#5D6A7E',
  },
  card: {
    gap: 10,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    padding: 14,
  },
  sectionTitle: {
    color: '#152238',
    fontSize: 17,
    fontWeight: '700',
  },
  subsectionTitle: {
    color: '#263850',
    fontSize: 15,
    fontWeight: '700',
  },
  statusLine: {
    color: '#34445C',
    fontSize: 13,
  },
  buttonRow: {
    gap: 8,
  },
  button: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#2457D6',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#B8C5D8',
    backgroundColor: '#FFFFFF',
  },
  disabledButton: {
    opacity: 0.55,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  secondaryButtonText: {
    color: '#2457D6',
  },
  detail: {
    color: '#34445C',
    fontSize: 13,
    lineHeight: 19,
  },
  hint: {
    color: '#718096',
    fontSize: 12,
  },
  metrics: {
    gap: 4,
  },
  similarities: {
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#DCE3ED',
    paddingTop: 10,
  },
  resultCard: {
    gap: 6,
    borderRadius: 8,
    backgroundColor: '#F5F7FB',
    padding: 10,
  },
  phrase: {
    color: '#263850',
    fontSize: 13,
  },
  input: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: '#C8D2E0',
    borderRadius: 8,
    color: '#152238',
    padding: 10,
    textAlignVertical: 'top',
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 10,
  },
  error: {
    gap: 4,
    borderRadius: 8,
    backgroundColor: '#FDECEC',
    padding: 12,
  },
  errorTitle: {
    color: '#9B1C1C',
    fontWeight: '700',
  },
  errorText: {
    color: '#7A2020',
    fontSize: 13,
  },
});

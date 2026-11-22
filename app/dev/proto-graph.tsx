import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Canvas,
  Circle,
  Line,
  Text as SkiaText,
  matchFont,
  vec,
} from '@shopify/react-native-skia';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

interface TopicNode extends SimulationNodeDatum {
  id: string;
  label: string;
  keywords: string[];
  weight: number;
  radius: number;
  color: string;
}

interface TopicLink extends SimulationLinkDatum<TopicNode> {
  source: string | TopicNode;
  target: string | TopicNode;
}

const INITIAL_NODES: TopicNode[] = [
  { id: 'inbox', label: 'Входящие', keywords: ['буфер', 'новое', 'неразобранное', 'inbox'], weight: 5, radius: 46, color: '#F97316' },
  { id: 'diploma', label: 'Диплом', keywords: ['статья', 'исследование', 'график', 'вуз'], weight: 5, radius: 44, color: '#3B82F6' },
  { id: 'rn', label: 'React Native', keywords: ['expo', 'typescript', 'android', 'мобилка'], weight: 4, radius: 40, color: '#06B6D4' },
  { id: 'ux', label: 'UX и Фиттс', keywords: ['эргономика', 'палец', 'хик', 'интерфейс', '20:9'], weight: 4, radius: 40, color: '#8B5CF6' },
  { id: 'skia', label: 'Skia', keywords: ['canvas', 'графика', 'рендер', 'граф'], weight: 4, radius: 38, color: '#EC4899' },
  { id: 'ollama', label: 'Ollama', keywords: ['llm', 'агент', 'qwen', 'gemma', 'ии'], weight: 4, radius: 38, color: '#10B981' },
  { id: 'python', label: 'Python', keywords: ['скрипт', 'onnx', 'эмбеддинги', 'ml'], weight: 3, radius: 34, color: '#EAB308' },
  { id: 'sqlite', label: 'SQLite', keywords: ['бд', 'база', 'данные', 'таблицы'], weight: 3, radius: 34, color: '#6366F1' },
  { id: 'articles', label: 'Статьи', keywords: ['чтение', 'pdf', 'наука', 'ссылки'], weight: 3, radius: 34, color: '#14B8A6' },
  { id: 'ideas', label: 'Идеи', keywords: ['заметки', 'мысли', 'проекты'], weight: 2, radius: 30, color: '#F43F5E' },
  { id: 'design', label: 'Дизайн', keywords: ['цвет', 'шрифт', 'макет', 'ui'], weight: 2, radius: 30, color: '#A855F7' },
  { id: 'books', label: 'Книги', keywords: ['читать', 'литература', 'конспект'], weight: 1, radius: 28, color: '#64748B' },
];

const INITIAL_LINKS: TopicLink[] = [
  { source: 'inbox', target: 'ideas' },
  { source: 'inbox', target: 'articles' },
  { source: 'diploma', target: 'ux' },
  { source: 'diploma', target: 'rn' },
  { source: 'diploma', target: 'articles' },
  { source: 'rn', target: 'skia' },
  { source: 'rn', target: 'sqlite' },
  { source: 'ux', target: 'design' },
  { source: 'ux', target: 'skia' },
  { source: 'ollama', target: 'python' },
  { source: 'ollama', target: 'rn' },
  { source: 'python', target: 'sqlite' },
  { source: 'articles', target: 'books' },
  { source: 'ideas', target: 'design' },
];

function computeRelevance(node: TopicNode, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const label = node.label.toLowerCase();
  if (label === q) return 1;
  if (label.startsWith(q)) return 0.9;
  if (label.includes(q)) return 0.75;

  for (const kw of node.keywords) {
    const k = kw.toLowerCase();
    if (k === q) return 0.85;
    if (k.includes(q)) return 0.6;
  }

  return 0;
}

export default function GraphPrototypeScreen() {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [canvasSize, setCanvasSize] = useState({
    width: screenWidth,
    height: Math.max(300, screenHeight - 210),
  });
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<TopicNode[]>([]);
  const [links, setLinks] = useState<TopicLink[]>([]);

  const simRef = useRef<Simulation<TopicNode, TopicLink> | null>(null);
  const nodesRef = useRef<TopicNode[]>([]);

  const font = useMemo(
    () =>
      matchFont({
        fontFamily: Platform.select({ android: 'sans-serif', default: 'System' }),
        fontSize: 12,
      }),
    []
  );

  const anchorX = canvasSize.width * 0.65;
  const anchorY = canvasSize.height * 0.75;

  const relevanceMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const n of INITIAL_NODES) {
      map[n.id] = computeRelevance(n, query);
    }
    return map;
  }, [query]);

  // Инициализация симуляции
  useEffect(() => {
    const { width, height } = canvasSize;
    const simNodes: TopicNode[] = INITIAL_NODES.map((n, i) => ({
      ...n,
      x: width / 2 + Math.cos(i) * 40,
      y: height / 2 + Math.sin(i) * 40,
    }));
    const simLinks: TopicLink[] = INITIAL_LINKS.map((l) => ({ ...l }));

    nodesRef.current = simNodes;

    const simulation = forceSimulation<TopicNode>(simNodes)
      .force(
        'link',
        forceLink<TopicNode, TopicLink>(simLinks)
          .id((d) => d.id)
          .distance(105)
          .strength(0.35)
      )
      .force('charge', forceManyBody().strength(-160))
      .force('center', forceCenter(width / 2, height / 2))
      .force(
        'collide',
        forceCollide<TopicNode>().radius((d) => d.radius + 8)
      )
      .on('tick', () => {
        for (const n of simNodes) {
          const pad = n.radius + 4;
          n.x = Math.max(pad, Math.min(width - pad, n.x ?? width / 2));
          n.y = Math.max(pad, Math.min(height - pad, n.y ?? height / 2));
        }
        setNodes([...simNodes]);
        setLinks([...simLinks]);
      });

    simRef.current = simulation;

    return () => {
      simulation.stop();
    };
  }, [canvasSize.width, canvasSize.height]);

  // Реакция физики на поисковый запрос
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;

    const isSearching = query.trim().length > 0;
    const centerX = canvasSize.width / 2;
    const centerY = canvasSize.height / 2;

    if (isSearching) {
      sim.force('center', null);
      sim.force(
        'x',
        forceX<TopicNode>((d) => {
          const r = relevanceMap[d.id] ?? 0;
          return r > 0 ? anchorX : centerX;
        }).strength((d) => {
          const r = relevanceMap[d.id] ?? 0;
          return r > 0 ? 0.35 * r : 0.05;
        })
      );
      sim.force(
        'y',
        forceY<TopicNode>((d) => {
          const r = relevanceMap[d.id] ?? 0;
          return r > 0 ? anchorY : anchorY * 0.25;
        }).strength((d) => {
          const r = relevanceMap[d.id] ?? 0;
          return r > 0 ? 0.35 * r : 0.12;
        })
      );
    } else {
      sim.force('x', null);
      sim.force('y', null);
      sim.force('center', forceCenter(centerX, centerY));
    }

    sim.alpha(0.7).restart();
  }, [query, relevanceMap, anchorX, anchorY, canvasSize.width, canvasSize.height]);

  // Обработка касания по узлам
  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .onEnd((e) => {
          let hit: TopicNode | null = null;
          for (const n of nodesRef.current) {
            const dx = e.x - (n.x ?? 0);
            const dy = e.y - (n.y ?? 0);
            if (Math.hypot(dx, dy) <= n.radius) {
              hit = n;
              break;
            }
          }
          setSelectedId(hit ? hit.id : null);
        }),
    []
  );

  const selectedNode = useMemo(
    () => INITIAL_NODES.find((n) => n.id === selectedId) ?? null,
    [selectedId]
  );

  const isSearching = query.trim().length > 0;

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Верхняя панель: кнопка Назад + инфо о выбранном узле */}
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>← Назад</Text>
          </Pressable>

          {selectedNode ? (
            <View style={styles.infoPill}>
              <Text style={styles.infoTitle} numberOfLines={1}>
                {selectedNode.label}
              </Text>
              <Text style={styles.infoMeta}>
                вес: {selectedNode.weight} · r: {(relevanceMap[selectedNode.id] ?? 0).toFixed(2)}
              </Text>
            </View>
          ) : (
            <Text style={styles.hintText}>Коснитесь узла или начните поиск</Text>
          )}
        </View>

        {/* Область графа */}
        <View
          style={styles.canvasWrap}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            if (width > 0 && height > 0) {
              setCanvasSize({ width, height });
            }
          }}
        >
          <GestureDetector gesture={tapGesture}>
            <Canvas style={styles.flex}>
              {/* Якорь у большого пальца */}
              <Circle
                cx={anchorX}
                cy={anchorY}
                r={54}
                color="rgba(255, 255, 255, 0.18)"
                style="stroke"
                strokeWidth={1.5}
              />
              <Circle
                cx={anchorX}
                cy={anchorY}
                r={4}
                color="rgba(255, 255, 255, 0.3)"
              />

              {/* Рёбра */}
              {links.map((link, idx) => {
                const s = link.source as TopicNode;
                const t = link.target as TopicNode;
                if (typeof s !== 'object' || typeof t !== 'object') return null;
                return (
                  <Line
                    key={idx}
                    p1={vec(s.x ?? 0, s.y ?? 0)}
                    p2={vec(t.x ?? 0, t.y ?? 0)}
                    color="rgba(148, 163, 184, 0.25)"
                    strokeWidth={1.5}
                  />
                );
              })}

              {/* Узлы */}
              {nodes.map((node) => {
                const x = node.x ?? 0;
                const y = node.y ?? 0;
                const r = relevanceMap[node.id] ?? 0;
                const isSelected = node.id === selectedId;
                const opacity = isSearching && r === 0 ? 0.25 : 1;
                const textWidth = font
                  ? font.measureText(node.label).width
                  : node.label.length * 6.5;

                return (
                  <React.Fragment key={node.id}>
                    <Circle
                      cx={x}
                      cy={y}
                      r={node.radius}
                      color={node.color}
                      opacity={opacity}
                    />
                    {(isSelected || (isSearching && r > 0)) && (
                      <Circle
                        cx={x}
                        cy={y}
                        r={node.radius + 2}
                        color={isSelected ? '#FFFFFF' : '#FDE047'}
                        style="stroke"
                        strokeWidth={isSelected ? 3 : 2}
                      />
                    )}
                    {font && (
                      <SkiaText
                        x={x - textWidth / 2}
                        y={y + 4}
                        text={node.label}
                        font={font}
                        color="#FFFFFF"
                        opacity={opacity}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </Canvas>
          </GestureDetector>
        </View>

        {/* Поиск снизу (зона большого пальца) */}
        <View style={styles.searchBar}>
          <TextInput
            style={styles.searchInput}
            placeholder="Поиск темы (например: диплом, skia, ии)..."
            placeholderTextColor="#94A3B8"
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} style={styles.clearButton}>
              <Text style={styles.clearText}>✕</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  flex: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  backButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#1E293B',
  },
  backText: {
    color: '#E2E8F0',
    fontWeight: '600',
    fontSize: 13,
  },
  infoPill: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  infoTitle: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  infoMeta: {
    color: '#94A3B8',
    fontSize: 11,
  },
  hintText: {
    flex: 1,
    color: '#64748B',
    fontSize: 12,
    textAlign: 'right',
  },
  canvasWrap: {
    flex: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#1E293B',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    height: 44,
    backgroundColor: '#0F172A',
    color: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#334155',
  },
  clearButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
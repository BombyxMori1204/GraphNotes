import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  Canvas,
  Circle,
  Line,
  Path,
  RoundedRect,
  Skia,
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
import Animated, {
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import type { Item } from '@/types';
import {
  createItem,
  getAllItems,
  getInboxCount,
  toggleItemRead,
} from '@/db/repositories/itemsRepo';
import {
  getAllTopicsWithStats,
  getTopicEdges,
  type TopicEdge,
  type TopicWithStats,
} from '@/db/repositories/topicsRepo';
import { QuickAddModal } from '@/features/items/QuickAddModal';
import { TopicBottomSheet } from '@/features/items/TopicBottomSheet';
import { getTopicNodeDiameter, mmToDp } from '@/features/graph/metrics';

const SEARCH_PANEL_HEIGHT = mmToDp(12);
const SEARCH_PANEL_HIDE_OFFSET = mmToDp(3);

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
  weight: number;
}

interface TopicMetrics {
  totalCount: number;
  readCount: number;
  progress: number;
  inboxCount: number;
}

const TOPIC_KEYWORDS: Record<string, string[]> = {
  diploma: ['статья', 'исследование', 'график', 'вуз'],
  rn: ['expo', 'typescript', 'android', 'мобилка'],
  ux: ['эргономика', 'палец', 'хик', 'интерфейс', '20:9'],
  skia: ['canvas', 'графика', 'рендер', 'граф'],
  ollama: ['llm', 'агент', 'qwen', 'gemma', 'ии'],
  python: ['скрипт', 'onnx', 'эмбеддинги', 'ml'],
  sqlite: ['бд', 'база', 'данные', 'таблицы'],
  articles: ['чтение', 'pdf', 'наука', 'ссылки'],
  ideas: ['заметки', 'мысли', 'проекты'],
  design: ['цвет', 'шрифт', 'макет', 'ui'],
  books: ['читать', 'литература', 'конспект'],
};

const FALLBACK_TOPIC_COLORS = [
  '#3B82F6',
  '#06B6D4',
  '#8B5CF6',
  '#EC4899',
  '#10B981',
  '#EAB308',
  '#6366F1',
  '#14B8A6',
  '#F43F5E',
  '#A855F7',
  '#64748B',
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

function loadGraphData() {
  return Promise.all([
    getAllTopicsWithStats(),
    getTopicEdges(),
    getInboxCount(),
    getAllItems(),
  ]);
}

export default function GraphPrototypeScreen() {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const [canvasSize, setCanvasSize] = useState({
    width: screenWidth,
    height: Math.max(300, screenHeight - 210),
  });
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetTopicId, setSheetTopicId] = useState<string | null>(null);
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [topics, setTopics] = useState<TopicWithStats[]>([]);
  const [topicEdges, setTopicEdges] = useState<TopicEdge[]>([]);
  const [inboxCount, setInboxCount] = useState(0);
  const [nodes, setNodes] = useState<TopicNode[]>([]);
  const [links, setLinks] = useState<TopicLink[]>([]);
  const [toastMessage, setToastMessage] = useState('');

  const refreshGraphData = useCallback(async () => {
    const [loadedTopics, loadedEdges, loadedInboxCount, loadedItems] =
      await loadGraphData();
    setTopics(loadedTopics);
    setTopicEdges(loadedEdges);
    setInboxCount(loadedInboxCount);
    setItems(loadedItems);
  }, []);

  useEffect(() => {
    let isMounted = true;
    void loadGraphData()
      .then(([loadedTopics, loadedEdges, loadedInboxCount, loadedItems]) => {
        if (!isMounted) return;
        setTopics(loadedTopics);
        setTopicEdges(loadedEdges);
        setInboxCount(loadedInboxCount);
        setItems(loadedItems);
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        setToastMessage(
          `Не удалось загрузить данные: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const graphTopicNodes = useMemo<TopicNode[]>(
    () => [
      {
        id: 'inbox',
        label: 'Входящие',
        keywords: ['буфер', 'новое', 'неразобранное', 'inbox'],
        weight: 5,
        radius: getTopicNodeDiameter(inboxCount) / 2,
        color: '#F97316',
      },
      ...topics.map((topic, index) => ({
        id: topic.id,
        label: topic.name,
        keywords: TOPIC_KEYWORDS[topic.id] ?? [topic.name.toLowerCase()],
        weight: Math.max(1, topic.totalCount),
        radius: getTopicNodeDiameter(topic.totalCount) / 2,
        color: topic.color ?? FALLBACK_TOPIC_COLORS[index % FALLBACK_TOPIC_COLORS.length],
      })),
    ],
    [inboxCount, topics],
  );
  const graphTopicLinks = useMemo<TopicLink[]>(
    () =>
      topicEdges.map(({ source, target, weight }) => ({
        source,
        target,
        weight,
      })),
    [topicEdges],
  );

  const topicMetrics = useMemo(() => {
    const metrics = new Map<string, TopicMetrics>(
      [
        [
          'inbox',
          { totalCount: 0, readCount: 0, progress: 0, inboxCount },
        ],
        ...topics.map((topic) => [
          topic.id,
          {
            totalCount: topic.totalCount,
            readCount: topic.readCount,
            progress:
              topic.totalCount > 0 ? topic.readCount / topic.totalCount : 0,
            inboxCount: 0,
          },
        ] as [string, TopicMetrics]),
      ],
    );
    return metrics;
  }, [inboxCount, topics]);

  const simRef = useRef<Simulation<TopicNode, TopicLink> | null>(null);
  const topicMetricsRef = useRef(topicMetrics);
  const nodesRef = useRef<TopicNode[]>([]);
  const draggedNodeRef = useRef<TopicNode | null>(null);

  useEffect(() => {
    topicMetricsRef.current = topicMetrics;
  }, [topicMetrics]);

  useEffect(() => {
    if (!toastMessage) return;
    const timeout = setTimeout(() => setToastMessage(''), 1800);
    return () => clearTimeout(timeout);
  }, [toastMessage]);

  const font = useMemo(
    () =>
      matchFont({
        fontFamily: Platform.select({ android: 'sans-serif', default: 'System' }),
        fontSize: 12,
      }),
    []
  );
  const countFont = useMemo(
    () =>
      matchFont({
        fontFamily: Platform.select({ android: 'sans-serif', default: 'System' }),
        fontSize: 10,
      }),
    []
  );

  const anchorX = canvasSize.width * 0.65;
  const anchorY = canvasSize.height * 0.75;
  const activeHeight =
    selectedId === null ? canvasSize.height : canvasSize.height * 0.35;
  const searchBarAnimatedStyle = useAnimatedStyle(
    () => ({
      opacity: withTiming(selectedId === null ? 1 : 0, { duration: 180 }),
      height: withTiming(selectedId === null ? SEARCH_PANEL_HEIGHT : 0, {
        duration: 180,
      }),
      transform: [
        {
          translateY: withTiming(
            selectedId === null ? 0 : SEARCH_PANEL_HIDE_OFFSET,
            {
              duration: 180,
            },
          ),
        },
      ],
    }),
    [selectedId],
  );

  const relevanceMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const n of graphTopicNodes) {
      map[n.id] = computeRelevance(n, query);
    }
    return map;
  }, [graphTopicNodes, query]);

  const selectedNeighborIds = useMemo(() => {
    const neighbors = new Set<string>();
    if (selectedId === null) return neighbors;

    for (const link of graphTopicLinks) {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      if (sourceId === selectedId) neighbors.add(targetId);
      if (targetId === selectedId) neighbors.add(sourceId);
    }

    return neighbors;
  }, [graphTopicLinks, selectedId]);

  const selectedModeRef = useRef({ selectedId, neighborIds: selectedNeighborIds });

  useEffect(() => {
    selectedModeRef.current = { selectedId, neighborIds: selectedNeighborIds };
  }, [selectedId, selectedNeighborIds]);

  // Инициализация симуляции
  useEffect(() => {
    const { width, height } = canvasSize;
    const previousPositions = new Map(
      nodesRef.current.map((node) => [node.id, { x: node.x, y: node.y }]),
    );
    const simNodes: TopicNode[] = graphTopicNodes.map((n, i) => {
      const previousPosition = previousPositions.get(n.id);
      const metrics = topicMetricsRef.current.get(n.id);
      const itemCount =
        n.id === 'inbox'
          ? metrics?.inboxCount ?? 0
          : metrics?.totalCount ?? 0;
      return {
        ...n,
        radius: getTopicNodeDiameter(itemCount) / 2,
        x: previousPosition?.x ?? width / 2 + Math.cos(i) * 40,
        y: previousPosition?.y ?? height / 2 + Math.sin(i) * 40,
      };
    });
    const simLinks: TopicLink[] = graphTopicLinks.map((link) => ({ ...link }));

    nodesRef.current = simNodes;

    const simulation = forceSimulation<TopicNode>(simNodes)
      .force(
        'link',
        forceLink<TopicNode, TopicLink>(simLinks)
          .id((d) => d.id)
          .distance(105)
          .strength((link) => Math.min(0.75, 0.2 + link.weight * 0.1))
      )
      .force('charge', forceManyBody().strength(-160))
      .force('center', forceCenter(width / 2, height / 2))
      .force(
        'collide',
        forceCollide<TopicNode>().radius((d) => d.radius + 8)
      )
      .on('tick', () => {
        const { selectedId: focusedId, neighborIds } = selectedModeRef.current;
        const currentActiveHeight = focusedId === null ? height : height * 0.35;
        for (const n of simNodes) {
          const isVisible = n.id === focusedId || neighborIds.has(n.id);
          const pad = n.radius + (n.id === focusedId ? 6 : 0) + 4;
          const minY =
            focusedId !== null && !isVisible ? currentActiveHeight + pad : pad;
          const maxY =
            focusedId !== null && isVisible
              ? Math.max(pad, currentActiveHeight - pad)
              : height - pad;
          n.x = Math.max(pad, Math.min(width - pad, n.x ?? width / 2));
          n.y = Math.max(minY, Math.min(maxY, n.y ?? height / 2));
        }
        setNodes([...simNodes]);
        setLinks([...simLinks]);
      });

    simRef.current = simulation;

    return () => {
      simulation.stop();
    };
  }, [canvasSize, graphTopicLinks, graphTopicNodes]);

  useEffect(() => {
    const simulation = simRef.current;
    if (!simulation) return;

    for (const node of simulation.nodes()) {
      const metrics = topicMetrics.get(node.id);
      const itemCount =
        node.id === 'inbox'
          ? metrics?.inboxCount ?? 0
          : metrics?.totalCount ?? 0;
      node.radius = getTopicNodeDiameter(itemCount) / 2;
    }

    simulation.force(
      'collide',
      forceCollide<TopicNode>().radius((node) => node.radius + 8),
    );
    simulation.alpha(0.25).restart();
  }, [topicMetrics]);

  // Реакция физики на поисковый запрос и выбор темы
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;

    const isSearching = query.trim().length > 0;
    const centerX = canvasSize.width / 2;
    const centerY = canvasSize.height / 2;

    if (selectedId !== null) {
      const focusedX = canvasSize.width * 0.28;
      const neighborsX = canvasSize.width * 0.68;
      const focusedY = activeHeight * 0.35;
      const hiddenY =
        activeHeight + (canvasSize.height - activeHeight) * 0.55;

      sim.force('center', null);
      sim.force(
        'x',
        forceX<TopicNode>((node) =>
          node.id === selectedId
            ? focusedX
            : selectedNeighborIds.has(node.id)
              ? neighborsX
              : centerX
        ).strength((node) =>
          node.id === selectedId
            ? 0.9
            : selectedNeighborIds.has(node.id)
              ? 0.65
              : 0.05
        )
      );
      sim.force(
        'y',
        forceY<TopicNode>((node) =>
          node.id === selectedId || selectedNeighborIds.has(node.id)
            ? focusedY
            : hiddenY
        ).strength((node) =>
          node.id === selectedId
            ? 0.9
            : selectedNeighborIds.has(node.id)
              ? 0.65
              : 0.7
        )
      );
    } else if (isSearching) {
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
  }, [
    query,
    relevanceMap,
    selectedId,
    selectedNeighborIds,
    activeHeight,
    anchorX,
    anchorY,
    canvasSize.width,
    canvasSize.height,
  ]);

  // Обработка касания и перетаскивания узлов
  /* eslint-disable react-hooks/refs, react-hooks/immutability */
  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .onEnd((e) => {
          let hit: TopicNode | null = null;
          for (const n of nodesRef.current) {
            if (
              selectedId !== null &&
              n.id !== selectedId &&
              !selectedNeighborIds.has(n.id)
            ) {
              continue;
            }
            const dx = e.x - (n.x ?? 0);
            const dy = e.y - (n.y ?? 0);
            const hitRadius = n.radius + (n.id === selectedId ? 6 : 0);
            if (Math.hypot(dx, dy) <= hitRadius) {
              hit = n;
              break;
            }
          }
          if (hit) {
            setSheetTopicId(hit.id);
          }
          setSelectedId(hit ? hit.id : null);
        }),
    [selectedId, selectedNeighborIds]
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .onStart((e) => {
          let hit: TopicNode | null = null;
          for (const n of nodesRef.current) {
            if (
              selectedId !== null &&
              n.id !== selectedId &&
              !selectedNeighborIds.has(n.id)
            ) {
              continue;
            }
            const dx = e.x - (n.x ?? 0);
            const dy = e.y - (n.y ?? 0);
            const hitRadius = n.radius + (n.id === selectedId ? 6 : 0);
            if (Math.hypot(dx, dy) <= hitRadius) {
              hit = n;
              break;
            }
          }

          if (hit) {
            draggedNodeRef.current = hit;
            hit.fx = e.x;
            hit.fy = e.y;
            simRef.current?.alphaTarget(0.3).restart();
          }
        })
        .onUpdate((e) => {
          const node = draggedNodeRef.current;
          if (!node) return;

          const pad = node.radius + (node.id === selectedId ? 6 : 0) + 4;
          const maxY =
            selectedId === null
              ? canvasSize.height - pad
              : Math.max(pad, canvasSize.height * 0.35 - pad);
          node.fx = Math.max(pad, Math.min(canvasSize.width - pad, e.x));
          node.fy = Math.max(pad, Math.min(maxY, e.y));
        })
        .onFinalize(() => {
          const node = draggedNodeRef.current;
          if (!node) return;

          node.fx = null;
          node.fy = null;
          draggedNodeRef.current = null;
          simRef.current?.alphaTarget(0);
        }),
    [canvasSize.width, canvasSize.height, selectedId, selectedNeighborIds]
  );
  /* eslint-enable react-hooks/refs, react-hooks/immutability */

  const sheetTopic = sheetTopicId
    ? graphTopicNodes.find((node) => node.id === sheetTopicId) ?? null
    : null;
  const selectedItems = sheetTopic
    ? items.filter((item) =>
        sheetTopic.id === 'inbox'
          ? item.topicIds.length === 0
          : item.topicIds.includes(sheetTopic.id),
      )
    : [];
  const closeTopic = useCallback(() => setSelectedId(null), []);
  const dismissTopic = useCallback(() => setSheetTopicId(null), []);
  const handleItemPress = useCallback(async (item: Item) => {
    const isRead = !item.isRead;
    setItems((current) =>
      current.map((currentItem) =>
        currentItem.id === item.id ? { ...currentItem, isRead } : currentItem,
      ),
    );
    try {
      await toggleItemRead(item.id, isRead);
    } catch (error) {
      setItems((current) =>
        current.map((currentItem) =>
          currentItem.id === item.id
            ? { ...currentItem, isRead: item.isRead }
            : currentItem,
        ),
      );
      setToastMessage(
        `Не удалось обновить отметку: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    try {
      await refreshGraphData();
    } catch (error) {
      setToastMessage(
        `Отметка сохранена, но граф не обновился: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }, [refreshGraphData]);

  const openAddModal = useCallback(() => setIsAddModalVisible(true), []);
  const closeAddModal = useCallback(() => setIsAddModalVisible(false), []);
  const handleQuickAddSave = useCallback(async (item: Item) => {
    await createItem(item);
    setItems((current) => [item, ...current]);
    try {
      await refreshGraphData();
    } catch (error) {
      setToastMessage(
        `Материал сохранён, но граф не обновился: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    if (item.topicIds.length === 0) {
      setToastMessage('Сохранено во «Входящие»');
      return;
    }

    const topicLabels = item.topicIds
      .map((topicId) => graphTopicNodes.find((node) => node.id === topicId)?.label)
      .filter((label): label is string => label !== undefined);
    setToastMessage(
      topicLabels.length === 1
        ? `Добавлено в тему «${topicLabels[0]}»`
        : `Добавлено в ${topicLabels.length} темы`,
    );
  }, [graphTopicNodes, refreshGraphData]);

  const isSearching = query.trim().length > 0;

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={110}
      >
        <View style={styles.topBar}>
          <Text style={styles.hintText}>Коснитесь узла или начните поиск</Text>
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
          <GestureDetector gesture={Gesture.Exclusive(panGesture, tapGesture)}>
            <Canvas style={styles.flex}>
              {/* Якорь у большого пальца */}
              {selectedId === null && (
                <>
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
                </>
              )}

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
                    opacity={
                      selectedId === null || s.id === selectedId || t.id === selectedId
                        ? 1
                        : 0
                    }
                  />
                );
              })}

              {/* Узлы */}
              {nodes.map((node) => {
                const x = node.x ?? 0;
                const y = node.y ?? 0;
                const r = relevanceMap[node.id] ?? 0;
                const isSelected = node.id === selectedId;
                const isNeighbor = selectedNeighborIds.has(node.id);
                const opacity =
                  selectedId !== null
                    ? isSelected || isNeighbor
                      ? 1
                      : 0
                    : isSearching && r === 0
                      ? 0.25
                      : 1;
                const nodeRadius = node.radius + (isSelected ? 6 : 0);
                const metrics = topicMetrics.get(node.id);
                const itemCountText = String(
                  node.id === 'inbox'
                    ? metrics?.inboxCount ?? 0
                    : metrics?.totalCount ?? 0,
                );
                const progress = metrics?.progress ?? 0;
                const arcRadius = nodeRadius + (isSelected ? 7 : 3.5);
                const progressPath =
                  node.id !== 'inbox' && progress > 0 && progress < 1
                    ? Skia.PathBuilder.Make()
                        .addArc(
                          {
                            x: x - arcRadius,
                            y: y - arcRadius,
                            width: arcRadius * 2,
                            height: arcRadius * 2,
                          },
                          -90,
                          progress * 360,
                        )
                        .detach()
                    : null;
                const textWidth = font
                  ? font.measureText(node.label).width
                  : node.label.length * 6.5;
                const itemCountWidth = countFont
                  ? countFont.measureText(itemCountText).width
                  : itemCountText.length * 5.5;
                const inboxBadgeText =
                  (metrics?.inboxCount ?? 0) > 99
                    ? '99+'
                    : String(metrics?.inboxCount ?? 0);
                const inboxBadgeTextWidth = countFont
                  ? countFont.measureText(inboxBadgeText).width
                  : inboxBadgeText.length * 5.5;
                const inboxBadgeWidth = Math.max(20, inboxBadgeTextWidth + 10);
                const inboxBadgeX = x + nodeRadius * 0.7;
                const inboxBadgeY = y - nodeRadius * 0.7;

                return (
                  <React.Fragment key={node.id}>
                    <Circle
                      cx={x}
                      cy={y}
                      r={nodeRadius}
                      color={isSelected ? '#FFFFFF' : node.color}
                      opacity={opacity}
                    />
                    {node.id !== 'inbox' && (
                      <>
                        <Circle
                          cx={x}
                          cy={y}
                          r={arcRadius}
                          color="rgba(148, 163, 184, 0.2)"
                          style="stroke"
                          strokeWidth={2.5}
                          opacity={opacity * (isSelected ? 0.45 : 1)}
                        />
                        {progress >= 1 ? (
                          <Circle
                            cx={x}
                            cy={y}
                            r={arcRadius}
                            color="#4ADE80"
                            style="stroke"
                            strokeWidth={2.5}
                            strokeCap="round"
                            opacity={opacity * (isSelected ? 0.5 : 1)}
                          />
                        ) : (
                          progressPath && (
                            <Path
                              path={progressPath}
                              color="#38BDF8"
                              style="stroke"
                              strokeWidth={2.5}
                              strokeCap="round"
                              opacity={opacity * (isSelected ? 0.5 : 1)}
                            />
                          )
                        )}
                      </>
                    )}
                    {(isSelected || (isSearching && r > 0)) && (
                      <Circle
                        cx={x}
                        cy={y}
                        r={nodeRadius + 2}
                        color={isSelected ? '#38BDF8' : '#FDE047'}
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
                        color={isSelected ? '#0F172A' : '#FFFFFF'}
                        opacity={opacity}
                      />
                    )}
                    {countFont && (
                      <SkiaText
                        x={x - itemCountWidth / 2}
                        y={y + 18}
                        text={itemCountText}
                        font={countFont}
                        color={isSelected ? '#334155' : '#CBD5E1'}
                        opacity={opacity}
                      />
                    )}
                    {node.id === 'inbox' &&
                      (metrics?.inboxCount ?? 0) > 0 && (
                        <>
                          {inboxBadgeText.length > 1 ? (
                            <>
                              <RoundedRect
                                x={inboxBadgeX - inboxBadgeWidth / 2}
                                y={inboxBadgeY - 10}
                                width={inboxBadgeWidth}
                                height={20}
                                r={10}
                                color="#EF4444"
                                opacity={opacity}
                              />
                              <RoundedRect
                                x={inboxBadgeX - inboxBadgeWidth / 2}
                                y={inboxBadgeY - 10}
                                width={inboxBadgeWidth}
                                height={20}
                                r={10}
                                color="#0F172A"
                                style="stroke"
                                strokeWidth={1.5}
                                opacity={opacity}
                              />
                            </>
                          ) : (
                            <>
                              <Circle
                                cx={inboxBadgeX}
                                cy={inboxBadgeY}
                                r={10}
                                color="#EF4444"
                                opacity={opacity}
                              />
                              <Circle
                                cx={inboxBadgeX}
                                cy={inboxBadgeY}
                                r={10}
                                color="#0F172A"
                                style="stroke"
                                strokeWidth={1.5}
                                opacity={opacity}
                              />
                            </>
                          )}
                          {countFont && (
                            <SkiaText
                              x={inboxBadgeX - inboxBadgeTextWidth / 2}
                              y={inboxBadgeY + 3.5}
                              text={inboxBadgeText}
                              font={countFont}
                              color="#FFFFFF"
                              opacity={opacity}
                            />
                          )}
                        </>
                      )}
                  </React.Fragment>
                );
              })}
            </Canvas>
          </GestureDetector>
        </View>

        {/* Прозрачный контейнер поиска и кнопки добавления */}
        <Animated.View
          pointerEvents={selectedId === null ? 'auto' : 'none'}
          style={[styles.searchBar, searchBarAnimatedStyle]}
        >
            <View style={styles.searchField}>
              <TextInput
                style={styles.searchInput}
                placeholder="Поиск"
                placeholderTextColor="#64748B"
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
              />
              {query.length > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Очистить поиск"
                  onPress={() => setQuery('')}
                  style={styles.clearButton}
                >
                  <Text style={styles.clearText}>✕</Text>
                </Pressable>
              )}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Быстро добавить материал"
              onPress={openAddModal}
              style={styles.addButton}
            >
              <Text style={styles.addButtonText}>+</Text>
            </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>

      {sheetTopic && (
        <TopicBottomSheet
          topic={sheetTopic}
          isOpen={selectedId !== null}
          items={selectedItems}
          onClose={closeTopic}
          onDismiss={dismissTopic}
          onItemPress={handleItemPress}
        />
      )}

      <QuickAddModal
        visible={isAddModalVisible}
        topics={graphTopicNodes
          .filter((node) => node.id !== 'inbox')
          .map((node) => ({ id: node.id, label: node.label }))}
        onClose={closeAddModal}
        onSave={handleQuickAddSave}
      />

      {toastMessage.length > 0 && (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      )}
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
    height: mmToDp(12),
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    gap: 12,
  },
  searchField: {
    flex: 1,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    gap: 10,
  },
  searchIcon: {
    fontSize: 16,
  },
  searchInput: {
    flex: 1,
    height: 50,
    color: '#0F172A',
    paddingHorizontal: 0,
    fontSize: 16,
  },
  clearButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '700',
  },
  addButton: {
    width: mmToDp(10),
    height: mmToDp(10),
    borderRadius: mmToDp(5),
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '500',
    lineHeight: 32,
  },
  toast: {
    position: 'absolute',
    zIndex: 3,
    bottom: mmToDp(12) + 10,
    alignSelf: 'center',
    maxWidth: '90%',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#334155',
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});
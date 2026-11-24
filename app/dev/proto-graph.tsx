import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { router, usePathname } from 'expo-router';
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
  type ForceLink,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
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
import { KeyboardAwareBottom } from '@/components/KeyboardAwareBottom';

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

interface GraphPosition {
  x: number;
  y: number;
}

type GraphPositions = Record<string, GraphPosition>;

interface GraphNodeVisualProps {
  node: TopicNode;
  positions: SharedValue<GraphPositions>;
  selectedId: string | null;
  isNeighbor: boolean;
  relevance: number;
  isSearching: boolean;
  metrics: TopicMetrics | undefined;
  font: ReturnType<typeof matchFont>;
  countFont: ReturnType<typeof matchFont>;
}

function GraphNodeVisual({
  node,
  positions,
  selectedId,
  isNeighbor,
  relevance,
  isSearching,
  metrics,
  font,
  countFont,
}: GraphNodeVisualProps) {
  const isSelected = node.id === selectedId;
  const opacity =
    selectedId !== null
      ? isSelected || isNeighbor
        ? 1
        : 0
      : isSearching && relevance === 0
        ? 0.25
        : 1;
  const nodeRadius = node.radius + (isSelected ? 6 : 0);
  const arcRadius = nodeRadius + (isSelected ? 7 : 3.5);
  const itemCountText = String(
    node.id === 'inbox'
      ? metrics?.inboxCount ?? 0
      : metrics?.totalCount ?? 0,
  );
  const progress = metrics?.progress ?? 0;
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
  const nodeX = useDerivedValue(
    () => positions.value[node.id]?.x ?? node.x ?? 0,
  );
  const nodeY = useDerivedValue(
    () => positions.value[node.id]?.y ?? node.y ?? 0,
  );
  const labelX = useDerivedValue(
    () => nodeX.value - textWidth / 2,
  );
  const labelY = useDerivedValue(() => nodeY.value + 4);
  const countX = useDerivedValue(
    () => nodeX.value - itemCountWidth / 2,
  );
  const countY = useDerivedValue(() => nodeY.value + 18);
  const inboxBadgeX = useDerivedValue(
    () => nodeX.value + nodeRadius * 0.7,
  );
  const inboxBadgeY = useDerivedValue(
    () => nodeY.value - nodeRadius * 0.7,
  );
  const inboxBadgeRectX = useDerivedValue(
    () => inboxBadgeX.value - inboxBadgeWidth / 2,
  );
  const inboxBadgeRectY = useDerivedValue(
    () => inboxBadgeY.value - 10,
  );
  const inboxBadgeTextX = useDerivedValue(
    () => inboxBadgeX.value - inboxBadgeTextWidth / 2,
  );
  const inboxBadgeTextY = useDerivedValue(
    () => inboxBadgeY.value + 3.5,
  );
  const progressTransform = useDerivedValue(
    () => [
      { translateX: nodeX.value },
      { translateY: nodeY.value },
    ],
  );
  const progressPath = useMemo(
    () =>
      node.id !== 'inbox' && progress > 0 && progress < 1
        ? Skia.PathBuilder.Make()
            .addArc(
              {
                x: -arcRadius,
                y: -arcRadius,
                width: arcRadius * 2,
                height: arcRadius * 2,
              },
              -90,
              progress * 360,
            )
            .detach()
        : null,
    [arcRadius, node.id, progress],
  );

  return (
    <>
      <Circle
        cx={nodeX}
        cy={nodeY}
        r={nodeRadius}
        color={isSelected ? '#FFFFFF' : node.color}
        opacity={opacity}
      />
      {node.id !== 'inbox' && (
        <>
          <Circle
            cx={nodeX}
            cy={nodeY}
            r={arcRadius}
            color="rgba(148, 163, 184, 0.2)"
            style="stroke"
            strokeWidth={2.5}
            opacity={opacity * (isSelected ? 0.45 : 1)}
          />
          {progress >= 1 ? (
            <Circle
              cx={nodeX}
              cy={nodeY}
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
                transform={progressTransform}
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
      {(isSelected || (isSearching && relevance > 0)) && (
        <Circle
          cx={nodeX}
          cy={nodeY}
          r={nodeRadius + 2}
          color={isSelected ? '#38BDF8' : '#FDE047'}
          style="stroke"
          strokeWidth={isSelected ? 3 : 2}
        />
      )}
      {font && (
        <SkiaText
          x={labelX}
          y={labelY}
          text={node.label}
          font={font}
          color={isSelected ? '#0F172A' : '#FFFFFF'}
          opacity={opacity}
        />
      )}
      {countFont && (
        <SkiaText
          x={countX}
          y={countY}
          text={itemCountText}
          font={countFont}
          color={isSelected ? '#334155' : '#CBD5E1'}
          opacity={opacity}
        />
      )}
      {node.id === 'inbox' && (metrics?.inboxCount ?? 0) > 0 && (
        <>
          {inboxBadgeText.length > 1 ? (
            <>
              <RoundedRect
                x={inboxBadgeRectX}
                y={inboxBadgeRectY}
                width={inboxBadgeWidth}
                height={20}
                r={10}
                color="#EF4444"
                opacity={opacity}
              />
              <RoundedRect
                x={inboxBadgeRectX}
                y={inboxBadgeRectY}
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
              x={inboxBadgeTextX}
              y={inboxBadgeTextY}
              text={inboxBadgeText}
              font={countFont}
              color="#FFFFFF"
              opacity={opacity}
            />
          )}
        </>
      )}
    </>
  );
}

interface GraphLinkVisualProps {
  sourceId: string;
  targetId: string;
  positions: SharedValue<GraphPositions>;
  opacity: number;
}

function GraphLinkVisual({
  sourceId,
  targetId,
  positions,
  opacity,
}: GraphLinkVisualProps) {
  const p1 = useDerivedValue(
    () => vec(positions.value[sourceId]?.x ?? 0, positions.value[sourceId]?.y ?? 0),
  );
  const p2 = useDerivedValue(
    () => vec(positions.value[targetId]?.x ?? 0, positions.value[targetId]?.y ?? 0),
  );

  return (
    <Line
      p1={p1}
      p2={p2}
      color="rgba(148, 163, 184, 0.25)"
      strokeWidth={1.5}
      opacity={opacity}
    />
  );
}

function getLinkNodeId(value: string | TopicNode): string {
  return typeof value === 'string' ? value : value.id;
}

function getLinkSignature(link: TopicLink): string {
  return JSON.stringify([
    getLinkNodeId(link.source),
    getLinkNodeId(link.target),
    link.weight,
  ]);
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
  const pathname = usePathname();
  const isDevRoute = pathname.startsWith('/dev/');

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
  const nodesRef = useRef<TopicNode[]>([]);
  const linksRef = useRef<TopicLink[]>([]);
  const linkForceRef = useRef<ForceLink<TopicNode, TopicLink> | null>(null);
  const positions = useSharedValue<GraphPositions>({});
  const canvasSizeRef = useRef(canvasSize);
  const previousCanvasSizeRef = useRef(canvasSize);
  const draggedNodeRef = useRef<TopicNode | null>(null);

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
  );

  const relevanceMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const n of graphTopicNodes) {
      map[n.id] = computeRelevance(n, query);
    }
    return map;
  }, [graphTopicNodes, query]);
  const relevanceSignature = graphTopicNodes
    .map((node) => `${node.id}:${relevanceMap[node.id] ?? 0}`)
    .join('|');
  const relevanceMapRef = useRef(relevanceMap);

  useEffect(() => {
    relevanceMapRef.current = relevanceMap;
  }, [relevanceMap]);

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

  useEffect(() => {
    canvasSizeRef.current = canvasSize;
  }, [canvasSize]);

  useEffect(() => {
    const linkForce = forceLink<TopicNode, TopicLink>([])
      .id((node) => node.id)
      .distance(105)
      .strength((link) => Math.min(0.75, 0.2 + link.weight * 0.1));
    const collideForce = forceCollide<TopicNode>().radius(
      (node) => node.radius + 8,
    );
    const simulation = forceSimulation<TopicNode>([])
      .velocityDecay(0.68)
      .alphaDecay(0.05)
      .alphaMin(0.008)
      .force('link', linkForce)
      .force('charge', forceManyBody<TopicNode>().strength(-160))
      .force(
        'center',
        forceCenter(canvasSizeRef.current.width / 2, canvasSizeRef.current.height / 2),
      )
      .force('collide', collideForce)
      .on('tick', () => {
        const { width, height } = canvasSizeRef.current;
        const { selectedId: focusedId, neighborIds } = selectedModeRef.current;
        const currentActiveHeight = focusedId === null ? height : height * 0.35;
        const nextPositions: GraphPositions = {};

        for (const node of nodesRef.current) {
          const isVisible = node.id === focusedId || neighborIds.has(node.id);
          const pad = node.radius + (node.id === focusedId ? 6 : 0) + 4;
          const minY =
            focusedId !== null && !isVisible ? currentActiveHeight + pad : pad;
          const maxY =
            focusedId !== null && isVisible
              ? Math.max(pad, currentActiveHeight - pad)
              : height - pad;
          node.x = Math.max(pad, Math.min(width - pad, node.x ?? width / 2));
          node.y = Math.max(minY, Math.min(maxY, node.y ?? height / 2));
          nextPositions[node.id] = { x: node.x, y: node.y };
        }

        positions.value = nextPositions;
        if (simulation.alpha() < simulation.alphaMin()) {
          simulation.stop();
        }
      });

    simRef.current = simulation;
    linkForceRef.current = linkForce;

    return () => {
      simulation.stop();
      simRef.current = null;
      linkForceRef.current = null;
    };
  }, [positions]);

  useEffect(() => {
    const simulation = simRef.current;
    if (!simulation) return;

    const previousCanvasSize = previousCanvasSizeRef.current;
    const layoutChanged =
      previousCanvasSize.width !== canvasSize.width ||
      previousCanvasSize.height !== canvasSize.height;
    previousCanvasSizeRef.current = canvasSize;

    const previousNodes = nodesRef.current;
    const nodesById = new Map(previousNodes.map((node) => [node.id, node]));
    let nodePhysicsChanged = previousNodes.length !== graphTopicNodes.length;
    const updatedNodes = graphTopicNodes.map((source, index) => {
      if (previousNodes[index]?.id !== source.id) {
        nodePhysicsChanged = true;
      }
      const metrics = topicMetrics.get(source.id);
      const itemCount =
        source.id === 'inbox'
          ? metrics?.inboxCount ?? 0
          : metrics?.totalCount ?? 0;
      const radius = getTopicNodeDiameter(itemCount) / 2;
      const existing = nodesById.get(source.id);

      if (existing) {
        if (existing.radius !== radius) {
          nodePhysicsChanged = true;
        }
        Object.assign(existing, source, { radius });
        return existing;
      }

      nodePhysicsChanged = true;
      return {
        ...source,
        radius,
        x: canvasSize.width / 2 + Math.cos(index) * 24,
        y: canvasSize.height / 2 + Math.sin(index) * 24,
        vx: 0,
        vy: 0,
      };
    });
    if (nodePhysicsChanged || layoutChanged) {
      previousNodes.splice(0, previousNodes.length, ...updatedNodes);
    }

    const nextLinks = graphTopicLinks.map((link) => ({ ...link }));
    const previousLinkSignatures = linksRef.current
      .map(getLinkSignature)
      .sort();
    const nextLinkSignatures = nextLinks.map(getLinkSignature).sort();
    const linksChanged =
      previousLinkSignatures.length !== nextLinkSignatures.length ||
      previousLinkSignatures.some(
        (signature, index) => signature !== nextLinkSignatures[index],
      );

    nodesRef.current = previousNodes;
    if (layoutChanged) {
      simulation.force(
        'center',
        forceCenter(canvasSize.width / 2, canvasSize.height / 2),
      );
    }

    if (nodePhysicsChanged || layoutChanged) {
      for (const node of updatedNodes) {
        node.vx = 0;
        node.vy = 0;
      }
      simulation
        .force(
          'collide',
          forceCollide<TopicNode>().radius((node) => node.radius + 8),
        )
        .nodes(previousNodes);
    }

    if (linksChanged) {
      linksRef.current = nextLinks;
      linkForceRef.current?.links(nextLinks);
    }

    if (nodePhysicsChanged || linksChanged || layoutChanged) {
      simulation.alpha(0.12).restart();
    }
  }, [
    canvasSize,
    graphTopicLinks,
    graphTopicNodes,
    positions,
    topicMetrics,
  ]);

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
            : selectedModeRef.current.neighborIds.has(node.id)
              ? neighborsX
              : centerX
        ).strength((node) =>
          node.id === selectedId
            ? 0.9
            : selectedModeRef.current.neighborIds.has(node.id)
              ? 0.65
              : 0.05
        )
      );
      sim.force(
        'y',
        forceY<TopicNode>((node) =>
          node.id === selectedId ||
          selectedModeRef.current.neighborIds.has(node.id)
            ? focusedY
            : hiddenY
        ).strength((node) =>
          node.id === selectedId
            ? 0.9
            : selectedModeRef.current.neighborIds.has(node.id)
              ? 0.65
              : 0.7
        )
      );
    } else if (isSearching) {
      sim.force('center', null);
      sim.force(
        'x',
        forceX<TopicNode>((d) => {
          const r = relevanceMapRef.current[d.id] ?? 0;
          return r > 0 ? anchorX : centerX;
        }).strength((d) => {
          const r = relevanceMapRef.current[d.id] ?? 0;
          return r > 0 ? 0.35 * r : 0.05;
        })
      );
      sim.force(
        'y',
        forceY<TopicNode>((d) => {
          const r = relevanceMapRef.current[d.id] ?? 0;
          return r > 0 ? anchorY : anchorY * 0.25;
        }).strength((d) => {
          const r = relevanceMapRef.current[d.id] ?? 0;
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
    relevanceSignature,
    selectedId,
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
  const goBackFromDev = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }, []);
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
      <View style={styles.topBar}>
        {isDevRoute && (
          <Pressable
            accessibilityRole="button"
            onPress={goBackFromDev}
            style={styles.backButton}
          >
            <Text style={styles.backText}>‹ Назад</Text>
          </Pressable>
        )}
        <Text style={styles.hintText}>Коснитесь узла или начните поиск</Text>
        {__DEV__ && !isDevRoute && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Открыть прототип эмбеддингов"
            onPress={() => router.push('/dev/proto-embeddings')}
            style={styles.devButton}
          >
            <Text style={styles.devButtonText}>DEV</Text>
          </Pressable>
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

              {graphTopicLinks.map((link, index) => {
                const sourceId = getLinkNodeId(link.source);
                const targetId = getLinkNodeId(link.target);
                const opacity =
                  selectedId === null ||
                  sourceId === selectedId ||
                  targetId === selectedId
                    ? 1
                    : 0;

                return (
                  <GraphLinkVisual
                    key={`${sourceId}-${targetId}-${index}`}
                    sourceId={sourceId}
                    targetId={targetId}
                    positions={positions}
                    opacity={opacity}
                  />
                );
              })}

              {graphTopicNodes.map((node) => (
                <GraphNodeVisual
                  key={node.id}
                  node={node}
                  positions={positions}
                  selectedId={selectedId}
                  isNeighbor={selectedNeighborIds.has(node.id)}
                  relevance={relevanceMap[node.id] ?? 0}
                  isSearching={isSearching}
                  metrics={topicMetrics.get(node.id)}
                  font={font}
                  countFont={countFont}
                />
              ))}
          </Canvas>
        </GestureDetector>
      </View>

      {/* Прозрачный контейнер поиска и кнопки добавления */}
      <KeyboardAwareBottom>
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
      </KeyboardAwareBottom>

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
  devButton: {
    minWidth: 48,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.45)',
    backgroundColor: 'rgba(30, 41, 59, 0.88)',
  },
  devButtonText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
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
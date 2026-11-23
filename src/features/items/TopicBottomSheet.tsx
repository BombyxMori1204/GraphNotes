import { useEffect, useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { Item } from '@/types';
import { ItemCard } from './ItemCard';

interface TopicBottomSheetProps {
  topic: { id: string; label: string } | null;
  isOpen: boolean;
  items: Item[];
  onClose: () => void;
  onDismiss: () => void;
  onItemPress: (item: Item) => void;
}

const AnimatedFlashList = Animated.createAnimatedComponent(FlashList<Item>);

export function TopicBottomSheet({
  topic,
  isOpen,
  items,
  onClose,
  onDismiss,
  onItemPress,
}: TopicBottomSheetProps) {
  const { height: screenHeight } = useWindowDimensions();
  const sheetHeight = Math.max(0, screenHeight * 0.66 - 36);
  const translateY = useSharedValue(sheetHeight);
  const dragStartY = useSharedValue(0);
  const scrollOffset = useSharedValue(0);
  const canDragFromList = useSharedValue(false);
  const activeTopicId = topic?.id ?? '';
  const lastTopicId = useSharedValue(activeTopicId);

  useEffect(() => {
    if (isOpen) {
      translateY.value = withTiming(0, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
      });
    } else {
      translateY.value = withTiming(
        sheetHeight,
        {
          duration: 180,
          easing: Easing.in(Easing.cubic),
        },
        (finished) => {
          if (finished) {
            runOnJS(onDismiss)();
          }
        },
      );
    }
  }, [isOpen, onDismiss, sheetHeight, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const onListScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollOffset.value = event.contentOffset.y;
    },
  });

  /* eslint-disable react-hooks/immutability */
  const headerPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          dragStartY.value = translateY.value;
        })
        .onUpdate((event) => {
          translateY.value = Math.max(0, dragStartY.value + event.translationY);
        })
        .onEnd((event) => {
          if (event.translationY > 100 || event.velocityY > 500) {
            runOnJS(onClose)();
          } else {
            translateY.value = withTiming(0, {
              duration: 180,
              easing: Easing.out(Easing.cubic),
            });
          }
        }),
    [dragStartY, onClose, translateY],
  );

  const listPanGesture = useMemo(
    () =>
      Gesture.Simultaneous(
        Gesture.Pan()
          .onBegin(() => {
            if (lastTopicId.value !== activeTopicId) {
              scrollOffset.value = 0;
              lastTopicId.value = activeTopicId;
            }
            dragStartY.value = translateY.value;
            canDragFromList.value = scrollOffset.value <= 0;
          })
          .onUpdate((event) => {
            if (canDragFromList.value && event.translationY > 0) {
              translateY.value = Math.max(
                0,
                dragStartY.value + event.translationY,
              );
            }
          })
          .onEnd((event) => {
            if (
              canDragFromList.value &&
              (event.translationY > 100 || event.velocityY > 500)
            ) {
              runOnJS(onClose)();
            } else {
              translateY.value = withTiming(0, {
                duration: 180,
                easing: Easing.out(Easing.cubic),
              });
            }
            canDragFromList.value = false;
          }),
        Gesture.Native(),
      ),
    [
      activeTopicId,
      canDragFromList,
      dragStartY,
      lastTopicId,
      onClose,
      scrollOffset,
      translateY,
    ],
  );
  /* eslint-enable react-hooks/immutability */

  const emptyList = useMemo(
    () => (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>Пока нет материалов</Text>
        <Text style={styles.emptyDescription}>
          Добавленные в эту тему ссылки, файлы и заметки появятся здесь.
        </Text>
      </View>
    ),
    [],
  );

  if (!topic) {
    return null;
  }

  return (
    <Animated.View style={[styles.sheet, { height: sheetHeight }, animatedStyle]}>
      <GestureDetector gesture={headerPanGesture}>
        <View style={styles.header}>
          <View style={styles.handle} />
          <View style={styles.heading}>
            <Text style={styles.title} numberOfLines={1}>
              {topic.label}
            </Text>
            <Text style={styles.count}>· {items.length}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Закрыть список материалов"
              hitSlop={4}
              onPress={onClose}
              style={styles.closeButton}
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
        </View>
      </GestureDetector>

      <GestureDetector gesture={listPanGesture}>
        <AnimatedFlashList
          key={topic.id}
          style={styles.listContainer}
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ItemCard item={item} onPress={onItemPress} />
          )}
          ListEmptyComponent={emptyList}
          contentContainerStyle={styles.listContent}
          onScroll={onListScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        />
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    zIndex: 2,
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingBottom: 16,
    overflow: 'hidden',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: '#334155',
    backgroundColor: '#1E293B',
  },
  header: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    marginBottom: 8,
    borderRadius: 2,
    backgroundColor: '#64748B',
  },
  heading: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '700',
  },
  count: {
    color: '#94A3B8',
    fontSize: 14,
  },
  closeButton: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 32,
    backgroundColor: '#334155',
  },
  closeText: {
    color: '#E2E8F0',
    fontSize: 19,
    fontWeight: '600',
  },
  listContainer: {
    flex: 1,
  },
  listContent: {
    paddingTop: 4,
    paddingBottom: 16,
  },
  emptyState: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    color: '#E2E8F0',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyDescription: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
});

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  ScrollView as RNGHScrollView,
} from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { Item } from '@/types';
import { KeyboardAwareBottom } from '@/components/KeyboardAwareBottom';

interface QuickAddTopic {
  id: string;
  label: string;
}

interface QuickAddModalProps {
  visible: boolean;
  topics: QuickAddTopic[];
  onClose: () => void;
  onSave: (item: Item) => Promise<void> | void;
}

type QuickAddType = 'link' | 'text';

const AnimatedRNGHScrollView =
  Animated.createAnimatedComponent(RNGHScrollView);

function getDomain(url: string): string {
  try {
    const normalizedUrl = /^[a-z][a-z\d+.-]*:\/\//i.test(url)
      ? url
      : `https://${url}`;
    return new URL(normalizedUrl).hostname.replace(/^www\./i, '') || url;
  } catch {
    return url;
  }
}

function normalizeUrl(url: string): string {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `https://${url}`;
}

export function QuickAddModal({
  visible,
  topics,
  onClose,
  onSave,
}: QuickAddModalProps) {
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [type, setType] = useState<QuickAddType>('link');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saveOfflineCopy, setSaveOfflineCopy] = useState(true);
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [validationMessage, setValidationMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const urlInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const backdropOpacity = useSharedValue(0);
  const sheetOffset = useSharedValue(36);
  const dragOffset = useSharedValue(0);
  const scrollOffset = useSharedValue(0);
  const startScrollOffset = useSharedValue(0);

  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    backdropOpacity.value = withTiming(visible ? 1 : 0, { duration: 180 });
    if (visible) {
      dragOffset.value = 0;
      scrollOffset.value = 0;
      startScrollOffset.value = 0;
    }
    sheetOffset.value = withTiming(visible ? 0 : 36, {
      duration: visible ? 240 : 180,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
    });

    if (visible) {
      const focusTimeout = setTimeout(() => urlInputRef.current?.focus(), 250);
      return () => clearTimeout(focusTimeout);
    }

    return undefined;
  }, [
    backdropOpacity,
    dragOffset,
    scrollOffset,
    sheetOffset,
    startScrollOffset,
    visible,
  ]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetOffset.value + dragOffset.value }],
  }));

  const resetForm = useCallback(() => {
    setType('link');
    setUrl('');
    setTitle('');
    setDescription('');
    setSaveOfflineCopy(true);
    setSelectedTopicIds([]);
    setValidationMessage('');
  }, []);

  const close = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleDismissKeyboardAndClose = useCallback(() => {
    Keyboard.dismiss();
    close();
  }, [close]);

  const onFormScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollOffset.value = event.contentOffset.y;
    },
  });

  const headerPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(5)
        .onUpdate((event) => {
          if (event.translationY > 0) {
            dragOffset.value = event.translationY;
          }
        })
        .onEnd((event) => {
          if (event.translationY > 80 || event.velocityY > 500) {
            dragOffset.value = withTiming(
              screenHeight,
              { duration: 200 },
              (finished) => {
                if (finished) {
                  runOnJS(handleDismissKeyboardAndClose)();
                }
              },
            );
          } else {
            dragOffset.value = withSpring(0, {
              damping: 22,
              stiffness: 220,
            });
          }
        }),
    [dragOffset, handleDismissKeyboardAndClose, screenHeight],
  );
  const listPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(10)
        .failOffsetX([-20, 20])
        .onBegin(() => {
          startScrollOffset.value = scrollOffset.value;
        })
        .onUpdate((event) => {
          if (startScrollOffset.value <= 2 && event.translationY > 0) {
            dragOffset.value = event.translationY;
          }
        })
        .onEnd((event) => {
          if (startScrollOffset.value > 2 || event.translationY <= 0) {
            return;
          }

          if (dragOffset.value > 80 || event.velocityY > 500) {
            dragOffset.value = withTiming(
              screenHeight,
              { duration: 200 },
              (finished) => {
                if (finished) {
                  runOnJS(handleDismissKeyboardAndClose)();
                }
              },
            );
          } else {
            dragOffset.value = withSpring(0, {
              damping: 22,
              stiffness: 220,
            });
          }
        }),
    [
      dragOffset,
      handleDismissKeyboardAndClose,
      screenHeight,
      scrollOffset,
      startScrollOffset,
    ],
  );
  const nativeScrollGesture = useMemo(() => Gesture.Native(), []);
  const listGesture = useMemo(
    () => Gesture.Simultaneous(listPanGesture, nativeScrollGesture),
    [listPanGesture, nativeScrollGesture],
  );
  /* eslint-enable react-hooks/immutability */

  const save = async () => {
    const normalizedUrl = url.trim();
    const normalizedDescription = description.trim();
    const itemText = type === 'text' ? normalizedDescription : normalizedUrl;

    if (!itemText) {
      setValidationMessage(
        type === 'link' ? 'Введите ссылку.' : 'Введите текст заметки.',
      );
      return;
    }

    const sourceLabel = type === 'link' ? getDomain(normalizedUrl) : 'Заметка';
    const fallbackTitle =
      type === 'link'
        ? sourceLabel
        : normalizedDescription.slice(0, 40);
    const item: Item = {
      id: `quick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: title.trim() || fallbackTitle,
      type,
      description: normalizedDescription,
      sourceLabel,
      url: type === 'link' ? normalizeUrl(normalizedUrl) : null,
      copyStatus:
        type === 'link' && saveOfflineCopy ? 'full' : 'none',
      topicIds: selectedTopicIds,
      isRead: false,
      createdAt: new Date().toISOString(),
    };

    setIsSaving(true);
    try {
      await onSave(item);
      close();
    } catch (error) {
      setValidationMessage(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const toggleTopic = (topicId: string) => {
    setSelectedTopicIds((current) =>
      current.includes(topicId)
        ? current.filter((id) => id !== topicId)
        : [...current, topicId],
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={close}
    >
      <GestureHandlerRootView style={styles.gestureRoot}>
        <View style={styles.overlay}>
          <Animated.View style={[styles.backdrop, backdropStyle]}>
            <Pressable
              accessibilityLabel="Закрыть окно быстрого добавления"
              onPress={close}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <KeyboardAwareBottom
            maxHeight={screenHeight * 0.9}
            style={[styles.keyboardAvoiding, { paddingBottom: insets.bottom }]}
          >
            <Animated.View
              style={[
                styles.sheet,
                { maxHeight: screenHeight * 0.9 },
                sheetStyle,
              ]}
            >
              <GestureDetector gesture={headerPanGesture}>
                <View style={styles.sheetHeader}>
                  <View style={styles.handle} />
                  <Text style={styles.heading}>Быстрое добавление</Text>
                </View>
              </GestureDetector>
              <GestureDetector gesture={listGesture}>
                <AnimatedRNGHScrollView
                  style={styles.form}
                  contentContainerStyle={styles.formContent}
                  keyboardShouldPersistTaps="handled"
                  onScroll={onFormScroll}
                  scrollEventThrottle={16}
                  showsVerticalScrollIndicator={false}
                >
              <View style={styles.typeRow}>
                {([
                  ['link', 'Ссылка'],
                  ['text', 'Текст'],
                ] as const).map(([value, label]) => {
                  const isActive = type === value;
                  return (
                    <Pressable
                      key={value}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isActive }}
                      onPress={() => {
                        setType(value);
                        setValidationMessage('');
                      }}
                      style={[
                        styles.typeChip,
                        isActive && styles.activeTypeChip,
                      ]}
                    >
                      <Text
                        style={[
                          styles.typeChipText,
                          isActive && styles.activeTypeChipText,
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {type === 'link' && (
                <>
                  <Text style={styles.label}>Ссылка</Text>
                  <TextInput
                    ref={urlInputRef}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                    keyboardType="url"
                    onChangeText={(value) => {
                      setUrl(value);
                      setValidationMessage('');
                    }}
                    placeholder="https://example.com"
                    placeholderTextColor="#64748B"
                    returnKeyType="next"
                    style={styles.input}
                    value={url}
                  />
                </>
              )}

              <Text style={styles.label}>Название · необязательно</Text>
              <TextInput
                autoCorrect={false}
                onChangeText={setTitle}
                placeholder="Название"
                placeholderTextColor="#64748B"
                returnKeyType="next"
                style={styles.input}
                value={title}
              />

              <Text style={styles.label}>
                {type === 'text' ? 'Текст заметки' : 'Описание / заметка'}
              </Text>
              <TextInput
                autoCorrect
                multiline
                onChangeText={(value) => {
                  setDescription(value);
                  setValidationMessage('');
                }}
                placeholder={
                  type === 'text'
                    ? 'Запишите мысль…'
                    : 'Короткая заметка к ссылке'
                }
                placeholderTextColor="#64748B"
                style={[styles.input, styles.descriptionInput]}
                textAlignVertical="top"
                value={description}
              />

              {type === 'link' && (
                <View style={styles.offlineRow}>
                  <View style={styles.offlineCopy}>
                    <Text style={styles.label}>Офлайн-копия</Text>
                    <Text style={styles.helper}>
                      Сохранить материал для чтения без сети
                    </Text>
                  </View>
                  <Switch
                    onValueChange={setSaveOfflineCopy}
                    trackColor={{ false: '#475569', true: '#F97316' }}
                    value={saveOfflineCopy}
                  />
                </View>
              )}

              <Text style={styles.label}>Темы</Text>
              <ScrollView
                horizontal
                contentContainerStyle={styles.topicList}
                showsHorizontalScrollIndicator={false}
              >
                {topics.map((topic) => {
                  const isSelected = selectedTopicIds.includes(topic.id);
                  return (
                    <Pressable
                      key={topic.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => toggleTopic(topic.id)}
                      style={[
                        styles.topicChip,
                        isSelected && styles.selectedTopicChip,
                      ]}
                    >
                      <Text
                        style={[
                          styles.topicChipText,
                          isSelected && styles.selectedTopicChipText,
                        ]}
                      >
                        {topic.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {selectedTopicIds.length === 0 && (
                <Text style={styles.helper}>Попадёт во «Входящие»</Text>
              )}
              {validationMessage.length > 0 && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {validationMessage}
                </Text>
              )}
              <View style={styles.footer}>
                <Pressable
                  accessibilityRole="button"
                  disabled={isSaving}
                  onPress={() => void save()}
                  style={[
                    styles.saveButton,
                    isSaving && styles.saveButtonDisabled,
                  ]}
                >
                  <Text style={styles.saveButtonText}>
                    {isSaving ? 'Сохранение…' : 'Сохранить'}
                  </Text>
                </Pressable>
              </View>
                </AnimatedRNGHScrollView>
              </GestureDetector>
            </Animated.View>
          </KeyboardAwareBottom>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  gestureRoot: {
    flex: 1,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(2, 6, 23, 0.7)',
  },
  keyboardAvoiding: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    overflow: 'hidden',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: '#334155',
    backgroundColor: '#1E293B',
    paddingTop: 10,
  },
  sheetHeader: {
    paddingHorizontal: 20,
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
    marginHorizontal: 0,
    marginBottom: 12,
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '700',
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 0,
    paddingBottom: 8,
  },
  typeChip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#475569',
  },
  activeTypeChip: {
    borderColor: '#F97316',
    backgroundColor: '#F97316',
  },
  typeChipText: {
    color: '#CBD5E1',
    fontSize: 14,
    fontWeight: '600',
  },
  activeTypeChipText: {
    color: '#FFFFFF',
  },
  form: {
    flexShrink: 1,
  },
  formContent: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  label: {
    marginTop: 10,
    marginBottom: 6,
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
    color: '#FFFFFF',
    fontSize: 15,
  },
  descriptionInput: {
    minHeight: 66,
    maxHeight: 112,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  offlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  offlineCopy: {
    flex: 1,
  },
  helper: {
    color: '#94A3B8',
    fontSize: 12,
  },
  topicList: {
    gap: 8,
    paddingBottom: 2,
  },
  topicChip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#475569',
    backgroundColor: '#0F172A',
  },
  selectedTopicChip: {
    borderColor: '#F97316',
    backgroundColor: '#F97316',
  },
  topicChipText: {
    color: '#CBD5E1',
    fontSize: 13,
  },
  selectedTopicChipText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  error: {
    marginTop: 8,
    color: '#FCA5A5',
    fontSize: 13,
  },
  footer: {
    marginHorizontal: -20,
    marginTop: 8,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#334155',
  },
  saveButton: {
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#F97316',
  },
  saveButtonDisabled: {
    opacity: 0.65,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

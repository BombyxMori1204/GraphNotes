import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useKeyboardOffset } from '@/hooks/useKeyboardOffset';

interface KeyboardAwareBottomProps {
  children: ReactNode;
  maxHeight?: number;
  style?: StyleProp<ViewStyle>;
}

export function KeyboardAwareBottom({
  children,
  maxHeight,
  style,
}: KeyboardAwareBottomProps) {
  const keyboardOffset = useKeyboardOffset();
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboardOffset.value }],
    ...(maxHeight === undefined
      ? {}
      : { maxHeight: Math.max(0, maxHeight - keyboardOffset.value) }),
  }), [maxHeight]);

  return (
    <Animated.View style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}

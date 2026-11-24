import { useEffect } from 'react';
import { Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

export function useKeyboardOffset(): SharedValue<number> {
  const insets = useSafeAreaInsets();
  const keyboardOffset = useSharedValue(0);

  useEffect(() => {
    const showSubscription = Keyboard.addListener(
      'keyboardDidShow',
      (event) => {
        keyboardOffset.value = withTiming(
          Math.max(0, event.endCoordinates.height - insets.bottom),
          { duration: 220 },
        );
      },
    );
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      keyboardOffset.value = withTiming(0, { duration: 180 });
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [insets.bottom, keyboardOffset]);

  return keyboardOffset;
}

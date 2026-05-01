import { useRef, type ReactNode } from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  Animated,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
  type GestureResponderEvent,
} from 'react-native';
import * as haptics from '../../utils/agent/haptics';

type HapticType = 'tap' | 'press' | 'heavy' | 'success' | 'warning' | 'error' | 'selection';

export interface HapticButtonProps extends Omit<PressableProps, 'onPress' | 'style' | 'disabled'> {
  onPress?: (e?: GestureResponderEvent) => void;
  title?: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  loading?: boolean;
  disabled?: boolean;
  hapticType?: HapticType;
}

const HapticButton: React.FC<HapticButtonProps> = ({
  onPress,
  title,
  children,
  style,
  textStyle,
  loading = false,
  disabled = false,
  hapticType = 'tap',
  ...rest
}) => {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = (): void => {
    Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, friction: 7, tension: 200 }).start();
  };
  const handlePressOut = (): void => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5, tension: 100 }).start();
  };
  const handlePress = (e: GestureResponderEvent): void => {
    if (loading || disabled) return;
    (haptics[hapticType] || haptics.tap)();
    onPress?.(e);
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        disabled={loading || disabled}
        style={[styles.base, disabled && styles.disabled, style]}
        {...rest}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : children ? (
          children
        ) : (
          <Text style={[styles.text, textStyle]}>{title}</Text>
        )}
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  base: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF6B35',
  },
  disabled: { opacity: 0.5 },
  text: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
});

export default HapticButton;

import React, { useRef } from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, Animated } from 'react-native';
import * as haptics from '../utils/haptics';

const HapticButton = ({
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

  // Snappy 80ms timing — feels instant, no spring lag
  const handlePressIn = () => {
    Animated.timing(scale, { toValue: 0.96, duration: 80, useNativeDriver: true }).start();
  };
  const handlePressOut = () => {
    Animated.timing(scale, { toValue: 1, duration: 80, useNativeDriver: true }).start();
  };
  const handlePress = (e) => {
    if (loading || disabled) return;
    (haptics[hapticType] || haptics.tap)();   // fire-and-forget
    onPress?.(e);                              // run handler immediately
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        disabled={loading || disabled}
        android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: false }}
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
    backgroundColor: '#E63946',
  },
  disabled: { opacity: 0.5 },
  text: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
});

export default HapticButton;

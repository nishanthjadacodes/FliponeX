import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Modal, Animated, Easing } from 'react-native';
import * as haptics from '../utils/haptics';

/**
 * Animated success modal — shows a check mark with spring entrance + auto-dismiss.
 *
 * Usage:
 *   const [show, setShow] = useState(false);
 *   <SuccessToast visible={show} title="Uploaded!" subtitle="..." onHide={() => setShow(false)} />
 */
const SuccessToast = ({
  visible,
  title = 'Success!',
  subtitle = '',
  duration = 1800,
  variant = 'success', // 'success' | 'error' | 'info'
  onHide,
}) => {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      if (variant === 'success') haptics.success();
      else if (variant === 'error') haptics.error();
      else haptics.tap();

      // Entrance animation
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start();

      // Check mark zoom in slightly delayed
      Animated.spring(checkScale, {
        toValue: 1, delay: 150, friction: 4, tension: 100, useNativeDriver: true,
      }).start();

      // Auto-dismiss
      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(scale, { toValue: 0.8, duration: 200, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]).start(() => {
          checkScale.setValue(0);
          onHide?.();
        });
      }, duration);

      return () => clearTimeout(timer);
    } else {
      scale.setValue(0);
      opacity.setValue(0);
      checkScale.setValue(0);
    }
  }, [visible]);

  const config = {
    success: { color: '#28A745', tint: '#E8F5E9', icon: '✓' },
    error:   { color: '#E63946', tint: '#FCE4E6', icon: '✕' },
    info:    { color: '#1976D2', tint: '#E3F2FD', icon: 'ℹ' },
  }[variant] || { color: '#28A745', tint: '#E8F5E9', icon: '✓' };

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <Animated.View style={[styles.overlay, { opacity }]}>
        <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
          <View style={[styles.iconRing, { backgroundColor: config.tint }]}>
            <Animated.View
              style={[
                styles.iconCircle,
                { backgroundColor: config.color, transform: [{ scale: checkScale }] },
              ]}
            >
              <Text style={styles.iconText}>{config.icon}</Text>
            </Animated.View>
          </View>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 30,
    paddingHorizontal: 26,
    minWidth: 240,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 12,
  },
  iconRing: {
    width: 80, height: 80, borderRadius: 40,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 14,
  },
  iconCircle: {
    width: 56, height: 56, borderRadius: 28,
    justifyContent: 'center', alignItems: 'center',
  },
  iconText: { color: '#fff', fontSize: 30, fontWeight: '900' },
  title: { fontSize: 18, fontWeight: '800', color: '#1A1A1A', textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#6C757D', textAlign: 'center', lineHeight: 18 },
});

export default SuccessToast;

import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, type ViewProps, type ViewStyle, type StyleProp } from 'react-native';

export interface FadeInViewProps extends Omit<ViewProps, 'style'> {
  children?: ReactNode;
  delay?: number;
  from?: 'bottom' | 'top' | 'left' | 'right';
  distance?: number;
  style?: StyleProp<ViewStyle>;
}

const FadeInView: React.FC<FadeInViewProps> = ({
  children,
  delay = 0,
  from = 'bottom',
  distance = 20,
  style,
  ...rest
}) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const offset = useRef(new Animated.Value(distance)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay, useNativeDriver: true }),
      Animated.spring(offset, { toValue: 0, delay, friction: 7, tension: 80, useNativeDriver: true }),
    ]).start();
  }, []);

  const translateY = ['bottom', 'top'].includes(from)
    ? offset.interpolate({
        inputRange: [0, distance],
        outputRange: [0, from === 'bottom' ? distance : -distance],
      })
    : 0;
  const translateX = ['left', 'right'].includes(from)
    ? offset.interpolate({
        inputRange: [0, distance],
        outputRange: [0, from === 'right' ? distance : -distance],
      })
    : 0;

  return (
    <Animated.View
      style={[{ opacity, transform: [{ translateY }, { translateX }] }, style]}
      {...rest}
    >
      {children}
    </Animated.View>
  );
};

export default FadeInView;

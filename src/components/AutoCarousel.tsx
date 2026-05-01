import { useEffect, useRef } from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';

/**
 * Smooth auto-rotating carousel — animation runs on the native UI thread
 * via react-native-reanimated, so it's locked to 60fps regardless of what
 * the JS thread is doing. Same feel as the auto-rotating banners on
 * Swiggy / Zomato / Paytm home screens.
 *
 * Approach (clone-and-loop pattern):
 *   - Render `items` followed by a duplicate of `items[0]` at the end
 *   - Auto-advance translateX each `intervalMs` with a cubic-ease curve
 *   - When animation lands on the duplicate (visually identical to the
 *     start), instantly snap translateX back to 0 — invisible to the user
 *
 * No manual swipe — banner carousels conventionally auto-rotate without
 * touch interaction. If a card is tappable, wrap each child in your own
 * `<TouchableOpacity>`.
 */
export interface AutoCarouselProps<T> {
  items: T[];
  /** Width of each card in pixels — must match the rendered card width. */
  cardWidth: number;
  /** Time between auto-advances. Default 3500ms. */
  intervalMs?: number;
  /** Duration of each slide animation. Default 600ms — feels smooth without dragging. */
  slideDurationMs?: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Optional outer wrapper style (applied to the clipped viewport). */
  style?: ViewStyle;
  /** Optional inner row style. */
  contentStyle?: ViewStyle;
}

function AutoCarousel<T>({
  items,
  cardWidth,
  intervalMs = 3500,
  slideDurationMs = 600,
  renderItem,
  style,
  contentStyle,
}: AutoCarouselProps<T>) {
  const offset = useSharedValue(0);
  const indexRef = useRef<number>(0);

  useEffect(() => {
    if (!items || items.length <= 1) return;
    const realCount = items.length;

    const tick = () => {
      const next = indexRef.current + 1; // can briefly equal realCount (the clone)
      offset.value = withTiming(
        -next * cardWidth,
        {
          duration: slideDurationMs,
          easing: Easing.out(Easing.cubic),
        },
        (finished) => {
          'worklet';
          if (finished && next >= realCount) {
            // Landed on the duplicate. Snap back to 0 instantly. The card
            // at offset 0 looks identical to the one we just landed on, so
            // the user perceives an unbroken loop.
            offset.value = 0;
          }
        },
      );
      indexRef.current = next >= realCount ? 0 : next;
    };

    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [items, cardWidth, intervalMs, slideDurationMs]);

  // RN's transform array typing rejects worklet-derived values — cast to any
  // to keep the runtime semantics identical without fighting the type system.
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }] as any,
  }));

  // Render the items + a clone of the first one for seamless wraparound.
  const clones = items.length > 0 ? [...items, items[0]] : items;

  return (
    <View style={[styles.viewport, style]}>
      <Animated.View style={[styles.row, contentStyle, animStyle]}>
        {clones.map((it, i) => (
          // Each slot is exactly cardWidth wide. We use `flexDirection: row`
          // on the inner so the rendered card stretches to fill the slot
          // (combined with `flex: 1` on the card itself), giving us cards
          // that touch edge-to-edge with zero gap.
          <View
            key={`auto-${i}`}
            style={{ width: cardWidth, flexDirection: 'row' }}
          >
            {renderItem(it, i)}
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: {
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
  },
});

export default AutoCarousel;

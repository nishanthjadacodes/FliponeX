import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { COLORS, SIZES, BORDER_RADIUS } from '../constants/colors';
import { STRINGS } from '../constants/strings';
import { storeB2BMode, getB2BMode } from '../utils/storage';

export type B2BMode = 'consumer' | 'industrial';

export interface B2BToggleProps {
  onToggle?: (type: B2BMode) => void;
  currentMode?: B2BMode;
}

const B2BToggle: React.FC<B2BToggleProps> = ({ onToggle, currentMode }) => {
  const [isIndustrial, setIsIndustrial] = useState(false);
  const [animatedValue] = useState(new Animated.Value(0));
  // Container width is needed to slide the indicator by exactly half.
  // Captured via onLayout once the toggle paints — until then, the
  // indicator just doesn't slide (avoids a flash to a hard-coded 48px).
  const [trackWidth, setTrackWidth] = useState<number>(0);

  useEffect(() => {
    if (currentMode) {
      setIsIndustrial(currentMode === 'industrial');
    } else {
      loadMode();
    }
  }, [currentMode]);

  useEffect(() => {
    Animated.timing(animatedValue, {
      toValue: isIndustrial ? 1 : 0,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, [isIndustrial, animatedValue]);

  const loadMode = async (): Promise<void> => {
    try {
      const savedMode = await getB2BMode();
      setIsIndustrial(savedMode === 'industrial');
    } catch (error) {
      console.error('Error loading service type mode:', error);
    }
  };

  const handleToggle = async (type: B2BMode): Promise<void> => {
    const newIsIndustrial = type === 'industrial';
    setIsIndustrial(newIsIndustrial);

    try {
      await storeB2BMode(type);
      if (onToggle) {
        onToggle(type);
      }
    } catch (error) {
      console.error('Error saving service type mode:', error);
    }
  };

  // Slide distance = (track width / 2) - the 4px padding on either side
  // of the indicator. Until trackWidth is measured, slide stays at 0 so
  // there's no jump on first paint.
  const slideDistance = trackWidth > 0 ? trackWidth / 2 - 4 : 0;
  const toggleStyle = {
    transform: [
      {
        translateX: animatedValue.interpolate({
          inputRange: [0, 1],
          outputRange: [0, slideDistance],
        }),
      },
    ],
  };

  return (
    <View
      style={styles.container}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
    >
      {/* Indicator BEHIND the labels — z-index handled via order in JSX
          (RN respects last-rendered-on-top). Indicator is rendered first
          via absolute positioning so labels sit on top. */}
      <Animated.View style={[styles.toggleIndicator, toggleStyle]} />

      <TouchableOpacity
        style={styles.option}
        onPress={() => handleToggle('consumer')}
        activeOpacity={0.7}
      >
        {/* 🏠 next to "Common Services" — house glyph reads as "doorstep
            consumer". Active text turns navy on the gold pill. */}
        <Text style={styles.optionEmoji}>🏠</Text>
        {/* numberOfLines={1} + adjustsFontSizeToFit guarantee the full
            "Common Services" / "Industrial Services" label stays on a
            SINGLE line on every phone — they'd otherwise wrap to two
            lines (icon on row 1, second word on row 2) on narrow
            devices, breaking the pill alignment. */}
        <Text
          style={[styles.optionText, !isIndustrial && styles.activeText]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
        >
          {STRINGS.COMMON}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.option}
        onPress={() => handleToggle('industrial')}
        activeOpacity={0.7}
      >
        {/* 🏭 factory glyph next to "Industrial Services". */}
        <Text style={styles.optionEmoji}>🏭</Text>
        <Text
          style={[styles.optionText, isIndustrial && styles.activeText]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
        >
          {STRINGS.INDUSTRIAL}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  // Pill-style segmented toggle: light-gray track with a deep-blue
  // pill that slides between Common / Industrial. Matches the design
  // mock — wider rounded corners, bolder active text, more padding.
  container: {
    flexDirection: 'row',
    backgroundColor: '#EEF2F6',
    borderRadius: 999,
    padding: 4,
    position: 'relative',
    minHeight: 48,
  },
  option: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    // Tighter horizontal padding (was SIZES.BASE * 2 = 16) so the longer
    // "Common Services" / "Industrial Services" labels have enough room
    // to render on one line on a 320–360px phone alongside their emoji.
    paddingHorizontal: SIZES.BASE,
    borderRadius: 999,
    zIndex: 1,
  },
  optionEmoji: {
    fontSize: 16,
  },
  optionText: {
    fontSize: SIZES.FONT,
    color: '#64748B',
    fontWeight: '600',
  },
  // Active state — white text on Prussian-blue pill. The blue is the
  // brand primary so it visually anchors the toggle to the rest of the
  // navy header / hero card on the home screen.
  activeText: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  toggleIndicator: {
    position: 'absolute',
    top: 4,
    left: 4,
    bottom: 4,
    width: '50%',
    backgroundColor: '#0D3B66',
    borderRadius: 999,
    zIndex: 0,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
});

export default B2BToggle;

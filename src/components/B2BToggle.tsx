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
      duration: 300,
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

  const toggleStyle = {
    transform: [
      {
        translateX: animatedValue.interpolate({
          inputRange: [0, 1],
          outputRange: [0, SIZES.BASE * 6],
        }),
      },
    ],
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.option, !isIndustrial && styles.activeOption]}
        onPress={() => handleToggle('consumer')}
      >
        <Text style={[styles.optionText, !isIndustrial && styles.activeText]}>
          {STRINGS.COMMON}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.option, isIndustrial && styles.activeOption]}
        onPress={() => handleToggle('industrial')}
      >
        <Text style={[styles.optionText, isIndustrial && styles.activeText]}>
          {STRINGS.INDUSTRIAL}
        </Text>
      </TouchableOpacity>

      <Animated.View style={[styles.toggleIndicator, toggleStyle]} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: COLORS.LIGHT_GRAY,
    borderRadius: BORDER_RADIUS.LARGE,
    padding: SIZES.BASE / 2,
    position: 'relative',
  },
  option: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: SIZES.BASE,
    paddingHorizontal: SIZES.BASE * 2,
    borderRadius: BORDER_RADIUS.MEDIUM,
    zIndex: 1,
  },
  activeOption: {
    backgroundColor: 'transparent',
  },
  optionText: {
    fontSize: SIZES.FONT,
    color: COLORS.GRAY,
    fontWeight: '600',
  },
  activeText: {
    color: COLORS.WHITE,
  },
  toggleIndicator: {
    position: 'absolute',
    top: SIZES.BASE / 2,
    left: SIZES.BASE / 2,
    width: '50%',
    // Note: 'calc()' is a CSS string here — RN tolerates it on native;
    // we keep the original behavior to avoid layout regressions.
    height: 'calc(100% - 8px)' as unknown as number,
    backgroundColor: COLORS.PRIMARY,
    borderRadius: BORDER_RADIUS.MEDIUM,
    zIndex: 0,
  },
});

export default B2BToggle;

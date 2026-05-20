import React, { useRef, useEffect } from 'react';
import { Pressable, StyleSheet, Linking, Alert, Animated } from 'react-native';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import { STRINGS } from '../constants/strings';
import * as haptics from '../utils/haptics';

const WHATSAPP_GREEN = '#25D366';

const WhatsAppButton: React.FC = () => {
  const scale = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  // Subtle continuous pulse to draw attention
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const handlePressIn = (): void => {
    Animated.timing(scale, { toValue: 0.92, duration: 80, useNativeDriver: true }).start();
  };
  const handlePressOut = (): void => {
    Animated.timing(scale, { toValue: 1, duration: 80, useNativeDriver: true }).start();
  };

  const handleWhatsAppPress = async (): Promise<void> => {
    haptics.tap();
    const phoneNumber = STRINGS.WHATSAPP_NUMBER.replace(/[^\d]/g, '');
    const message = encodeURIComponent(STRINGS.WHATSAPP_MESSAGE);
    const whatsappUrl = `whatsapp://send?phone=${phoneNumber}&text=${message}`;
    const webUrl = `https://wa.me/${phoneNumber}?text=${message}`;

    try {
      const supported = await Linking.canOpenURL(whatsappUrl);
      await Linking.openURL(supported ? whatsappUrl : webUrl);
    } catch (error) {
      Alert.alert('WhatsApp Support', `Reach us at ${STRINGS.WHATSAPP_NUMBER}`);
    }
  };

  return (
    <Animated.View style={[styles.fab, { transform: [{ scale: Animated.multiply(scale, pulse) }] }]}>
      <Pressable
        onPress={handleWhatsAppPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        android_ripple={{ color: 'rgba(255,255,255,0.3)', borderless: true }}
        style={styles.fabInner}
      >
        {/* Real WhatsApp logo via FontAwesome (white on the green
            FAB so it matches WhatsApp's brand glyph instead of the
            generic 💬 chat bubble that was there before). */}
        <FontAwesome name="whatsapp" size={32} color="#FFFFFF" />
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    // Sits ~80px above the bottom edge of the parent screen so it
    // floats clear of the bottom-tab nav (~56–72px high) on every
    // device. zIndex so it always paints over scrollable content.
    bottom: 80,
    right: 16,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: WHATSAPP_GREEN,
    shadowColor: WHATSAPP_GREEN,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
    zIndex: 999,
  },
  fabInner: {
    width: '100%',
    height: '100%',
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default WhatsAppButton;

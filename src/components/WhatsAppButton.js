import React, { useRef, useEffect } from 'react';
import { Pressable, Text, StyleSheet, Linking, Alert, Animated } from 'react-native';
import { STRINGS } from '../constants/strings';
import * as haptics from '../utils/haptics';

const WHATSAPP_GREEN = '#25D366';

const WhatsAppButton = () => {
  const scale = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  // Subtle continuous pulse to draw attention
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const handlePressIn = () => Animated.timing(scale, { toValue: 0.92, duration: 80, useNativeDriver: true }).start();
  const handlePressOut = () => Animated.timing(scale, { toValue: 1, duration: 80, useNativeDriver: true }).start();

  const handleWhatsAppPress = async () => {
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
        <Text style={styles.icon}>💬</Text>
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
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
  },
  fabInner: {
    width: '100%',
    height: '100%',
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: { fontSize: 28 },
});

export default WhatsAppButton;

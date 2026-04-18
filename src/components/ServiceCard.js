import React, { useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import * as haptics from '../utils/haptics';

// Single brand palette for every service card — Prussian Blue + white.
// Icon chip uses a very light blue tint so the emoji stays legible; accent
// (stripe + time-pill text) uses the full Prussian Blue.
const BRAND = { bg: '#E3EEF8', accent: '#0D3B66' };

const styleForService = () => BRAND;

const iconForCategory = (text) => {
  const t = (text || '').toLowerCase();
  if (t.includes('aadhaar')) return '🆔';
  if (t.includes('pan')) return '💳';
  if (t.includes('voter')) return '🗳️';
  if (t.includes('ration')) return '🍱';
  if (t.includes('driving') || t.includes('license')) return '🚗';
  if (t.includes('passport')) return '🛂';
  if (t.includes('income')) return '💼';
  if (t.includes('birth')) return '👶';
  if (t.includes('marriage')) return '💍';
  return '📄';
};

const ServiceCard = ({ service, onPress }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const palette = styleForService(`${service.name} ${service.category}`);
  const icon = iconForCategory(`${service.name} ${service.category}`);

  const handlePressIn = () => { Animated.timing(scale, { toValue: 0.96, duration: 80, useNativeDriver: true }).start(); };
  const handlePressOut = () => { Animated.timing(scale, { toValue: 1, duration: 80, useNativeDriver: true }).start(); };
  const handlePress = () => { haptics.tap(); onPress?.(service); };

  return (
    <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        android_ripple={{ color: palette.bg, borderless: false }}
      >
        <View style={styles.row}>
          {/* Soft tinted icon — category color */}
          <View style={[styles.iconBadge, { backgroundColor: palette.bg }]}>
            <Text style={styles.iconEmoji}>{icon}</Text>
          </View>

          <View style={styles.content}>
            <Text style={styles.name} numberOfLines={2}>{service.name}</Text>

            <View style={styles.metaRow}>
              {service.pricing_model === 'quote' ? (
                // Quote-based (industrial) — no catalog price or fixed timeline
                <Text style={styles.quoteLabel}>Get Quote</Text>
              ) : (
                <Text style={styles.price}>
                  <Text style={styles.priceCurrency}>₹</Text>
                  {service.total_expense || service.price || 0}
                </Text>
              )}
              <View style={[styles.timePill, { backgroundColor: palette.bg }]}>
                <Text style={[styles.timeText, { color: palette.accent }]}>
                  {service.pricing_model === 'quote'
                    ? 'B2B'
                    : service.processing_time || service.estimated_time || 'Quick'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Subtle bottom accent stripe in the category color */}
        <View style={[styles.accentStripe, { backgroundColor: palette.accent }]} />
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    margin: 5,
    borderWidth: 1,
    borderColor: '#EEF0F2',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', padding: 12 },
  iconBadge: {
    width: 38, height: 38, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 10,
  },
  iconEmoji: { fontSize: 18 },
  content: { flex: 1 },
  name: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1A1A1A',
    minHeight: 32,
    lineHeight: 16,
    marginBottom: 10,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  price: { fontSize: 15, fontWeight: '800', color: '#1A1A1A' },
  priceCurrency: { fontWeight: '600', color: '#9E9E9E' },
  quoteLabel: { fontSize: 13, fontWeight: '800', color: '#1976D2', letterSpacing: 0.2 },
  timePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  timeText: { fontSize: 10, fontWeight: '700' },
  // Subtle 2px stripe at the bottom — adds category identity without overpowering
  accentStripe: { height: 2, width: '100%' },
});

export default ServiceCard;

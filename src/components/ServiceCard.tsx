import React, { useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import * as haptics from '../utils/haptics';
import type { Service } from '../types';

// Single brand palette for every service card — Prussian Blue + white.
const BRAND = { bg: '#E3EEF8', accent: '#0D3B66' } as const;

const styleForService = () => BRAND;

const iconForCategory = (text: string): string => {
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

// Service shape used by the card. Only loosely tied to the canonical Service
// type — accepts the extra fields the catalog hands us at runtime.
export interface ServiceCardItem extends Partial<Service> {
  pricing_model?: 'quote' | 'fixed' | string;
  indicative_price_from?: number | string;
  pricing_unit?: string;
  total_expense?: number;
  price?: number;
  processing_time?: string;
  estimated_time?: string;
}

export interface ServiceCardProps {
  service: ServiceCardItem;
  onPress?: (service: ServiceCardItem) => void;
  index?: number;
}

const ServiceCard: React.FC<ServiceCardProps> = ({ service, onPress }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const palette = styleForService();
  const icon = iconForCategory(`${service.name} ${service.category}`);

  const handlePressIn = (): void => {
    Animated.timing(scale, { toValue: 0.96, duration: 80, useNativeDriver: true }).start();
  };
  const handlePressOut = (): void => {
    Animated.timing(scale, { toValue: 1, duration: 80, useNativeDriver: true }).start();
  };
  const handlePress = (): void => {
    haptics.tap();
    onPress?.(service);
  };

  return (
    <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        android_ripple={{ color: palette.bg, borderless: false }}
      >
        <View style={styles.row}>
          <View style={[styles.iconBadge, { backgroundColor: palette.bg }]}>
            <Text style={styles.iconEmoji}>{icon}</Text>
          </View>

          <View style={styles.content}>
            <Text style={styles.name} numberOfLines={2}>
              {service.name}
            </Text>

            <View style={styles.metaRow}>
              {service.pricing_model === 'quote' ? (
                service.indicative_price_from ? (
                  <View>
                    <Text style={styles.quoteStartLabel}>Starting at</Text>
                    <Text style={styles.quoteStartPrice}>
                      ₹{Number(service.indicative_price_from).toLocaleString('en-IN')}
                      {service.pricing_unit && service.pricing_unit !== 'one_time' ? (
                        <Text style={styles.quoteStartUnit}>
                          {' '}/ {service.pricing_unit.replace('per_', '').replace('_', ' ')}
                        </Text>
                      ) : null}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.quoteLabel}>Get Quote</Text>
                )
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
  quoteStartLabel: { fontSize: 10, fontWeight: '600', color: '#78909C', letterSpacing: 0.4, textTransform: 'uppercase' },
  quoteStartPrice: { fontSize: 15, fontWeight: '800', color: '#0D47A1', marginTop: 1 },
  quoteStartUnit: { fontSize: 11, fontWeight: '500', color: '#78909C' },
  timePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  timeText: { fontSize: 10, fontWeight: '700' },
  accentStripe: { height: 2, width: '100%' },
});

export default ServiceCard;

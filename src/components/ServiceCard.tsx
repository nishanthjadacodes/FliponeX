import React, { useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import * as haptics from '../utils/haptics';
import type { Service } from '../types';

// Single brand palette for every service card — Prussian Blue + white.
const BRAND = { bg: '#E3EEF8', accent: '#0D3B66' } as const;

const styleForService = () => BRAND;

// Maps a service / category name → an emoji that hints at what the
// service is. Order matters: more-specific keywords first, broader
// catch-alls later. Surfaces in two places — ServiceCard (per-card
// badge) and HomeScreen's catIcon (per-section header) — keep them
// in sync.
export const iconForCategory = (text: string): string => {
  const t = (text || '').toLowerCase();

  // ─── Identity / govt ID documents ────────────────────────────────
  if (t.includes('aadhaar') || t.includes('aadhar')) return '🆔';
  if (t.includes('pan')) return '💳';
  if (t.includes('voter') || t.includes('epic') || t.includes('electoral')) return '🗳️';
  if (t.includes('ration') || t.includes('pds')) return '🍱';
  if (t.includes('driving') || t.includes('dl ') || t.includes('learner')) return '🚗';
  if (t.includes('passport')) return '🛂';
  if (t.includes('visa') || t.includes('immigration')) return '🛃';

  // ─── Travel ──────────────────────────────────────────────────────
  if (t.includes('flight') || t.includes('airline') || t.includes('air ticket')) return '✈️';
  if (t.includes('train') || t.includes('railway') || t.includes('irctc')) return '🚆';
  if (t.includes('bus')) return '🚌';
  if (t.includes('cab') || t.includes('taxi') || t.includes('uber') || t.includes('ola')) return '🚖';
  if (t.includes('hotel') || t.includes('stay')) return '🏨';
  if (t.includes('travel') || t.includes('tour')) return '🧳';

  // ─── Recharge / utility / bill payment ───────────────────────────
  if (t.includes('mobile recharge') || t.includes('prepaid')) return '📱';
  if (t.includes('dth') || t.includes('cable')) return '📺';
  if (t.includes('electric') || t.includes('electricity') || t.includes('bescom') || t.includes('mseb')) return '💡';
  if (t.includes('water bill') || (t.includes('water') && !t.includes('connection'))) return '💧';
  if (t.includes('gas') || t.includes('lpg') || t.includes('cylinder')) return '🔥';
  if (t.includes('broadband') || t.includes('wifi') || t.includes('fiber') || t.includes('internet')) return '📶';
  if (t.includes('telephone') || t.includes('landline')) return '☎️';
  if (t.includes('recharge') || t.includes('utility') || t.includes('bill pay')) return '🔌';

  // ─── Finance / banking ───────────────────────────────────────────
  if (t.includes('mutual fund') || t.includes('sip')) return '📊';
  if (t.includes('insurance') || t.includes('policy') || t.includes('lic')) return '🛡️';
  if (t.includes('loan') || t.includes('emi') || t.includes('credit')) return '💰';
  if (t.includes('demat') || t.includes('stock') || t.includes('shares')) return '📈';
  if (t.includes('bank') || t.includes('account opening')) return '🏦';
  if (t.includes('finance') || t.includes('investment')) return '💵';

  // ─── PF / ESI / employment / pension ─────────────────────────────
  if (t.includes('pf ') || t.includes('epfo') || t.includes('provident fund')) return '🏛️';
  if (t.includes('esi') || t.includes('esic')) return '🏥';
  if (t.includes('pension') || t.includes('npsl') || t.includes('nps ')) return '👴';
  if (t.includes('employment') || t.includes('job ') || t.includes('mgnrega') || t.includes('skill')) return '💼';
  if (t.includes('udyam') || t.includes('msme') || t.includes('startup') || t.includes('business reg')) return '🏢';

  // ─── Welfare / social schemes / state schemes ────────────────────
  if (t.includes('scholarship') || t.includes('education')) return '🎓';
  if (t.includes('housing') || t.includes('pmay') || t.includes('home') || t.includes('flat')) return '🏠';
  if (t.includes('subsidy') || t.includes('disability') || t.includes('handicap')) return '♿';
  if (t.includes('welfare') || t.includes('social security')) return '🤝';
  if (t.includes('state scheme') || t.includes('govt scheme') || t.includes('government scheme')) return '🏛️';
  if (t.includes('agriculture') || t.includes('farmer') || t.includes('kisan')) return '🌾';

  // ─── Health / medical ────────────────────────────────────────────
  if (t.includes('ayushman') || t.includes('health card') || t.includes('abha')) return '❤️‍🩹';
  if (t.includes('vaccine') || t.includes('covid') || t.includes('cowin')) return '💉';
  if (t.includes('hospital') || t.includes('medical')) return '🏥';

  // ─── Civic certificates ──────────────────────────────────────────
  if (t.includes('income certificate') || t.includes('income proof')) return '📑';
  if (t.includes('caste') || t.includes('obc') || t.includes('sc ') || t.includes('st ')) return '📜';
  if (t.includes('domicile') || t.includes('residence')) return '🏘️';
  if (t.includes('birth')) return '👶';
  if (t.includes('death')) return '🕯️';
  if (t.includes('marriage')) return '💍';
  if (t.includes('divorce')) return '⚖️';

  // ─── Property / vehicle / RTO ────────────────────────────────────
  if (t.includes('vehicle') || t.includes('rto') || t.includes('registration certificate')) return '🚘';
  if (t.includes('property') || t.includes('land') || t.includes('khata') || t.includes('survey')) return '📐';
  if (t.includes('rent') || t.includes('lease')) return '📑';

  // ─── Tax / GST ───────────────────────────────────────────────────
  if (t.includes('gst')) return '🧾';
  if (t.includes('income tax') || t.includes('itr') || t.includes('tax return')) return '🧮';
  if (t.includes('tax')) return '🧾';

  // ─── Generic catch-alls ──────────────────────────────────────────
  if (t.includes('government') || t.includes('govt') || t.includes('statutory')) return '🏛️';
  if (t.includes('service') || t.includes('certificate') || t.includes('document')) return '📄';

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
                  {/* user_cost is the customer-facing price (govt + partner
                      + company margin). Was previously showing total_expense
                      which is just (govt + partner) — caused the home-page
                      card to show ₹175 even though checkout charges ₹275. */}
                  {service.user_cost || service.total_expense || service.price || 0}
                </Text>
              )}
              <View style={[styles.timePill, { backgroundColor: palette.bg }]}>
                <Text style={[styles.timeText, { color: palette.accent }]}>
                  {service.pricing_model === 'quote'
                    ? 'B2B'
                    : (() => {
                        // Prefer the canonical rate-chart timeline
                        // (service.expected_timeline) over the older
                        // generic processing_time / estimated_time
                        // columns. Strip "Instant"/"Quick"/"N/A"
                        // placeholders so the pill shows a real
                        // duration whenever the DB has one.
                        const placeholder = /^(instant|quick|n\/?a|tbd|—|-)$/i;
                        const candidates = [
                          service.expected_timeline,
                          service.processing_time,
                          service.estimated_time,
                        ];
                        const found = candidates.find(
                          (v) => v && !placeholder.test(String(v).trim()),
                        );
                        return found || 'See details';
                      })()}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Book Now CTA — Prussian blue pill INSIDE the card itself.
            Tapping it routes through the same `onPress` so the card and
            the button share one handler — no double-binding. */}
        <View style={styles.bookNowBtn}>
          <Text style={styles.bookNowBtnText}>Book Now  →</Text>
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
  // Prussian-blue Book Now CTA inside the card. Sits below the meta
  // row + above the accent stripe so every card shows the explicit
  // call-to-action without the user needing to read the price hint.
  bookNowBtn: {
    backgroundColor: '#0D3B66',
    marginHorizontal: 12,
    marginBottom: 10,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: 'center',
  },
  bookNowBtnText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.4,
  },
});

// React.memo so HomeScreen's View All ↔ Show Less toggle doesn't
// rerender 156 cards when only `showAllServices` flipped. Default
// shallow equality on `service` + `onPress` is enough — service
// objects come from a stable API response, and HomeScreen wraps
// onPress in useCallback.
export default React.memo(ServiceCard);

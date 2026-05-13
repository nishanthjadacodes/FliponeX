// Pre-login flash notifications. Mounted on both customer and agent
// login screens so the ops team can surface festival offers, scheduled
// maintenance windows, or other "everyone needs to know this" messages
// to users who haven't authenticated yet.
//
// Source of truth (in priority order):
//   1. GET /announcements/prelogin  — public endpoint, returns array
//   2. Static fallback list below   — used when the endpoint is missing,
//      the device is offline, or the API returns an empty list
//
// Each banner is dismissible. Dismissals are remembered locally (by id)
// in AsyncStorage so the same notification doesn't re-appear after the
// user closes it. New announcements (different id) show up immediately.

import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../services/api';

export interface PreLoginAnnouncement {
  id: string;
  title: string;
  body: string;
  // Optional accent colour for the banner's left border + icon tint.
  // Falls back to a festive gold if not provided.
  color?: string;
  emoji?: string;
}

// Fallback announcements — shown when the backend has nothing to push
// or the endpoint hasn't been deployed yet. Keep this list short and
// evergreen; do not put time-sensitive ops messages here.
const FALLBACK_ANNOUNCEMENTS: PreLoginAnnouncement[] = [
  {
    id: 'welcome-default',
    title: 'Welcome to FliponeX',
    body: 'Doorstep digital services across India — login to book.',
    color: '#0D3B66',
    emoji: '👋',
  },
  {
    id: 'festival-default',
    title: 'Festive offer — ₹20 off your first booking',
    body: 'Apply code FLIPON20 at checkout. Limited period.',
    color: '#F59E0B',
    emoji: '🎉',
  },
];

const DISMISSED_STORAGE_KEY = 'prelogin_banner_dismissed_ids_v1';

interface Props {
  // Tint the card to match the host screen's palette. Customer login is
  // light navy; agent login is dark navy. Defaults to white-on-dark.
  variant?: 'light' | 'dark';
}

const PreLoginBanner: React.FC<Props> = ({ variant = 'light' }) => {
  const [announcements, setAnnouncements] = useState<PreLoginAnnouncement[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<ScrollView | null>(null);
  const cardWidth = Math.min(Dimensions.get('window').width - 32, 420);

  // Load dismissed IDs once on mount so we can filter the announcement list.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DISMISSED_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setDismissedIds(new Set(parsed));
        }
      } catch (_) {
        /* harmless — start with empty set */
      }
    })();
  }, []);

  // Pull live announcements; on failure, fall back to the static list.
  // The endpoint is intentionally unauthenticated so the device shows
  // them BEFORE the user has logged in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let live: PreLoginAnnouncement[] | null = null;
      try {
        const res = await api.get('/announcements/prelogin', { timeout: 4000 });
        const list = (res?.data?.data || res?.data || []) as PreLoginAnnouncement[];
        if (Array.isArray(list) && list.length > 0) live = list;
      } catch (_) {
        /* offline or endpoint missing — fall through to fallback */
      }
      if (cancelled) return;
      setAnnouncements(live || FALLBACK_ANNOUNCEMENTS);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = announcements.filter((a) => !dismissedIds.has(a.id));
  if (visible.length === 0) return null;

  const handleDismiss = async (id: string): Promise<void> => {
    const next = new Set(dismissedIds);
    next.add(id);
    setDismissedIds(next);
    try {
      await AsyncStorage.setItem(
        DISMISSED_STORAGE_KEY,
        JSON.stringify(Array.from(next)),
      );
    } catch (_) {
      /* non-blocking — worst case the banner reappears next launch */
    }
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / cardWidth);
    if (idx !== activeIndex) setActiveIndex(idx);
  };

  const isDark = variant === 'dark';

  return (
    <View style={styles.wrap}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardWidth}
        decelerationRate="fast"
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {visible.map((a) => {
          const accent = a.color || '#F59E0B';
          return (
            <View
              key={a.id}
              style={[
                styles.card,
                { width: cardWidth },
                isDark ? styles.cardDark : styles.cardLight,
                { borderLeftColor: accent },
              ]}
            >
              <View style={styles.cardContent}>
                <Text style={[styles.emoji, { color: accent }]}>{a.emoji || '📣'}</Text>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.title, isDark && styles.titleDark]}
                    numberOfLines={1}
                  >
                    {a.title}
                  </Text>
                  <Text
                    style={[styles.body, isDark && styles.bodyDark]}
                    numberOfLines={2}
                  >
                    {a.body}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleDismiss(a.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.closeBtn}
                >
                  <Text style={[styles.closeText, isDark && styles.closeTextDark]}>
                    ✕
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>
      {visible.length > 1 && (
        <View style={styles.dotsRow}>
          {visible.map((a, i) => (
            <View
              key={a.id}
              style={[
                styles.dot,
                i === activeIndex && styles.dotActive,
                isDark && i !== activeIndex && styles.dotDark,
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 14,
    alignItems: 'center',
  },
  card: {
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderLeftWidth: 4,
    marginHorizontal: 8,
  },
  cardLight: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  cardDark: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  emoji: {
    fontSize: 22,
    marginRight: 10,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0D3B66',
  },
  titleDark: {
    color: '#FCD34D',
  },
  body: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
    lineHeight: 16,
  },
  bodyDark: {
    color: 'rgba(255,255,255,0.85)',
  },
  closeBtn: {
    paddingHorizontal: 6,
    marginLeft: 6,
  },
  closeText: {
    fontSize: 16,
    color: '#94A3B8',
    fontWeight: '700',
  },
  closeTextDark: {
    color: 'rgba(255,255,255,0.6)',
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 8,
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#CBD5E1',
  },
  dotActive: {
    backgroundColor: '#0D3B66',
    width: 18,
  },
  dotDark: {
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
});

export default PreLoginBanner;

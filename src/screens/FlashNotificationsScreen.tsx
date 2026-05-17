// Splash-before-login banners (Flipkart / Myntra festive-offer pattern).
//
// Lifecycle:
//   1. SplashScreen finishes its animation, fetches active flash
//      notifications from /flash-notifications/active.
//   2. If at least one notification is NOT in the per-device "seen"
//      AsyncStorage set, Splash navigates here passing the intended
//      next route as a param (e.g. nextRoute='Login' for a logged-out
//      customer, nextRoute='HomeTabs' for a returning user).
//   3. This screen shows the unseen notifications as a swipeable
//      carousel with a "Continue" / "Skip All" button. Tapping the
//      CTA navigates to cta_url (external link or fliponex:// deep
//      link). Dismissing marks all visible notifications as seen so
//      they don't pop up again on next launch.
//   4. On dismiss-all we navigate to the saved nextRoute.

import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Dimensions,
  Linking,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../config';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SEEN_KEY = '@flipon_flash_notifications_seen';

interface FlashNotification {
  id: string;
  title: string;
  body?: string | null;
  image_url?: string | null;
  cta_label?: string | null;
  cta_url?: string | null;
}

interface Props {
  navigation: {
    replace?: (route: string, params?: any) => void;
    reset?: (state: { index: number; routes: { name: string; params?: any }[] }) => void;
  };
  route: {
    params?: {
      nextRoute?: string;
      nextParams?: Record<string, unknown>;
    };
  };
}

const FlashNotificationsScreen: React.FC<Props> = ({ navigation, route }) => {
  const [items, setItems] = useState<FlashNotification[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeIdx, setActiveIdx] = useState<number>(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const nextRoute = route?.params?.nextRoute || 'ModeSelect';
  const nextParams = route?.params?.nextParams;

  // Loader — fetches active notifications, filters out already-seen
  // ones via AsyncStorage. If nothing's left to show, navigate
  // straight through.
  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`${API_BASE_URL}/flash-notifications/active`);
        const json = await resp.json();
        const all: FlashNotification[] = Array.isArray(json?.data) ? json.data : [];
        const seenRaw = await AsyncStorage.getItem(SEEN_KEY);
        const seen: string[] = seenRaw ? JSON.parse(seenRaw) : [];
        const seenSet = new Set(seen);
        const unseen = all.filter((n) => !seenSet.has(n.id));
        if (unseen.length === 0) {
          continueNext();
          return;
        }
        setItems(unseen);
      } catch (e: any) {
        // Backend unreachable on launch — don't block the user; skip
        // straight to the next route as if there were no notifications.
        console.log('[flash] fetch failed:', e?.message);
        continueNext();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const continueNext = (): void => {
    if (navigation.reset) {
      navigation.reset({
        index: 0,
        routes: [{ name: nextRoute, params: nextParams }],
      });
    } else {
      navigation.replace?.(nextRoute, nextParams);
    }
  };

  const markAllSeenAndContinue = async (): Promise<void> => {
    try {
      const seenRaw = await AsyncStorage.getItem(SEEN_KEY);
      const seen: string[] = seenRaw ? JSON.parse(seenRaw) : [];
      const merged = Array.from(new Set([...seen, ...items.map((i) => i.id)]));
      await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(merged));
    } catch (_) { /* non-fatal */ }
    continueNext();
  };

  const handleCta = async (item: FlashNotification): Promise<void> => {
    if (!item.cta_url) return;
    try {
      const supported = await Linking.canOpenURL(item.cta_url);
      if (supported) {
        await Linking.openURL(item.cta_url);
      }
    } catch (_) { /* ignore — don't block */ }
    // Mark the tapped notification seen but stay on this screen so
    // the user can still browse the other banners or skip.
    try {
      const seenRaw = await AsyncStorage.getItem(SEEN_KEY);
      const seen: string[] = seenRaw ? JSON.parse(seenRaw) : [];
      await AsyncStorage.setItem(
        SEEN_KEY,
        JSON.stringify(Array.from(new Set([...seen, item.id]))),
      );
    } catch (_) { /* non-fatal */ }
  };

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <StatusBar barStyle="light-content" backgroundColor="#0D3B66" />
        <ActivityIndicator color="#FFFFFF" size="large" />
      </View>
    );
  }

  if (items.length === 0) {
    // Should be redirected by useEffect already, but render-time guard
    // in case the navigation hasn't fired yet.
    return null;
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0D3B66" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>FliponeX</Text>
        <TouchableOpacity onPress={markAllSeenAndContinue} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.skipText}>Skip ✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
          setActiveIdx(idx);
        }}
      >
        {items.map((item) => (
          <View key={item.id} style={[styles.card, { width: SCREEN_WIDTH }]}>
            {item.image_url ? (
              <Image
                source={{ uri: item.image_url }}
                style={styles.image}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.image, styles.imageFallback]}>
                <Text style={styles.imageFallbackEmoji}>📣</Text>
              </View>
            )}
            <View style={styles.body}>
              <Text style={styles.title}>{item.title}</Text>
              {item.body ? <Text style={styles.bodyText}>{item.body}</Text> : null}
              {item.cta_url && item.cta_label ? (
                <TouchableOpacity style={styles.ctaBtn} onPress={() => handleCta(item)}>
                  <Text style={styles.ctaBtnText}>{item.cta_label} →</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Page dots — only when more than one notification */}
      {items.length > 1 && (
        <View style={styles.dotsRow}>
          {items.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === activeIdx && styles.dotActive]}
            />
          ))}
        </View>
      )}

      <TouchableOpacity style={styles.continueBtn} onPress={markAllSeenAndContinue}>
        <Text style={styles.continueBtnText}>Continue to FliponeX →</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D3B66' },
  loadingWrap: {
    flex: 1,
    backgroundColor: '#0D3B66',
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    paddingTop: 48,
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  skipText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '700',
  },
  card: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    alignItems: 'center',
  },
  image: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
  },
  imageFallback: {
    backgroundColor: '#1E4F8C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageFallbackEmoji: { fontSize: 80 },
  body: {
    marginTop: 22,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 28,
  },
  bodyText: {
    marginTop: 10,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  ctaBtn: {
    marginTop: 22,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: '#F5B301',
  },
  ctaBtnText: {
    color: '#0D3B66',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 0.3,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  dotActive: {
    backgroundColor: '#F5B301',
    width: 18,
  },
  continueBtn: {
    marginHorizontal: 20,
    marginBottom: 30,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
  },
  continueBtnText: {
    color: '#0D3B66',
    fontWeight: '900',
    fontSize: 15,
    letterSpacing: 0.3,
  },
});

export default FlashNotificationsScreen;

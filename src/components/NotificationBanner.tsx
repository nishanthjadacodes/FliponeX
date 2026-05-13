// NotificationBanner — top-down sliding banner for in-app notifications.
//
// Mounted once at the root of the app (above NavigationContainer's screens
// but below GestureHandlerRootView). Polls the backend's /notifications/inbox
// every time the app gains focus, shows the topmost UNSEEN notification as a
// banner that slides in from the top of the screen, marks it seen on tap or
// dismiss, and (if the notification has a deep_link) navigates the user
// to the relevant screen.
//
// Visual is a glass-style card with title, body, optional CTA, and an X
// close button. Auto-dismisses after 8s. Stacks: if a second unseen
// notification comes in while one is showing, it queues up and shows
// next once the current one is dismissed.

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, AppState,
  Platform, StatusBar, PanResponder, Dimensions, type AppStateStatus,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Soft-load expo-haptics so a missing native binding doesn't crash
// the banner. Visual-only banner if haptics are unavailable.
let Haptics: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Haptics = require('expo-haptics');
} catch {
  Haptics = null;
}

// Top padding = status bar height. Avoids the SafeAreaProvider context
// dependency entirely — works the same regardless of where the banner
// is mounted in the tree.
const TOP_INSET = Platform.OS === 'android'
  ? (StatusBar.currentHeight || 24)
  : 44;

interface InboxNotification {
  id: string | number;
  type: string;
  title: string;
  body?: string | null;
  deep_link?: any;
  metadata?: any;
  seen_at?: string | null;
  created_at?: string;
}

interface Props {
  // Pass the navigation ref so we can deep-link on tap. Optional —
  // banner still works (informational only) if not provided.
  navigationRef?: { current: any };
  // API base URL (e.g. https://flipon-backend.onrender.com/api).
  apiBase: string;
}

const NotificationBanner: React.FC<Props> = ({ navigationRef, apiBase }) => {
  const [queue, setQueue] = useState<InboxNotification[]>([]);
  const [current, setCurrent] = useState<InboxNotification | null>(null);
  const slideY = useRef(new Animated.Value(-200)).current;
  const slideX = useRef(new Animated.Value(0)).current;

  // Local "dismissed" memory — TWO levels of dedup:
  //   1. By notification ID — handles the race between dismiss →
  //      markRead → next poll.
  //   2. By content hash (type|title|body) — handles backend
  //      duplicates with different IDs but identical content (e.g.
  //      booking creation retried by the customer app, fan-out to
  //      multiple admin accounts that share a phone, etc.). Bounded
  //      by a 10-minute window so a genuinely-new identical event
  //      later still surfaces.
  const dismissedIds = useRef<Set<string>>(new Set()).current;
  const dismissedContent = useRef<Map<string, number>>(new Map()).current;
  const CONTENT_DEDUP_WINDOW_MS = 10 * 60 * 1000;
  const contentKeyFor = (n: InboxNotification): string =>
    `${n.type}|${n.title}|${n.body || ''}`;
  const isAlreadyHandled = (n: InboxNotification): boolean => {
    if (dismissedIds.has(String(n.id))) return true;
    const ts = dismissedContent.get(contentKeyFor(n));
    if (ts && Date.now() - ts < CONTENT_DEDUP_WINDOW_MS) return true;
    return false;
  };
  const rememberDismissed = (n: InboxNotification): void => {
    dismissedIds.add(String(n.id));
    dismissedContent.set(contentKeyFor(n), Date.now());
  };

  // Tracks app foreground/background — we only fetch on transition to
  // active so we're not hitting the server when the app is in the
  // background.
  const appState = useRef(AppState.currentState);

  // Read whichever token is currently active. The customer app keeps
  // its token under 'token'; the agent app uses 'agent_token'. Both
  // surfaces share this banner component.
  const getActiveToken = useCallback(async (): Promise<string | null> => {
    const customer = await AsyncStorage.getItem('token');
    if (customer) return customer;
    const agent = await AsyncStorage.getItem('agent_token');
    return agent;
  }, []);

  // ─── Fetch unseen inbox ────────────────────────────────────────────
  const fetchInbox = useCallback(async (): Promise<void> => {
    try {
      const token = await getActiveToken();
      if (!token) return; // not logged in → nothing to fetch
      // Skip transient demo / offline tokens issued before real login.
      if (token.startsWith('demo_token_') || token.startsWith('offline_token_')) return;
      const res = await fetch(`${apiBase}/notifications/inbox?unread_only=true&limit=10`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json = await res.json();
      const list: InboxNotification[] = Array.isArray(json?.notifications) ? json.notifications : [];
      if (list.length > 0) {
        // Newest first → reverse so the OLDEST unseen pops first (FIFO).
        const ordered = list.slice().reverse();
        setQueue((prev) => {
          // De-dup against:
          //   1. items already queued (ID OR content match)
          //   2. items the user already dismissed in this session
          //      (ID OR content match — prevents the "spam every 30s"
          //      loop AND collapses backend duplicates with different
          //      IDs but identical content)
          //   3. the currently-displayed banner
          const existing = new Set(prev.map((n) => String(n.id)));
          const existingContent = new Set(prev.map(contentKeyFor));
          const next = ordered.filter((n) => {
            const id = String(n.id);
            if (existing.has(id)) return false;
            if (existingContent.has(contentKeyFor(n))) return false;
            if (isAlreadyHandled(n)) return false;
            if (current && String(current.id) === id) return false;
            return true;
          });
          return [...prev, ...next];
        });
      }
    } catch (e: any) {
      // Network failure / no auth — silently skip; banner will retry on
      // next focus event.
      console.log('[banner] fetch skipped:', e?.message);
    }
  }, [apiBase, getActiveToken]);

  // Fetch on mount + every AppState transition to 'active'.
  useEffect(() => {
    fetchInbox();
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && appState.current !== 'active') {
        fetchInbox();
      }
      appState.current = state;
    });
    return () => sub.remove();
  }, [fetchInbox]);

  // ─── Promote next from queue → current ─────────────────────────────
  useEffect(() => {
    if (current || queue.length === 0) return;
    const [head, ...rest] = queue;
    // Mark the about-to-show notification as "handled" immediately so
    // an in-flight poll doesn't re-queue it while it's already on
    // screen. Both ID and content key are recorded — same event with
    // different ID won't pop a second time within the dedup window.
    rememberDismissed(head);
    setCurrent(head);
    setQueue(rest);
    // Reset slide-X for the swipe gesture — fresh banner starts
    // centred regardless of how the previous one was dismissed.
    slideX.setValue(0);
    // Light tap to draw attention on new banner. Haptics is soft-
    // loaded so a missing native binding is a no-op.
    if (Haptics?.impactAsync && Haptics?.ImpactFeedbackStyle) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }, [current, queue, dismissedIds, slideX]);

  // ─── Slide-in / slide-out animation ────────────────────────────────
  useEffect(() => {
    if (!current) return;
    Animated.spring(slideY, {
      toValue: 0,
      friction: 8,
      tension: 60,
      useNativeDriver: true,
    }).start();
    // Auto-dismiss after 8 seconds. User can tap or X to dismiss earlier.
    const timer = setTimeout(() => dismiss(), 8000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const dismiss = useCallback((tapped: boolean = false): void => {
    if (!current) return;
    const dismissing = current;
    Animated.timing(slideY, {
      toValue: -200,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      setCurrent(null);
    });

    // Mark seen on the server. Fire-and-forget; if the network fails,
    // the row stays unseen and will reappear next launch — that's
    // acceptable, better than silently swallowing.
    (async () => {
      try {
        const token = await getActiveToken();
        if (!token) return;
        await fetch(`${apiBase}/notifications/${dismissing.id}/read`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {}
    })();

    // If the user TAPPED the banner (not dismissed via X), follow the
    // deep link.
    if (tapped && dismissing.deep_link?.route && navigationRef?.current) {
      const { route, params } = dismissing.deep_link;
      try {
        navigationRef.current.navigate(route, params);
      } catch (e: any) {
        console.log('[banner] deep-link nav failed:', e?.message);
      }
    }
  }, [current, slideY, apiBase, getActiveToken, navigationRef]);

  // Swipe-to-dismiss — drag the banner left or right past a threshold
  // to dismiss it without tapping the X. Threshold = 30% of screen
  // width. We set up the responder lazily via useRef so the same
  // instance survives across renders. dismiss is captured by ref so
  // the gesture handler always reads the latest version.
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  const screenWidth = Dimensions.get('window').width;
  const swipeThreshold = screenWidth * 0.3;
  const panResponder = useRef(
    PanResponder.create({
      // Only claim the gesture once the user has dragged a meaningful
      // distance horizontally — otherwise vertical scrolls of the
      // underlying screen still work.
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => {
        slideX.setValue(g.dx);
      },
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) > swipeThreshold) {
          // Past threshold → fly the banner off-screen in the swipe
          // direction, then dismiss.
          Animated.timing(slideX, {
            toValue: g.dx > 0 ? screenWidth : -screenWidth,
            duration: 180,
            useNativeDriver: true,
          }).start(() => dismissRef.current(false));
        } else {
          // Snap back to centre.
          Animated.spring(slideX, {
            toValue: 0,
            friction: 8,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  if (!current) return null;

  // Map type → accent colour + icon.
  const accent = (() => {
    switch (current.type) {
      case 'booking.created':
      case 'booking.assigned':
        return { color: '#0D3B66', icon: '📋' };
      case 'enquiry.requested':
        return { color: '#92400E', icon: '📝' };
      case 'quote.sent':
        return { color: '#0D9488', icon: '💼' };
      default:
        return { color: '#1F2937', icon: '🔔' };
    }
  })();

  return (
    <Animated.View
      pointerEvents="box-none"
      {...panResponder.panHandlers}
      style={[
        styles.wrap,
        {
          paddingTop: TOP_INSET + 8,
          // translateY = slide-down entrance, translateX = swipe-aside.
          // Banner also fades as it swipes off so the user gets a
          // physical sense of "I'm dismissing this".
          transform: [{ translateY: slideY }, { translateX: slideX }],
          opacity: slideX.interpolate({
            inputRange: [-screenWidth, 0, screenWidth],
            outputRange: [0, 1, 0],
            extrapolate: 'clamp',
          }),
        },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => dismiss(true)}
        style={[styles.card, { borderLeftColor: accent.color }]}
      >
        <Text style={styles.icon}>{accent.icon}</Text>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>
            {current.title}
          </Text>
          {current.body ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              {current.body}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={(e) => {
            e.stopPropagation();
            dismiss(false);
          }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.closeBtn}
        >
          <Text style={styles.closeBtnText}>×</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    elevation: 30,
    paddingHorizontal: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 12,
    ...Platform.select({
      android: {
        elevation: 12,
      },
    }),
  },
  icon: { fontSize: 22, marginRight: 10 },
  body: { flex: 1 },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.2,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 16,
  },
  closeBtn: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  closeBtnText: {
    fontSize: 22,
    color: '#94A3B8',
    fontWeight: '600',
    lineHeight: 22,
  },
});

export default NotificationBanner;

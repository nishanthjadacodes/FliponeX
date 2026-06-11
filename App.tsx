import { useEffect, useRef, useState } from 'react';
import {
  NavigationContainer,
  NavigationContainerRef,
  type NavigationState,
} from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { queryClient } from './src/lib/queryClient';
import { useAppStore } from './src/store/useAppStore';
import { NAV_STATE_KEY } from './src/utils/storage';
import AppNavigator from './AppNavigator';
import {
  registerForPushNotifications,
  addNotificationTapListener,
  type NotificationData,
} from './src/utils/notifications';
import type { RootStackParamList } from './src/types';
import { loadAppLanguage } from './src/i18n';
import NotificationBanner from './src/components/NotificationBanner';
import ErrorBoundary from './src/components/ErrorBoundary';
import PermissionRationaleModal from './src/components/PermissionRationaleModal';
import { API_BASE_URL } from './src/config';

// Navigation lifecycle:
//   Every app open starts at AppNavigator's `initialRouteName="Splash"`,
//   so the splash video ALWAYS plays in full on each launch.
//
//   RESUME: the navigation stack is persisted on every change (see
//   persistNavState below). When the user switches away mid-task and
//   comes back, SplashScreen — AFTER the splash video finishes —
//   restores that saved stack, so they land exactly where they left off
//   instead of being sent through ModeSelect / Login again. If there is
//   no fresh saved state (first launch, or away longer than the resume
//   window) SplashScreen falls back to its normal first-launch routing.
//   The Splash route itself is never persisted, so resume can't loop
//   back into the splash.

export default function App() {
  const navRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
  // Gate the first render until the persisted i18n locale is loaded so
  // every screen reads strings in the correct language from frame 1.
  const [i18nReady, setI18nReady] = useState(false);

  // Persist the navigation stack on every change so SplashScreen can
  // resume the user where they left off after the splash video. The
  // Splash route is never saved — resuming TO Splash would loop.
  const persistNavState = (state: NavigationState | undefined): void => {
    if (!state) return;
    const current = state.routes?.[state.index]?.name;
    if (current === 'Splash') return;
    AsyncStorage.setItem(
      NAV_STATE_KEY,
      JSON.stringify({ state, savedAt: Date.now() }),
    ).catch(() => {});
  };

  useEffect(() => {
    loadAppLanguage().finally(() => setI18nReady(true));
  }, []);

  // Seed the Zustand app store from AsyncStorage once on launch so
  // every screen reads user / mode from a single reactive source.
  // The store wraps the existing storage utils, so screens not yet
  // migrated keep working unchanged.
  useEffect(() => {
    useAppStore.getState().hydrate();
  }, []);

  useEffect(() => {
    // Register for push notifications after first render — this asks the
    // user for permission and caches the Expo push token locally.
    registerForPushNotifications();

    // Tap handler: when a push notification is tapped, deep-link the user
    // into the relevant screen based on the `data` payload the admin sends.
    const unsubscribe = addNotificationTapListener((data: NotificationData) => {
      if (!navRef.current) return;
      const type = data?.type as string | undefined;
      const enquiryId = data?.enquiry_id as string | undefined;
      const bookingId = data?.booking_id as string | undefined;
      if (type === 'enquiry' && enquiryId) {
        navRef.current.navigate('EnquiryDetails', { enquiryId });
      } else if (type === 'booking' && bookingId) {
        navRef.current.navigate('BookingDetails', { bookingId });
      }
    });
    return unsubscribe;
  }, []);

  if (!i18nReady) {
    return <GestureHandlerRootView style={{ flex: 1 }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* SafeAreaProvider supplies real status-bar / nav-bar insets to
          every screen's useSafeAreaInsets(); initialWindowMetrics makes
          those values correct on the very FIRST frame, so headers and
          bottom buttons never flash under the system bars on any device. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <QueryClientProvider client={queryClient}>
          <ErrorBoundary>
            <NavigationContainer ref={navRef} onStateChange={persistNavState}>
              <AppNavigator />
              {/* Top-down banner for in-app notifications. Renders ABOVE the
                  stack screens (zIndex 9999) so it's visible on every screen.
                  Polls the backend's /notifications/inbox on app focus and
                  shows the topmost unseen notification with a tap-to-deep-link
                  CTA. Handles both customer and agent surfaces. */}
              <NotificationBanner navigationRef={navRef} apiBase={API_BASE_URL} />
              {/* Root-mounted bottom-sheet that explains WHY before any
                  runtime permission ask (camera, gallery, location,
                  notifications). Visibility is driven by
                  usePermissionRationaleStore — every util that calls
                  requestPermissionWithRationale() flips it on, the
                  user's tap resolves the awaiting Promise, and the
                  modal flips off. No per-screen wiring needed. */}
              <PermissionRationaleModal />
            </NavigationContainer>
          </ErrorBoundary>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

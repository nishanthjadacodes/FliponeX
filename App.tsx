import { useEffect, useRef, useState } from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AppNavigator from './AppNavigator';
import {
  registerForPushNotifications,
  addNotificationTapListener,
  type NotificationData,
} from './src/utils/notifications';
import type { RootStackParamList } from './src/types';
import { loadAppLanguage } from './src/i18n';
import NotificationBanner from './src/components/NotificationBanner';
import { API_BASE_URL } from './src/config';

// Navigation lifecycle in this app:
//   • Cold start (fresh launch after a full process kill — swiped from recents,
//     phone reboot, first install): NavigationContainer uses AppNavigator's
//     `initialRouteName="Splash"`. User sees the logo page first every time,
//     then it routes to HomeTabs.
//   • Warm resume (app backgrounded, user opens another app, returns): React
//     Navigation keeps the stack in memory. The user lands back on whatever
//     screen they left — no splash shown, no persistence layer needed.
//
// No nav-state persistence layer: we deliberately don't save the stack to
// AsyncStorage. Skipping it means process-killed resumes correctly restart at
// Splash, exactly matching the intended flow.
export default function App() {
  const navRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
  // Gate the first render until the persisted i18n locale is loaded so
  // every screen reads strings in the correct language from frame 1.
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    loadAppLanguage().finally(() => setI18nReady(true));
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
      <NavigationContainer ref={navRef}>
        <AppNavigator />
        {/* Top-down banner for in-app notifications. Renders ABOVE the
            stack screens (zIndex 9999) so it's visible on every screen.
            Polls the backend's /notifications/inbox on app focus and
            shows the topmost unseen notification with a tap-to-deep-link
            CTA. Handles both customer and agent surfaces. */}
        <NotificationBanner navigationRef={navRef} apiBase={API_BASE_URL} />
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}

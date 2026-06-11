// Splash screen — plays the FliponeX intro video, then routes onward.
//
// The splash visual is the bundled intro video (assets/splash.mp4),
// played full-screen WITH its own audio.
//
// When the video finishes (or a safety timeout fires) the screen
// decides where to go:
//   • RESUME — if the user was in the app recently (within
//     RESUME_WINDOW_MS) and a saved navigation stack exists, restore it
//     so they land exactly where they left off. This is what makes an
//     app-switch — leave mid-task, use another app, come back — return
//     to the same screen instead of ModeSelect → Login again.
//   • Otherwise — first-launch routing: LanguageSelect on the very
//     first launch, else ModeSelect (the 4-tile toggle page). The
//     FlashNotifications detour still lives on ModeSelect's Customer
//     tile. Agents go ModeSelect → AgentLogin.
import { useEffect, useRef } from 'react';
import { View, StyleSheet, StatusBar, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getToken, getUserMode, NAV_STATE_KEY } from '../utils/storage';
import { API_BASE_URL } from '../config';

// expo-av (Video) + the splash video asset are loaded defensively: a
// dev-client APK built before the native module was linked, or an
// asset-bundle skew, would otherwise crash the splash on import. If
// either is unavailable the splash falls back to a brief navy hold and
// still routes correctly.
const tryLoadVideo = (): {
  Video: any;
  ResizeMode: any;
  Audio: any;
  asset: any;
} | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const av = require('expo-av');
    if (!av?.Video) return null;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const asset = require('../../assets/splash.mp4');
    return { Video: av.Video, ResizeMode: av.ResizeMode, Audio: av.Audio, asset };
  } catch (e: any) {
    console.log('[splash] video module/asset load failed:', e?.message);
    return null;
  }
};

interface NavigationProp {
  navigate: (route: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
  replace?: (route: string, params?: Record<string, unknown>) => void;
  reset?: (state: {
    index: number;
    routes: { name: string; params?: Record<string, unknown> }[];
  }) => void;
  addListener?: (event: string, cb: () => void) => () => void;
}

interface Props {
  navigation: NavigationProp;
}

// Hard safety cap — route even if the video never reports completion
// (decode error on an exotic device, status callback never firing).
// Comfortably longer than a normal splash video.
const SPLASH_MAX_MS = 15000;
// With no video bundled, hold the navy screen briefly before routing
// so the transition isn't a jarring instant flash.
const NO_VIDEO_HOLD_MS = 1400;
// Resume window — if the user was last in the app within this long, the
// splash restores their previous screen instead of routing fresh. Long
// enough to cover an app-switch; an app left for hours starts fresh.
const RESUME_WINDOW_MS = 30 * 60 * 1000;

const SplashScreen: React.FC<Props> = ({ navigation }) => {
  // Resolve the video module + asset once.
  const av = useRef(tryLoadVideo()).current;
  // Routing fires exactly once — guarded so the video's end callback,
  // an error, and the safety timeout can't double-navigate.
  const routedRef = useRef<boolean>(false);
  // Holds the latest route() so the <Video> callbacks always invoke
  // the current closure.
  const routeRef = useRef<() => void>(() => {});

  // Warm up the Render dyno so the first real API call after the
  // splash is cheap.
  useEffect(() => {
    const apiOrigin = API_BASE_URL.replace(/\/api\/?$/, '');
    fetch(`${apiOrigin}/health`, { method: 'GET' })
      .then(() => console.log('[splash] warmup ping ok'))
      .catch((e) => console.log('[splash] warmup ping failed (non-fatal):', e?.message));
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Let the video's own audio play even when the iOS ringer switch
    // is on silent (Android plays through media volume regardless).
    if (av?.Audio) {
      av.Audio
        .setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          allowsRecordingIOS: false,
        })
        .catch(() => {});
    }

    // ── Routing — UNCHANGED from the previous splash ───────────────
    const runRouting = async (): Promise<void> => {
      try {
        const mode = await getUserMode();
        const langPicked = await AsyncStorage.getItem('app_language');
        if (!langPicked && !mode) {
          // Very first launch — language picker before anything else.
          navigation.replace?.('LanguageSelect');
          return;
        }

        const isGuestUser = (raw: string | null, guestMobile: string): boolean => {
          if (!raw) return false;
          try {
            const u = JSON.parse(raw);
            return u?.mobile === guestMobile;
          } catch {
            return false;
          }
        };

        const goToLogin = (loginRoute: 'Login' | 'AgentLogin'): void => {
          if (loginRoute === 'AgentLogin') {
            // Agents go straight to their login (no flash hop).
            if (navigation.reset) {
              navigation.reset({
                index: 1,
                routes: [{ name: 'ModeSelect' }, { name: 'AgentLogin' }],
              });
            } else {
              navigation.replace?.('AgentLogin');
            }
            return;
          }
          // Customer path → land on ModeSelect; the Customer tile there
          // handles the FlashNotifications hop before Login.
          navigation.replace?.('ModeSelect');
        };

        if (mode === 'agent') {
          const existing = await AsyncStorage.getItem('agent_token');
          const userRaw = await AsyncStorage.getItem('agent_data');
          const demoOrOffline =
            existing &&
            typeof existing === 'string' &&
            (existing.startsWith('demo_token_') || existing.startsWith('offline_token_'));
          const guest = isGuestUser(userRaw, '1111111111');
          if (!existing || demoOrOffline || guest) {
            await AsyncStorage.multiRemove(['agent_token', 'agent_data']);
            goToLogin('AgentLogin');
            return;
          }
          navigation.replace?.('AgentTabs');
          return;
        }

        if (mode === 'customer') {
          const existing = await getToken();
          const userRaw = await AsyncStorage.getItem('user');
          const guest = isGuestUser(userRaw, '0000000000');
          if (!existing || guest) {
            await AsyncStorage.multiRemove(['token', 'user', 'auth_token']);
          }
          // Always route through ModeSelect (toggle page) on launch.
          // The Customer tile detects the existing token and forwards
          // through FlashNotifications → HomeTabs (skipping Login).
          navigation.replace?.('ModeSelect');
          return;
        }

        navigation.replace?.('ModeSelect');
      } catch (e: any) {
        console.log('[splash] routing error:', e?.message);
        navigation.replace?.('ModeSelect');
      }
    };

    // After the splash video: first try to RESUME the user's last
    // screen (they switched apps mid-task and came back), so they don't
    // get sent through ModeSelect / Login again. Falls through to
    // runRouting() for a first launch or a stale/missing saved state.
    const resumeOrRoute = async (): Promise<void> => {
      try {
        const raw = await AsyncStorage.getItem(NAV_STATE_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as { state?: any; savedAt?: number };
          const fresh =
            !!saved?.state &&
            typeof saved.savedAt === 'number' &&
            Date.now() - saved.savedAt < RESUME_WINDOW_MS;
          const topRoute = saved?.state?.routes?.[saved.state.index]?.name;
          if (fresh && topRoute && topRoute !== 'Splash' && navigation.reset) {
            // Restore the exact stack the user left — drops them back
            // where they were, skipping ModeSelect / Login.
            navigation.reset(saved.state);
            return;
          }
          if (!fresh) {
            await AsyncStorage.removeItem(NAV_STATE_KEY).catch(() => {});
          }
        }
      } catch (e: any) {
        console.log('[splash] resume check failed:', e?.message);
      }
      runRouting();
    };

    const route = (): void => {
      if (routedRef.current || cancelled) return;
      routedRef.current = true;
      void resumeOrRoute();
    };
    routeRef.current = route;

    // Safety cap — always route eventually.
    const cap = setTimeout(route, SPLASH_MAX_MS);
    // No video bundled / module missing → short navy hold, then route.
    const hold = av ? null : setTimeout(route, NO_VIDEO_HOLD_MS);

    return () => {
      cancelled = true;
      clearTimeout(cap);
      if (hold) clearTimeout(hold);
    };
  }, [navigation, av]);

  const VideoComp = av?.Video;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#082B4C" />
      {VideoComp ? (
        <VideoComp
          source={av.asset}
          style={StyleSheet.absoluteFill}
          // contain = show the WHOLE video frame ("FliponeX Digital" and
          // every element fully visible, nothing cropped), fit inside the
          // screen. The navy background fills any letterbox margin. The
          // video is scaled to fit whatever the device's screen is, so
          // it adapts to every screen size.
          resizeMode={av.ResizeMode?.CONTAIN ?? 'contain'}
          shouldPlay
          isLooping={false}
          isMuted={false}
          // Route the moment the intro finishes.
          onPlaybackStatusUpdate={(s: any) => {
            if (s?.isLoaded && s.didJustFinish) routeRef.current();
          }}
          onError={(e: any) => {
            console.log('[splash] video playback error:', e);
            routeRef.current();
          }}
        />
      ) : (
        <ActivityIndicator color="#FFFFFF" size="large" />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#082B4C',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default SplashScreen;

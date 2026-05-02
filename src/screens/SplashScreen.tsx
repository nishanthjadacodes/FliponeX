import { useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Image,
  StatusBar,
  Animated,
  Easing,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getToken, getUserMode } from '../utils/storage';

const Logo = require('../assets/logo.jpeg');

interface NavigationProp {
  navigate: (route: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
  replace?: (route: string) => void;
  addListener?: (event: string, cb: () => void) => () => void;
}

interface Props {
  navigation: NavigationProp;
}

const SplashScreen: React.FC<Props> = ({ navigation }) => {
  const { width, height } = useWindowDimensions();

  // Responsive sizing (media-query equivalent)
  const isSmall = width < 360;
  const isLarge = width > 480;
  const logoSize = isSmall ? 110 : isLarge ? 160 : 140;
  const titleSize = isSmall ? 26 : isLarge ? 36 : 32;
  // Hook line = proper headline, not a small tagline
  const taglineSize = isSmall ? 15 : isLarge ? 19 : 17;

  // Animation values
  const bgOpacity = useRef<Animated.Value>(new Animated.Value(0)).current;
  const ringScale = useRef<Animated.Value>(new Animated.Value(0)).current;
  const ringOpacity = useRef<Animated.Value>(new Animated.Value(0)).current;
  const logoScale = useRef<Animated.Value>(new Animated.Value(0)).current;
  const logoRotate = useRef<Animated.Value>(new Animated.Value(0)).current;
  const titleOpacity = useRef<Animated.Value>(new Animated.Value(0)).current;
  const titleTranslateY = useRef<Animated.Value>(new Animated.Value(30)).current;
  const taglineOpacity = useRef<Animated.Value>(new Animated.Value(0)).current;
  const dotsOpacity = useRef<Animated.Value>(new Animated.Value(0)).current;
  const dot1 = useRef<Animated.Value>(new Animated.Value(0)).current;
  const dot2 = useRef<Animated.Value>(new Animated.Value(0)).current;
  const dot3 = useRef<Animated.Value>(new Animated.Value(0)).current;

  useEffect(() => {
    // Choreographed entrance sequence
    Animated.sequence([
      // 1. Background fade
      Animated.timing(bgOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),

      // 2. Logo: dual ring expand + spring scale + slight rotate
      Animated.parallel([
        Animated.spring(logoScale, { toValue: 1, friction: 4, tension: 40, useNativeDriver: true }),
        Animated.timing(logoRotate, { toValue: 1, duration: 800, easing: Easing.out(Easing.elastic(1)), useNativeDriver: true }),
        Animated.timing(ringScale, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(ringOpacity, { toValue: 0.6, duration: 400, useNativeDriver: true }),
      ]),

      // 3. Ring fade out
      Animated.timing(ringOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),

      // 4. Title slide up + fade in
      Animated.parallel([
        Animated.timing(titleOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(titleTranslateY, { toValue: 0, friction: 6, tension: 50, useNativeDriver: true }),
      ]),

      // 5. Tagline fade
      Animated.timing(taglineOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),

      // 6. Loading dots fade in
      Animated.timing(dotsOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();

    // Loading dots — staggered infinite pulse (separate from main sequence)
    const animateDots = (): void => {
      Animated.stagger(150, [
        Animated.sequence([
          Animated.timing(dot1, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot1, { toValue: 0, duration: 400, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(dot2, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot2, { toValue: 0, duration: 400, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(dot3, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot3, { toValue: 0, duration: 400, useNativeDriver: true }),
        ]),
      ]).start(() => animateDots());
    };
    setTimeout(animateDots, 2400);

    // Routing after splash:
    //   1. Language not picked + no mode → LanguageSelect (first-launch onboarding)
    //   2. Mode not picked yet → ModeSelect
    //   3. Mode picked, no token → corresponding Login screen
    //   4. Mode picked, token present → straight into the tabs
    //
    // No more guest-login fallback — testers and real users go through
    // the proper phone+OTP path. The dev banner shows the OTP for free
    // testing while OTP_PROVIDER=hardcoded; flip the env var to swap in
    // a real SMS gateway without changing app code.
    const timeout: ReturnType<typeof setTimeout> = setTimeout(async () => {
      try {
        const mode = await getUserMode();
        const langPicked = await AsyncStorage.getItem('app_language');
        if (!langPicked && !mode) {
          navigation.replace?.('LanguageSelect');
          return;
        }

        // Old build used auto-guest-login. Guest accounts are identified
        // by their well-known mobile numbers — when we spot one, wipe
        // the session and force the user through the real login flow.
        const isGuestUser = (raw: string | null, guestMobile: string): boolean => {
          if (!raw) return false;
          try {
            const u = JSON.parse(raw);
            return u?.mobile === guestMobile;
          } catch {
            return false;
          }
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
            navigation.replace?.('AgentLogin');
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
            navigation.replace?.('Login');
            return;
          }
          navigation.replace?.('HomeTabs');
          return;
        }

        navigation.replace?.('ModeSelect');
      } catch (e: any) {
        console.log('[splash] routing error:', e?.message);
        navigation.replace?.('ModeSelect');
      }
    }, 5200);
    return () => clearTimeout(timeout);
  }, [navigation]);

  const logoRotateInterpolated = logoRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['-180deg', '0deg'],
  });

  const ringSize = logoSize + 60;

  return (
    <Animated.View style={[styles.container, { opacity: bgOpacity }]}>
      <StatusBar barStyle="light-content" backgroundColor="#082B4C" />

      {/* Decorative blurred circles in background (logo colors) */}
      <View style={[styles.bgCircle, styles.bgCircleRed, { width: width * 0.7, height: width * 0.7, top: -width * 0.2, left: -width * 0.2 }]} />
      <View style={[styles.bgCircle, styles.bgCircleBlue, { width: width * 0.6, height: width * 0.6, bottom: height * 0.1, right: -width * 0.2 }]} />
      <View style={[styles.bgCircle, styles.bgCircleGold, { width: width * 0.4, height: width * 0.4, top: height * 0.15, right: -width * 0.1 }]} />

      <View style={styles.logoWrapper}>
        {/* Expanding ring */}
        <Animated.View
          style={[
            styles.ring,
            {
              width: ringSize, height: ringSize, borderRadius: ringSize / 2,
              transform: [{ scale: ringScale }] as any,
              opacity: ringOpacity,
            },
          ]}
        />

        {/* Logo with spring scale + rotation entrance */}
        <Animated.View
          style={[
            styles.logoCircle,
            {
              width: logoSize, height: logoSize, borderRadius: logoSize / 2,
              transform: [{ scale: logoScale }, { rotate: logoRotateInterpolated }] as any,
            },
          ]}
        >
          <Image source={Logo} style={[styles.logoImage, { width: logoSize * 0.78, height: logoSize * 0.78 }]} resizeMode="contain" />
        </Animated.View>
      </View>

      {/* Title with slide-up reveal */}
      <Animated.Text
        style={[
          styles.title,
          { fontSize: titleSize, opacity: titleOpacity, transform: [{ translateY: titleTranslateY }] as any },
        ]}
      >
        FliponeX Digital
      </Animated.Text>

      {/* Hook line — exact marketing headline */}
      <Animated.Text style={[styles.tagline, { fontSize: taglineSize, opacity: taglineOpacity }]}>
        India's #1 Doorstep Digital Service —{"\n"}At Your Home & Office!
      </Animated.Text>

      {/* Loading dots */}
      <Animated.View style={[styles.dotsRow, { opacity: dotsOpacity }]}>
        <Animated.View style={[styles.dot, { opacity: dot1.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }), transform: [{ scale: dot1.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.2] }) }] as any }]} />
        <Animated.View style={[styles.dot, { opacity: dot2.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }), transform: [{ scale: dot2.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.2] }) }] as any }]} />
        <Animated.View style={[styles.dot, { opacity: dot3.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }), transform: [{ scale: dot3.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.2] }) }] as any }]} />
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D3B66', overflow: 'hidden' },

  // Decorative background blobs (logo colors)
  bgCircle: { position: 'absolute', opacity: 0.18 },
  bgCircleRed: { backgroundColor: '#FFC107', borderRadius: 999 },
  bgCircleBlue: { backgroundColor: '#1976D2', borderRadius: 999 },
  bgCircleGold: { backgroundColor: '#FFC107', borderRadius: 999 },

  logoWrapper: { justifyContent: 'center', alignItems: 'center', marginBottom: 36 },
  ring: { position: 'absolute', borderWidth: 3, borderColor: '#fff' },
  logoCircle: {
    backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 20, elevation: 20,
  },
  logoImage: { borderRadius: 999 },
  title: { fontWeight: '900', color: '#fff', letterSpacing: 1.5, textAlign: 'center' },
  // Hookline headline — larger, bolder, gold-lined for prominence on the splash
  tagline: {
    color: '#FFFFFF',
    letterSpacing: 0.3,
    marginTop: 14,
    textAlign: 'center',
    paddingHorizontal: 24,
    lineHeight: 24,
    fontWeight: '800',
  },

  dotsRow: { flexDirection: 'row', position: 'absolute', bottom: 60, gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFC107' },
});

export default SplashScreen;

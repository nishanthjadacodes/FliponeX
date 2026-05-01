import { useEffect } from 'react';
import { View, Text, StyleSheet, Image, Dimensions, StatusBar } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  withSpring,
  withRepeat,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initApiUrl, getApiBaseUrl } from '../../config/agent';

const { width, height } = Dimensions.get('window');

interface AgentSplashProps {
  navigation: { replace: (route: string) => void };
}

const SplashScreen: React.FC<AgentSplashProps> = ({ navigation }) => {
  const logoScale = useSharedValue(0);
  const logoRotate = useSharedValue(-20);
  const logoGlow = useSharedValue(0.3);
  const brandOpacity = useSharedValue(0);
  const brandTranslateY = useSharedValue(16);
  const taglineOpacity = useSharedValue(0);
  const orb1 = useSharedValue(0);
  const orb2 = useSharedValue(0);

  useEffect(() => {
    logoScale.value = withSequence(
      withTiming(1.15, { duration: 650, easing: Easing.out(Easing.back(1.4)) }),
      withSpring(1, { damping: 9, stiffness: 110 }),
    );
    logoRotate.value = withTiming(0, { duration: 800, easing: Easing.out(Easing.cubic) });
    logoGlow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.3, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    brandOpacity.value = withDelay(500, withTiming(1, { duration: 600 }));
    brandTranslateY.value = withDelay(500, withSpring(0, { damping: 12 }));
    taglineOpacity.value = withDelay(900, withTiming(1, { duration: 600 }));

    orb1.value = withRepeat(withTiming(1, { duration: 6000, easing: Easing.inOut(Easing.sin) }), -1, true);
    orb2.value = withRepeat(withTiming(1, { duration: 8000, easing: Easing.inOut(Easing.sin) }), -1, true);

    (async () => {
      await initApiUrl();

      const existing = await AsyncStorage.getItem('agent_token');
      if (existing && existing.startsWith('demo_token_')) {
        await AsyncStorage.multiRemove(['agent_token', 'agent_data']);
      }

      const haveToken = !!(await AsyncStorage.getItem('agent_token'));
      if (!haveToken) {
        try {
          const res = await fetch(
            `${getApiBaseUrl()}/auth/agent-guest-login?_t=${Date.now()}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store',
              },
              body: JSON.stringify({}),
            },
          );
          const data: { success?: boolean; token?: string; user?: unknown } = await res
            .json()
            .catch(() => ({}));
          if (data?.success && data?.token) {
            await AsyncStorage.setItem('agent_token', data.token);
            if (data.user) {
              await AsyncStorage.setItem('agent_data', JSON.stringify(data.user));
            }
          }
        } catch (e: any) {
          console.log('agent-guest-login skipped:', e?.message);
        }
      }

      setTimeout(() => navigation.replace('Main'), 1600);
    })();
  }, []);

  // RN's transform array typing is exact-tagged-union strict; Reanimated's
  // worklet-returned objects don't match it cleanly. Cast to `any` to keep
  // runtime semantics identical without fighting the type system.
  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: logoScale.value }, { rotate: `${logoRotate.value}deg` }] as any,
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: logoGlow.value * 0.75,
    transform: [{ scale: interpolate(logoGlow.value, [0.3, 1], [0.9, 1.4]) }] as any,
  }));
  const brandStyle = useAnimatedStyle(() => ({
    opacity: brandOpacity.value,
    transform: [{ translateY: brandTranslateY.value }] as any,
  }));
  const taglineStyle = useAnimatedStyle(() => ({
    opacity: taglineOpacity.value,
    transform: [{ translateY: interpolate(taglineOpacity.value, [0, 1], [8, 0]) }] as any,
  }));
  const orb1Style = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(orb1.value, [0, 1], [-30, 30]) },
      { translateY: interpolate(orb1.value, [0, 1], [-10, 30]) },
    ] as any,
  }));
  const orb2Style = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(orb2.value, [0, 1], [20, -20]) },
      { translateY: interpolate(orb2.value, [0, 1], [20, -30]) },
    ] as any,
  }));

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#001F3F" />
      <LinearGradient
        colors={['#001F3F', '#003153', '#1B4B72']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <Animated.View style={[styles.orb, styles.orb1, orb1Style]}>
        <LinearGradient colors={['rgba(252,211,77,0.55)', 'rgba(252,211,77,0)']} style={styles.orbFill} />
      </Animated.View>
      <Animated.View style={[styles.orb, styles.orb2, orb2Style]}>
        <LinearGradient colors={['rgba(220,38,38,0.35)', 'rgba(220,38,38,0)']} style={styles.orbFill} />
      </Animated.View>

      <View style={styles.center}>
        <View style={styles.logoWrap}>
          <Animated.View style={[styles.logoGlow, glowStyle]}>
            <LinearGradient
              colors={['rgba(244,161,0,0.6)', 'rgba(252,211,77,0.25)', 'rgba(252,211,77,0)']}
              style={styles.logoGlowFill}
            />
          </Animated.View>
          <Animated.View style={[styles.logoRing, logoStyle]}>
            <Image
              source={require('../../assets/logo1.jpeg')}
              style={styles.logoImg}
              resizeMode="cover"
            />
          </Animated.View>
        </View>

        <Animated.Text style={[styles.brandName, brandStyle]}>FlipOneX</Animated.Text>
        <Animated.Text style={[styles.tagline, taglineStyle]}>
          Partner Platform · Earn on every trip
        </Animated.Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Starting up…</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#001F3F' },
  orb: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
  },
  orbFill: { flex: 1, borderRadius: 150 },
  orb1: { top: -60, left: -80 },
  orb2: { bottom: -80, right: -60 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logoWrap: {
    width: 150,
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  logoGlow: {
    position: 'absolute',
    width: 230,
    height: 230,
    borderRadius: 115,
  },
  logoGlowFill: { flex: 1, borderRadius: 115 },
  logoRing: {
    width: 130,
    height: 130,
    borderRadius: 65,
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: '#FCD34D',
    backgroundColor: '#FFFFFF',
    shadowColor: '#FCD34D',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 28,
    elevation: 22,
  },
  logoImg: { width: '100%', height: '100%' },
  brandName: {
    fontSize: 42,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: 10,
    textShadowColor: 'rgba(252,211,77,0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 12,
  },
  tagline: {
    fontSize: 13,
    color: '#FCD34D',
    marginTop: 6,
    letterSpacing: 0.6,
    textAlign: 'center',
    fontWeight: '700',
  },
  footer: {
    position: 'absolute',
    bottom: 32,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
    letterSpacing: 0.4,
    fontWeight: '600',
  },
});

export default SplashScreen;

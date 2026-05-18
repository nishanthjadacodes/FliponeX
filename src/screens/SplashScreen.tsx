// Splash / animated welcome screen — runs before ModeSelect.
//
// Visual choreography:
//   1. Logo drops in with rotating arrow halo around it.
//   2. Service-icon "sparks" burst OUT from the logo (electric dispersion)
//      to four corners around it — start at center, scale up, fly to final
//      positions with a glow flare. Only relevant FliponeX services:
//      Apply / Pay / KYC / Doorstep.
//   3. Brand title slides up.
//   4. Glass pill + 4 glass feature cards fade in (frosted via BlurView).
//   5. Progress bar fills over ~4.7s; on completion, a glass-break haptic
//      pulse fires (and an optional glass-break sound, if the asset is
//      bundled — see GLASS_SOUND comment below).
//
// Routing logic at the bottom is unchanged.
import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  StatusBar,
  Animated,
  Easing,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { getToken, getUserMode } from '../utils/storage';
import { API_BASE_URL } from '../config';

const Logo = require('../assets/logo.jpeg');

// Audio is loaded lazily inside the splash effect — keeping the
// expo-av module + the glass-break.mp3 asset off the critical
// module-load path. If either is missing on this device (autolinking
// hiccup after a dependency change, asset bundle skew between JS
// and native, etc.), the splash continues silently — no crash.
const tryLoadGlassSound = (): { Audio: any; asset: any } | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const av = require('expo-av');
    if (!av?.Audio) return null;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const asset = require('../assets/glass-break.mp3');
    return { Audio: av.Audio, asset };
  } catch (e: any) {
    console.log('[splash] audio module load failed:', e?.message);
    return null;
  }
};

interface NavigationProp {
  navigate: (route: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
  // Accept optional params so the FlashNotifications hop can pass
  // { nextRoute, nextParams } when forwarding from the splash.
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

// 4 service "sparks" that radiate from the logo. Angles in degrees,
// 0° = right, -90° = top. Distance is from logo center.
const SERVICE_SPARKS: { icon: string; label: string; color: string; angle: number }[] = [
  { icon: '📋', label: 'Apply', color: '#22D3EE', angle: -135 }, // top-left
  { icon: '💳', label: 'Pay', color: '#FCD34D', angle: -45 },    // top-right
  { icon: '🆔', label: 'KYC', color: '#A855F7', angle: 135 },    // bottom-left
  { icon: '📍', label: 'Doorstep', color: '#EF4444', angle: 45 }, // bottom-right
];

const SPARK_RADIUS = 135; // px from logo center to icon center

const FEATURES: { icon: string; iconColor: string; title: string; sub: string }[] = [
  { icon: '🛡️', iconColor: '#22D3EE', title: '100% Secure', sub: 'Your data is\nfully protected' },
  { icon: '✅', iconColor: '#A855F7', title: 'Verified Agent', sub: 'Experts at your\ndoorstep' },
  { icon: '💰', iconColor: '#3B82F6', title: 'Pay After Service', sub: 'Pay only once task\nis completed' },
  { icon: '🎧', iconColor: '#FCD34D', title: '24/7 Support', sub: 'We are always\nhere to help' },
];

const SplashScreen: React.FC<Props> = ({ navigation }) => {
  const { width, height } = useWindowDimensions();

  // Choreographed entrance values.
  const bgOpacity = useRef<Animated.Value>(new Animated.Value(0)).current;
  const logoScale = useRef<Animated.Value>(new Animated.Value(0)).current;
  const arrowSpin = useRef<Animated.Value>(new Animated.Value(0)).current;
  const titleOpacity = useRef<Animated.Value>(new Animated.Value(0)).current;
  const titleTranslateY = useRef<Animated.Value>(new Animated.Value(20)).current;
  const pillOpacity = useRef<Animated.Value>(new Animated.Value(0)).current;
  const featureOpacity = useRef<Animated.Value>(new Animated.Value(0)).current;
  const subtitleOpacity = useRef<Animated.Value>(new Animated.Value(0)).current;
  const progressX = useRef<Animated.Value>(new Animated.Value(0)).current;

  // One animated value per spark, driving translate + scale + opacity
  // together so the spark bursts out from the logo in one motion.
  const sparkProgress = useRef<Animated.Value[]>(
    SERVICE_SPARKS.map(() => new Animated.Value(0)),
  ).current;

  // First-launch detection. The animated splash plays in full only on
  // the very first app open; subsequent launches route immediately
  // with no visible animation so the user goes straight to where
  // they belong (ModeSelect / Login / Tabs). null = AsyncStorage
  // hasn't been read yet (gate the effect), false = first launch
  // (full animation), true = warm launch (instant route).
  const [splashSeen, setSplashSeen] = useState<boolean | null>(null);
  const SPLASH_SEEN_KEY = 'flipon_splash_seen';

  // Dyno warmup so the first real API call after splash is cheap.
  useEffect(() => {
    const apiOrigin = API_BASE_URL.replace(/\/api\/?$/, '');
    fetch(`${apiOrigin}/health`, { method: 'GET' })
      .then(() => console.log('[splash] warmup ping ok'))
      .catch((e) => console.log('[splash] warmup ping failed (non-fatal):', e?.message));
  }, []);

  // Read the splash-seen flag once on mount.
  useEffect(() => {
    (async () => {
      try {
        const v = await AsyncStorage.getItem(SPLASH_SEEN_KEY);
        setSplashSeen(v === 'true');
      } catch {
        setSplashSeen(false);
      }
    })();
  }, []);

  useEffect(() => {
    // Wait until we know whether the user has seen the splash before.
    // null = AsyncStorage not yet read.
    if (splashSeen === null) return undefined;

    // Track teardown state so async work (audio load, routing timer)
    // can bail cleanly when the screen unmounts mid-animation.
    let activeSound: any = null;
    let cancelled = false;
    let breakTimer: ReturnType<typeof setTimeout> | null = null;

    // Stop + unload the looping audio synchronously-as-possible.
    // Called BEFORE navigation.replace inside runRouting so the
    // native audio thread starts ramping down before the screen
    // unmounts — without this, native buffered audio kept playing
    // for ~1-2s after the splash had visually disappeared.
    const stopAudio = (): void => {
      if (!activeSound) return;
      const s = activeSound;
      activeSound = null;
      try { s.setIsLoopingAsync(false); } catch {}
      try { s.setVolumeAsync(0); } catch {}
      try { s.stopAsync(); } catch {}
      try { s.unloadAsync(); } catch {}
    };

    // Routing logic — runs after the animation completes (or
    // immediately on warm launches), routing the user to the correct
    // surface (LanguageSelect first time / ModeSelect / Login / Tabs).
    // Stamps the splash-seen flag so the next launch skips the
    // animated entrance.
    // Flash notifications used to be inserted here, but per spec they
    // should appear AFTER the user picks "Customer App" on
    // ModeSelectScreen — not before the splash animation. The
    // splash-side hop was removed; ModeSelectScreen.pickMobile()
    // handles the carousel detour for the customer tile only.

    const runRouting = async (): Promise<void> => {
      AsyncStorage.setItem(SPLASH_SEEN_KEY, 'true').catch(() => {});
      // Kill the audio FIRST — by the time navigation.replace
      // unmounts the splash, the sound has already started winding
      // down on the native side, so no overhang into the next screen.
      stopAudio();
      try {
        const mode = await getUserMode();
        const langPicked = await AsyncStorage.getItem('app_language');
        if (!langPicked && !mode) {
          // First launch — language picker before any flash content.
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

        // Probe /flash-notifications/active. Returns true when there's
        // at least one active notification — we no longer track
        // dismissals so the carousel pops on EVERY app open until
        // admin deactivates it server-side (per spec). Backend down /
        // empty → returns false so launch isn't blocked.
        const hasUnseenFlashNotifications = async (): Promise<boolean> => {
          try {
            const resp = await fetch(`${API_BASE_URL}/flash-notifications/active`);
            const json = await resp.json();
            const all: { id: string }[] = Array.isArray(json?.data) ? json.data : [];
            return all.length > 0;
          } catch (_) {
            return false;
          }
        };

        const goToLogin = async (loginRoute: 'Login' | 'AgentLogin'): Promise<void> => {
          // Customer login path → hop through FlashNotifications first
          // when there's a pre-login splash banner to show. Mirrors the
          // ModeSelect → customer tile flow so the banner always
          // appears between any path → customer Login (warm-launch
          // logged-out users would otherwise skip ModeSelect entirely
          // and bypass the carousel). Agent login skips the hop.
          if (loginRoute === 'Login' && (await hasUnseenFlashNotifications())) {
            if (navigation.reset) {
              navigation.reset({
                index: 1,
                routes: [
                  { name: 'ModeSelect' },
                  { name: 'FlashNotifications', params: { nextRoute: 'Login' } },
                ],
              });
            } else {
              navigation.replace?.('FlashNotifications', { nextRoute: 'Login' });
            }
            return;
          }
          if (navigation.reset) {
            navigation.reset({
              index: 1,
              routes: [{ name: 'ModeSelect' }, { name: loginRoute }],
            });
          } else {
            navigation.replace?.(loginRoute);
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
            await goToLogin('AgentLogin');
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
            await goToLogin('Login');
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
    };

    // ── Warm launch (splashSeen=true) ──────────────────────────────
    // User has already seen the animation on a previous open — skip
    // it and route immediately. We render nothing while the route
    // resolves so there's no half-animation flash.
    if (splashSeen === true) {
      runRouting();
      return () => {
        cancelled = true;
      };
    }

    // ── First launch (splashSeen=false) — full animated splash ──────
    //
    // Slowed every step a little so the user actually sees the full
    // sequence land before navigation kicks in. Earlier the entrance
    // resolved in ~2.5s and the rest of the time was a static wait —
    // with the progress bar moving through an already-finished
    // composition. Now each step gets visibly more breathing room and
    // the total splash window is 7s, with the progress bar tracking
    // alongside the animation so they finish together.

    // Main entrance sequence — total duration ~5.2s (each spring
    // settles in ~700ms, four staggered sparks now ~1s, then title /
    // pill / features / subtitle each get longer fade-ins).
    Animated.sequence([
      Animated.timing(bgOpacity, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.spring(logoScale, { toValue: 1, friction: 6, tension: 38, useNativeDriver: true }),
      // Sparks burst out from logo — staggered 160ms apart so they
      // fire like four distinct lightning arcs (was 80ms, felt rushed).
      Animated.stagger(
        160,
        sparkProgress.map((v) =>
          Animated.spring(v, {
            toValue: 1,
            friction: 6,
            tension: 70,
            useNativeDriver: true,
          }),
        ),
      ),
      Animated.parallel([
        Animated.timing(titleOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.spring(titleTranslateY, { toValue: 0, friction: 8, tension: 50, useNativeDriver: true }),
      ]),
      Animated.timing(pillOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(featureOpacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(subtitleOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start();

    // Continuous arrow halo spin — native thread, stays smooth even
    // while routing-decision JS work runs below.
    Animated.loop(
      Animated.timing(arrowSpin, {
        toValue: 1,
        duration: 6000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();

    // Progress bar — sweeps left → right over ~6.5s, ending right
    // before the navigation timer fires. Visually tracks alongside
    // the staged entrance so the user never sees a finished progress
    // bar while content is still arriving.
    Animated.timing(progressX, {
      toValue: 1,
      duration: 6500,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: false,
    }).start();

    // Glass-breaking soundtrack — starts the moment the splash mounts
    // and loops until we navigate away. The cleanup below calls
    // unloadAsync() which stops playback, so the sound naturally cuts
    // off when the next screen takes over.
    //
    // Audio module + asset are loaded LAZILY here (not at module-load)
    // so a missing expo-av native module or an asset-bundle skew never
    // crashes the splash. Splash plays silently if audio can't load.
    //
    // Race-safety: we load with shouldPlay:false, then explicitly
    // call playAsync() AFTER the cancellation check. Without this,
    // a fast unmount could land between createAsync (auto-playing)
    // and the if-cancelled check, leaking a brief sound burst into
    // the next screen.
    (async () => {
      const audio = tryLoadGlassSound();
      if (!audio) return;
      try {
        await audio.Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
        }).catch(() => {});
        const { sound } = await audio.Audio.Sound.createAsync(audio.asset, {
          shouldPlay: false,
          isLooping: true,
          volume: 1.0,
        });
        if (cancelled) {
          await sound.unloadAsync().catch(() => {});
          return;
        }
        activeSound = sound;
        sound.playAsync().catch(() => {});
      } catch (e: any) {
        console.log('[splash] glass-break audio failed:', e?.message);
      }
    })();

    // Tactile crack right at the end — fires when the progress bar
    // hits 100% so the haptic punctuates the visual completion.
    breakTimer = setTimeout(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      setTimeout(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      }, 90);
    }, 6450);

    // 7-second total splash window — gives the entrance sequence
    // (~5.2s) plus the progress bar sweep (~6.5s) time to play in
    // full before navigation. Earlier 5.2s window cut off mid-fade.
    const timeout: ReturnType<typeof setTimeout> = setTimeout(runRouting, 7000);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      if (breakTimer) clearTimeout(breakTimer);
      // Backup cleanup — runRouting already called stopAudio, but if
      // the screen unmounts for some other reason (parent navigation
      // re-mount) we still want the audio gone.
      stopAudio();
    };
  }, [navigation, splashSeen]);

  const arrowRotation = arrowSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const progressWidth = progressX.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  // Warm-launch path: render only the navy background while
  // routing resolves so there's no flash of the (un-animated) logo +
  // sparks + title. Returning users go from app-icon-tap straight to
  // their destination screen with just a navy fade behind it.
  if (splashSeen === true) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor="#082B4C" />
        <LinearGradient
          colors={['#0A2540', '#082B4C', '#1B4B72']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
    );
  }
  // splashSeen === null: AsyncStorage hasn't returned yet. Render
  // the same plain navy fill so we don't flash white (Android's
  // default initial backgroundColor). Auto-replaces with the real
  // splash render below within a few ms.
  if (splashSeen === null) {
    return <View style={styles.root} />;
  }

  return (
    <Animated.View style={[styles.root, { opacity: bgOpacity }]}>
      <StatusBar barStyle="light-content" backgroundColor="#082B4C" />
      <LinearGradient
        colors={['#0A2540', '#082B4C', '#1B4B72']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Diffuse colored glow blobs — energy-circuit backdrop. */}
      <View style={[styles.glow, styles.glowCyan, { width: width * 0.6, height: width * 0.6, top: -width * 0.1, left: -width * 0.2 }]} />
      <View style={[styles.glow, styles.glowGold, { width: width * 0.5, height: width * 0.5, top: height * 0.2, right: -width * 0.2 }]} />

      <View style={styles.content}>
        {/* ─── Logo + 4 service sparks (electric dispersion) ─── */}
        <View style={styles.logoBlock}>
          {/* Rotating arrow halo around the logo */}
          <Animated.View
            style={[styles.arrowRing, { transform: [{ rotate: arrowRotation }] }]}
          >
            <Text style={[styles.arrowChevron, styles.arrowChevronTop]}>▼</Text>
            <Text style={[styles.arrowChevron, styles.arrowChevronRight]}>◀</Text>
            <Text style={[styles.arrowChevron, styles.arrowChevronBottom]}>▲</Text>
            <Text style={[styles.arrowChevron, styles.arrowChevronLeft]}>▶</Text>
          </Animated.View>

          {/* The 4 service sparks — absolutely positioned at logo center,
              translated outward via animated transform. They start at
              (0,0) scale 0 and "shoot" out to their angle on the radius. */}
          {SERVICE_SPARKS.map((s, i) => {
            const v = sparkProgress[i];
            const dx = Math.cos((s.angle * Math.PI) / 180) * SPARK_RADIUS;
            const dy = Math.sin((s.angle * Math.PI) / 180) * SPARK_RADIUS;
            const tx = v.interpolate({ inputRange: [0, 1], outputRange: [0, dx] });
            const ty = v.interpolate({ inputRange: [0, 1], outputRange: [0, dy] });
            // Scale spike: pop slightly larger mid-flight, settle to 1.
            const scale = v.interpolate({
              inputRange: [0, 0.6, 1],
              outputRange: [0, 1.25, 1],
            });
            // Opacity: invisible until they begin to fly out.
            const opacity = v.interpolate({
              inputRange: [0, 0.15, 1],
              outputRange: [0, 1, 1],
            });
            return (
              <Animated.View
                key={s.label}
                style={[
                  styles.spark,
                  {
                    transform: [{ translateX: tx }, { translateY: ty }, { scale }],
                    opacity,
                    shadowColor: s.color,
                    borderColor: s.color,
                  },
                ]}
              >
                <Text style={styles.sparkIcon}>{s.icon}</Text>
                <Text style={styles.sparkLabel}>{s.label}</Text>
              </Animated.View>
            );
          })}

          {/* Logo disc */}
          <Animated.View style={[styles.logoDisc, { transform: [{ scale: logoScale }] }]}>
            <Image source={Logo} style={styles.logoImage} resizeMode="contain" />
          </Animated.View>
        </View>

        {/* ─── Brand title ─── */}
        <Animated.Text
          style={[
            styles.title,
            {
              opacity: titleOpacity,
              transform: [{ translateY: titleTranslateY }] as any,
            },
          ]}
        >
          Flipone<Text style={styles.titleAccent}>X</Text> Digital
        </Animated.Text>

        {/* ─── Doorstep glass pill ─── */}
        <Animated.View style={[styles.pillWrap, { opacity: pillOpacity }]}>
          <View style={styles.pill}>
            {/* BlurView with experimentalBlurMethod="dimezisBlurView"
                gives real frosted glass on Android (default Android
                impl just dims). On iOS it is native. */}
            <BlurView
              intensity={60}
              tint="dark"
              experimentalBlurMethod="dimezisBlurView"
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.glassSheen} pointerEvents="none" />
            <Text style={styles.pillText}>Doorstep Digital Services</Text>
          </View>
        </Animated.View>

        {/* ─── 4 glass feature cards ─── */}
        <Animated.View style={[styles.featureRow, { opacity: featureOpacity }]}>
          {FEATURES.map((f) => (
            <View key={f.title} style={styles.featureCard}>
              <BlurView
                intensity={55}
                tint="dark"
                experimentalBlurMethod="dimezisBlurView"
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.glassSheen} pointerEvents="none" />
              <View style={[styles.featureIconCircle, { borderColor: f.iconColor }]}>
                <Text style={styles.featureIconText}>{f.icon}</Text>
              </View>
              <Text style={styles.featureTitle}>{f.title}</Text>
              <Text style={styles.featureSub}>{f.sub}</Text>
            </View>
          ))}
        </Animated.View>

        {/* ─── 100+ Premium subtitle ─── */}
        <Animated.View style={[styles.subtitleBlock, { opacity: subtitleOpacity }]}>
          <View style={styles.subtitleDivider}>
            <View style={styles.subtitleLine} />
            <Text style={styles.subtitleStar}>✦</Text>
            <View style={styles.subtitleLine} />
          </View>
          <Text style={styles.subtitleMain}>
            <Text style={styles.subtitleAccent}>100+</Text> Premium Digital Services
          </Text>
          <Text style={styles.subtitleSub}>- At Your Home & Office</Text>
        </Animated.View>

        {/* ─── Progress bar — Connecting experts… ─── */}
        <View style={styles.progressBlock}>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
          </View>
          <Text style={styles.progressLabel}>Connecting experts…</Text>
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#082B4C', overflow: 'hidden' },

  glow: { position: 'absolute', borderRadius: 999, opacity: 0.18 },
  glowCyan: { backgroundColor: '#22D3EE' },
  glowGold: { backgroundColor: '#FCD34D' },

  // Pushed content down — paddingTop bumped from 40 → 90 so the logo
  // and dispersed sparks sit lower on the screen, leaving more breathing
  // room above and a visually centered animation block.
  content: { flex: 1, alignItems: 'center', paddingHorizontal: 18, paddingTop: 90, paddingBottom: 24 },

  // ─── Logo block (now also hosts the dispersed sparks) ──────────────
  logoBlock: {
    width: 240,
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  arrowRing: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowChevron: {
    position: 'absolute',
    color: '#FCD34D',
    fontSize: 18,
    fontWeight: '900',
    textShadowColor: 'rgba(252,211,77,0.80)',
    textShadowRadius: 6,
  },
  arrowChevronTop: { top: -4 },
  arrowChevronRight: { right: -4, top: '50%', marginTop: -10 },
  arrowChevronBottom: { bottom: -4 },
  arrowChevronLeft: { left: -4, top: '50%', marginTop: -10 },

  // Spark = the 4 service icons that radiate out from logo center.
  // Absolutely positioned at the center of logoBlock; translated by
  // Animated values to their final radial positions.
  spark: {
    position: 'absolute',
    width: 70,
    height: 70,
    borderRadius: 16,
    backgroundColor: 'rgba(8,43,76,0.78)',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    elevation: 10,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 14,
  },
  sparkIcon: { fontSize: 22 },
  sparkLabel: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    marginTop: 2,
    letterSpacing: 0.3,
  },

  logoDisc: {
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    borderWidth: 4,
    borderColor: 'rgba(252,211,77,0.45)',
  },
  logoImage: { width: 130, height: 130, borderRadius: 65 },

  // ─── Title ──────────────────────────────────────────────────────────
  title: {
    fontSize: 36,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.8,
    textAlign: 'center',
    marginTop: 28,
  },
  titleAccent: { color: '#FCD34D' },

  // ─── Glass pill ─────────────────────────────────────────────────────
  pillWrap: {
    marginTop: 12,
    alignItems: 'center',
  },
  pill: {
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(252,211,77,0.85)',
    backgroundColor: 'rgba(255,255,255,0.10)',
    elevation: 6,
    shadowColor: '#FCD34D',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
  },
  pillText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  // Sheen = thin diagonal white highlight along the top of every glass
  // surface, sells the frosted-glass illusion when blur is subtle on
  // certain devices. Pointer-events disabled.
  glassSheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '50%',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },

  // ─── 4 glass feature cards ─────────────────────────────────────────
  featureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 28,
    width: '100%',
    paddingHorizontal: 4,
    gap: 6,
  },
  featureCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.30)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    elevation: 4,
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  featureIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.20)',
  },
  featureIconText: { fontSize: 16 },
  featureTitle: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 4,
  },
  featureSub: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 9,
    textAlign: 'center',
    lineHeight: 12,
  },

  // ─── 100+ subtitle ──────────────────────────────────────────────────
  subtitleBlock: { alignItems: 'center', marginTop: 22 },
  subtitleDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  subtitleLine: { width: 60, height: 1.5, backgroundColor: '#FCD34D' },
  subtitleStar: { color: '#FCD34D', fontSize: 16 },
  subtitleMain: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
  subtitleAccent: { color: '#FCD34D' },
  subtitleSub: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
  },

  // ─── Progress bar ───────────────────────────────────────────────────
  progressBlock: { width: '85%', marginTop: 20, alignItems: 'center' },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FCD34D',
    borderRadius: 3,
  },
  progressLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    letterSpacing: 0.4,
  },
});

export default SplashScreen;

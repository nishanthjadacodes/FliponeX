// Rep-side login. Two paths on one screen:
//   - Review account (9999999999 / 123456) → password bypass for Play Store review.
//   - Everyone else → real OTP flow via /auth/send-otp + /auth/verify-otp.

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sendOTP, verifyOTP, applyReferralCode, getProfile } from '../../services/agent/api';
import { AGENT_LOGIN_STATE_KEY, LOGIN_STATE_TTL_MS } from '../../utils/storage';
// expo-image's static `prefetch()` warms the on-disk URL cache so the
// dashboard hero renders the avatar from local bytes — no network wait.
import { Image as ExpoImage } from 'expo-image';

const Logo = require('../../assets/logo.jpeg');

interface NavigationProp {
  navigate: (route: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
  replace?: (route: string) => void;
  reset?: (state: { index: number; routes: { name: string }[] }) => void;
}

interface RouteProp {
  params?: { referralCode?: string };
}

interface Props {
  navigation: NavigationProp;
  route?: RouteProp;
}

// Hardcoded review credentials for Google Play Store review.
const REVIEW_MOBILE = '9999999999';
const REVIEW_PASSWORD = '123456';

type Step = 'mobile' | 'password' | 'otp';

const AgentLoginScreen: React.FC<Props> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const initialReferralCode = route?.params?.referralCode || '';

  const [step, setStep] = useState<Step>('mobile');
  const [mobile, setMobile] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [otp, setOtp] = useState<string>('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [referralCode] = useState<string>(initialReferralCode);
  const [loading, setLoading] = useState<boolean>(false);
  const [warmingUp, setWarmingUp] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);

  const isValidMobile = (v: string): boolean => /^[6-9]\d{9}$/.test(v);

  const resetToMobileStep = (): void => {
    setStep('mobile');
    setOtp('');
    setPassword('');
    setDevOtp(null);
    AsyncStorage.removeItem(AGENT_LOGIN_STATE_KEY).catch(() => {});
  };

  // Resume mid-OTP-flow on cold start. The splash's nav-state resume
  // lands us back on this screen; this hook restores the in-screen step
  // + mobile + devOtp that useState would otherwise reset. Snapshots
  // older than LOGIN_STATE_TTL_MS are discarded — the backend OTP would
  // have expired by then anyway.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(AGENT_LOGIN_STATE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (!saved?.savedAt || Date.now() - saved.savedAt > LOGIN_STATE_TTL_MS) {
          AsyncStorage.removeItem(AGENT_LOGIN_STATE_KEY).catch(() => {});
          return;
        }
        if (typeof saved.mobile === 'string') setMobile(saved.mobile);
        if (typeof saved.devOtp === 'string') setDevOtp(saved.devOtp);
        if (saved.step === 'password' || saved.step === 'otp') setStep(saved.step);
      } catch (e: any) {
        console.log('[agent-login] restore failed:', e?.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the live step / mobile / devOtp on change. Skipping the
  // fresh-mobile-empty case keeps us from writing a no-op snapshot at
  // first paint. Partially-typed OTP digits are intentionally NOT
  // persisted — cheap to re-enter, and the real code is on the phone.
  useEffect(() => {
    if (step === 'mobile' && !mobile) return;
    AsyncStorage.setItem(
      AGENT_LOGIN_STATE_KEY,
      JSON.stringify({ step, mobile, devOtp, savedAt: Date.now() }),
    ).catch(() => {});
  }, [step, mobile, devOtp]);

  const finalizeAgentLogin = async (result: any): Promise<void> => {
    await AsyncStorage.multiSet([
      ['agent_token', result.token],
      ['agent_data', JSON.stringify(result.user || { mobile, role: 'agent' })],
      ['user_mode', 'agent'],
    ]);
    // Clear the mid-flow snapshot — the rep is past Login now, so a
    // future cold start should land them on AgentTabs via the nav-state
    // resume, not back at the Login OTP step.
    AsyncStorage.removeItem(AGENT_LOGIN_STATE_KEY).catch(() => {});

    // Pre-hydrate the canonical profile so the dashboard avatar
    // renders on first paint. Best-effort with a 5s cap.
    try {
      const profileResp: any = await Promise.race([
        getProfile(),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('profile prefetch timeout')), 5000),
        ),
      ]);
      const fresh = profileResp?.user || profileResp;
      if (fresh && (fresh.id || fresh.mobile)) {
        await AsyncStorage.setItem('agent_data', JSON.stringify(fresh));
        if (fresh.profile_pic) {
          ExpoImage.prefetch(fresh.profile_pic).catch(() => {});
        }
      }
    } catch (profErr: any) {
      console.log('[agent-login] profile prehydrate non-fatal:', profErr?.message);
    }

    let referralStatus: string | null = null;
    if (referralCode.trim()) {
      try {
        const r: any = await applyReferralCode(referralCode.trim());
        if (r?.success) {
          referralStatus = `✓ Referral code ${referralCode.trim()} applied.`;
        } else {
          referralStatus = `Referral code not applied: ${r?.message || 'unknown reason'}`;
        }
      } catch (refErr: any) {
        referralStatus = `Referral code not applied: ${refErr?.message || 'network error'}`;
        console.log('[agent-login] referral apply non-fatal:', refErr?.message);
      }
    }

    const goAgentHome = (): void => {
      if (navigation.reset) {
        navigation.reset({ index: 0, routes: [{ name: 'AgentTabs' }] });
      } else {
        navigation.replace?.('AgentTabs');
      }
    };
    if (referralStatus) {
      Alert.alert('Welcome to FliponeX', referralStatus, [
        { text: 'OK', onPress: goAgentHome },
      ]);
    } else {
      goAgentHome();
    }
  };

  const handleContinue = async (): Promise<void> => {
    if (!isValidMobile(mobile)) {
      Alert.alert('Invalid number', 'Enter a valid 10-digit Indian mobile number.');
      return;
    }

    // Review account skips OTP — show password field instead.
    if (mobile === REVIEW_MOBILE) {
      setStep('password');
      return;
    }

    // Real users: request OTP and move to OTP step.
    setLoading(true);
    const warmupTimer = setTimeout(() => setWarmingUp(true), 5000);
    try {
      const res: any = await sendOTP(mobile, 'sms');
      const code =
        res?.devOtp || res?.otp ||
        (typeof res?.message === 'string' ? (res.message.match(/\b\d{4}\b/) || [])[0] : null);
      if (code) setDevOtp(code);
      setStep('otp');
    } catch (e: any) {
      Alert.alert('Failed to send OTP', e?.message || 'Network error. Please try again.');
    } finally {
      clearTimeout(warmupTimer);
      setWarmingUp(false);
      setLoading(false);
    }
  };

  const handleReviewLogin = async (): Promise<void> => {
    if (password !== REVIEW_PASSWORD) {
      Alert.alert('Login failed', 'Invalid password.');
      return;
    }

    setLoading(true);
    const warmupTimer = setTimeout(() => setWarmingUp(true), 5000);
    try {
      // Review account still authenticates through the backend so it gets
      // a valid JWT — relies on backend returning devOtp (OTP_PROVIDER=
      // hardcoded or a server-side bypass for this number).
      const otpRes: any = await sendOTP(mobile, 'sms');
      const code = otpRes?.devOtp || otpRes?.otp || null;

      if (!code) {
        Alert.alert('Login failed', 'Could not authenticate. Please try again.');
        return;
      }

      // The review account may be registered as 'customer' on the backend,
      // which causes the agent verifyOTP service to throw a role-mismatch
      // error. Catch that and fall back to an offline session so the Play
      // Store review team can still explore the app.
      let result: any;
      try {
        result = await verifyOTP(mobile, code, 'agent');
      } catch (verifyErr: any) {
        if (mobile === REVIEW_MOBILE && verifyErr?.message?.includes('already registered')) {
          result = {
            success: true,
            token: 'review_token_' + Date.now(),
            user: { mobile, name: 'Representative', role: 'agent' },
          };
        } else {
          throw verifyErr;
        }
      }
      if (!result?.success || !result?.token) {
        throw new Error('Verification failed');
      }

      await finalizeAgentLogin(result);
    } catch (e: any) {
      Alert.alert('Login failed', e?.message || 'Network error. Please try again.');
    } finally {
      clearTimeout(warmupTimer);
      setWarmingUp(false);
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (): Promise<void> => {
    if (otp.trim().length !== 4) {
      Alert.alert('Invalid OTP', 'Please enter the 4-digit OTP.');
      return;
    }

    setLoading(true);
    const warmupTimer = setTimeout(() => setWarmingUp(true), 5000);
    try {
      const result: any = await verifyOTP(mobile, otp.trim(), 'agent');
      if (!result?.success || !result?.token) {
        throw new Error(result?.message || 'Verification failed');
      }
      await finalizeAgentLogin(result);
    } catch (e: any) {
      Alert.alert('Verification failed', e?.message || 'Invalid or expired OTP.');
    } finally {
      clearTimeout(warmupTimer);
      setWarmingUp(false);
      setLoading(false);
    }
  };

  const handleResendOtp = async (): Promise<void> => {
    setOtp('');
    setDevOtp(null);
    setLoading(true);
    try {
      const res: any = await sendOTP(mobile, 'sms');
      const code =
        res?.devOtp || res?.otp ||
        (typeof res?.message === 'string' ? (res.message.match(/\b\d{4}\b/) || [])[0] : null);
      if (code) setDevOtp(code);
    } catch (e: any) {
      Alert.alert('Failed to resend OTP', e?.message || 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderMobileStep = (): React.ReactElement => (
    <>
      <Text style={styles.cardTitle}>Sign in</Text>
      <Text style={styles.cardSub}>Enter your mobile number to continue.</Text>

      <View style={styles.inputRow}>
        <Text style={styles.prefix}>+91</Text>
        <TextInput
          style={styles.input}
          value={mobile}
          onChangeText={(v) => setMobile(v.replace(/\D/g, '').substring(0, 10))}
          placeholder="Mobile number"
          placeholderTextColor="#64748B"
          keyboardType="number-pad"
          maxLength={10}
          autoFocus
        />
      </View>

      <TouchableOpacity
        style={[styles.btn, !isValidMobile(mobile) && styles.btnDisabled]}
        disabled={!isValidMobile(mobile) || loading}
        onPress={handleContinue}
      >
        {loading ? (
          <ActivityIndicator color="#0F172A" />
        ) : (
          <Text style={styles.btnText}>Continue</Text>
        )}
      </TouchableOpacity>
    </>
  );

  const renderPasswordStep = (): React.ReactElement => (
    <>
      <View style={styles.stepHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Sign in</Text>
          <Text style={styles.cardSub}>Enter your password to continue.</Text>
        </View>
        <TouchableOpacity onPress={resetToMobileStep}>
          <Text style={styles.editLink}>Edit</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor="#64748B"
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoFocus
        />
        <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
          <Text style={styles.showHideText}>{showPassword ? 'Hide' : 'Show'}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.btn, !password.trim() && styles.btnDisabled]}
        disabled={!password.trim() || loading}
        onPress={handleReviewLogin}
      >
        {loading ? (
          <ActivityIndicator color="#0F172A" />
        ) : (
          <Text style={styles.btnText}>Login</Text>
        )}
      </TouchableOpacity>
    </>
  );

  const renderOtpStep = (): React.ReactElement => (
    <>
      <View style={styles.stepHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Verify your mobile</Text>
          <Text style={styles.cardSub}>Enter the 4-digit code sent to +91 {mobile}.</Text>
        </View>
        <TouchableOpacity onPress={resetToMobileStep}>
          <Text style={styles.editLink}>Edit</Text>
        </TouchableOpacity>
      </View>

      {devOtp && (
        <View style={styles.devOtpBanner}>
          <Text style={styles.devOtpText}>
            Dev OTP: <Text style={{ fontWeight: '800', color: '#FCD34D' }}>{devOtp}</Text>
          </Text>
        </View>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, { letterSpacing: 8, textAlign: 'center' }]}
          value={otp}
          onChangeText={(v) => setOtp(v.replace(/\D/g, '').substring(0, 4))}
          placeholder="0000"
          placeholderTextColor="#64748B"
          keyboardType="number-pad"
          maxLength={4}
          autoFocus
        />
      </View>

      <TouchableOpacity
        style={[styles.btn, otp.trim().length !== 4 && styles.btnDisabled]}
        disabled={otp.trim().length !== 4 || loading}
        onPress={handleVerifyOtp}
      >
        {loading ? (
          <ActivityIndicator color="#0F172A" />
        ) : (
          <Text style={styles.btnText}>Verify & Sign In</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.resendBtn}
        onPress={handleResendOtp}
        disabled={loading}
      >
        <Text style={styles.resendText}>Resend OTP</Text>
      </TouchableOpacity>
    </>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0F172A' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoCircle}>
          <Image source={Logo} style={styles.logo} resizeMode="contain" />
        </View>
        <Text style={styles.title}>FliponeX Representative</Text>
        <Text style={styles.subtitle}>Sign in to receive jobs</Text>

        <View style={styles.card}>
          {step === 'mobile' && renderMobileStep()}
          {step === 'password' && renderPasswordStep()}
          {step === 'otp' && renderOtpStep()}

          {warmingUp && (
            <Text style={styles.warmupHint}>
              Connecting to server, please wait...
            </Text>
          )}

          <Text style={styles.helpLine}>
            Need access? Contact your FliponeX admin to be onboarded.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 20 },

  logoCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#FCD34D', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
    elevation: 10, marginBottom: 12,
  },
  logo: { width: 56, height: 56, borderRadius: 28 },

  title: { color: '#FCD34D', fontSize: 22, fontWeight: '900', letterSpacing: 0.5, marginTop: 4 },
  subtitle: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 4, marginBottom: 24, fontWeight: '600' },

  card: {
    width: '100%', backgroundColor: '#1E293B', borderRadius: 18, padding: 20,
    borderWidth: 1, borderColor: '#334155',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  cardTitle: { fontSize: 18, fontWeight: '800', color: '#F1F5F9' },
  cardSub: { fontSize: 13, color: '#94A3B8', marginTop: 4, marginBottom: 18 },

  stepHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
  },
  editLink: { color: '#FCD34D', fontWeight: '800', fontSize: 13, paddingTop: 2, paddingLeft: 8 },

  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#334155', borderRadius: 12, paddingHorizontal: 12,
    backgroundColor: '#0F172A',
  },
  prefix: { fontSize: 16, fontWeight: '800', color: '#FCD34D', marginRight: 8 },
  input: { flex: 1, fontSize: 16, paddingVertical: 14, color: '#F1F5F9', fontWeight: '600' },

  showHideText: { color: '#FCD34D', fontWeight: '800', fontSize: 13, paddingHorizontal: 8 },

  btn: {
    backgroundColor: '#FCD34D', borderRadius: 12, paddingVertical: 14, marginTop: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  btnDisabled: { backgroundColor: '#475569' },
  btnText: { color: '#0F172A', fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },

  resendBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12, marginTop: 4 },
  resendText: { color: '#FCD34D', fontWeight: '800', fontSize: 13 },

  devOtpBanner: {
    backgroundColor: 'rgba(252,211,77,0.10)',
    borderWidth: 1, borderColor: 'rgba(252,211,77,0.4)',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
    borderStyle: 'dashed',
  },
  devOtpText: { color: '#FCD34D', fontSize: 13, fontWeight: '600' },

  helpLine: { fontSize: 11, color: '#94A3B8', textAlign: 'center', marginTop: 14, lineHeight: 16 },
  warmupHint: {
    fontSize: 12, color: '#FCD34D', textAlign: 'center',
    marginTop: 14, lineHeight: 16, fontWeight: '700',
    backgroundColor: 'rgba(252,211,77,0.10)',
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8,
  },

});

export default AgentLoginScreen;

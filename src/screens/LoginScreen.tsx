// Customer-side login. Three paths on one screen:
//   - Review account (9999999999 / 123456) → password bypass for Play Store review.
//   - First-time customer → signup form (name / email / address) → OTP.
//   - Returning customer → mobile → OTP (no signup hop).
// The signup form is gated on the backend's `isNewUser` flag from send-otp,
// so existing customers don't see it.

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
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sendOTP, verifyOTP } from '../services/api';
import {
  storeToken,
  storeUser,
  CUSTOMER_LOGIN_STATE_KEY,
  LOGIN_STATE_TTL_MS,
} from '../utils/storage';

const Logo = require('../assets/logo.jpeg');

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

type Step = 'mobile' | 'password' | 'signup' | 'otp';

const LoginScreen: React.FC<Props> = ({ navigation, route }) => {
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

  // Signup form values — collected between mobile entry and OTP for
  // first-time customers (backend's isNewUser flag drives the gate). Sent
  // along with verifyOTP so they save in the same atomic update. Empty
  // strings for returning customers since the step is skipped entirely.
  const [signupName, setSignupName] = useState<string>('');
  const [signupEmail, setSignupEmail] = useState<string>('');
  const [signupAddress, setSignupAddress] = useState<string>('');

  // Hardware back: step 2/3 → step 1, step 1 → ModeSelect (toggle page).
  useEffect(() => {
    const onBack = (): boolean => {
      if (step !== 'mobile') {
        resetToMobileStep();
        return true;
      }
      AsyncStorage.removeItem(CUSTOMER_LOGIN_STATE_KEY).catch(() => {});
      if (navigation.replace) {
        navigation.replace('ModeSelect');
      } else {
        navigation.navigate('ModeSelect');
      }
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [navigation, step]);

  // Resume mid-OTP-flow on cold start. The navigation stack lands us here
  // via the splash's resume mechanism; this hook restores the in-screen
  // state (step + mobile + devOtp) that useState would otherwise reset.
  // Snapshots older than LOGIN_STATE_TTL_MS are discarded — the backend
  // OTP would have expired by then anyway.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CUSTOMER_LOGIN_STATE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (!saved?.savedAt || Date.now() - saved.savedAt > LOGIN_STATE_TTL_MS) {
          AsyncStorage.removeItem(CUSTOMER_LOGIN_STATE_KEY).catch(() => {});
          return;
        }
        if (typeof saved.mobile === 'string') setMobile(saved.mobile);
        if (typeof saved.devOtp === 'string') setDevOtp(saved.devOtp);
        if (typeof saved.signupName === 'string') setSignupName(saved.signupName);
        if (typeof saved.signupEmail === 'string') setSignupEmail(saved.signupEmail);
        if (typeof saved.signupAddress === 'string') setSignupAddress(saved.signupAddress);
        if (
          saved.step === 'password' ||
          saved.step === 'signup' ||
          saved.step === 'otp'
        ) {
          setStep(saved.step);
        }
      } catch (e: any) {
        console.log('[login] restore failed:', e?.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the live step / mobile / devOtp whenever they change. We skip
  // the initial 'mobile' + empty-input state — no point writing a snapshot
  // that's identical to a fresh launch. The OTP digits the user has
  // partially typed are intentionally NOT persisted — they're cheap to
  // re-enter, and the SMS code is still on their phone.
  useEffect(() => {
    if (step === 'mobile' && !mobile) return;
    AsyncStorage.setItem(
      CUSTOMER_LOGIN_STATE_KEY,
      JSON.stringify({
        step,
        mobile,
        devOtp,
        signupName,
        signupEmail,
        signupAddress,
        savedAt: Date.now(),
      }),
    ).catch(() => {});
  }, [step, mobile, devOtp, signupName, signupEmail, signupAddress]);

  const isValidMobile = (v: string): boolean => /^[6-9]\d{9}$/.test(v);

  const resetToMobileStep = (): void => {
    setStep('mobile');
    setOtp('');
    setPassword('');
    setDevOtp(null);
    setSignupName('');
    setSignupEmail('');
    setSignupAddress('');
    AsyncStorage.removeItem(CUSTOMER_LOGIN_STATE_KEY).catch(() => {});
  };

  const finalizeLogin = async (res: any): Promise<void> => {
    await storeToken(res.token);
    if (res.user) await storeUser(res.user);
    await AsyncStorage.setItem('user_mode', 'customer');
    // Clear the mid-flow snapshot — the user is past Login now, so a
    // future cold start should land them on HomeTabs via the nav-state
    // resume, not back at the Login OTP step.
    AsyncStorage.removeItem(CUSTOMER_LOGIN_STATE_KEY).catch(() => {});

    let referralStatus: string | null = null;
    if (referralCode.trim()) {
      try {
        const { applyReferralCode }: any = await import('../services/api');
        if (typeof applyReferralCode === 'function') {
          const r: any = await applyReferralCode(referralCode.trim());
          if (r?.success) {
            referralStatus = `✓ Referral code ${referralCode.trim()} applied.`;
          } else {
            referralStatus = `Referral code not applied: ${r?.message || 'unknown reason'}`;
          }
        }
      } catch (refErr: any) {
        referralStatus = `Referral code not applied: ${refErr?.message || 'network error'}`;
        console.log('[login] referral apply non-fatal:', refErr?.message);
      }
    }

    const goHome = (): void => {
      if (navigation.reset) {
        navigation.reset({ index: 0, routes: [{ name: 'HomeTabs' }] });
      } else {
        navigation.replace?.('HomeTabs');
      }
    };
    if (referralStatus) {
      Alert.alert('Welcome to FliponeX', referralStatus, [
        { text: 'OK', onPress: goHome },
      ]);
    } else {
      goHome();
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

    // Real users: request OTP. First-time numbers (backend's isNewUser
    // flag) get the signup form before the OTP step; returning customers
    // skip straight to OTP.
    setLoading(true);
    const warmupTimer = setTimeout(() => setWarmingUp(true), 5000);
    try {
      const res: any = await sendOTP(mobile);
      const code =
        res?.devOtp || res?.otp ||
        (typeof res?.message === 'string' ? (res.message.match(/\b\d{4}\b/) || [])[0] : null);
      if (code) setDevOtp(code);
      if (res?.isNewUser) {
        setStep('signup');
      } else {
        setStep('otp');
      }
    } catch (e: any) {
      Alert.alert('Failed to send OTP', e?.message || 'Network error. Please try again.');
    } finally {
      clearTimeout(warmupTimer);
      setWarmingUp(false);
      setLoading(false);
    }
  };

  const handleSignupContinue = (): void => {
    if (!signupName.trim() || signupName.trim().length < 2) {
      Alert.alert('Name required', 'Please enter your full name to continue.');
      return;
    }
    if (signupEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signupEmail.trim())) {
      Alert.alert('Invalid email', 'Please enter a valid email address (or leave it blank).');
      return;
    }
    setStep('otp');
  };

  const handleReviewLogin = async (): Promise<void> => {
    if (password !== REVIEW_PASSWORD) {
      Alert.alert('Login failed', 'Invalid password.');
      return;
    }

    setLoading(true);
    const warmupTimer = setTimeout(() => setWarmingUp(true), 5000);
    try {
      // Review account still authenticates through the backend so it gets a
      // valid JWT — relies on backend returning devOtp (OTP_PROVIDER=hardcoded
      // or a server-side special-case for this number).
      const otpRes: any = await sendOTP(mobile);
      const code =
        otpRes?.devOtp || otpRes?.otp ||
        (typeof otpRes?.message === 'string' ? (otpRes.message.match(/\b\d{4}\b/) || [])[0] : null);
      if (!code) {
        Alert.alert('Login failed', 'Could not authenticate. Please try again.');
        return;
      }
      const res: any = await verifyOTP(mobile, code);
      if (!res?.success || !res?.token) {
        throw new Error(res?.message || 'Verification failed');
      }
      await finalizeLogin(res);
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
      // Ship the signup form values when we have them — backend only
      // honours these on the first-ever verify, so returning customers
      // can't accidentally overwrite their saved profile from this path.
      const extras = signupName.trim()
        ? {
            name: signupName.trim(),
            email: signupEmail.trim() || undefined,
            address: signupAddress.trim() || undefined,
          }
        : undefined;
      const res: any = await verifyOTP(mobile, otp.trim(), extras);
      if (!res?.success || !res?.token) {
        throw new Error(res?.message || 'Verification failed');
      }

      const role = res?.user?.role;
      if (role && role !== 'customer') {
        Alert.alert(
          'Wrong app',
          `This number is registered as ${role}. Open the FliponeX Representative app to sign in instead.`,
        );
        return;
      }

      await finalizeLogin(res);
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
      const res: any = await sendOTP(mobile);
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
          placeholderTextColor="#94A3B8"
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
          <ActivityIndicator color="#0D3B66" />
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
          placeholderTextColor="#94A3B8"
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
          <ActivityIndicator color="#0D3B66" />
        ) : (
          <Text style={styles.btnText}>Login</Text>
        )}
      </TouchableOpacity>
    </>
  );

  const renderSignupStep = (): React.ReactElement => (
    <>
      <View style={styles.stepHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Create your account</Text>
          <Text style={styles.cardSub}>
            Tell us a bit about yourself to finish signing up.
          </Text>
        </View>
        <TouchableOpacity onPress={resetToMobileStep}>
          <Text style={styles.editLink}>Edit</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={signupName}
          onChangeText={setSignupName}
          placeholder="Full name"
          placeholderTextColor="#94A3B8"
          autoCapitalize="words"
          autoFocus
        />
      </View>

      <View style={[styles.inputRow, { marginTop: 12 }]}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={signupEmail}
          onChangeText={setSignupEmail}
          placeholder="Email (optional)"
          placeholderTextColor="#94A3B8"
          keyboardType="email-address"
          autoCapitalize="none"
        />
      </View>

      <View style={[styles.inputRow, { marginTop: 12, alignItems: 'flex-start' }]}>
        <TextInput
          style={[styles.input, { flex: 1, minHeight: 72, textAlignVertical: 'top' }]}
          value={signupAddress}
          onChangeText={setSignupAddress}
          placeholder="Address (optional)"
          placeholderTextColor="#94A3B8"
          multiline
        />
      </View>

      <TouchableOpacity
        style={[styles.btn, !signupName.trim() && styles.btnDisabled]}
        disabled={!signupName.trim() || loading}
        onPress={handleSignupContinue}
      >
        {loading ? (
          <ActivityIndicator color="#0D3B66" />
        ) : (
          <Text style={styles.btnText}>Continue</Text>
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
            Dev OTP: <Text style={{ fontWeight: '800' }}>{devOtp}</Text>
          </Text>
        </View>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, { letterSpacing: 8, textAlign: 'center' }]}
          value={otp}
          onChangeText={(v) => setOtp(v.replace(/\D/g, '').substring(0, 4))}
          placeholder="0000"
          placeholderTextColor="#94A3B8"
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
          <ActivityIndicator color="#0D3B66" />
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
      style={{ flex: 1, backgroundColor: '#0D3B66' }}
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
        <Text style={styles.title}>FliponeX Digital</Text>
        <Text style={styles.subtitle}>India's #1 Doorstep Digital Service</Text>

        <View style={styles.card}>
          {step === 'mobile' && renderMobileStep()}
          {step === 'password' && renderPasswordStep()}
          {step === 'signup' && renderSignupStep()}
          {step === 'otp' && renderOtpStep()}

          {warmingUp && (
            <Text style={styles.warmupHint}>
              Connecting to server, please wait...
            </Text>
          )}

          <Text style={styles.legal}>
            By continuing you agree to FliponeX's Terms & Privacy Policy.
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
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 8, marginBottom: 12,
  },
  logo: { width: 56, height: 56, borderRadius: 28 },

  title: { color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: 0.5, marginTop: 4 },
  subtitle: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 4, marginBottom: 24, fontWeight: '600' },

  card: {
    width: '100%', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 20,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  cardTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  cardSub: { fontSize: 13, color: '#475569', marginTop: 4, marginBottom: 18 },

  stepHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
  },
  editLink: { color: '#0D3B66', fontWeight: '800', fontSize: 13, paddingTop: 2, paddingLeft: 8 },

  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12,
    backgroundColor: '#F8FAFC',
  },
  prefix: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginRight: 8 },
  input: { flex: 1, fontSize: 16, paddingVertical: 14, color: '#0F172A', fontWeight: '600' },

  showHideText: { color: '#0D3B66', fontWeight: '800', fontSize: 13, paddingHorizontal: 8 },

  btn: {
    backgroundColor: '#FCD34D', borderRadius: 12, paddingVertical: 14, marginTop: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  btnDisabled: { backgroundColor: '#FEF3C7' },
  btnText: { color: '#0D3B66', fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },

  resendBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12, marginTop: 4 },
  resendText: { color: '#0D3B66', fontWeight: '800', fontSize: 13 },

  devOtpBanner: {
    backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FCD34D',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
    borderStyle: 'dashed',
  },
  devOtpText: { color: '#0D3B66', fontSize: 13, fontWeight: '600' },

  legal: { fontSize: 11, color: '#94A3B8', textAlign: 'center', marginTop: 14, lineHeight: 16 },
  warmupHint: {
    fontSize: 12, color: '#0D3B66', textAlign: 'center',
    marginTop: 14, lineHeight: 16, fontWeight: '700',
    backgroundColor: '#FEF3C7',
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8,
  },
});

export default LoginScreen;

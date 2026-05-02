// Customer-side login. Phone → OTP → role-gate → HomeTabs.
//
// Same code path that ships to production. The OTP delivery channel is
// controlled by the backend's OTP_PROVIDER env var:
//   - 'hardcoded' (default for free testing) → OTP shown in the dev
//     banner on this screen, deterministic per mobile via getHardcodedOTP
//   - 'whatsapp'  → Meta Cloud API, free first 1k/mo
//   - 'msg91' / 'fast2sms' → real SMS, ~₹0.15/message
// Switching providers requires zero changes to this file.

import { useState, useRef, useEffect } from 'react';
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
import { sendOTP, verifyOTP } from '../services/api';
import { storeToken, storeUser } from '../utils/storage';

const Logo = require('../assets/logo.jpeg');

interface NavigationProp {
  navigate: (route: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
  replace?: (route: string) => void;
}

interface RouteProp {
  params?: { referralCode?: string };
}

interface Props {
  navigation: NavigationProp;
  route?: RouteProp;
}

const LoginScreen: React.FC<Props> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const initialReferralCode = route?.params?.referralCode || '';

  const [phase, setPhase] = useState<'mobile' | 'otp'>('mobile');
  const [mobile, setMobile] = useState<string>('');
  const [otp, setOtp] = useState<string>('');
  const [referralCode, setReferralCode] = useState<string>(initialReferralCode);
  const [loading, setLoading] = useState<boolean>(false);
  const [resending, setResending] = useState<boolean>(false);
  const [resendCooldown, setResendCooldown] = useState<number>(0);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const otpRef = useRef<TextInput | null>(null);

  // Resend countdown — disables the resend button for 60s after each send.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendCooldown]);

  const isValidMobile = (v: string): boolean => /^[6-9]\d{9}$/.test(v);

  const handleSendOtp = async (isResend: boolean = false): Promise<void> => {
    if (!isValidMobile(mobile)) {
      Alert.alert('Invalid number', 'Enter a valid 10-digit Indian mobile number.');
      return;
    }
    if (isResend) setResending(true);
    else setLoading(true);

    try {
      const res: any = await sendOTP(mobile);
      if (res?.success !== false) {
        // Backend (or offline-mode fallback) returns the OTP in dev mode
        // so the user can copy it from the banner. In production with a
        // real SMS provider, this field is null and the user reads it
        // from their SMS.
        const code =
          res?.devOtp || res?.otp ||
          (typeof res?.message === 'string' ? (res.message.match(/\b\d{6}\b/) || [])[0] : null);
        setDevOtp(code || null);
        setPhase('otp');
        setResendCooldown(60);
        // Focus the OTP input shortly after layout settles.
        setTimeout(() => otpRef.current?.focus(), 250);
      } else {
        Alert.alert('Could not send OTP', res?.message || 'Try again in a moment.');
      }
    } catch (e: any) {
      Alert.alert('Could not send OTP', e?.message || 'Network error');
    } finally {
      setLoading(false);
      setResending(false);
    }
  };

  const handleVerify = async (): Promise<void> => {
    if (otp.length !== 6) {
      Alert.alert('Invalid OTP', 'Enter the 6-digit code.');
      return;
    }
    setLoading(true);
    try {
      const res: any = await verifyOTP(mobile, otp);
      if (!res?.success || !res?.token) {
        throw new Error(res?.message || 'Verification failed');
      }

      // Role gate — this screen is the customer entry point. If the
      // mobile is registered as a rep, send them to the rep app instead
      // of locking them into a customer experience that won't work.
      const role = res?.user?.role;
      if (role && role !== 'customer') {
        Alert.alert(
          'Wrong app',
          `This number is registered as ${role}. Open the FliponeX Representative app to sign in instead.`,
        );
        return;
      }

      await storeToken(res.token);
      if (res.user) await storeUser(res.user);
      await AsyncStorage.setItem('user_mode', 'customer');

      // Apply referral code if entered or prefilled from deep link.
      // Surface the result so the user has visible confirmation.
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

      if (referralStatus) {
        Alert.alert('Welcome to FliponeX', referralStatus, [
          { text: 'OK', onPress: () => navigation.replace?.('HomeTabs') },
        ]);
      } else {
        navigation.replace?.('HomeTabs');
      }
    } catch (e: any) {
      Alert.alert('Verification failed', e?.message || 'Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleChangeNumber = (): void => {
    setPhase('mobile');
    setOtp('');
    setDevOtp(null);
    setResendCooldown(0);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0D3B66' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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

        {phase === 'mobile' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign in with mobile</Text>
            <Text style={styles.cardSub}>We'll send a 6-digit OTP to verify it's you.</Text>

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
              onPress={() => handleSendOtp(false)}
            >
              {loading ? (
                <ActivityIndicator color="#0D3B66" />
              ) : (
                <Text style={styles.btnText}>Send OTP</Text>
              )}
            </TouchableOpacity>

            <Text style={styles.legal}>
              By continuing you agree to FliponeX's Terms & Privacy Policy.
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Enter the OTP</Text>
            <Text style={styles.cardSub}>
              Sent to <Text style={styles.cardSubBold}>+91 {mobile}</Text>{' '}
              <Text style={styles.changeLink} onPress={handleChangeNumber}>
                Change
              </Text>
            </Text>

            <TextInput
              ref={otpRef}
              style={styles.otpInput}
              value={otp}
              onChangeText={(v) => setOtp(v.replace(/\D/g, '').substring(0, 6))}
              placeholder="● ● ● ● ● ●"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
              maxLength={6}
              textAlign="center"
            />

            {devOtp ? (
              <View style={styles.devBanner}>
                <Text style={styles.devBannerLabel}>DEV MODE OTP</Text>
                <Text style={styles.devBannerCode}>{devOtp}</Text>
                <TouchableOpacity onPress={() => setOtp(devOtp)}>
                  <Text style={styles.devBannerFill}>Tap to autofill</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={styles.referralBox}>
              <Text style={styles.referralLabel}>Have a referral code? (optional)</Text>
              <TextInput
                style={styles.referralInput}
                value={referralCode}
                onChangeText={(v) => setReferralCode(v.toUpperCase().substring(0, 16))}
                placeholder="FLIPXXXX"
                placeholderTextColor="#94A3B8"
                autoCapitalize="characters"
              />
              {referralCode.trim().length > 0 && (
                <Text style={styles.referralHint}>
                  ✓ Will be applied automatically when you verify.
                </Text>
              )}
            </View>

            <TouchableOpacity
              style={[styles.btn, otp.length !== 6 && styles.btnDisabled]}
              disabled={otp.length !== 6 || loading}
              onPress={handleVerify}
            >
              {loading ? (
                <ActivityIndicator color="#0D3B66" />
              ) : (
                <Text style={styles.btnText}>
                  {otp.length !== 6
                    ? `Enter all 6 digits (${otp.length}/6)`
                    : referralCode.trim().length > 0
                    ? 'Verify & Apply Referral'
                    : 'Verify & Continue'}
                </Text>
              )}
            </TouchableOpacity>

            <View style={styles.resendRow}>
              <Text style={styles.resendText}>Didn't get it?</Text>
              <TouchableOpacity
                disabled={resendCooldown > 0 || resending}
                onPress={() => handleSendOtp(true)}
              >
                <Text style={[styles.resendLink, resendCooldown > 0 && styles.resendLinkDisabled]}>
                  {resending
                    ? 'Sending…'
                    : resendCooldown > 0
                    ? `Resend in ${resendCooldown}s`
                    : 'Resend'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
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
  cardSubBold: { fontWeight: '800', color: '#0F172A' },
  changeLink: { color: '#0D3B66', fontWeight: '700' },

  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12,
    backgroundColor: '#F8FAFC',
  },
  prefix: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginRight: 8 },
  input: { flex: 1, fontSize: 16, paddingVertical: 14, color: '#0F172A', fontWeight: '600' },

  otpInput: {
    borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingVertical: 16,
    fontSize: 22, letterSpacing: 8, color: '#0F172A', fontWeight: '900',
    backgroundColor: '#F8FAFC',
  },

  btn: {
    backgroundColor: '#FCD34D', borderRadius: 12, paddingVertical: 14, marginTop: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  btnDisabled: { backgroundColor: '#FEF3C7' },
  btnText: { color: '#0D3B66', fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },

  legal: { fontSize: 11, color: '#94A3B8', textAlign: 'center', marginTop: 14, lineHeight: 16 },

  resendRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 14 },
  resendText: { color: '#475569', fontSize: 13 },
  resendLink: { color: '#0D3B66', fontSize: 13, fontWeight: '800' },
  resendLinkDisabled: { color: '#94A3B8' },

  devBanner: {
    marginTop: 16, padding: 12, borderRadius: 10,
    backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FCD34D',
    alignItems: 'center',
  },
  devBannerLabel: { color: '#92400E', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  devBannerCode: { color: '#0F172A', fontSize: 22, fontWeight: '900', letterSpacing: 6, marginTop: 4 },
  devBannerFill: { color: '#0D3B66', fontWeight: '800', fontSize: 12, marginTop: 4 },

  referralBox: {
    marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#F1F5F9',
  },
  referralLabel: { fontSize: 12, color: '#475569', fontWeight: '700', marginBottom: 6 },
  referralInput: {
    borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#0F172A', fontWeight: '700', letterSpacing: 1, backgroundColor: '#F8FAFC',
  },
  referralHint: {
    color: '#16A34A', fontSize: 11, fontWeight: '700', marginTop: 6, letterSpacing: 0.3,
  },
});

export default LoginScreen;

// Rep-side login. Phone → OTP → role-gate → AgentTabs.
//
// Mirrors src/screens/LoginScreen.tsx structurally but lives on the rep
// surface with the dark/gold palette and an explicit role='agent' gate
// that rejects customer accounts. Same OTP-provider abstraction —
// switch between hardcoded (free dev) / WhatsApp / SMS via backend env
// var, no app changes required.

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
import { sendOTP, verifyOTP, applyReferralCode } from '../../services/agent/api';

const Logo = require('../../assets/logo.jpeg');

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

const AgentLoginScreen: React.FC<Props> = ({ navigation, route }) => {
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
      const res = await sendOTP(mobile, 'sms');
      if (res?.success) {
        setDevOtp(res?.devOtp || null);
        setPhase('otp');
        setResendCooldown(60);
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
      // verifyOTP in services/agent/api.ts already passes role='agent'
      // and rejects non-rep accounts at the API layer. We surface the
      // same intent here in case the service layer ever loosens up.
      const result = await verifyOTP(mobile, otp, 'agent');
      if (!result?.success || !result?.token) {
        throw new Error('Verification failed');
      }
      const role = result?.user?.role;
      if (role && role !== 'agent' && role !== 'partner') {
        Alert.alert(
          'Wrong app',
          `This number is registered as ${role}. Open the FliponeX customer app to sign in instead.`,
        );
        return;
      }

      await AsyncStorage.multiSet([
        ['agent_token', result.token],
        ['agent_data', JSON.stringify(result.user || { mobile, role: 'agent' })],
        ['user_mode', 'agent'],
      ]);

      // Apply referral code if one was passed in via deep link or typed
      // by the user. Backend silently no-ops for already-referred users
      // and rejects self-referrals — both surface here so the user has
      // confirmation either way.
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

      if (referralStatus) {
        Alert.alert('Welcome to FliponeX', referralStatus, [
          { text: 'OK', onPress: () => navigation.replace?.('AgentTabs') },
        ]);
      } else {
        navigation.replace?.('AgentTabs');
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
      style={{ flex: 1, backgroundColor: '#0F172A' }}
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
        <Text style={styles.title}>FliponeX Representative</Text>
        <Text style={styles.subtitle}>Sign in to receive jobs</Text>

        {phase === 'mobile' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign in with mobile</Text>
            <Text style={styles.cardSub}>
              Use the mobile number registered with your FliponeX admin.
            </Text>

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
              onPress={() => handleSendOtp(false)}
            >
              {loading ? (
                <ActivityIndicator color="#0F172A" />
              ) : (
                <Text style={styles.btnText}>Send OTP</Text>
              )}
            </TouchableOpacity>

            <Text style={styles.helpLine}>
              Need access? Contact your FliponeX admin to be onboarded.
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
              placeholderTextColor="#64748B"
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

            {/* Referral code goes ABOVE the verify button so it's clear
                the same action submits both. New reps coming in via a
                shared referral link will see the code prefilled here. */}
            <View style={styles.referralBox}>
              <Text style={styles.referralLabel}>Referred by another rep? (optional)</Text>
              <TextInput
                style={styles.referralInput}
                value={referralCode}
                onChangeText={(v) => setReferralCode(v.toUpperCase().substring(0, 16))}
                placeholder="FLIPXXXX"
                placeholderTextColor="#64748B"
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
                <ActivityIndicator color="#0F172A" />
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
  cardSubBold: { fontWeight: '800', color: '#FCD34D' },
  changeLink: { color: '#FCD34D', fontWeight: '700' },

  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#334155', borderRadius: 12, paddingHorizontal: 12,
    backgroundColor: '#0F172A',
  },
  prefix: { fontSize: 16, fontWeight: '800', color: '#FCD34D', marginRight: 8 },
  input: { flex: 1, fontSize: 16, paddingVertical: 14, color: '#F1F5F9', fontWeight: '600' },

  otpInput: {
    borderWidth: 1, borderColor: '#334155', borderRadius: 12, paddingVertical: 16,
    fontSize: 22, letterSpacing: 8, color: '#FCD34D', fontWeight: '900',
    backgroundColor: '#0F172A',
  },

  btn: {
    backgroundColor: '#FCD34D', borderRadius: 12, paddingVertical: 14, marginTop: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  btnDisabled: { backgroundColor: '#475569' },
  btnText: { color: '#0F172A', fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },

  helpLine: { fontSize: 11, color: '#94A3B8', textAlign: 'center', marginTop: 14, lineHeight: 16 },

  resendRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 14 },
  resendText: { color: '#94A3B8', fontSize: 13 },
  resendLink: { color: '#FCD34D', fontSize: 13, fontWeight: '800' },
  resendLinkDisabled: { color: '#475569' },

  devBanner: {
    marginTop: 16, padding: 12, borderRadius: 10,
    backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FCD34D',
    alignItems: 'center',
  },
  devBannerLabel: { color: '#92400E', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  devBannerCode: { color: '#0F172A', fontSize: 22, fontWeight: '900', letterSpacing: 6, marginTop: 4 },
  devBannerFill: { color: '#0D3B66', fontWeight: '800', fontSize: 12, marginTop: 4 },

  referralBox: {
    marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#334155',
  },
  referralLabel: { fontSize: 12, color: '#94A3B8', fontWeight: '700', marginBottom: 6 },
  referralInput: {
    borderWidth: 1, borderColor: '#334155', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#FCD34D', fontWeight: '700', letterSpacing: 1, backgroundColor: '#0F172A',
  },
  referralHint: {
    color: '#22C55E', fontSize: 11, fontWeight: '700', marginTop: 6, letterSpacing: 0.3,
  },
});

export default AgentLoginScreen;

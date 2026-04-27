import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  Image,
  KeyboardAvoidingView,
  StatusBar,
  TouchableOpacity,
  Animated,
  Easing,
  ScrollView,
  useWindowDimensions,
} from 'react-native';

const Logo = require('../assets/logo.jpeg');
import auth from '@react-native-firebase/auth';
import { firebaseLogin } from '../services/api';
import { storeToken, storeUser, storeMobile } from '../utils/storage';
import HapticButton from '../components/HapticButton';
import * as haptics from '../utils/haptics';

const LoginScreen = ({ navigation }) => {
  const { width } = useWindowDimensions();
  const isSmall = width < 360;

  // Mode: 'login' (just mobile) | 'signup' (name + email + mobile) | 'otp' (verify)
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  // Firebase confirmation result returned from signInWithPhoneNumber.
  // Held in a ref so re-renders don't clobber it between send & verify steps.
  const confirmationRef = useRef(null);
  const [timer, setTimer] = useState(0);
  const [loading, setLoading] = useState(false);
  const otpRefs = useRef([]);

  // Animations
  const logoScale = useRef(new Animated.Value(0)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const formOpacity = useRef(new Animated.Value(0)).current;
  const formTranslateY = useRef(new Animated.Value(40)).current;
  const errorShake = useRef(new Animated.Value(0)).current;

  // Sliding tab indicator (0 = login, 1 = signup)
  const tabIndicator = useRef(new Animated.Value(0)).current;
  // Horizontal slide for form content (negative = slide in from right)
  const formTranslateX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(logoScale, { toValue: 1, friction: 5, tension: 50, useNativeDriver: true }),
      Animated.timing(taglineOpacity, { toValue: 1, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(formOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(formTranslateY, { toValue: 0, friction: 7, tension: 60, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    if (timer > 0) {
      const i = setInterval(() => setTimer((t) => t - 1), 1000);
      return () => clearInterval(i);
    }
  }, [timer]);

  const animateMode = (newMode) => {
    haptics.tap();

    // Figure out slide direction: going to signup = slide left, to login = slide right
    const goingToSignup = newMode === 'signup';
    const goingToLogin = newMode === 'login';
    const exitOffset = goingToSignup ? -60 : goingToLogin ? 60 : 0;
    const enterOffset = goingToSignup ? 60 : goingToLogin ? -60 : 0;

    // Animate tab indicator pill (only between login/signup — OTP mode hides tabs)
    if (newMode === 'login' || newMode === 'signup') {
      Animated.spring(tabIndicator, {
        toValue: newMode === 'signup' ? 1 : 0,
        friction: 8,
        tension: 100,
        useNativeDriver: false, // width/left animation
      }).start();
    }

    // Exit: fade + slide out in the direction of the new tab
    Animated.parallel([
      Animated.timing(formOpacity, { toValue: 0, duration: 130, useNativeDriver: true }),
      Animated.timing(formTranslateX, { toValue: exitOffset, duration: 130, useNativeDriver: true }),
    ]).start(() => {
      setMode(newMode);
      // Prep for entrance: place form on the opposite side, then spring it into place
      formTranslateX.setValue(enterOffset);
      Animated.parallel([
        Animated.timing(formOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(formTranslateX, { toValue: 0, friction: 7, tension: 70, useNativeDriver: true }),
      ]).start();
    });
  };

  const triggerErrorShake = () => {
    haptics.error();
    Animated.sequence([
      Animated.timing(errorShake, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(errorShake, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(errorShake, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(errorShake, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(errorShake, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  // Kick off Firebase phone-auth. Firebase handles SMS delivery + reCAPTCHA.
  // The returned `confirmation` object is held in a ref for the verify step.
  const requestFirebaseOTP = async () => {
    const e164 = `+91${mobile}`;
    const confirmation = await auth().signInWithPhoneNumber(e164);
    confirmationRef.current = confirmation;
  };

  // ─── Login flow: mobile → OTP → done ───
  const handleLoginSendOTP = async () => {
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      triggerErrorShake();
      Alert.alert('Invalid Number', 'Enter a valid 10-digit Indian mobile number');
      return;
    }
    setLoading(true);
    try {
      await requestFirebaseOTP();
      await storeMobile(mobile);
      haptics.success();
      setTimer(60);
      animateMode('otp');
      setTimeout(() => otpRefs.current[0]?.focus(), 400);
    } catch (error) {
      triggerErrorShake();
      Alert.alert('Could not send OTP', error?.message || 'Please try again');
    } finally {
      setLoading(false);
    }
  };

  // ─── Signup flow: name + email + mobile → OTP → backend upsert on verify ───
  // With Firebase there is no separate /signup call; we just capture name/email
  // locally and pass them to /auth/firebase-login on a successful verify so
  // the backend can upsert the row with those fields.
  const handleSignup = async () => {
    if (!name.trim() || name.trim().length < 2) {
      triggerErrorShake();
      Alert.alert('Invalid Name', 'Please enter your full name');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      triggerErrorShake();
      Alert.alert('Invalid Email', 'Please enter a valid email address');
      return;
    }
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      triggerErrorShake();
      Alert.alert('Invalid Number', 'Enter a valid 10-digit Indian mobile number');
      return;
    }

    setLoading(true);
    try {
      await requestFirebaseOTP();
      await storeMobile(mobile);
      haptics.success();
      setTimer(60);
      animateMode('otp');
      setTimeout(() => otpRefs.current[0]?.focus(), 400);
    } catch (error) {
      triggerErrorShake();
      Alert.alert('Signup Failed', error?.message || 'Could not send OTP');
    } finally {
      setLoading(false);
    }
  };

  // ─── OTP verification (shared) ───
  const handleOtpChange = (value, index) => {
    if (value) haptics.selection();
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    if (value && index < 5) otpRefs.current[index + 1]?.focus();
    if (value && index === 5 && newOtp.every((d) => d)) handleVerifyOTP(newOtp.join(''));
  };

  const handleOtpKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
      const newOtp = [...otp];
      newOtp[index - 1] = '';
      setOtp(newOtp);
    }
  };

  const handleVerifyOTP = async (otpStr) => {
    const code = otpStr || otp.join('');
    if (code.length !== 6) {
      triggerErrorShake();
      return;
    }
    if (!confirmationRef.current) {
      Alert.alert('Session expired', 'Please request a new OTP.');
      setOtp(['', '', '', '', '', '']);
      animateMode(tab); // back to the tab the user was on
      return;
    }
    setLoading(true);
    try {
      // 1. Ask Firebase to verify the SMS code; returns UserCredential on success.
      const credential = await confirmationRef.current.confirm(code);
      const idToken = await credential.user.getIdToken();

      // 2. Exchange the Firebase ID token for our backend JWT. The backend
      //    verifies the token with firebase-admin, upserts the User row, and
      //    returns { token, user } just like the old verifyOTP did.
      const response = await firebaseLogin({
        idToken,
        name: tab === 'signup' ? name.trim() : undefined,
        email: tab === 'signup' ? email.trim() : undefined,
      });

      await storeToken(response.token);
      await storeUser(response.user);
      confirmationRef.current = null;
      haptics.success();
      navigation.replace('HomeTabs');
    } catch (error) {
      triggerErrorShake();
      const msg = error?.message || '';
      // Firebase's 'auth/invalid-verification-code' is the wrong-OTP case.
      const isWrongCode = /invalid-verification-code|invalid code|wrong/i.test(msg);
      Alert.alert(
        'Verification Failed',
        isWrongCode ? 'That OTP is incorrect. Please try again.' : (msg || 'Verification failed')
      );
      setOtp(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    if (timer > 0) return;
    haptics.tap();
    setLoading(true);
    try {
      await requestFirebaseOTP();
      haptics.success();
      setTimer(60);
      setOtp(['', '', '', '', '', '']);
      Alert.alert('OTP Resent', `A new OTP was sent to +91 ${mobile}`);
    } catch (error) {
      triggerErrorShake();
      Alert.alert('Error', error?.message || 'Failed to resend OTP');
    } finally {
      setLoading(false);
    }
  };

  // ─── Render helpers ───
  const renderTabs = () => (
    <View style={styles.tabBar}>
      {/* Sliding pill indicator behind the tabs */}
      <Animated.View
        style={[
          styles.tabPill,
          {
            left: tabIndicator.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '50%'],
            }),
          },
        ]}
      />
      <TouchableOpacity
        style={styles.tab}
        onPress={() => mode !== 'login' && animateMode('login')}
      >
        <Text style={[styles.tabText, mode === 'login' && styles.tabTextActive]}>Login</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.tab}
        onPress={() => mode !== 'signup' && animateMode('signup')}
      >
        <Text style={[styles.tabText, mode === 'signup' && styles.tabTextActive]}>Sign Up</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#082B4C" />

      {/* Brand header */}
      <View style={styles.header}>
        <Animated.View style={[styles.logoContainer, { transform: [{ scale: logoScale }] }]}>
          <View style={styles.logoCircle}>
            <Image source={Logo} style={styles.logoImage} resizeMode="contain" />
          </View>
        </Animated.View>
        <Animated.View style={{ opacity: taglineOpacity }}>
          <Text style={styles.brandName}>FliponeX Digital</Text>
          <Text style={styles.brandTagline}>Skip the Queues, Stay Online — choose FliponeX!</Text>
        </Animated.View>
      </View>

      <KeyboardAvoidingView style={styles.formArea} behavior="padding">
        <ScrollView contentContainerStyle={styles.formScroll} keyboardShouldPersistTaps="handled">
          {/* Tabs only when not in OTP step */}
          {mode !== 'otp' && renderTabs()}

          <Animated.View
            style={[
              styles.formCard,
              {
                opacity: formOpacity,
                transform: [
                  { translateY: formTranslateY },
                  { translateX: Animated.add(formTranslateX, errorShake) },
                ],
              },
            ]}
          >
            {mode === 'login' && (
              <>
                <Text style={styles.formTitle}>Welcome Back</Text>
                <Text style={styles.formSubtitle}>Login with your registered mobile number</Text>

                <View style={styles.phoneInputContainer}>
                  <View style={styles.countryCode}>
                    <Text style={styles.flag}>IN</Text>
                    <Text style={styles.codeText}>+91</Text>
                  </View>
                  <TextInput
                    style={styles.phoneInput}
                    value={mobile}
                    onChangeText={(t) => setMobile(t.replace(/[^0-9]/g, '').slice(0, 10))}
                    placeholder="Enter mobile number"
                    placeholderTextColor="#BDBDBD"
                    keyboardType="phone-pad"
                    maxLength={10}
                    autoFocus
                  />
                </View>

                <HapticButton
                  title={loading ? 'Sending OTP...' : 'Send OTP'}
                  onPress={handleLoginSendOTP}
                  loading={loading}
                  hapticType="press"
                  style={styles.primaryBtn}
                  textStyle={styles.primaryBtnText}
                />

                <Text style={styles.switchHint}>
                  New here? <Text style={styles.switchHintLink} onPress={() => animateMode('signup')}>Create an account</Text>
                </Text>
              </>
            )}

            {mode === 'signup' && (
              <>
                <Text style={styles.formTitle}>Create Account</Text>
                <Text style={styles.formSubtitle}>Sign up to start booking services</Text>

                <Text style={styles.inputLabel}>Full Name</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="Enter your full name"
                  placeholderTextColor="#BDBDBD"
                  autoFocus
                />

                <Text style={styles.inputLabel}>Email</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="your@email.com"
                  placeholderTextColor="#BDBDBD"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />

                <Text style={styles.inputLabel}>Mobile Number</Text>
                <View style={styles.phoneInputContainer}>
                  <View style={styles.countryCode}>
                    <Text style={styles.flag}>IN</Text>
                    <Text style={styles.codeText}>+91</Text>
                  </View>
                  <TextInput
                    style={styles.phoneInput}
                    value={mobile}
                    onChangeText={(t) => setMobile(t.replace(/[^0-9]/g, '').slice(0, 10))}
                    placeholder="10-digit mobile"
                    placeholderTextColor="#BDBDBD"
                    keyboardType="phone-pad"
                    maxLength={10}
                  />
                </View>

                <HapticButton
                  title={loading ? 'Creating account...' : 'Create Account & Send OTP'}
                  onPress={handleSignup}
                  loading={loading}
                  hapticType="press"
                  style={styles.primaryBtn}
                  textStyle={styles.primaryBtnText}
                />

                <Text style={styles.switchHint}>
                  Already have an account? <Text style={styles.switchHintLink} onPress={() => animateMode('login')}>Login</Text>
                </Text>
              </>
            )}

            {mode === 'otp' && (
              <>
                <Text style={styles.formTitle}>Verify OTP</Text>
                <Text style={styles.formSubtitle}>
                  Enter the 6-digit code sent to{'\n'}
                  <Text style={styles.phoneHighlight}>+91 {mobile}</Text>
                </Text>

                <View style={styles.otpContainer}>
                  {otp.map((digit, index) => (
                    <TextInput
                      key={index}
                      ref={(ref) => (otpRefs.current[index] = ref)}
                      style={[styles.otpBox, { width: isSmall ? 38 : 44 }, digit && styles.otpBoxFilled]}
                      value={digit}
                      onChangeText={(v) => handleOtpChange(v.replace(/[^0-9]/g, ''), index)}
                      onKeyPress={(e) => handleOtpKeyPress(e, index)}
                      keyboardType="number-pad"
                      maxLength={1}
                      selectTextOnFocus
                    />
                  ))}
                </View>

                <HapticButton
                  title={loading ? 'Verifying...' : 'Verify & Continue'}
                  onPress={() => handleVerifyOTP()}
                  loading={loading}
                  hapticType="press"
                  style={styles.primaryBtn}
                  textStyle={styles.primaryBtnText}
                />

                <View style={styles.resendRow}>
                  {timer > 0 ? (
                    <Text style={styles.timerText}>Resend OTP in {timer}s</Text>
                  ) : (
                    <TouchableOpacity onPress={handleResendOTP}>
                      <Text style={styles.resendText}>Resend OTP</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <TouchableOpacity
                  onPress={() => { haptics.tap(); animateMode('login'); setOtp(['', '', '', '', '', '']); }}
                  style={styles.changeRow}
                >
                  <Text style={styles.changeText}>← Back to login</Text>
                </TouchableOpacity>
              </>
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D3B66' },
  header: { paddingTop: 50, paddingBottom: 30, alignItems: 'center', backgroundColor: '#0D3B66' },
  logoContainer: { alignItems: 'center', marginBottom: 14 },
  logoCircle: {
    width: 70, height: 70, borderRadius: 35, backgroundColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 12,
  },
  logoImage: { width: 56, height: 56, borderRadius: 28 },
  brandName: { fontSize: 24, fontWeight: '800', color: '#fff', letterSpacing: 1, textAlign: 'center' },
  brandTagline: { fontSize: 12, color: 'rgba(255,255,255,0.9)', marginTop: 4, letterSpacing: 0.5, textAlign: 'center' },

  formArea: { flex: 1, backgroundColor: '#F8F9FA', borderTopLeftRadius: 30, borderTopRightRadius: 30, marginTop: -20 },
  formScroll: { padding: 20 },

  // Tabs — animated sliding pill indicator
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
    position: 'relative',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  // Animated pill that slides between the two tabs
  tabPill: {
    position: 'absolute',
    top: 4, bottom: 4,
    width: '50%',
    marginLeft: 0,
    borderRadius: 9,
    backgroundColor: '#0D3B66',
    shadowColor: '#0D3B66',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  tab: {
    flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center',
    zIndex: 1,
  },
  tabText: { fontSize: 14, fontWeight: '700', color: '#6C757D' },
  tabTextActive: { color: '#fff' },

  formCard: { padding: 8 },
  formTitle: { fontSize: 24, fontWeight: '800', color: '#212121', marginBottom: 4 },
  formSubtitle: { fontSize: 13, color: '#6C757D', lineHeight: 19, marginBottom: 22 },
  phoneHighlight: { fontWeight: '700', color: '#0D3B66' },

  inputLabel: { fontSize: 12, fontWeight: '700', color: '#212121', marginBottom: 6, marginTop: 4, letterSpacing: 0.3 },
  input: {
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E0E0E0', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#212121',
    marginBottom: 14,
  },

  phoneInputContainer: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: '#E0E0E0',
    marginBottom: 14, overflow: 'hidden',
  },
  countryCode: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 13,
    borderRightWidth: 1, borderRightColor: '#E0E0E0', backgroundColor: '#FAFAFA',
  },
  flag: { fontSize: 13, fontWeight: '700', color: '#0D3B66', marginRight: 5 },
  codeText: { fontSize: 15, fontWeight: '600', color: '#212121' },
  phoneInput: { flex: 1, fontSize: 16, fontWeight: '600', color: '#212121', paddingHorizontal: 14, paddingVertical: 13, letterSpacing: 1.2 },

  otpContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 22, gap: 6 },
  otpBox: {
    height: 52, borderWidth: 2, borderColor: '#E0E0E0', borderRadius: 10,
    textAlign: 'center', fontSize: 20, fontWeight: '700', color: '#212121', backgroundColor: '#fff',
  },
  otpBoxFilled: { borderColor: '#0D3B66', backgroundColor: '#FCE4E6' },

  primaryBtn: {
    backgroundColor: '#0D3B66', paddingVertical: 15, borderRadius: 12, alignItems: 'center',
    shadowColor: '#0D3B66', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },

  switchHint: { fontSize: 13, color: '#6C757D', textAlign: 'center', marginTop: 16 },
  switchHintLink: { color: '#0D3B66', fontWeight: '700' },

  resendRow: { alignItems: 'center', marginTop: 18 },
  timerText: { fontSize: 13, color: '#9E9E9E' },
  resendText: { fontSize: 14, color: '#0D3B66', fontWeight: '700' },

  changeRow: { alignItems: 'center', marginTop: 14 },
  changeText: { fontSize: 13, color: '#6C757D' },
});

export default LoginScreen;

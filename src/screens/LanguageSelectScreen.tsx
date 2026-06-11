import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { setAppLanguage } from '../i18n';
import { getUserMode } from '../utils/storage';

interface LanguageOption {
  code: 'en' | 'hi' | 'te';
  label: string;
  native: string;
  flag: string;
}

// Only English is currently exposed. The Hindi / Telugu plumbing is
// scaffolded (translation tables + setAppLanguage + persisted choice
// exist) but no UI screen consumes the t() translator yet, so picking a
// non-English language has no visible effect. Hidden until the
// translation pass lands so users aren't misled into expecting an app
// they can read in their language. Restore the Hindi / Telugu rows here
// (and remove the "coming soon" hint below) once translations ship.
const LANGUAGES: LanguageOption[] = [
  { code: 'en', label: 'English', native: 'English', flag: '🇮🇳' },
];

interface LanguageSelectProps {
  navigation: { replace: (route: string) => void };
}

const LanguageSelectScreen: React.FC<LanguageSelectProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<LanguageOption['code'] | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  const handleContinue = async (): Promise<void> => {
    if (!picked || busy) return;
    setBusy(true);
    try {
      await setAppLanguage(picked);
      // If the user has already chosen a mode previously (rare on first
      // launch but possible if they cleared only the language key), send
      // them straight to their mode's tabs. Otherwise, go to ModeSelect.
      const mode = await getUserMode();
      if (mode === 'customer') navigation.replace('HomeTabs');
      else if (mode === 'agent') navigation.replace('AgentTabs');
      else navigation.replace('ModeSelect');
    } catch (e) {
      // Fall through; user can re-pick from Profile later.
      navigation.replace('ModeSelect');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#001F3F" />
      <LinearGradient
        colors={['#001F3F', '#003153', '#1B4B72']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}
      >
        <View style={styles.brandRow}>
          <Image source={require('../assets/logo1.jpeg')} style={styles.logo} resizeMode="cover" />
          <Text style={styles.brand}>FliponeX</Text>
        </View>

        <Text style={styles.title}>Choose your language</Text>
        <Text style={styles.subtitle}>
          Hindi and Telugu coming soon. You can change this later from
          Profile → Language.
        </Text>

        <View style={styles.optionsCol}>
          {LANGUAGES.map((opt) => {
            const active = picked === opt.code;
            return (
              <TouchableOpacity
                key={opt.code}
                style={[styles.optionCard, active && styles.optionCardActive]}
                onPress={() => setPicked(opt.code)}
                activeOpacity={0.85}
              >
                <Text style={styles.optionFlag}>{opt.flag}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>
                    {opt.label}
                  </Text>
                  <Text style={[styles.optionNative, active && styles.optionNativeActive]}>
                    {opt.native}
                  </Text>
                </View>
                <View style={[styles.radio, active && styles.radioActive]}>
                  {active && <View style={styles.radioDot} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={[styles.continueBtn, (!picked || busy) && styles.continueBtnDisabled]}
          onPress={handleContinue}
          disabled={!picked || busy}
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator color="#003153" />
          ) : (
            <Text style={styles.continueText}>Continue →</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#001F3F' },
  scroll: { paddingHorizontal: 22 },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  logo: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 2, borderColor: '#FCD34D',
    backgroundColor: '#FFFFFF',
  },
  brand: {
    color: '#FFFFFF', fontSize: 22, fontWeight: '900',
    letterSpacing: 1.4, marginLeft: 12,
  },
  title: {
    color: '#FFFFFF', fontSize: 26, fontWeight: '800',
    textAlign: 'center', marginBottom: 6, letterSpacing: 0.3,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.7)', fontSize: 13,
    textAlign: 'center', marginBottom: 28,
  },
  optionsCol: { gap: 12, marginBottom: 28 },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  optionCardActive: {
    backgroundColor: '#FCD34D',
    borderColor: '#FCD34D',
  },
  optionFlag: { fontSize: 26, marginRight: 14 },
  optionLabel: {
    color: '#FFFFFF', fontSize: 15, fontWeight: '800',
    letterSpacing: 0.3,
  },
  optionLabelActive: { color: '#003153' },
  optionNative: {
    color: 'rgba(255,255,255,0.7)', fontSize: 13,
    fontWeight: '600', marginTop: 2,
  },
  optionNativeActive: { color: 'rgba(0,49,83,0.7)' },
  radio: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  radioActive: { borderColor: '#003153' },
  radioDot: {
    width: 11, height: 11, borderRadius: 6,
    backgroundColor: '#003153',
  },
  continueBtn: {
    backgroundColor: '#FCD34D',
    paddingVertical: 16, borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  continueBtnDisabled: {
    backgroundColor: 'rgba(252,211,77,0.4)',
  },
  continueText: {
    color: '#003153', fontSize: 16, fontWeight: '900',
    letterSpacing: 0.4,
  },
});

export default LanguageSelectScreen;

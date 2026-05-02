import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  SafeAreaView,
  StatusBar,
  ScrollView,
} from 'react-native';
import {
  setUserMode,
  getUserMode,
} from '../utils/storage';
import { ADMIN_DASHBOARD_URL, CUSTOMER_WEBSITE_URL } from '../config';

interface ModeSelectScreenProps {
  navigation: {
    navigate: (route: string, params?: Record<string, unknown>) => void;
    goBack: () => void;
    replace: (route: string) => void;
  };
}

interface OptionCardProps {
  icon: string;
  accent: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
}

type MobileMode = 'customer' | 'agent';

/**
 * ModeSelect — the "what do you want to use?" switcher that sits between
 * Splash and the app proper.
 *
 * Four options:
 *   1. Customer App  → mobile customer flow (HomeTabs)
 *   2. Agent App     → mobile agent flow (AgentTabs)
 *   3. Admin Dashboard → in-app WebView of the Next.js admin panel
 *   4. Customer Website → in-app WebView of the Next.js public site
 *
 * Mobile modes persist via @flipon_user_mode so returning users skip this
 * screen on warm launch. Web views never persist — they're stateless:
 * tapping one opens the WebView, tapping back returns here.
 */
const ModeSelectScreen: React.FC<ModeSelectScreenProps> = ({ navigation }) => {
  const [busy, setBusy] = useState<boolean>(false);

  // If a mobile mode is already persisted, skip this screen — splash
  // already routes returning users to the right tab stack via the token
  // check. We mirror that here only as a safety net (e.g. user navigated
  // back to ModeSelect after picking once).
  useEffect(() => {
    (async () => {
      const existing = await getUserMode();
      if (existing === 'customer') navigation.replace('Login');
      else if (existing === 'agent') navigation.replace('AgentLogin');
    })();
  }, [navigation]);

  // Picking a mode now routes to the corresponding LOGIN screen — no
  // more silent guest-login. The user verifies their identity via OTP,
  // gets a real JWT for their actual role, and lands in the tabs after
  // verification.
  const pickMobile = async (mode: MobileMode): Promise<void> => {
    if (busy) return;
    setBusy(true);
    await setUserMode(mode);
    navigation.replace(mode === 'agent' ? 'AgentLogin' : 'Login');
  };

  const openWeb = (url: string, title: string): void => {
    if (busy) return;
    // Intentionally NOT persisting user mode — web views are a one-off
    // surface, the user comes back here after. `navigate` (not `replace`)
    // so the back button returns to ModeSelect.
    navigation.navigate('WebView', { url, title });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0D3B66" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoWrap}>
          <Image
            source={require('../assets/logo.jpeg')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        <Text style={styles.title}>Welcome to FliponeX</Text>
        <Text style={styles.subtitle}>How will you be using the app today?</Text>

        {/* ─── Mobile apps ──────────────────────────────── */}
        <Text style={styles.sectionLabel}>MOBILE APPS</Text>

        <OptionCard
          icon="👤"
          accent="#F5B301"
          title="Customer App"
          subtitle="Book government services, industrial enquiries, and track applications."
          onPress={() => pickMobile('customer')}
          disabled={busy}
        />

        <OptionCard
          icon="🧑‍💼"
          accent="#FCD34D"
          title="Representative App"
          subtitle="Accept tasks, manage earnings, and deliver services to customers."
          onPress={() => pickMobile('agent')}
          disabled={busy}
        />

        {/* ─── Web surfaces (embedded) ─────────────────── */}
        <Text style={styles.sectionLabel}>WEB SURFACES</Text>

        <OptionCard
          icon="🛡️"
          accent="#1976D2"
          title="Admin Dashboard"
          subtitle="B2B pipeline, enquiry quotes, reports — admin panel opens inside the app."
          onPress={() => openWeb(ADMIN_DASHBOARD_URL, 'Admin Dashboard')}
          disabled={busy}
        />

        <OptionCard
          icon="🌐"
          accent="#2E7D32"
          title="Customer Website"
          subtitle="Browse the public FliponeX website — services catalog, about, contact."
          onPress={() => openWeb(CUSTOMER_WEBSITE_URL, 'Customer Website')}
          disabled={busy}
        />

        <Text style={styles.footnote}>
          Mobile-app choice is tied to your account. Web surfaces open in an in-app
          browser — tap back to return here.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const OptionCard: React.FC<OptionCardProps> = ({ icon, accent, title, subtitle, onPress, disabled }) => (
  <TouchableOpacity
    style={[styles.card, { borderLeftColor: accent }, disabled && styles.disabled]}
    activeOpacity={0.85}
    onPress={onPress}
    disabled={disabled}
  >
    <Text style={styles.cardIcon}>{icon}</Text>
    <View style={styles.cardBody}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardSubtitle}>{subtitle}</Text>
    </View>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D3B66' },
  scrollContent: { paddingHorizontal: 20, paddingTop: 32, paddingBottom: 24 },

  logoWrap: { alignItems: 'center', marginBottom: 20 },
  logo: { width: 92, height: 92, borderRadius: 20 },

  title: {
    fontSize: 24, fontWeight: '800', color: '#FFFFFF',
    textAlign: 'center', marginBottom: 6,
  },
  subtitle: {
    fontSize: 14, color: 'rgba(255,255,255,0.8)',
    textAlign: 'center', marginBottom: 22,
  },

  sectionLabel: {
    fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.55)',
    letterSpacing: 1.2, marginTop: 10, marginBottom: 10, marginLeft: 4,
  },

  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF', borderRadius: 14,
    padding: 16, marginBottom: 12,
    borderLeftWidth: 5,
    shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  cardIcon: { fontSize: 36, marginRight: 14 },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#0D3B66', marginBottom: 3 },
  cardSubtitle: { fontSize: 12, color: '#455A64', lineHeight: 17 },
  disabled: { opacity: 0.55 },

  footnote: {
    marginTop: 18,
    fontSize: 11, color: 'rgba(255,255,255,0.55)',
    textAlign: 'center', lineHeight: 16,
  },
});

export default ModeSelectScreen;

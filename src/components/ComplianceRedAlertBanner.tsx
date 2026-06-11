import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import {
  getComplianceDocs,
  renewComplianceDoc,
  type ComplianceDoc,
} from '../services/api';

/**
 * Home-screen Smart Alert banner — the customer-facing surface of the
 * FliponeX 90/60/30-day compliance expiry system. Every variant carries
 * the "SMART ALERT" kicker label so a first-time user can immediately
 * tell what feature this banner belongs to (previously the red state
 * only said "Action Required Immediately" with no system name, leaving
 * users wondering what it was about).
 *
 * Five visual states, escalating urgency wins:
 *
 *   1. RED    — at least one doc <30 days from expiry. Critical alert,
 *               one-click "Renew via FliponeX" CTA.
 *   2. YELLOW — at least one doc 30–60 days out. Action reminder
 *               ("time to prepare"), same renew CTA.
 *   3. SOFT   — at least one doc 61–90 days out (backend status=green
 *               but daysLeft<=90 — we compute this tier on the client).
 *               Soft early warning, tap-to-open Vault, no big CTA.
 *   4. ACTIVE — has docs, all >90 days from expiry. "All monitored".
 *   5. SETUP  — no compliance docs uploaded yet. Friendly invite.
 *
 * Banner is always present on Home so even brand-new users learn the
 * Smart Alert system exists.
 */
export interface ComplianceRedAlertBannerProps {
  onPress?: () => void;
}

type BannerState = 'loading' | 'red' | 'yellow' | 'soft' | 'active' | 'setup';

const KICKER_LABEL = '🛡️ SMART ALERT';

const ComplianceRedAlertBanner: React.FC<ComplianceRedAlertBannerProps> = ({ onPress }) => {
  const [redDocs, setRedDocs] = useState<ComplianceDoc[]>([]);
  const [yellowDocs, setYellowDocs] = useState<ComplianceDoc[]>([]);
  const [softDocs, setSoftDocs] = useState<ComplianceDoc[]>([]);
  const [totalDocs, setTotalDocs] = useState<number>(0);
  const [state, setState] = useState<BannerState>('loading');
  const [renewing, setRenewing] = useState<boolean>(false);
  // useIsFocused returns true whenever the screen this banner lives on
  // (HomeScreen) is the active screen — including the case where the
  // user navigated away to ComplianceScreen, uploaded a doc, and came
  // back. Re-running the fetch on every focus transition means the
  // banner picks up newly-uploaded compliance docs immediately, instead
  // of waiting for the user to log out / log back in.
  const isFocused = useIsFocused();

  useEffect(() => {
    if (!isFocused) return;
    let alive = true;
    (async () => {
      try {
        const res = await getComplianceDocs();
        if (!alive) return;
        const all = res?.data || [];
        const red = all.filter((d) => d.status === 'red');
        const yellow = all.filter((d) => d.status === 'yellow');
        // 61–90 day tier: backend marks these 'green' (status thresholds
        // are <30 red / 30–60 yellow / >60 green), so we derive the
        // early-warning bucket from daysLeft on the client.
        const soft = all.filter(
          (d) =>
            d.status === 'green' &&
            typeof d.daysLeft === 'number' &&
            d.daysLeft <= 90,
        );
        setRedDocs(red);
        setYellowDocs(yellow);
        setSoftDocs(soft);
        setTotalDocs(all.length);

        let nextState: BannerState;
        if (red.length > 0) nextState = 'red';
        else if (yellow.length > 0) nextState = 'yellow';
        else if (soft.length > 0) nextState = 'soft';
        else if (all.length > 0) nextState = 'active';
        else nextState = 'setup';
        setState(nextState);
      } catch (_) {
        if (alive) {
          setRedDocs([]);
          setYellowDocs([]);
          setSoftDocs([]);
          setTotalDocs(0);
          setState('setup');
        }
      }
    })();
    return () => { alive = false; };
  }, [isFocused]);

  // One-click renewal — fires the renew API for the most-imminent doc in
  // the current alert bucket. Used by both RED and YELLOW states.
  const handleRenewViaFliponex = async (targetDocs: ComplianceDoc[]): Promise<void> => {
    if (renewing || targetDocs.length === 0) return;
    const target = [...targetDocs].sort(
      (a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999),
    )[0];
    setRenewing(true);
    try {
      const res: any = await renewComplianceDoc(target.id);
      Alert.alert(
        'Renewal request sent',
        res?.message ||
          'A FliponeX representative will call you shortly to schedule document pickup.',
      );
      // Remove the just-actioned doc from whichever bucket it lived in
      // so the banner doesn't prompt the user about it again.
      setRedDocs((prev) => prev.filter((d) => d.id !== target.id));
      setYellowDocs((prev) => prev.filter((d) => d.id !== target.id));
    } catch (e: any) {
      Alert.alert(
        'Could not start renewal',
        e?.message || 'Please try again from the Compliance Vault.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Compliance Vault', onPress: () => onPress?.() },
        ],
      );
    } finally {
      setRenewing(false);
    }
  };

  if (state === 'loading') return null;

  // Reusable kicker label — appears at the top of every variant so the
  // user always sees what system this banner belongs to.
  const renderKicker = (color: string) => (
    <Text style={[styles.kicker, { color }]}>{KICKER_LABEL}</Text>
  );

  // ─── RED — critical, <30 days ─────────────────────────────────────────
  if (state === 'red') {
    const headline =
      redDocs.length === 1
        ? `${redDocs[0].label} expires in ${Math.max(redDocs[0].daysLeft ?? 0, 0)} days`
        : `${redDocs.length} compliance documents are nearing expiry`;

    return (
      <View style={styles.banner} accessibilityRole="alert">
        {renderKicker('#FFFFFF')}
        <TouchableOpacity style={styles.bannerBody} activeOpacity={0.85} onPress={onPress}>
          <View style={styles.iconWrap}>
            <Text style={styles.icon}>🚨</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Action Required Immediately</Text>
            <Text style={styles.subtitle} numberOfLines={2}>
              {headline} — avoid penalties, renew via FliponeX now.
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.cta, renewing && styles.ctaDisabled]}
          onPress={() => handleRenewViaFliponex(redDocs)}
          disabled={renewing}
        >
          {renewing ? (
            <ActivityIndicator size="small" color="#E63946" />
          ) : (
            <Text style={styles.ctaText}>Renew via FliponeX</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  // ─── YELLOW — action reminder, 30-60 days ─────────────────────────────
  if (state === 'yellow') {
    const headline =
      yellowDocs.length === 1
        ? `${yellowDocs[0].label} expires in ${yellowDocs[0].daysLeft ?? 0} days`
        : `${yellowDocs.length} documents expire within 60 days`;

    return (
      <View style={[styles.banner, styles.bannerYellow]} accessibilityRole="alert">
        {renderKicker('#FFFFFF')}
        <TouchableOpacity style={styles.bannerBody} activeOpacity={0.85} onPress={onPress}>
          <View style={[styles.iconWrap, styles.iconWrapYellow]}>
            <Text style={styles.icon}>⚠️</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, styles.titleYellow]}>Time to Prepare</Text>
            <Text style={[styles.subtitle, styles.subtitleYellow]} numberOfLines={2}>
              {headline} — FliponeX experts are ready to assist with renewal.
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.cta, styles.ctaYellow, renewing && styles.ctaDisabled]}
          onPress={() => handleRenewViaFliponex(yellowDocs)}
          disabled={renewing}
        >
          {renewing ? (
            <ActivityIndicator size="small" color="#B45309" />
          ) : (
            <Text style={[styles.ctaText, styles.ctaTextYellow]}>Schedule Renewal</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  // ─── SOFT — early warning, 61-90 days ────────────────────────────────
  if (state === 'soft') {
    const headline =
      softDocs.length === 1
        ? `${softDocs[0].label} expires in ${softDocs[0].daysLeft ?? 0} days`
        : `${softDocs.length} documents expire within 90 days`;

    return (
      <TouchableOpacity
        style={[styles.banner, styles.bannerSoft]}
        activeOpacity={0.85}
        onPress={onPress}
        accessibilityRole="button"
      >
        {renderKicker('#1E3A8A')}
        <View style={styles.bannerBody}>
          <View style={[styles.iconWrap, styles.iconWrapSoft]}>
            <Text style={styles.icon}>⏰</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, styles.titleSoft]}>Early Warning</Text>
            <Text style={[styles.subtitle, styles.subtitleSoft]} numberOfLines={2}>
              {headline}. Should we start the documentation? Tap to plan.
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  // ─── ACTIVE — has docs, all healthy (>90 days) ───────────────────────
  if (state === 'active') {
    return (
      <TouchableOpacity
        style={[styles.banner, styles.bannerActive]}
        activeOpacity={0.85}
        onPress={onPress}
        accessibilityRole="button"
      >
        {renderKicker('#FFFFFF')}
        <View style={styles.bannerBody}>
          <View style={[styles.iconWrap, styles.iconWrapActive]}>
            <Text style={styles.icon}>✅</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>All Documents Healthy</Text>
            <Text style={styles.subtitle} numberOfLines={2}>
              Monitoring {totalDocs} document{totalDocs === 1 ? '' : 's'}.
              We'll alert you 90 / 60 / 30 days before any expiry.
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  // ─── SETUP — no docs yet ──────────────────────────────────────────────
  return (
    <TouchableOpacity
      style={[styles.banner, styles.bannerSetup]}
      activeOpacity={0.85}
      onPress={onPress}
      accessibilityRole="button"
    >
      {renderKicker('#7C2D12')}
      <View style={styles.bannerBody}>
        <View style={[styles.iconWrap, styles.iconWrapSetup]}>
          <Text style={styles.icon}>🛡️</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, styles.titleSetup]}>Activate Your Vault</Text>
          <Text style={[styles.subtitle, styles.subtitleSetup]} numberOfLines={3}>
            Upload your Factory Licence, Fire NOC, GST cert, etc. — we'll
            alert you 90 / 60 / 30 days before each expires.
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  // Base banner — tightened from prior version: marginHorizontal 14→12,
  // marginTop 10→8, paddingHorizontal 14→12, paddingVertical 12→10. Frees
  // ~12-15px of vertical space on the home page across every variant so
  // more services scroll into the initial viewport.
  banner: {
    backgroundColor: '#E63946',
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    shadowColor: '#7A1E27',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  // Kicker label — tiny uppercase "SMART ALERT" header so every state
  // visibly belongs to the same feature. Spans full banner width above
  // the icon+title row. ~12px tall including marginBottom.
  kicker: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginBottom: 4,
  },
  bannerBody: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  icon: { fontSize: 17 },
  title: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 10.5,
    fontWeight: '600',
    marginTop: 1,
    lineHeight: 13,
  },
  cta: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 8,
    alignItems: 'center',
    minHeight: 34,
    justifyContent: 'center',
  },
  ctaDisabled: { opacity: 0.7 },
  ctaText: {
    color: '#E63946',
    fontWeight: '900',
    fontSize: 12.5,
    letterSpacing: 0.4,
  },

  // YELLOW variant — bright canary background, ALL body text in white,
  // CTA inverted to a white pill with canary-yellow text. Per request:
  // "background of Schedule Renewal → white, text Schedule Renewal →
  // canary, SMART ALERT / Time to Prepare / all body text → white".
  // The canary hex matches ComplianceScreen.tsx's CANARY_YELLOW (#FFD400)
  // so the home banner and the Compliance Vault dashboard share one
  // brand yellow.
  bannerYellow: {
    backgroundColor: '#FFD400',
    shadowColor: '#92400E',
    borderWidth: 1,
    borderColor: '#E6BE00',
  },
  iconWrapYellow: { backgroundColor: 'rgba(255,255,255,0.22)' },
  titleYellow: { color: '#FFFFFF' },
  subtitleYellow: { color: '#FFFFFF' },
  ctaYellow: { backgroundColor: '#FFFFFF' },
  ctaTextYellow: { color: '#FFD400' },

  // SOFT variant — soft blue for "61-90 day early warning". No CTA, the
  // whole banner is tappable to open the vault.
  bannerSoft: {
    backgroundColor: '#DBEAFE',
    shadowColor: '#1E3A8A',
    borderWidth: 1,
    borderColor: '#93C5FD',
  },
  iconWrapSoft: { backgroundColor: 'rgba(30,58,138,0.10)' },
  titleSoft: { color: '#1E3A8A' },
  subtitleSoft: { color: '#1E40AF' },

  // ACTIVE variant — has docs, all >90 days out. Reassuring teal.
  bannerActive: {
    backgroundColor: '#0D5E5E',
    shadowColor: '#0A3F3F',
  },
  iconWrapActive: { backgroundColor: 'rgba(255,255,255,0.18)' },

  // SETUP variant — no docs yet. Friendly tan invite.
  bannerSetup: {
    backgroundColor: '#FFF7ED',
    shadowColor: '#7C2D12',
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  iconWrapSetup: { backgroundColor: 'rgba(124,45,18,0.08)' },
  titleSetup: { color: '#7C2D12' },
  subtitleSetup: { color: '#9A3412' },
});

export default ComplianceRedAlertBanner;

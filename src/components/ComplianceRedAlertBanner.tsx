import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  getComplianceDocs,
  renewComplianceDoc,
  type ComplianceDoc,
} from '../services/api';

/**
 * Home-screen Smart Alert banner.
 *
 * Always renders on Home so every user sees that the FliponeX Smart Alert
 * system exists. Three visual states based on the user's compliance docs:
 *
 *   1. RED — at least one doc in the critical (<30 days) bucket. Sticky
 *      red banner with one-click "Renew via FliponeX" CTA.
 *   2. ACTIVE — has compliance docs but none are red. Soft blue banner
 *      reading "✓ Smart Alert active — monitoring N documents".
 *   3. SETUP — no compliance docs uploaded yet (or user not signed in).
 *      Friendly tan banner inviting them to upload docs to activate the
 *      30-60-90 day expiry alerts.
 *
 * The banner is informational + functional; it never disappears just
 * because the logged-in user changed.
 */
export interface ComplianceRedAlertBannerProps {
  onPress?: () => void;
}

type BannerState = 'loading' | 'red' | 'active' | 'setup';

const ComplianceRedAlertBanner: React.FC<ComplianceRedAlertBannerProps> = ({ onPress }) => {
  const [redDocs, setRedDocs] = useState<ComplianceDoc[]>([]);
  const [totalDocs, setTotalDocs] = useState<number>(0);
  const [state, setState] = useState<BannerState>('loading');
  const [renewing, setRenewing] = useState<boolean>(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getComplianceDocs();
        if (!alive) return;
        const all = res?.data || [];
        const red = all.filter((d) => d.status === 'red');
        setRedDocs(red);
        setTotalDocs(all.length);
        setState(red.length > 0 ? 'red' : all.length > 0 ? 'active' : 'setup');
      } catch (_) {
        // API failed (no auth, network, etc.) — show the setup invite
        // rather than disappearing entirely.
        if (alive) {
          setRedDocs([]);
          setTotalDocs(0);
          setState('setup');
        }
      }
    })();
    return () => { alive = false; };
  }, []);

  // True one-click renewal — fires the renew API for the most-imminent doc
  // without bouncing the user through the Compliance screen first. Backend
  // auto-assigns an active representative and pushes them a lead.
  const handleRenewViaFliponex = async (): Promise<void> => {
    if (renewing || redDocs.length === 0) return;
    // Most-imminent first (smallest daysLeft). Fall back to first item if
    // daysLeft isn't computed.
    const target = [...redDocs].sort(
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
      // Hide the banner now that the lead is filed — user shouldn't see it
      // a second time on the same screen.
      setRedDocs((prev) => prev.filter((d) => d.id !== target.id));
    } catch (e: any) {
      // The renew API helper now extracts the real backend message
      // (e.g. "Document not found" / "Company profile required") into
      // e.message — no more opaque "Request failed with status code".
      // We also offer a fallback CTA to open the Compliance Vault so
      // the user has a clear next step instead of being stuck on the
      // banner.
      Alert.alert(
        'Could not start renewal',
        e?.message || 'Please try again from the Compliance Vault.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open Compliance Vault',
            onPress: () => onPress?.(),
          },
        ],
      );
    } finally {
      setRenewing(false);
    }
  };

  if (state === 'loading') return null;

  // ─── RED state — critical: at least one doc <30 days from expiry ───
  if (state === 'red') {
    const headline =
      redDocs.length === 1
        ? `${redDocs[0].label} expires in ${Math.max(redDocs[0].daysLeft ?? 0, 0)} days`
        : `${redDocs.length} compliance documents are nearing expiry`;

    return (
      <View style={styles.banner} accessibilityRole="alert">
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
          onPress={handleRenewViaFliponex}
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

  // ─── ACTIVE state — has docs, none red. Reassuring "we're watching" tile ───
  if (state === 'active') {
    return (
      <TouchableOpacity
        style={[styles.banner, styles.bannerActive]}
        activeOpacity={0.85}
        onPress={onPress}
        accessibilityRole="button"
      >
        <View style={styles.bannerBody}>
          <View style={[styles.iconWrap, styles.iconWrapActive]}>
            <Text style={styles.icon}>✅</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Smart Alert active</Text>
            <Text style={styles.subtitle} numberOfLines={2}>
              Monitoring {totalDocs} compliance document{totalDocs === 1 ? '' : 's'}.
              We'll notify you 90 / 60 / 30 days before any expiry.
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  // ─── SETUP state — invite the user to upload their first compliance doc ───
  return (
    <TouchableOpacity
      style={[styles.banner, styles.bannerSetup]}
      activeOpacity={0.85}
      onPress={onPress}
      accessibilityRole="button"
    >
      <View style={styles.bannerBody}>
        <View style={[styles.iconWrap, styles.iconWrapSetup]}>
          <Text style={styles.icon}>🛡️</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, styles.titleSetup]}>FliponeX Smart Alert system</Text>
          <Text style={[styles.subtitle, styles.subtitleSetup]} numberOfLines={3}>
            Never miss a compliance renewal. Upload your Factory Licence,
            Fire NOC, GST cert, etc. — we'll alert you 90 / 60 / 30 days
            before each expires.
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#E63946',
    marginHorizontal: 14,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: '#7A1E27',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  bannerBody: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  icon: { fontSize: 20 },
  title: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
    lineHeight: 14,
  },
  cta: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 10,
    alignItems: 'center',
    minHeight: 38,
    justifyContent: 'center',
  },
  ctaDisabled: { opacity: 0.7 },
  ctaText: {
    color: '#E63946',
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 0.4,
  },

  // Active variant — has docs, all healthy. Muted teal so it reads as
  // "informational" rather than "act now".
  bannerActive: {
    backgroundColor: '#0D5E5E',
    shadowColor: '#0A3F3F',
  },
  iconWrapActive: { backgroundColor: 'rgba(255,255,255,0.18)' },

  // Setup variant — no docs yet. Friendly tan, invites action without
  // shouting. Distinct from the red urgency variant so users learn the
  // colour code over time.
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

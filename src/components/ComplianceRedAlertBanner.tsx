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
 * Home-screen Red Alert banner for industrial customers.
 *
 * Pulls the user's compliance docs and surfaces a sticky red banner when any
 * doc is in the critical (<30 days to expiry) bucket. Tapping the banner
 * jumps to the Compliance Vault screen.
 *
 * Spec — 30-day tier: "Action Required Immediately to avoid penalties!"
 *
 * Renders nothing if:
 *   • Compliance API call fails (e.g., user not signed in yet)
 *   • User has no company profile (industrial customer hasn't filled it)
 *   • No docs are red-tier
 */
export interface ComplianceRedAlertBannerProps {
  onPress?: () => void;
}

const ComplianceRedAlertBanner: React.FC<ComplianceRedAlertBannerProps> = ({ onPress }) => {
  const [redDocs, setRedDocs] = useState<ComplianceDoc[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [renewing, setRenewing] = useState<boolean>(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getComplianceDocs();
        if (!alive) return;
        const list = (res?.data || []).filter((d) => d.status === 'red');
        setRedDocs(list);
      } catch (_) {
        // Silent — empty list is the same as "nothing to alert about".
      } finally {
        if (alive) setLoading(false);
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
      Alert.alert(
        'Could not start renewal',
        e?.message || 'Please try again from the Compliance Vault.',
      );
    } finally {
      setRenewing(false);
    }
  };

  if (loading) {
    // Skip showing a spinner — this banner is a peripheral signal. We just
    // wait silently and render once we know the answer.
    return null;
  }
  if (redDocs.length === 0) return null;

  const headline =
    redDocs.length === 1
      ? `${redDocs[0].label} expires in ${Math.max(redDocs[0].daysLeft ?? 0, 0)} days`
      : `${redDocs.length} compliance documents are nearing expiry`;

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <TouchableOpacity
        style={styles.bannerBody}
        activeOpacity={0.85}
        onPress={onPress}
      >
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

      {/* Spec — One-Click Renewal: button right under the alert. Single tap
          books the lead and an agent is auto-assigned to call back. */}
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
});

export default ComplianceRedAlertBanner;

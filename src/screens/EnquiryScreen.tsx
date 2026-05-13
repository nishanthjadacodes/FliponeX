import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { createEnquiry, getCompanyProfile } from '../services/api';
import * as haptics from '../utils/haptics';

interface NavigationProp {
  navigate: (route: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
  replace?: (route: string) => void;
  addListener?: (event: string, cb: () => void) => () => void;
}

interface RouteProp {
  params?: { [key: string]: any };
}

interface Props {
  navigation: NavigationProp;
  route: RouteProp;
}

interface ChecklistGroup {
  match: string[];
  label: string;
  items: string[];
}

// ─── Document checklist from FliponeX B2B framework (section 2) ─────────────
// Key lookups use lowercase includes; first match wins.
const DOC_CHECKLIST: ChecklistGroup[] = [
  {
    match: ['gst', 'tds', 'taxation', 'payroll'],
    label: 'GST & Taxation',
    items: [
      'Bank Statements (last 6 months)',
      'Previous GST / TDS Returns',
      'Digital Signature (DSC)',
    ],
  },
  {
    match: ['fire', 'pollution', 'water', 'noc', 'emergency'],
    label: 'NOC (Fire / Water / Pollution)',
    items: [
      'Approved Building Plans',
      'Site Maps',
      'Safety Certificates',
      'Waste Management Plans',
    ],
  },
  {
    match: ['pollution'],
    label: 'Pollution Control',
    items: [
      'Production Capacity Reports',
      'Raw Material Lists',
    ],
  },
  {
    match: ['factory', 'boiler', 'shop', 'establishment', 'trade', 'license', 'licence'],
    label: 'Trade / Factory License',
    items: [
      'Lease Agreement or Ownership Deed',
      'Recent Electricity Bills',
      'Board Resolution',
    ],
  },
  {
    match: ['iso', 'audit', 'quality'],
    label: 'ISO & Audits',
    items: [
      'Work Process Charts',
      'Quality Manuals',
      'Previous Audit Trails',
    ],
  },
];

const pickChecklist = (serviceName: string = ''): ChecklistGroup[] => {
  const n = serviceName.toLowerCase();
  return DOC_CHECKLIST.filter((c) => c.match.some((kw) => n.includes(kw)));
};

interface UrgencyOption {
  key: string;
  label: string;
  hint: string;
}

const URGENCIES: UrgencyOption[] = [
  { key: 'standard',   label: 'Standard',   hint: 'Normal timeline' },
  { key: 'urgent',     label: 'Urgent',     hint: 'Priority handling' },
  { key: 'fast_track', label: 'Fast Track', hint: '90-minute mode' },
];

const EnquiryScreen: React.FC<Props> = ({ navigation, route }) => {
  const service: any = route?.params?.service;
  const [profile, setProfile] = useState<any>(null);
  const [loadingProfile, setLoadingProfile] = useState<boolean>(true);
  const [notes, setNotes] = useState<string>('');
  const [preferredTime, setPreferredTime] = useState<string>('');
  const [urgency, setUrgency] = useState<string>('standard');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [successOpen, setSuccessOpen] = useState<boolean>(false);
  const [submittedRef, setSubmittedRef] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const res: any = await getCompanyProfile();
        setProfile(res?.data || null);
      } catch (e: any) {
        console.log('profile fetch:', e?.message);
      } finally {
        setLoadingProfile(false);
      }
    })();
  }, []);

  const checklist = pickChecklist(service?.name);

  const submit = async (): Promise<void> => {
    if (!service?.id) {
      Alert.alert('Missing service', 'Please open a service first.');
      return;
    }
    setSubmitting(true);
    try {
      const res: any = await createEnquiry({
        service_id: service.id,
        notes: notes.trim(),
        urgency,
        preferred_contact_time: preferredTime.trim() || null,
      });
      haptics.success();
      // Surface a clean in-app success modal instead of the system
      // Alert dialog. Reads more like a confirmation receipt — better
      // matches the rest of the app's visual language and gives the
      // user a reference number they can quote in support tickets.
      const enquiryId = res?.data?.id || res?.id || '';
      setSubmittedRef(enquiryId ? String(enquiryId).slice(0, 8).toUpperCase() : '—');
      setSuccessOpen(true);
    } catch (e: any) {
      haptics.error();
      Alert.alert('Could not submit', e?.message || 'Please try again in a moment.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!service) {
    return (
      <View style={styles.loadingWrap}>
        <Text style={{ color: '#6C757D' }}>No service selected.</Text>
      </View>
    );
  }
  if (loadingProfile) {
    return <View style={styles.loadingWrap}><ActivityIndicator size="large" color="#E63946" /></View>;
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#F8F9FA' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

        {/* Service banner */}
        <View style={styles.serviceCard}>
          <View style={styles.serviceBadge}><Text style={styles.serviceBadgeText}>QUOTE-BASED · B2B</Text></View>
          <Text style={styles.serviceName}>{service.name}</Text>
          {!!service.category && <Text style={styles.serviceCategory}>{service.category}</Text>}
          {!!service.description && (
            <Text style={styles.serviceDescription} numberOfLines={3}>{service.description}</Text>
          )}
        </View>

        {/* Company Profile snapshot (read-only — edit on Profile tab) */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Your Company</Text>
            <TouchableOpacity onPress={() => navigation.navigate('CompanyProfile')}>
              <Text style={styles.sectionAction}>Edit</Text>
            </TouchableOpacity>
          </View>
          <InfoRow label="Legal Entity" value={profile?.legal_entity_name} />
          <InfoRow label="GSTIN" value={profile?.gstin} />
          <InfoRow label="PoC" value={profile?.poc_name ? `${profile.poc_name} · ${profile.poc_mobile}` : null} />
          <InfoRow label="Factory / Site" value={profile?.factory_address || profile?.registered_address} />
        </View>

        {/* Document checklist (per PDF doc vault mapping) */}
        {checklist.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Documents We'll Ask For</Text>
            <Text style={styles.sectionHint}>
              Keep these ready — a B2B expert will collect them through the Secure Vault after quote acceptance.
            </Text>
            {checklist.map((group) => (
              <View key={group.label} style={styles.docGroup}>
                <Text style={styles.docGroupTitle}>{group.label}</Text>
                {group.items.map((it) => (
                  <View key={it} style={styles.docItemRow}>
                    <Text style={styles.docBullet}>•</Text>
                    <Text style={styles.docItemText}>{it}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}

        {/* Urgency */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Urgency</Text>
          <View style={styles.urgencyRow}>
            {URGENCIES.map((u) => (
              <TouchableOpacity
                key={u.key}
                style={[styles.urgencyChip, urgency === u.key && styles.urgencyChipActive]}
                onPress={() => setUrgency(u.key)}
              >
                <Text style={[styles.urgencyLabel, urgency === u.key && styles.urgencyLabelActive]}>{u.label}</Text>
                <Text style={[styles.urgencyHint,  urgency === u.key && styles.urgencyHintActive]}>{u.hint}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Notes + preferred time */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Scope & Preferences</Text>

          <Text style={styles.label}>Notes for the expert</Text>
          <TextInput
            style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
            placeholder="Briefly describe your requirement — headcount, turnover, renewal dates, specific concerns…"
            placeholderTextColor="#B0B0B0"
            value={notes}
            onChangeText={setNotes}
            multiline
          />

          <Text style={[styles.label, { marginTop: 10 }]}>Preferred contact time</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Mon–Fri, 11 AM – 1 PM"
            placeholderTextColor="#B0B0B0"
            value={preferredTime}
            onChangeText={setPreferredTime}
          />
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
          disabled={submitting}
          onPress={submit}
          activeOpacity={0.85}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.submitBtnText}>Submit Enquiry</Text>}
        </TouchableOpacity>

        <Text style={styles.footNote}>
          A FliponeX Digital expert reviews every enquiry, shares a quote and schedules a call. No charges apply until you accept the quote.
        </Text>

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Success modal — shown after the enquiry is accepted by the
          backend. The user gets a checkmark, a reference number to
          quote in support, and a single CTA back to My Bookings.
          Dismissing the modal also navigates so the user can't get
          stuck on the now-stale form. */}
      <Modal
        visible={successOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setSuccessOpen(false);
          navigation.navigate('MyBookings');
        }}
      >
        <View style={styles.successBackdrop}>
          <View style={styles.successCard}>
            <View style={styles.successIconWrap}>
              <Text style={styles.successIcon}>✓</Text>
            </View>
            <Text style={styles.successTitle}>Quote Requested</Text>
            <Text style={styles.successBody}>
              We&apos;ve received your enquiry for{' '}
              <Text style={styles.successBodyAccent}>{service?.name || 'this service'}</Text>.
              {'\n\n'}
              A FliponeX Digital expert will review the scope and share a quote within
              24 business hours.
            </Text>
            <View style={styles.successRefRow}>
              <Text style={styles.successRefLabel}>Reference</Text>
              <Text style={styles.successRefValue}>#{submittedRef}</Text>
            </View>
            <TouchableOpacity
              style={styles.successCta}
              onPress={() => {
                setSuccessOpen(false);
                navigation.navigate('MyBookings');
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.successCtaText}>View My Enquiries</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
};

interface InfoRowProps {
  label: string;
  value?: string | null;
}

const InfoRow: React.FC<InfoRowProps> = ({ label, value }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue} numberOfLines={2}>{value || '—'}</Text>
  </View>
);

const styles = StyleSheet.create({
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F9FA' },
  container: { padding: 14 },

  serviceCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12,
    borderLeftWidth: 4, borderLeftColor: '#1976D2',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 1,
  },
  serviceBadge: {
    alignSelf: 'flex-start', backgroundColor: '#E3F2FD',
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, marginBottom: 6,
  },
  serviceBadgeText: { fontSize: 9, fontWeight: '800', color: '#1565C0', letterSpacing: 0.5 },
  serviceName: { fontSize: 16, fontWeight: '800', color: '#1A1A1A' },
  serviceCategory: { fontSize: 11, color: '#6C757D', marginTop: 2 },
  serviceDescription: { fontSize: 12, color: '#4A4A4A', marginTop: 6, lineHeight: 17 },

  section: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#1A1A1A' },
  sectionHint: { fontSize: 11, color: '#6C757D', marginBottom: 8, lineHeight: 15 },
  sectionAction: { fontSize: 12, fontWeight: '700', color: '#1976D2' },

  infoRow: { flexDirection: 'row', paddingVertical: 5 },
  infoLabel: { width: 100, fontSize: 11, color: '#6C757D', fontWeight: '700' },
  infoValue: { flex: 1, fontSize: 12, color: '#1A1A1A' },

  docGroup: {
    backgroundColor: '#F8F9FA', borderRadius: 8, padding: 10, marginBottom: 8,
    borderLeftWidth: 3, borderLeftColor: '#00695C',
  },
  docGroupTitle: { fontSize: 12, fontWeight: '800', color: '#00695C', marginBottom: 4 },
  docItemRow: { flexDirection: 'row', paddingVertical: 2 },
  docBullet: { width: 14, color: '#00695C', fontSize: 12 },
  docItemText: { flex: 1, fontSize: 12, color: '#1A1A1A', lineHeight: 16 },

  urgencyRow: { flexDirection: 'row', gap: 8 },
  urgencyChip: {
    flex: 1, padding: 10, borderRadius: 10,
    backgroundColor: '#F8F9FA', borderWidth: 1, borderColor: '#E9ECEF',
    alignItems: 'center',
  },
  urgencyChipActive: { backgroundColor: '#FCE4E6', borderColor: '#E63946' },
  urgencyLabel: { fontSize: 12, fontWeight: '800', color: '#1A1A1A' },
  urgencyLabelActive: { color: '#E63946' },
  urgencyHint: { fontSize: 10, color: '#6C757D', marginTop: 2 },
  urgencyHintActive: { color: '#E63946' },

  label: { fontSize: 11, color: '#6C757D', fontWeight: '700', marginBottom: 3 },
  input: {
    borderWidth: 1, borderColor: '#E9ECEF', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 9, fontSize: 13, color: '#1A1A1A',
    backgroundColor: '#FAFAFA',
  },

  submitBtn: {
    backgroundColor: '#1976D2', paddingVertical: 14, borderRadius: 10,
    alignItems: 'center',
    shadowColor: '#1976D2', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 4,
  },
  submitBtnText: { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 0.3 },

  footNote: {
    fontSize: 11, color: '#6C757D', textAlign: 'center',
    marginTop: 10, paddingHorizontal: 10, lineHeight: 15,
  },

  // ─── Quote-requested success modal ──────────────────────────────────
  successBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8,43,76,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  successCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 26,
    paddingHorizontal: 22,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 12,
  },
  successIconWrap: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  successIcon: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '900',
    lineHeight: 38,
  },
  successTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0D3B66',
    marginBottom: 8,
  },
  successBody: {
    fontSize: 13.5,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 16,
  },
  successBodyAccent: {
    color: '#0D3B66',
    fontWeight: '800',
  },
  successRefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    backgroundColor: '#F1F5F9',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 18,
  },
  successRefLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  successRefValue: {
    fontSize: 14,
    color: '#0D3B66',
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  successCta: {
    width: '100%',
    backgroundColor: '#0D3B66',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  successCtaText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 0.3,
  },
});

export default EnquiryScreen;

import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';

interface PolicySection {
  head: string;
  body: string;
}

const PRIVACY: PolicySection[] = [
  {
    head: 'Our commitment',
    body:
      'FliponeX Digital respects your privacy. We use your documents solely for the requested service. ' +
      'Once the task is concluded, sensitive data is securely purged from our active systems. ' +
      'We never sell your data to third parties.',
  },
  {
    head: 'What we store',
    body:
      'Only what is necessary to complete your booking: identity documents you submit, contact details, ' +
      'service address, payment metadata, and the audit trail of status changes.',
  },
  {
    head: 'How we protect it',
    body:
      'Documents are encrypted at rest and in transit. Access is limited to the representative assigned to your task ' +
      'and the back-office team fulfilling government submissions.',
  },
];

const TERMS: string[] = [
  'Customers must provide original and authentic documents for all applications.',
  'Submission of fraudulent documents will lead to immediate service termination.',
  'Service success is subject to Government portal availability.',
  'Payment is mandatory immediately upon job completion by the representative.',
  'All services are subject to government regulations.',
];

const REFUND: PolicySection[] = [
  {
    head: 'Free Cancellation',
    body: 'Cancel your booking at no cost up to 1 hour before the scheduled slot.',
  },
  {
    head: 'Visiting Fee',
    body:
      'If the representative reaches the location and the service is cancelled by the user, ' +
      'a ₹99 visiting fee will apply.',
  },
  {
    head: 'Refunds',
    body:
      'If a service cannot be completed due to government portal technical errors / downtime, ' +
      'the service fee will be refunded (excluding the nominal visiting charge).',
  },
];

export type PolicyType = 'privacy' | 'terms' | 'refund';

const TITLES: Record<PolicyType, string> = {
  privacy: 'Privacy Policy',
  terms: 'Terms & Conditions',
  refund: 'Refund & Cancellation',
};

export interface PolicyModalProps {
  visible: boolean;
  type?: PolicyType | null;
  onClose: () => void;
}

const PolicyModal: React.FC<PolicyModalProps> = ({ visible, type, onClose }) => {
  const renderBody = () => {
    if (type === 'privacy') {
      return PRIVACY.map((s, i) => (
        <View key={i} style={styles.section}>
          <Text style={styles.sectionHead}>{s.head}</Text>
          <Text style={styles.para}>{s.body}</Text>
        </View>
      ));
    }
    if (type === 'refund') {
      return REFUND.map((s, i) => (
        <View key={i} style={styles.section}>
          <Text style={styles.sectionHead}>{s.head}</Text>
          <Text style={styles.para}>{s.body}</Text>
        </View>
      ));
    }
    return (
      <View style={styles.section}>
        {TERMS.map((t, i) => (
          <View key={i} style={styles.bulletRow}>
            <View style={styles.bulletDot} />
            <Text style={styles.bulletText}>{t}</Text>
          </View>
        ))}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{(type && TITLES[type]) || 'Policy'}</Text>
              <Text style={styles.subtitle}>FliponeX Digital Services</Text>
            </View>
            <TouchableOpacity style={styles.close} onPress={onClose}>
              <Text style={styles.closeText}>×</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>{renderBody()}</ScrollView>

          <TouchableOpacity style={styles.okBtn} onPress={onClose} activeOpacity={0.9}>
            <Text style={styles.okText}>Got it</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,31,63,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 18,
    maxHeight: '86%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E6EEF4',
  },
  title: { fontSize: 20, fontWeight: '900', color: '#003153', letterSpacing: 0.2 },
  subtitle: { fontSize: 11, color: '#1B4B72', marginTop: 2, fontWeight: '600' },
  close: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#E6EEF4',
    alignItems: 'center', justifyContent: 'center',
  },
  closeText: { fontSize: 20, color: '#003153', fontWeight: '700', lineHeight: 22 },

  section: { marginBottom: 16 },
  sectionHead: {
    fontSize: 13,
    fontWeight: '800',
    color: '#F4A100',
    letterSpacing: 0.3,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  para: { fontSize: 13, color: '#003153', lineHeight: 20, fontWeight: '500' },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  bulletDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: '#F4A100',
    marginTop: 7, marginRight: 10,
  },
  bulletText: { flex: 1, fontSize: 13, color: '#003153', lineHeight: 19, fontWeight: '500' },
  okBtn: {
    marginTop: 6,
    backgroundColor: '#003153',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
  },
  okText: { color: '#FCD34D', fontWeight: '800', fontSize: 14, letterSpacing: 0.5 },
});

export default PolicyModal;

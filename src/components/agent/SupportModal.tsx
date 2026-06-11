import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Linking,
  ScrollView,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPPORT_PHONE = '+917482872330';
const WHATSAPP_URL = 'https://wa.me/7482872330';
const SUPPORT_EMAIL = 'support@fliponex.com';
const OFFICE = 'S. No. 11/1, Quepem, South Goa, Goa – 403705';

interface FAQItem {
  q: string;
  a: string;
}

const FAQS: FAQItem[] = [
  {
    q: 'How do I verify my representative ID?',
    a: 'Your Partner ID and profile are verified through the details in your Profile tab. Keep your documents and bank info up to date for faster payouts.',
  },
  {
    q: 'Which payment modes are accepted?',
    a: 'All payments are made online through the company payment gateway — UPI, wallet, card or netbanking. Customers can pay upfront or choose "Pay After Service", where the payment is made online once the work is verified. If a customer prefers cash, the representative may collect it and complete the online payment to the company on the customer\'s behalf. Representative commissions are paid to the bank account in Profile → Bank Details.',
  },
  {
    q: 'Is my payment secure?',
    a: 'Yes. All transactions use encrypted gateways and your documents are purged from active systems once the task is concluded.',
  },
  {
    q: 'Timeline for Aadhaar Services',
    a: 'Most Aadhaar updates are processed within 2–7 working days depending on UIDAI portal availability.',
  },
  {
    q: 'Timeline for PAN Services',
    a: 'New PAN / corrections are typically issued in 5–10 working days (e-PAN same day where supported).',
  },
  {
    q: 'Timeline for Voter Services',
    a: 'Voter ID enrolment and corrections usually take 15–30 days and are subject to BLO verification.',
  },
  {
    q: 'Timeline for other Services',
    a: 'GST registration 3–7 days; Industrial Licensing varies by authority. Expected timelines are shown on each service card.',
  },
];

type TicketCategory = 'Delay' | 'Representative behavior' | 'Task pending' | 'Payment';
const TICKET_CATEGORIES: TicketCategory[] = ['Delay', 'Representative behavior', 'Task pending', 'Payment'];

export interface SupportModalProps {
  visible: boolean;
  onClose: () => void;
}

const SupportModal: React.FC<SupportModalProps> = ({ visible, onClose }) => {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [ticketOpen, setTicketOpen] = useState<boolean>(false);
  const [ticketCategory, setTicketCategory] = useState<TicketCategory>('Delay');
  const [ticketMessage, setTicketMessage] = useState<string>('');

  const call = (): void => { Linking.openURL(`tel:${SUPPORT_PHONE}`).catch(() => {}); };
  const whatsapp = (): void => { Linking.openURL(WHATSAPP_URL).catch(() => {}); };
  const email = (): void => { Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {}); };

  const submitTicket = async (): Promise<void> => {
    if (!ticketMessage.trim() || ticketMessage.trim().length < 10) {
      Alert.alert('Too short', 'Please describe the issue in at least 10 characters.');
      return;
    }
    try {
      const raw = await AsyncStorage.getItem('grievance_tickets');
      const list: unknown[] = raw ? JSON.parse(raw) : [];
      list.unshift({
        id: `T${Date.now()}`,
        category: ticketCategory,
        message: ticketMessage.trim(),
        createdAt: new Date().toISOString(),
        status: 'open',
      });
      await AsyncStorage.setItem('grievance_tickets', JSON.stringify(list.slice(0, 50)));
      Alert.alert(
        'Ticket raised',
        `Reference: T${Date.now().toString().slice(-6)}.\nOur team will reach out on ${SUPPORT_PHONE}.`,
      );
      setTicketMessage('');
      setTicketOpen(false);
    } catch (e) {
      Alert.alert('Error', 'Could not save the ticket locally. Please call support.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Help Center</Text>
              <Text style={styles.subtitle}>Mon–Sat, 9:00 AM – 8:00 PM</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.close}>
              <Text style={styles.closeText}>×</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            <View style={styles.quickRow}>
              <TouchableOpacity style={styles.quickCard} activeOpacity={0.9} onPress={call}>
                <LinearGradient colors={['#001F3F', '#003153']} style={StyleSheet.absoluteFill} />
                <Text style={styles.quickIcon}>{'\u{1F4DE}'}</Text>
                <Text style={styles.quickLabel}>Call</Text>
                <Text style={styles.quickMeta}>+91 7482 872 330</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickCard} activeOpacity={0.9} onPress={whatsapp}>
                <LinearGradient colors={['#F4A100', '#FCD34D']} style={StyleSheet.absoluteFill} />
                <Text style={styles.quickIcon}>{'\u{1F4AC}'}</Text>
                <Text style={[styles.quickLabel, { color: '#003153' }]}>WhatsApp</Text>
                <Text style={[styles.quickMeta, { color: '#003153' }]}>Instant chat</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickCard} activeOpacity={0.9} onPress={email}>
                <LinearGradient colors={['#FCA5A5', '#DC2626']} style={StyleSheet.absoluteFill} />
                <Text style={styles.quickIcon}>{'✉️'}</Text>
                <Text style={styles.quickLabel}>Email</Text>
                <Text style={styles.quickMeta}>support@fliponex.com</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.ticketCta}
              activeOpacity={0.9}
              onPress={() => setTicketOpen((v) => !v)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.ticketTitle}>Raise a Ticket</Text>
                <Text style={styles.ticketSub}>
                  Delays, representative behavior, pending task, or payment issues.
                </Text>
              </View>
              <Text style={styles.ticketArrow}>{ticketOpen ? '▴' : '▾'}</Text>
            </TouchableOpacity>

            {ticketOpen && (
              <View style={styles.ticketBox}>
                <Text style={styles.fieldLabel}>Category</Text>
                <View style={styles.chipRow}>
                  {TICKET_CATEGORIES.map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[styles.chip, ticketCategory === c && styles.chipActive]}
                      onPress={() => setTicketCategory(c)}
                    >
                      <Text
                        style={[styles.chipText, ticketCategory === c && styles.chipTextActive]}
                      >
                        {c}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>Describe the issue</Text>
                <TextInput
                  style={styles.textarea}
                  placeholder="What went wrong? Include booking id if any."
                  placeholderTextColor="#94A3B8"
                  multiline
                  value={ticketMessage}
                  onChangeText={setTicketMessage}
                  maxLength={500}
                />
                <TouchableOpacity style={styles.submitBtn} onPress={submitTicket} activeOpacity={0.9}>
                  <LinearGradient
                    colors={['#001F3F', '#003153', '#1B4B72']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={StyleSheet.absoluteFill}
                  />
                  <Text style={styles.submitText}>Submit Ticket</Text>
                </TouchableOpacity>
              </View>
            )}

            <Text style={styles.sectionLabel}>Frequently Asked</Text>
            {FAQS.map((f, i) => {
              const open = openFaq === i;
              return (
                <View key={i} style={styles.faqCard}>
                  <TouchableOpacity
                    style={styles.faqRow}
                    activeOpacity={0.85}
                    onPress={() => setOpenFaq(open ? null : i)}
                  >
                    <Text style={styles.faqQ}>{f.q}</Text>
                    <Text style={styles.faqArrow}>{open ? '−' : '+'}</Text>
                  </TouchableOpacity>
                  {open && <Text style={styles.faqA}>{f.a}</Text>}
                </View>
              );
            })}

            <View style={styles.officeCard}>
              <Text style={styles.officeLabel}>Corporate Office</Text>
              <Text style={styles.officeValue}>{OFFICE}</Text>
            </View>
          </ScrollView>
        </View>
      </View>
      </KeyboardAvoidingView>
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
    paddingBottom: 12,
    maxHeight: '92%',
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

  quickRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  quickCard: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 10,
    overflow: 'hidden',
    alignItems: 'center',
    shadowColor: '#003153',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  quickIcon: { fontSize: 22, marginBottom: 4 },
  quickLabel: { fontSize: 12, color: '#FFFFFF', fontWeight: '800', letterSpacing: 0.4 },
  quickMeta: { fontSize: 9, color: 'rgba(255,255,255,0.9)', marginTop: 2, fontWeight: '600' },

  ticketCta: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: 14,
    padding: 14,
    marginBottom: 6,
  },
  ticketTitle: { fontSize: 14, fontWeight: '800', color: '#003153', letterSpacing: 0.2 },
  ticketSub: { fontSize: 11, color: '#1B4B72', marginTop: 2, fontWeight: '500' },
  ticketArrow: { fontSize: 18, color: '#003153', fontWeight: '800', marginLeft: 8 },

  ticketBox: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 11, fontWeight: '800', color: '#003153',
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6, marginTop: 4,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 12, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#E6EEF4',
  },
  chipActive: { backgroundColor: '#003153', borderColor: '#003153' },
  chipText: { fontSize: 11, fontWeight: '700', color: '#003153' },
  chipTextActive: { color: '#FCD34D' },
  textarea: {
    minHeight: 70,
    textAlignVertical: 'top',
    borderWidth: 1.5, borderColor: '#E6EEF4',
    borderRadius: 12, padding: 12,
    fontSize: 13, color: '#003153',
    backgroundColor: '#FFFFFF',
    marginBottom: 10,
  },
  submitBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    overflow: 'hidden',
    shadowColor: '#003153',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  submitText: { color: '#FCD34D', fontWeight: '800', fontSize: 13, letterSpacing: 0.5 },

  sectionLabel: {
    fontSize: 11, fontWeight: '800', color: '#1B4B72',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8, marginTop: 8,
  },
  faqCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#E6EEF4',
    borderRadius: 12, marginBottom: 8,
    paddingHorizontal: 12,
  },
  faqRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12,
  },
  faqQ: { flex: 1, fontSize: 13, color: '#003153', fontWeight: '700' },
  faqArrow: { fontSize: 18, color: '#F4A100', fontWeight: '900', marginLeft: 8 },
  faqA: { fontSize: 12, color: '#1B4B72', lineHeight: 17, paddingBottom: 12, fontWeight: '500' },

  officeCard: {
    backgroundColor: '#E6EEF4',
    borderRadius: 12, padding: 12,
    marginTop: 6, marginBottom: 6,
    borderWidth: 1, borderColor: '#003153',
  },
  officeLabel: {
    fontSize: 10, fontWeight: '800', color: '#003153',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4,
  },
  officeValue: { fontSize: 12, color: '#003153', fontWeight: '600', lineHeight: 17 },
});

export default SupportModal;

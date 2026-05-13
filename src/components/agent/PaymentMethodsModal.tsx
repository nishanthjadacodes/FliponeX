import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  ScrollView,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';

const STORAGE_KEY = 'agent_payment_methods';

interface PaymentData {
  upiId: string;
  upiProvider: string;
  walletProvider: string;
  walletMobile: string;
  cashAccepted: boolean;
  notes: string;
}

const empty: PaymentData = {
  upiId: '',
  upiProvider: 'GPay',
  walletProvider: 'Paytm',
  walletMobile: '',
  cashAccepted: true,
  notes: '',
};

const UPI_PROVIDERS = ['GPay', 'PhonePe', 'BHIM', 'Paytm UPI', 'Other'];
const WALLET_PROVIDERS = ['Paytm', 'PhonePe Wallet', 'Amazon Pay', 'None'];

export interface PaymentMethodsModalProps {
  visible: boolean;
  onClose: () => void;
}

const PaymentMethodsModal: React.FC<PaymentMethodsModalProps> = ({ visible, onClose }) => {
  const [data, setData] = useState<PaymentData>(empty);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setData({ ...empty, ...JSON.parse(raw) });
        else setData(empty);
      } catch (e: any) {
        console.log('load payment failed', e?.message);
      }
    })();
  }, [visible]);

  const update = <K extends keyof PaymentData>(k: K, v: PaymentData[K]): void =>
    setData((prev) => ({ ...prev, [k]: v }));

  const save = async (): Promise<void> => {
    if (data.upiId && !/^[\w.\-]+@[\w.\-]+$/.test(data.upiId.trim())) {
      Alert.alert('Invalid UPI', 'Please enter a valid UPI ID (e.g. name@bank).');
      return;
    }
    if (data.walletMobile && !/^[6-9]\d{9}$/.test(data.walletMobile)) {
      Alert.alert('Invalid Number', 'Wallet mobile must be a 10-digit Indian mobile.');
      return;
    }
    setSaving(true);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      Alert.alert('Saved', 'Payment methods updated.');
      onClose();
    } catch (e) {
      Alert.alert('Error', 'Could not save payment methods.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Payment Methods</Text>
            <TouchableOpacity onPress={onClose} style={styles.close}>
              <Text style={styles.closeText}>×</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 6 }}>
            <Text style={styles.sectionLabel}>UPI</Text>
            <View style={styles.chipRow}>
              {UPI_PROVIDERS.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.chip, data.upiProvider === p && styles.chipActive]}
                  onPress={() => update('upiProvider', p)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.chipText, data.upiProvider === p && styles.chipTextActive]}>
                    {p}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.fieldLabel}>UPI ID</Text>
            <TextInput
              style={styles.input}
              placeholder="name@bank"
              placeholderTextColor="#94A3B8"
              value={data.upiId}
              onChangeText={(v) => update('upiId', v.trim())}
              autoCapitalize="none"
            />

            <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Wallet</Text>
            <View style={styles.chipRow}>
              {WALLET_PROVIDERS.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.chip, data.walletProvider === p && styles.chipActive]}
                  onPress={() => update('walletProvider', p)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[styles.chipText, data.walletProvider === p && styles.chipTextActive]}
                  >
                    {p}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Wallet Mobile</Text>
            <TextInput
              style={styles.input}
              placeholder="10-digit mobile linked to wallet"
              placeholderTextColor="#94A3B8"
              keyboardType="phone-pad"
              maxLength={10}
              value={data.walletMobile}
              onChangeText={(v) => update('walletMobile', v.replace(/[^0-9]/g, ''))}
            />

            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Accept Cash on Delivery</Text>
                <Text style={styles.toggleSub}>
                  Customers can hand cash on completion and you settle later.
                </Text>
              </View>
              <Switch
                value={data.cashAccepted}
                onValueChange={(v) => update('cashAccepted', v)}
                trackColor={{ false: '#E5E7EB', true: '#10B981' }}
                thumbColor="#FFFFFF"
              />
            </View>

            <Text style={[styles.fieldLabel, { marginTop: 4 }]}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, { height: 72, textAlignVertical: 'top' }]}
              placeholder="Anything the back-office should know about payouts…"
              placeholderTextColor="#94A3B8"
              multiline
              value={data.notes}
              onChangeText={(v) => update('notes', v)}
            />
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={onClose}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, saving && styles.btnDisabled]}
              onPress={save}
              disabled={saving}
              activeOpacity={0.9}
            >
              <LinearGradient
                colors={['#FCD34D', '#F4A100']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
              <Text style={styles.btnPrimaryText}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  title: { fontSize: 18, fontWeight: '800', color: '#0F172A', letterSpacing: 0.2 },
  close: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#F1F5F9',
    alignItems: 'center', justifyContent: 'center',
  },
  closeText: { fontSize: 20, color: '#475569', fontWeight: '700', lineHeight: 22 },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 8,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  chipActive: { backgroundColor: '#FEF3C7', borderColor: '#F4A100' },
  chipText: { fontSize: 12, color: '#475569', fontWeight: '700' },
  chipTextActive: { color: '#92400E' },

  fieldLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
    marginTop: 4,
  },
  input: {
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
    marginBottom: 10,
    fontWeight: '500',
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, marginBottom: 4 },
  toggleSub: { fontSize: 11, color: '#94A3B8', marginTop: 2 },

  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  btnGhost: { backgroundColor: '#F1F5F9' },
  btnGhostText: { color: '#475569', fontWeight: '700', fontSize: 13 },
  btnPrimary: {
    shadowColor: '#F4A100',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  btnPrimaryText: { color: '#0F172A', fontWeight: '800', fontSize: 14, letterSpacing: 0.3 },
  btnDisabled: { opacity: 0.7 },
});

export default PaymentMethodsModal;

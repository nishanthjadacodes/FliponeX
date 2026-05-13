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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';

const STORAGE_KEY = 'agent_bank_details';

interface BankDetails {
  accountHolder: string;
  bankName: string;
  accountNumber: string;
  confirmAccountNumber: string;
  ifsc: string;
  branch: string;
}

const empty: BankDetails = {
  accountHolder: '',
  bankName: '',
  accountNumber: '',
  confirmAccountNumber: '',
  ifsc: '',
  branch: '',
};

export interface BankDetailsModalProps {
  visible: boolean;
  onClose: () => void;
}

const BankDetailsModal: React.FC<BankDetailsModalProps> = ({ visible, onClose }) => {
  const [data, setData] = useState<BankDetails>(empty);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const d = JSON.parse(raw);
          setData({ ...empty, ...d, confirmAccountNumber: d.accountNumber || '' });
        } else {
          setData(empty);
        }
      } catch (e: any) {
        console.log('load bank failed', e?.message);
      }
    })();
  }, [visible]);

  const update = <K extends keyof BankDetails>(k: K, v: BankDetails[K]): void =>
    setData((prev) => ({ ...prev, [k]: v }));

  const save = async (): Promise<void> => {
    if (!data.accountHolder.trim()) {
      Alert.alert('Required', 'Please enter the account holder name.');
      return;
    }
    if (!data.bankName.trim()) {
      Alert.alert('Required', 'Please enter the bank name.');
      return;
    }
    if (!/^\d{9,18}$/.test(data.accountNumber)) {
      Alert.alert('Invalid Account', 'Account number should be 9–18 digits.');
      return;
    }
    if (data.accountNumber !== data.confirmAccountNumber) {
      Alert.alert('Mismatch', 'Account numbers do not match. Please re-enter.');
      return;
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(data.ifsc.toUpperCase())) {
      Alert.alert('Invalid IFSC', 'IFSC must be 11 characters (e.g. HDFC0001234).');
      return;
    }

    setSaving(true);
    try {
      const { confirmAccountNumber: _confirm, ...toStore } = data;
      const stored = { ...toStore, ifsc: data.ifsc.toUpperCase() };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      Alert.alert('Saved', 'Bank details updated.');
      onClose();
    } catch (e) {
      Alert.alert('Error', 'Could not save bank details.');
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
            <Text style={styles.title}>Bank Details</Text>
            <TouchableOpacity onPress={onClose} style={styles.close}>
              <Text style={styles.closeText}>×</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>Used for commission payouts. Verify carefully.</Text>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 6 }}>
            <Text style={styles.fieldLabel}>Account Holder Name</Text>
            <TextInput
              style={styles.input}
              placeholder="As per bank records"
              placeholderTextColor="#94A3B8"
              value={data.accountHolder}
              onChangeText={(v) => update('accountHolder', v)}
              autoCapitalize="words"
            />

            <Text style={styles.fieldLabel}>Bank Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. HDFC Bank"
              placeholderTextColor="#94A3B8"
              value={data.bankName}
              onChangeText={(v) => update('bankName', v)}
              autoCapitalize="words"
            />

            <Text style={styles.fieldLabel}>Account Number</Text>
            <TextInput
              style={styles.input}
              placeholder="9–18 digits"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
              maxLength={18}
              value={data.accountNumber}
              onChangeText={(v) => update('accountNumber', v.replace(/[^0-9]/g, ''))}
            />

            <Text style={styles.fieldLabel}>Re-enter Account Number</Text>
            <TextInput
              style={styles.input}
              placeholder="Must match the above"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
              maxLength={18}
              value={data.confirmAccountNumber}
              onChangeText={(v) => update('confirmAccountNumber', v.replace(/[^0-9]/g, ''))}
            />

            <Text style={styles.fieldLabel}>IFSC Code</Text>
            <TextInput
              style={[styles.input, { letterSpacing: 1.2 }]}
              placeholder="e.g. HDFC0001234"
              placeholderTextColor="#94A3B8"
              autoCapitalize="characters"
              maxLength={11}
              value={data.ifsc}
              onChangeText={(v) => update('ifsc', v.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
            />

            <Text style={styles.fieldLabel}>Branch (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Hyderabad - Banjara Hills"
              placeholderTextColor="#94A3B8"
              value={data.branch}
              onChangeText={(v) => update('branch', v)}
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
              <Text style={styles.btnPrimaryText}>{saving ? 'Saving…' : 'Save Bank Details'}</Text>
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
    marginBottom: 4,
  },
  title: { fontSize: 18, fontWeight: '800', color: '#0F172A', letterSpacing: 0.2 },
  subtitle: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  close: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#F1F5F9',
    alignItems: 'center', justifyContent: 'center',
  },
  closeText: { fontSize: 20, color: '#475569', fontWeight: '700', lineHeight: 22 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
    marginTop: 6,
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
    marginBottom: 8,
    fontWeight: '500',
  },
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

export default BankDetailsModal;

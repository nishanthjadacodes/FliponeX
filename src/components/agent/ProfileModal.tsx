import { useState, useEffect } from 'react';
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
  FlatList,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SIZES } from '../../constants/agent/colors';
import { INDIAN_STATES, INDIAN_DISTRICTS } from '../../constants/districts';

export interface AgentProfile {
  name: string;
  mobile: string;
  email: string;
  address: string;
  city: string;
  state: string;
  district: string;
  pincode: string;
}

export interface ProfileModalProps {
  visible: boolean;
  onClose: () => void;
  onSave?: (data: AgentProfile) => void;
}

const ProfileModal: React.FC<ProfileModalProps> = ({ visible, onClose, onSave }) => {
  const [agentData, setAgentData] = useState<AgentProfile>({
    name: '',
    mobile: '',
    email: '',
    address: '',
    city: '',
    state: '',
    district: '',
    pincode: '',
  });
  const [loading, setLoading] = useState<boolean>(false);
  // Picker visibility + search state for State / District dropdowns —
  // free-text inputs caused typos that broke admin filtering, so the
  // rep now selects from the same canonical lists used by the customer
  // booking form.
  const [showStatePicker, setShowStatePicker] = useState<boolean>(false);
  const [showDistrictPicker, setShowDistrictPicker] = useState<boolean>(false);
  const [stateSearch, setStateSearch] = useState<string>('');
  const [districtSearch, setDistrictSearch] = useState<string>('');

  useEffect(() => {
    if (visible) {
      loadAgentData();
    }
  }, [visible]);

  const loadAgentData = async (): Promise<void> => {
    try {
      const storedData = await AsyncStorage.getItem('agent_data');
      if (storedData) {
        const data = JSON.parse(storedData);
        setAgentData({
          name: data.name || '',
          mobile: data.mobile || '',
          email: data.email || '',
          address: data.address || '',
          city: data.city || '',
          state: data.state || '',
          district: data.district || '',
          pincode: data.pincode || '',
        });
      }
    } catch (error) {
      console.error('Error loading agent data:', error);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!agentData.name.trim()) {
      Alert.alert('Error', 'Please enter your name');
      return;
    }
    if (!agentData.mobile.trim() || agentData.mobile.length !== 10) {
      Alert.alert('Error', 'Please enter a valid 10-digit mobile number');
      return;
    }
    if (!agentData.email.trim()) {
      Alert.alert('Error', 'Please enter your email');
      return;
    }

    setLoading(true);
    try {
      // Hand the edited fields up to the parent. The parent owns the
      // canonical agent record (with UUID, agent_code, rating, etc.)
      // and writes the merged result back to AsyncStorage. Doing the
      // merge here would re-read potentially-corrupted storage (e.g.
      // from an older build that overwrote the whole blob with just
      // form fields) and lose the UUID — which then breaks repCode().
      if (onSave) onSave(agentData);
      Alert.alert('Success', 'Profile updated successfully!');
      onClose();
    } catch (error) {
      console.error('Error saving profile:', error);
      Alert.alert('Error', 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const updateField = <K extends keyof AgentProfile>(field: K, value: AgentProfile[K]): void => {
    setAgentData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Edit Profile</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>×</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.form}>
            <Text style={styles.label}>Full Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your full name"
              value={agentData.name}
              onChangeText={(value) => updateField('name', value)}
            />

            <Text style={styles.label}>Mobile Number</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter 10-digit mobile number"
              keyboardType="phone-pad"
              maxLength={10}
              value={agentData.mobile}
              onChangeText={(value) => updateField('mobile', value.replace(/[^0-9]/g, ''))}
            />

            <Text style={styles.label}>Email Address</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your email"
              keyboardType="email-address"
              value={agentData.email}
              onChangeText={(value) => updateField('email', value)}
            />

            <Text style={styles.label}>Address</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your address"
              multiline
              numberOfLines={3}
              value={agentData.address}
              onChangeText={(value) => updateField('address', value)}
            />

            <Text style={styles.label}>City</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your city"
              value={agentData.city}
              onChangeText={(value) => updateField('city', value)}
            />

            <Text style={styles.label}>State</Text>
            <TouchableOpacity
              style={[styles.input, styles.pickerInput]}
              onPress={() => setShowStatePicker(true)}
              activeOpacity={0.7}
            >
              <Text
                style={{
                  color: agentData.state ? '#212121' : '#9E9E9E',
                  fontSize: 15,
                  flex: 1,
                }}
              >
                {agentData.state || 'Tap to select your state'}
              </Text>
              <Text style={{ color: '#9E9E9E', fontSize: 18 }}>▾</Text>
            </TouchableOpacity>

            <Text style={styles.label}>District</Text>
            <TouchableOpacity
              style={[styles.input, styles.pickerInput]}
              onPress={() => setShowDistrictPicker(true)}
              activeOpacity={0.7}
            >
              <Text
                style={{
                  color: agentData.district ? '#212121' : '#9E9E9E',
                  fontSize: 15,
                  flex: 1,
                }}
              >
                {agentData.district || 'Tap to select your district'}
              </Text>
              <Text style={{ color: '#9E9E9E', fontSize: 18 }}>▾</Text>
            </TouchableOpacity>

            <Text style={styles.label}>Pincode</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your pincode"
              keyboardType="numeric"
              maxLength={6}
              value={agentData.pincode}
              onChangeText={(value) => updateField('pincode', value.replace(/[^0-9]/g, ''))}
            />
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={onClose}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.saveButton, loading && styles.buttonDisabled]}
            onPress={handleSave}
            disabled={loading}
          >
            <Text style={styles.saveButtonText}>{loading ? 'Saving...' : 'Save Changes'}</Text>
          </TouchableOpacity>
        </View>
      </View>
      </KeyboardAvoidingView>

      {/* State picker — searchable sheet, same UX as the customer
          booking form so reps see a familiar dropdown. */}
      <Modal
        visible={showStatePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowStatePicker(false)}
      >
        <View style={pickerStyles.overlay}>
          <View style={pickerStyles.sheet}>
            <View style={pickerStyles.headerRow}>
              <Text style={pickerStyles.title}>Select your state</Text>
              <TouchableOpacity onPress={() => setShowStatePicker(false)}>
                <Text style={pickerStyles.close}>✕</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={pickerStyles.search}
              value={stateSearch}
              onChangeText={setStateSearch}
              placeholder="Search…"
              autoCorrect={false}
              autoCapitalize="words"
            />
            <FlatList
              data={INDIAN_STATES.filter((s: string) =>
                s.toLowerCase().includes(stateSearch.trim().toLowerCase()),
              )}
              keyExtractor={(item: string) => item}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }: { item: string }) => (
                <TouchableOpacity
                  style={pickerStyles.row}
                  onPress={() => {
                    updateField('state', item);
                    setStateSearch('');
                    setShowStatePicker(false);
                  }}
                >
                  <Text style={pickerStyles.rowText}>{item}</Text>
                  {agentData.state === item && (
                    <Text style={pickerStyles.check}>✓</Text>
                  )}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={pickerStyles.empty}>No matching state.</Text>
              }
            />
          </View>
        </View>
      </Modal>

      {/* District picker — same pattern as the state picker above. */}
      <Modal
        visible={showDistrictPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDistrictPicker(false)}
      >
        <View style={pickerStyles.overlay}>
          <View style={pickerStyles.sheet}>
            <View style={pickerStyles.headerRow}>
              <Text style={pickerStyles.title}>Select your district</Text>
              <TouchableOpacity onPress={() => setShowDistrictPicker(false)}>
                <Text style={pickerStyles.close}>✕</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={pickerStyles.search}
              value={districtSearch}
              onChangeText={setDistrictSearch}
              placeholder="Search district…"
              autoCorrect={false}
              autoCapitalize="words"
            />
            <FlatList
              data={INDIAN_DISTRICTS.filter((d: string) =>
                d.toLowerCase().includes(districtSearch.trim().toLowerCase()),
              )}
              keyExtractor={(item: string) => item}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }: { item: string }) => (
                <TouchableOpacity
                  style={pickerStyles.row}
                  onPress={() => {
                    updateField('district', item);
                    setDistrictSearch('');
                    setShowDistrictPicker(false);
                  }}
                >
                  <Text style={pickerStyles.rowText}>{item}</Text>
                  {agentData.district === item && (
                    <Text style={pickerStyles.check}>✓</Text>
                  )}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={pickerStyles.empty}>No matching district.</Text>
              }
            />
          </View>
        </View>
      </Modal>
    </Modal>
  );
};

const pickerStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    maxHeight: '75%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  title: { fontSize: 17, fontWeight: '800', color: '#0D3B66' },
  close: { fontSize: 22, color: '#64748B', paddingHorizontal: 8 },
  search: {
    borderWidth: 1,
    borderColor: '#E7ECF2',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginVertical: 10,
    backgroundColor: '#F8FAFC',
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  rowText: { fontSize: 15, color: '#1F2937' },
  check: { fontSize: 18, color: '#10B981', fontWeight: '800' },
  empty: { textAlign: 'center', color: '#94A3B8', paddingVertical: 24 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SIZES.padding * 2,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: { fontSize: SIZES.h2, fontWeight: 'bold', color: COLORS.text },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.lightGray,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: { fontSize: SIZES.h2, color: COLORS.textSecondary, fontWeight: 'bold' },
  content: { flex: 1 },
  form: { padding: SIZES.padding * 2 },
  label: { fontSize: SIZES.font, fontWeight: '600', color: COLORS.text, marginBottom: SIZES.base },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: SIZES.radius / 2,
    padding: SIZES.base,
    fontSize: SIZES.font,
    marginBottom: SIZES.padding * 2,
    backgroundColor: COLORS.white,
    color: COLORS.text,
  },
  pickerInput: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footer: {
    flexDirection: 'row',
    padding: SIZES.padding * 2,
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: SIZES.padding,
  },
  button: {
    flex: 1,
    paddingVertical: SIZES.base * 1.5,
    borderRadius: SIZES.radius / 2,
    alignItems: 'center',
  },
  cancelButton: { backgroundColor: COLORS.lightGray },
  cancelButtonText: { color: COLORS.textSecondary, fontSize: SIZES.font, fontWeight: '600' },
  saveButton: { backgroundColor: COLORS.primary },
  saveButtonText: { color: COLORS.white, fontSize: SIZES.font, fontWeight: 'bold' },
  buttonDisabled: { backgroundColor: COLORS.gray },
});

export default ProfileModal;

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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SIZES } from '../../constants/agent/colors';

export interface AgentProfile {
  name: string;
  mobile: string;
  email: string;
  address: string;
  city: string;
  state: string;
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
    pincode: '',
  });
  const [loading, setLoading] = useState<boolean>(false);

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
      await AsyncStorage.setItem('agent_data', JSON.stringify(agentData));
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
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Edit Profile</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>×</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
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
            <TextInput
              style={styles.input}
              placeholder="Enter your state"
              value={agentData.state}
              onChangeText={(value) => updateField('state', value)}
            />

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
    </Modal>
  );
};

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

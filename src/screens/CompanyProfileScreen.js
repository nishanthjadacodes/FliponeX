import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { getCompanyProfile, upsertCompanyProfile } from '../services/api';
import * as haptics from '../utils/haptics';

// Single source of truth for the form layout — easy to extend without
// touching render logic.
const SECTIONS = [
  {
    title: 'Company Profile',
    hint: 'Legal identity and tax registrations',
    fields: [
      { key: 'legal_entity_name', label: 'Legal Entity Name *', placeholder: 'ACME Pvt Ltd' },
      { key: 'entity_type', label: 'Entity Type', placeholder: 'Pvt Ltd / LLP / Partnership' },
      { key: 'brand_name', label: 'Brand Name', placeholder: 'ACME' },
      { key: 'gstin', label: 'GSTIN *', placeholder: '22AAAAA0000A1Z5', auto: 'upper', max: 15 },
      { key: 'pan', label: 'PAN *', placeholder: 'AAAPL1234C', auto: 'upper', max: 10 },
      { key: 'tan', label: 'TAN', placeholder: 'BLRA99999B', auto: 'upper', max: 10 },
      { key: 'cin', label: 'CIN', placeholder: 'U12345KA2020PTC123456', auto: 'upper', max: 21 },
    ],
  },
  {
    title: 'Addresses',
    hint: 'Registered office vs. factory / site location',
    fields: [
      { key: 'registered_address', label: 'Registered Office Address *', placeholder: 'Full address with PIN', multiline: true },
      { key: 'factory_address', label: 'Factory / Site Address', placeholder: 'Leave blank if same as registered', multiline: true },
    ],
  },
  {
    title: 'Key Decision Maker',
    hint: 'Director / owner who signs off',
    fields: [
      { key: 'kdm_name', label: 'Name *', placeholder: 'Full name' },
      { key: 'kdm_designation', label: 'Designation', placeholder: 'Director' },
      { key: 'kdm_mobile', label: 'Mobile *', placeholder: '9876543210', keyboard: 'phone-pad', max: 10 },
      { key: 'kdm_email', label: 'Email', placeholder: 'director@acme.com', keyboard: 'email-address' },
    ],
  },
  {
    title: 'Point of Contact',
    hint: 'Day-to-day contact for our field agents',
    fields: [
      { key: 'poc_name', label: 'Name *', placeholder: 'Full name' },
      { key: 'poc_designation', label: 'Designation', placeholder: 'Admin Manager / HR' },
      { key: 'poc_mobile', label: 'Mobile *', placeholder: '9876543210', keyboard: 'phone-pad', max: 10 },
      { key: 'poc_email', label: 'Email', placeholder: 'ops@acme.com', keyboard: 'email-address' },
    ],
  },
  {
    title: 'Industrial Classification',
    hint: 'Helps us match compliance timelines correctly',
    fields: [
      { key: 'msme_category', label: 'MSME Category', placeholder: 'none / micro / small / medium', auto: 'lower' },
      { key: 'nic_code', label: 'NIC Code', placeholder: '5-digit code', keyboard: 'number-pad', max: 5 },
    ],
  },
];

const EMPTY = Object.fromEntries(
  SECTIONS.flatMap((s) => s.fields.map((f) => [f.key, '']))
);

const CompanyProfileScreen = ({ navigation, route }) => {
  const afterSaveAction = route?.params?.afterSave; // 'goBack' | 'nda' | undefined
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const res = await getCompanyProfile();
      if (res?.data) {
        // Existing profile — hydrate the form
        const d = res.data;
        setForm({ ...EMPTY, ...Object.fromEntries(
          Object.entries(d).map(([k, v]) => [k, v == null ? '' : String(v)])
        ) });
      }
    } catch (e) {
      console.log('load profile:', e);
    } finally {
      setLoading(false);
    }
  };

  const setField = (key, value, auto, max) => {
    let v = value;
    if (auto === 'upper') v = v.toUpperCase();
    if (auto === 'lower') v = v.toLowerCase();
    if (max) v = v.slice(0, max);
    setForm((p) => ({ ...p, [key]: v }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await upsertCompanyProfile(form);
      haptics.success();
      if (afterSaveAction === 'nda') {
        navigation.replace('NDA');
      } else {
        Alert.alert('Saved', 'Your company profile has been updated.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      }
    } catch (e) {
      haptics.error();
      Alert.alert('Validation failed', e.message || 'Please check your input.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color="#E63946" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#F8F9FA' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.pageHint}>
          Used for industrial bookings, invoices and statutory filings. Starred fields are mandatory.
        </Text>

        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.sectionHint}>{section.hint}</Text>
            {section.fields.map((f) => (
              <View key={f.key} style={styles.fieldWrap}>
                <Text style={styles.label}>{f.label}</Text>
                <TextInput
                  style={[styles.input, f.multiline && { minHeight: 72, textAlignVertical: 'top' }]}
                  value={form[f.key]}
                  onChangeText={(v) => setField(f.key, v, f.auto, f.max)}
                  placeholder={f.placeholder}
                  placeholderTextColor="#B0B0B0"
                  multiline={!!f.multiline}
                  keyboardType={f.keyboard || 'default'}
                  autoCapitalize={f.auto === 'upper' ? 'characters' : 'none'}
                  maxLength={f.max}
                />
              </View>
            ))}
          </View>
        ))}

        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={save}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveBtnText}>
                {afterSaveAction === 'nda' ? 'Save & Continue to NDA' : 'Save Profile'}
              </Text>}
        </TouchableOpacity>

        <View style={{ height: 24 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F9FA' },
  container: { padding: 14 },
  pageHint: {
    fontSize: 12, color: '#6C757D', marginBottom: 12, lineHeight: 17,
    backgroundColor: '#FFF8E1', borderLeftWidth: 3, borderLeftColor: '#F9A825',
    padding: 10, borderRadius: 6,
  },
  section: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#1A1A1A' },
  sectionHint: { fontSize: 11, color: '#6C757D', marginTop: 2, marginBottom: 10 },
  fieldWrap: { marginBottom: 8 },
  label: { fontSize: 11, color: '#6C757D', fontWeight: '700', marginBottom: 3 },
  input: {
    borderWidth: 1, borderColor: '#E9ECEF', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 9, fontSize: 13, color: '#1A1A1A',
    backgroundColor: '#FAFAFA',
  },
  saveBtn: {
    backgroundColor: '#1976D2', paddingVertical: 14, borderRadius: 10,
    alignItems: 'center', marginTop: 6,
    shadowColor: '#1976D2', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 4,
  },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 0.3 },
});

export default CompanyProfileScreen;

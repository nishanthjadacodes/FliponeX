import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { getMyDocuments, uploadKYCDocument } from '../services/api';
import SuccessToast from '../components/SuccessToast';
import * as haptics from '../utils/haptics';

const DOC_TYPES = [
  { key: 'aadhaar_front',  label: 'Aadhaar (Front)',  icon: '🆔', desc: 'Front side of your Aadhaar card', required: true },
  { key: 'aadhaar_back',   label: 'Aadhaar (Back)',   icon: '🪪', desc: 'Back side of your Aadhaar card',  required: true },
  { key: 'pan_card',       label: 'PAN Card',         icon: '💳', desc: 'Clear photo of your PAN card',     required: true },
  { key: 'profile_photo',  label: 'Profile Photo',    icon: '📸', desc: 'Recent passport-size photo',       required: true },
  { key: 'address_proof',  label: 'Address Proof',    icon: '📋', desc: 'Utility bill / bank statement',    required: false },
];

const DocumentsScreen = () => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState({});
  const [loadError, setLoadError] = useState(null);
  const [toast, setToast] = useState({ visible: false, title: '', subtitle: '', variant: 'success' });

  const showToast = (title, subtitle, variant = 'success') =>
    setToast({ visible: true, title, subtitle, variant });

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      setLoadError(null);
      const response = await getMyDocuments();
      // Backend may return { data: [...] } or [...] directly
      const list = Array.isArray(response) ? response : (response.data || []);
      setDocuments(list);
    } catch (error) {
      console.log('Documents load error:', error?.message);
      // Don't show alert — just show empty state with retry option
      setLoadError(error?.message || 'Could not load documents');
      setDocuments([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => { setRefreshing(true); loadDocuments(); };

  const handleUpload = async (docType) => {
    try {
      haptics.tap();
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showToast('Permission Needed', 'Please allow access to photos to upload', 'error');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      setUploading(prev => ({ ...prev, [docType.key]: true }));

      try {
        await uploadKYCDocument(docType.key, {
          uri: asset.uri,
          type: 'image/jpeg',
          name: `${docType.key}_${Date.now()}.jpg`,
        });
        showToast('Uploaded!', `${docType.label} added to your profile`, 'success');
        await loadDocuments();
      } catch (uploadErr) {
        console.log('Upload error:', uploadErr?.message);
        showToast('Upload Failed', 'Please try again in a moment', 'error');
      } finally {
        setUploading(prev => ({ ...prev, [docType.key]: false }));
      }
    } catch (error) {
      console.log('Picker error:', error?.message);
      setUploading(prev => ({ ...prev, [docType.key]: false }));
      showToast('Could Not Open', 'Photo picker failed to open', 'error');
    }
  };

  const getStatus = (doc) => {
    if (!doc) return { label: 'Not Uploaded', color: '#9E9E9E', bg: '#F0F2F5', icon: '○' };
    const s = doc.status || 'pending';
    if (s === 'verified') return { label: 'Verified',  color: '#28A745', bg: '#E8F5E9', icon: '✓' };
    if (s === 'pending')  return { label: 'In Review', color: '#F9A825', bg: '#FFF8E1', icon: '⏳' };
    if (s === 'rejected') return { label: 'Rejected',  color: '#E63946', bg: '#FCE4E6', icon: '✕' };
    return { label: 'Uploaded', color: '#1976D2', bg: '#E3F2FD', icon: '⬆' };
  };

  const requiredCount = DOC_TYPES.filter(t => t.required).length;
  const completedRequired = DOC_TYPES.filter(t => t.required && documents.find(d => d.document_type === t.key)).length;
  const progressPct = requiredCount > 0 ? (completedRequired / requiredCount) * 100 : 0;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#E63946" />
        <Text style={styles.loadingText}>Loading documents...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#E63946']} />}
      >
        {/* Brand header with progress */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Documents</Text>
          <Text style={styles.headerSubtitle}>
            Upload your KYC documents to verify your account
          </Text>

          <View style={styles.progressBox}>
            <View style={styles.progressRow}>
              <Text style={styles.progressLabel}>KYC Progress</Text>
              <Text style={styles.progressValue}>{completedRequired} / {requiredCount}</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
            </View>
            <Text style={styles.progressHint}>
              {progressPct === 100 ? '🎉 All required documents uploaded!' : `${requiredCount - completedRequired} more required`}
            </Text>
          </View>
        </View>

        {/* Documents list */}
        <View style={styles.docList}>
          {DOC_TYPES.map((docType) => {
            const doc = documents.find(d => d.document_type === docType.key);
            const status = getStatus(doc);
            const isUploading = uploading[docType.key];

            return (
              <View key={docType.key} style={styles.docCard}>
                {/* Left: icon */}
                <View style={[styles.docIconBox, { backgroundColor: status.bg }]}>
                  <Text style={styles.docIconEmoji}>{docType.icon}</Text>
                </View>

                {/* Middle: name + status */}
                <View style={styles.docMiddle}>
                  <View style={styles.docTitleRow}>
                    <Text style={styles.docTitle}>{docType.label}</Text>
                    {docType.required && (
                      <View style={styles.requiredBadge}>
                        <Text style={styles.requiredBadgeText}>Required</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.docDesc} numberOfLines={1}>{docType.desc}</Text>
                  <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
                    <Text style={[styles.statusPillText, { color: status.color }]}>
                      {status.icon} {status.label}
                    </Text>
                  </View>
                </View>

                {/* Right: action */}
                <TouchableOpacity
                  style={[styles.uploadBtn, doc && styles.uploadBtnSecondary]}
                  onPress={() => handleUpload(docType)}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <ActivityIndicator size="small" color={doc ? '#E63946' : '#fff'} />
                  ) : (
                    <Text style={[styles.uploadBtnText, doc && styles.uploadBtnTextSecondary]}>
                      {doc ? 'Replace' : 'Upload'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            );
          })}
        </View>

        {/* Help footer */}
        <View style={styles.footer}>
          <Text style={styles.footerIcon}>🔒</Text>
          <Text style={styles.footerText}>
            All documents are encrypted and stored securely.{'\n'}
            Visible only to verified service partners.
          </Text>
        </View>

        {loadError && (
          <TouchableOpacity style={styles.errorBanner} onPress={loadDocuments}>
            <Text style={styles.errorBannerIcon}>⚠️</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.errorBannerTitle}>Could not load saved documents</Text>
              <Text style={styles.errorBannerSubtitle}>Tap to retry — uploads will still work</Text>
            </View>
          </TouchableOpacity>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>

      <SuccessToast
        visible={toast.visible}
        title={toast.title}
        subtitle={toast.subtitle}
        variant={toast.variant}
        onHide={() => setToast({ ...toast, visible: false })}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8F9FA' },
  loadingText: { marginTop: 12, color: '#6C757D', fontSize: 14 },

  // Header
  header: {
    backgroundColor: '#E63946',
    paddingTop: 30,
    paddingBottom: 24,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 4 },
  headerSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.9)', marginBottom: 18 },
  progressBox: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 14,
    padding: 14,
  },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  progressLabel: { color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  progressValue: { color: '#fff', fontSize: 14, fontWeight: '800' },
  progressTrack: { height: 8, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 4, overflow: 'hidden', marginBottom: 8 },
  progressFill: { height: '100%', backgroundColor: '#FFC107', borderRadius: 4 },
  progressHint: { color: 'rgba(255,255,255,0.9)', fontSize: 11 },

  // Document list
  docList: { padding: 14 },
  docCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  docIconBox: {
    width: 48, height: 48, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  docIconEmoji: { fontSize: 22 },
  docMiddle: { flex: 1 },
  docTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  docTitle: { fontSize: 14, fontWeight: '800', color: '#1A1A1A' },
  requiredBadge: {
    marginLeft: 6,
    backgroundColor: '#FCE4E6',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  requiredBadgeText: { fontSize: 9, color: '#E63946', fontWeight: '800' },
  docDesc: { fontSize: 11, color: '#6C757D', marginBottom: 5 },
  statusPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusPillText: { fontSize: 10, fontWeight: '700' },

  // Upload button
  uploadBtn: {
    backgroundColor: '#E63946',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    minWidth: 78,
    alignItems: 'center',
  },
  uploadBtnSecondary: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#E63946',
  },
  uploadBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  uploadBtnTextSecondary: { color: '#E63946' },

  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 14,
    padding: 14,
    backgroundColor: '#F0F2F5',
    borderRadius: 12,
  },
  footerIcon: { fontSize: 20, marginRight: 10 },
  footerText: { flex: 1, fontSize: 11, color: '#6C757D', lineHeight: 16 },

  errorBanner: {
    flexDirection: 'row',
    margin: 14,
    padding: 12,
    backgroundColor: '#FFF8E1',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FFE082',
    alignItems: 'center',
  },
  errorBannerIcon: { fontSize: 22, marginRight: 10 },
  errorBannerTitle: { fontSize: 13, fontWeight: '800', color: '#5D4037' },
  errorBannerSubtitle: { fontSize: 11, color: '#8D6E63', marginTop: 2 },
});

export default DocumentsScreen;

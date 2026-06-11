import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
  Modal,
  Alert,
} from 'react-native';
import { captureWithCrop, pickWithCrop } from '../utils/cropPicker';
import { getMyDocuments, uploadKYCDocument } from '../services/api';
import { useRefetchOnFocus } from '../lib/useRefetchOnFocus';
import SuccessToast from '../components/SuccessToast';
import DocPreviewModal from '../components/DocPreviewModal';
import * as haptics from '../utils/haptics';

interface DocType {
  key: string;
  label: string;
  icon: string;
  desc: string;
  required: boolean;
}

interface DocumentItem {
  document_type?: string;
  status?: string;
  file_url?: string;
  [key: string]: any;
}

interface ToastState {
  visible: boolean;
  title: string;
  subtitle: string;
  variant: 'success' | 'error' | string;
}

interface PendingUpload {
  docType: DocType;
  asset: { uri: string; [key: string]: any };
}

interface StatusInfo {
  label: string;
  color: string;
  bg: string;
  icon: string;
}

const DOC_TYPES: DocType[] = [
  { key: 'aadhaar_front',  label: 'Aadhaar (Front)',  icon: '🆔', desc: 'Front side of your Aadhaar card', required: true },
  { key: 'aadhaar_back',   label: 'Aadhaar (Back)',   icon: '🪪', desc: 'Back side of your Aadhaar card',  required: true },
  { key: 'pan_card',       label: 'PAN Card',         icon: '💳', desc: 'Clear photo of your PAN card',     required: true },
  { key: 'profile_photo',  label: 'Profile Photo',    icon: '📸', desc: 'Recent passport-size photo',       required: true },
  { key: 'address_proof',  label: 'Address Proof',    icon: '📋', desc: 'Utility bill / bank statement',    required: false },
];

// Fetches the KYC document list. Backend may return { data: [...] }
// or a bare array.
const fetchDocuments = async (): Promise<DocumentItem[]> => {
  const response: any = await getMyDocuments();
  return Array.isArray(response) ? response : (response?.data || []);
};

const DocumentsScreen: React.FC = () => {
  // Documents fetched + cached by TanStack Query.
  const {
    data: documents = [],
    isLoading: loading,
    isFetching: refreshing,
    error: queryError,
    refetch,
  } = useQuery({ queryKey: ['documents'], queryFn: fetchDocuments });
  const loadError = queryError
    ? ((queryError as any)?.message || 'Could not load documents')
    : null;

  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<ToastState>({ visible: false, title: '', subtitle: '', variant: 'success' });

  const showToast = (title: string, subtitle: string, variant: string = 'success'): void =>
    setToast({ visible: true, title, subtitle, variant });

  // Two-phase upload state.
  // pendingUpload  → { docType, asset } shown in the preview modal until
  //                  the user taps Submit. Cancelling drops the picked
  //                  image without uploading anything.
  // previewDoc     → an already-uploaded doc the user tapped to inspect.
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [previewDoc, setPreviewDoc] = useState<DocumentItem | null>(null);

  // loadDocuments() is now refetch() from the query above.
  const onRefresh = useCallback((): void => {
    refetch();
  }, [refetch]);
  useRefetchOnFocus(onRefresh);

  // Phase 1 — open picker (gallery / camera) with the styled crop UI
  // (react-native-image-crop-picker → UCrop on Android). Cropper has a
  // branded toolbar + a clearly-coloured confirm tick, replacing
  // Android's plain "CROP" text overlay that customers struggled with.
  // The picked asset is held in state + shown in a preview modal until
  // they tap Submit.
  const pickFromGallery = async (docType: DocType): Promise<void> => {
    try {
      haptics.tap();
      const file = await pickWithCrop({ namePrefix: `kyc_${docType.key}` });
      if (!file) return;
      // Wrap into the same { uri, mimeType, fileName } shape the rest
      // of this screen expects so we don't have to touch the upload /
      // preview rendering downstream.
      setPendingUpload({
        docType,
        asset: { uri: file.uri, mimeType: file.type, fileName: file.name } as any,
      });
    } catch (e: any) {
      console.log('gallery pick error:', e?.message);
      showToast('Could Not Open', 'Photo picker failed to open', 'error');
    }
  };

  const pickFromCamera = async (docType: DocType): Promise<void> => {
    try {
      haptics.tap();
      const file = await captureWithCrop({ namePrefix: `kyc_${docType.key}` });
      if (!file) return;
      setPendingUpload({
        docType,
        asset: { uri: file.uri, mimeType: file.type, fileName: file.name } as any,
      });
    } catch (e: any) {
      console.log('camera pick error:', e?.message);
      showToast('Could Not Open', 'Camera failed to open', 'error');
    }
  };

  const handleUpload = (docType: DocType): void => {
    Alert.alert(
      `Add ${docType.label}`,
      'How would you like to capture this document?',
      [
        { text: '📷 Take Photo', onPress: () => pickFromCamera(docType) },
        { text: '🖼 Choose from Gallery', onPress: () => pickFromGallery(docType) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  // Phase 2 — fire the actual upload. Only triggered when the user taps
  // Submit on the preview sheet (or Cancel to drop the pending pick).
  const submitPendingUpload = async (): Promise<void> => {
    if (!pendingUpload || submitting) return;
    const { docType, asset } = pendingUpload;
    setSubmitting(true);
    setUploading((prev) => ({ ...prev, [docType.key]: true }));
    try {
      await uploadKYCDocument(docType.key, {
        uri: asset.uri,
        type: 'image/jpeg',
        name: `${docType.key}_${Date.now()}.jpg`,
      });
      setPendingUpload(null);
      showToast('Uploaded!', `${docType.label} added to your profile`, 'success');
      await refetch();
    } catch (uploadErr: any) {
      console.log('Upload error:', uploadErr?.message);
      showToast('Upload Failed', uploadErr?.message || 'Please try again', 'error');
    } finally {
      setSubmitting(false);
      setUploading((prev) => ({ ...prev, [docType.key]: false }));
    }
  };

  const cancelPendingUpload = (): void => {
    if (submitting) return;
    setPendingUpload(null);
  };

  const getStatus = (doc?: DocumentItem): StatusInfo => {
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
          <Text style={styles.headerTitle}>My KYC Documents</Text>
          <Text style={styles.headerSubtitle}>
            Upload your identity proofs (Aadhaar, PAN, Photo, Address)
            so your account is verified before booking any service.
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

            const fileUrl = doc?.file_url;
            return (
              <View key={docType.key} style={styles.docCard}>
                {/* Left: thumbnail of uploaded doc (tappable to preview) or
                    fallback emoji icon if nothing uploaded yet. */}
                {fileUrl ? (
                  <TouchableOpacity
                    onPress={() => setPreviewDoc(doc as DocumentItem)}
                    activeOpacity={0.8}
                  >
                    <Image source={{ uri: fileUrl }} style={styles.docThumb} />
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.docIconBox, { backgroundColor: status.bg }]}>
                    <Text style={styles.docIconEmoji}>{docType.icon}</Text>
                  </View>
                )}

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
          <TouchableOpacity style={styles.errorBanner} onPress={() => refetch()}>
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
        variant={toast.variant as any}
        onHide={() => setToast({ ...toast, visible: false })}
      />

      {/* Phase-2 sheet — shown after the user picks + crops an image, gives
          them a clear chance to confirm before the upload actually fires. */}
      <Modal
        visible={!!pendingUpload}
        transparent
        animationType="slide"
        onRequestClose={cancelPendingUpload}
      >
        <View style={styles.previewOverlay}>
          <View style={styles.previewSheet}>
            <Text style={styles.previewTitle}>
              Preview {pendingUpload?.docType?.label || ''}
            </Text>
            <Text style={styles.previewHint}>
              Looks good? Tap Submit to upload, or Cancel to pick a different image.
            </Text>
            {pendingUpload?.asset?.uri && (
              <Image
                source={{ uri: pendingUpload.asset.uri }}
                style={styles.previewImage}
                resizeMode="contain"
              />
            )}
            {/* In-app Crop buttons removed — system picker handles
                cropping (`allowsEditing: true`). */}
            <View style={styles.previewActions}>
              <TouchableOpacity
                style={[styles.previewBtn, styles.previewBtnGhost]}
                onPress={cancelPendingUpload}
                disabled={submitting}
              >
                <Text style={styles.previewBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.previewBtn, styles.previewBtnPrimary, submitting && { opacity: 0.6 }]}
                onPress={submitPendingUpload}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.previewBtnPrimaryText}>Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Inspect-an-already-uploaded doc — full-screen image / PDF preview. */}
      <DocPreviewModal
        visible={!!previewDoc}
        doc={previewDoc}
        onClose={() => setPreviewDoc(null)}
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
  // Thumbnail of the uploaded image — replaces the emoji icon once the
  // user has uploaded the document. Tappable → opens DocPreviewModal.
  docThumb: {
    width: 48, height: 48, borderRadius: 12,
    marginRight: 12, backgroundColor: '#ECEFF1',
  },
  // Phase-2 confirm sheet
  previewOverlay: {
    flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)',
  },
  previewSheet: {
    backgroundColor: '#fff', padding: 18,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '85%',
  },
  previewTitle: { fontSize: 17, fontWeight: '800', color: '#1A1A1A', marginBottom: 4 },
  previewHint: { fontSize: 12, color: '#6C757D', marginBottom: 14 },
  // Wrapper so we can absolutely-position the floating Crop pill on
  // top of the image.
  previewImageWrap: {
    position: 'relative',
    width: '100%',
    marginBottom: 16,
  },
  previewImage: {
    width: '100%', height: 360, borderRadius: 12, backgroundColor: '#F0F2F5',
  },
  // Floating Crop button in top-right of the image — bright green with
  // a white border + drop shadow so it's visible on any image.
  previewCropOverlay: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: '#10B981',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 8,
  },
  previewCropOverlayText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  previewActions: { flexDirection: 'row', gap: 10 },
  previewBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  previewBtnGhost: { backgroundColor: '#F0F2F5' },
  previewBtnGhostText: { color: '#37474F', fontWeight: '700', fontSize: 14 },
  // Secondary crop button in the action row (in addition to the
  // overlay) so the user can reach it from either spot.
  previewBtnCrop: { backgroundColor: '#10B981' },
  previewBtnCropText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  previewBtnPrimary: { backgroundColor: '#E63946' },
  previewBtnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
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

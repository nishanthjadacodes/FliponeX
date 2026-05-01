import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  StatusBar,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
// expo-file-system v18 split the API — `cacheDirectory` + the resumable
// downloader live under the legacy export. Cast to any so our usage works
// across the version range without fighting the new typed API.
import * as FileSystem from 'expo-file-system';
const FS: any = FileSystem;
import DocPreviewModal from '../components/DocPreviewModal';
import { Image as RNImage } from 'react-native';
import * as Sharing from 'expo-sharing';
import { COLORS, BORDER_RADIUS, SHADOWS } from '../constants/colors';
import {
  getComplianceDocs,
  uploadComplianceDoc,
  renewComplianceDoc,
  type ComplianceDoc,
  type ComplianceType,
} from '../services/api';
import { getToken } from '../utils/storage';
import SuccessToast from '../components/SuccessToast';
import * as haptics from '../utils/haptics';

// Defensive load — expo-document-picker is a native module and may not be
// available until the dev-client is rebuilt. The booking screen uses the same
// pattern so the bundle keeps resolving in older builds.
let DocumentPicker: any = null;
try {
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  DocumentPicker = require('expo-document-picker');
} catch (_) {
  DocumentPicker = null;
}
const documentPickerAvailable =
  DocumentPicker && typeof DocumentPicker?.getDocumentAsync === 'function';

interface NavigationProp {
  navigate: (route: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
}

interface Props {
  navigation: NavigationProp;
}

interface PickedFile {
  uri: string;
  name: string;
  type: string;
}

const COMPLIANCE_TYPES: { value: ComplianceType; label: string }[] = [
  { value: 'factory_license', label: 'Factory License' },
  { value: 'fire_noc', label: 'Fire NOC' },
  { value: 'pollution_noc', label: 'Pollution NOC' },
  { value: 'gst_certificate', label: 'GST' },
  { value: 'incorporation', label: 'Incorporation' },
  { value: 'iso_cert', label: 'ISO' },
  { value: 'trade_license', label: 'Trade License' },
  { value: 'esi_pf', label: 'ESI/PF' },
  { value: 'other', label: 'Other' },
];

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const formatExpiry = (iso: string): string => {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return `expires ${d.getDate()} ${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return iso;
  }
};

const formatBytes = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const monthKey = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const statusColor = (s: ComplianceDoc['status']): string => {
  if (s === 'red') return COLORS.ERROR;
  if (s === 'yellow') return COLORS.WARNING;
  return COLORS.SUCCESS;
};

const statusEmoji = (s: ComplianceDoc['status']): string => {
  if (s === 'red') return '🚨';
  if (s === 'yellow') return '⏳';
  return '✅';
};

const ComplianceScreen: React.FC<Props> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  // Auth-header passed to RN's <Image source={{uri,headers}}> so the inline
  // thumbnail loads the protected /api/compliance/:id/download URL directly
  // without a separate fetch. Derived once on mount.
  const [imgAuthHeader, setImgAuthHeader] = useState<{ Authorization: string } | null>(null);
  useEffect(() => {
    (async () => {
      const t = await getToken();
      if (t) setImgAuthHeader({ Authorization: `Bearer ${t}` });
    })();
  }, []);
  const [docs, setDocs] = useState<ComplianceDoc[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [needsCompanyProfile, setNeedsCompanyProfile] = useState<boolean>(false);

  const [uploadOpen, setUploadOpen] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [renewingId, setRenewingId] = useState<string | null>(null);

  // Upload form state
  const [pickedType, setPickedType] = useState<ComplianceType>('factory_license');
  const [expiryDate, setExpiryDate] = useState<Date>(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d;
  });
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [note, setNote] = useState<string>('');

  // Toast state
  const [toast, setToast] = useState<{
    visible: boolean;
    title: string;
    subtitle?: string;
    variant: 'success' | 'error' | 'info';
  }>({ visible: false, title: '', subtitle: '', variant: 'success' });

  // Refs to scroll list to a section when a calendar month is tapped
  const scrollRef = useRef<ScrollView | null>(null);
  const sectionPositions = useRef<Record<string, number>>({});

  const showToast = (
    title: string,
    subtitle: string,
    variant: 'success' | 'error' | 'info' = 'success',
  ): void => {
    setToast({ visible: true, title, subtitle, variant });
  };

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await getComplianceDocs();
      setDocs(Array.isArray(res?.data) ? res.data : []);
      setNeedsCompanyProfile(!!res?.needsCompanyProfile);
    } catch (e: any) {
      console.log('Compliance load error:', e?.message || e);
      setDocs([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = (): void => {
    setRefreshing(true);
    load();
  };

  // Group docs by status, sorted within group by daysLeft (most urgent first).
  const grouped = useMemo(() => {
    const sorter = (a: ComplianceDoc, b: ComplianceDoc) =>
      (a.daysLeft ?? 0) - (b.daysLeft ?? 0);
    return {
      red: docs.filter((d) => d.status === 'red').sort(sorter),
      yellow: docs.filter((d) => d.status === 'yellow').sort(sorter),
      green: docs.filter((d) => d.status === 'green').sort(sorter),
    };
  }, [docs]);

  // Build a 12-month visual calendar starting from this month.
  const calendar = useMemo(() => {
    const months: { key: string; label: string; year: number; status: ComplianceDoc['status'] | null }[] = [];
    const now = new Date();
    const docMonths: Record<string, ComplianceDoc['status']> = {};
    docs.forEach((d) => {
      const k = monthKey(d.expiry_date);
      if (!k) return;
      // Most urgent wins (red > yellow > green).
      const existing = docMonths[k];
      if (!existing || d.status === 'red' || (d.status === 'yellow' && existing === 'green')) {
        docMonths[k] = d.status;
      }
    });
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push({
        key: k,
        label: MONTH_LABELS[d.getMonth()],
        year: d.getFullYear(),
        status: docMonths[k] || null,
      });
    }
    return months;
  }, [docs]);

  const onMonthTap = (key: string): void => {
    // Find the first doc whose section contains this month and scroll to it.
    const target = docs.find((d) => monthKey(d.expiry_date) === key);
    if (!target) return;
    haptics.tap();
    const sectionKey = target.status; // 'red' | 'yellow' | 'green'
    const y = sectionPositions.current[sectionKey];
    if (typeof y === 'number' && scrollRef.current) {
      scrollRef.current.scrollTo({ y: Math.max(0, y - 12), animated: true });
    }
  };

  // ─── File picking ───────────────────────────────────────────────────────
  const pickFromFiles = async (): Promise<void> => {
    if (!documentPickerAvailable) {
      showToast(
        'Unavailable',
        'File picker needs a fresh app build. Use Camera or Gallery for now.',
        'error',
      );
      return;
    }
    try {
      const result: any = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result?.canceled || !result?.assets?.[0]) return;
      const f = result.assets[0];
      const mime = f.mimeType || 'application/octet-stream';
      const name = f.name || `compliance_${Date.now()}.${(mime.split('/').pop() || 'bin')}`;
      setPickedFile({ uri: f.uri, name, type: mime });
    } catch (e: any) {
      console.log('compliance file pick error:', e?.message || e);
      showToast('File picker error', e?.message || 'Could not open file picker', 'error');
    }
  };

  const pickFromCamera = async (): Promise<void> => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Permission required',
          'Camera access is needed to take a photo of your document.',
        );
        return;
      }
      const result: any = await ImagePicker.launchCameraAsync({
        mediaTypes: 'images' as any,
        allowsEditing: true,
        quality: 0.85,
      });
      if (result?.canceled || !result?.assets?.[0]) return;
      setPickedFile({
        uri: result.assets[0].uri,
        name: `compliance_${Date.now()}.jpg`,
        type: 'image/jpeg',
      });
    } catch (e: any) {
      console.log('camera pick error:', e?.message || e);
      showToast('Camera error', e?.message || 'Could not open camera', 'error');
    }
  };

  const pickFromGallery = async (): Promise<void> => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission required', 'Gallery access is needed to pick an image.');
        return;
      }
      const result: any = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images' as any,
        allowsEditing: true,
        quality: 0.85,
      });
      if (result?.canceled || !result?.assets?.[0]) return;
      setPickedFile({
        uri: result.assets[0].uri,
        name: `compliance_${Date.now()}.jpg`,
        type: 'image/jpeg',
      });
    } catch (e: any) {
      console.log('gallery pick error:', e?.message || e);
      showToast('Gallery error', e?.message || 'Could not open gallery', 'error');
    }
  };

  const resetUploadForm = (): void => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    setExpiryDate(d);
    setPickedType('factory_license');
    setPickedFile(null);
    setNote('');
  };

  const submitUpload = async (): Promise<void> => {
    if (!pickedFile) {
      showToast('Pick a file', 'Choose a document to upload first.', 'error');
      return;
    }
    try {
      setUploading(true);
      haptics.tap();
      const expiry_date = expiryDate.toISOString().slice(0, 10); // YYYY-MM-DD
      await uploadComplianceDoc(pickedFile, {
        compliance_type: pickedType,
        expiry_date,
        note: note.trim() || undefined,
      });
      setUploadOpen(false);
      resetUploadForm();
      showToast('Uploaded', 'Your compliance document is saved.', 'success');
      // Refresh the list
      load();
    } catch (e: any) {
      console.log('compliance upload error:', e?.message || e);
      showToast('Upload failed', e?.message || 'Please try again.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleRenew = async (doc: ComplianceDoc): Promise<void> => {
    try {
      setRenewingId(doc.id);
      haptics.tap();
      await renewComplianceDoc(doc.id);
      showToast(
        'Renewal requested',
        'A representative will contact you shortly.',
        'success',
      );
      load();
    } catch (e: any) {
      console.log('renew error:', e?.message || e);
      showToast('Could not request renewal', e?.message || 'Please try again.', 'error');
    } finally {
      setRenewingId(null);
    }
  };

  // ─── FliponeX Digital Locker — download + share a compliance scan ──────
  // Per spec: "If a factory manager is off-site and needs a license copy
  // for a bank or a tender, they can download the verified scan instantly
  // from our app." Downloads with the customer's auth token, saves to the
  // app's cache dir, then opens the native share sheet (WhatsApp, Gmail,
  // Drive, AirDrop, Print, etc.).
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // ─── In-app preview ──────────────────────────────────────────────────
  // Tapping a card's thumbnail downloads the file (with auth) to a stable
  // local path keyed by doc id, then opens DocPreviewModal pointed at the
  // local URI. The same downloaded copy gets reused by Download/Share.
  const [previewDoc, setPreviewDoc] = useState<{
    uri: string;
    name: string;
    mime?: string;
    label: string;
  } | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  // Compute the local cache path we use for both Preview AND Download/Share
  // so we only fetch each compliance file once per session.
  const localPathFor = (doc: ComplianceDoc): string => {
    const ext =
      (doc.original_name || '').split('.').pop()?.toLowerCase() ||
      (doc.mime_type?.includes('pdf') ? 'pdf' : 'jpg');
    const safeLabel = (doc.label || 'compliance').replace(/[^a-z0-9_]+/gi, '_');
    return `${FS.cacheDirectory}compliance_${doc.id}_${safeLabel}.${ext}`;
  };

  const ensureLocalCopy = async (doc: ComplianceDoc): Promise<string> => {
    if (!doc.downloadUrl) throw new Error('No download URL');
    const localPath = localPathFor(doc);
    // Reuse if already cached this session.
    try {
      const info = await FS.getInfoAsync(localPath);
      if (info?.exists && info?.size > 0) return localPath;
    } catch (_) {
      /* fall through to download */
    }
    const token = await getToken();
    const dl = FS.createDownloadResumable(
      doc.downloadUrl,
      localPath,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    const result = await dl.downloadAsync();
    if (!result?.uri) throw new Error('Download failed');
    return result.uri;
  };

  const handlePreview = async (doc: ComplianceDoc): Promise<void> => {
    if (previewingId) return;
    setPreviewingId(doc.id);
    try {
      haptics.tap();
      const uri = await ensureLocalCopy(doc);
      setPreviewDoc({
        uri,
        name: doc.original_name || doc.label,
        mime: doc.mime_type,
        label: doc.label,
      });
    } catch (e: any) {
      console.log('compliance preview error:', e?.message || e);
      Alert.alert(
        'Could not load preview',
        e?.message || 'Try the Download button instead.',
      );
    } finally {
      setPreviewingId(null);
    }
  };
  const handleDownload = async (doc: ComplianceDoc): Promise<void> => {
    if (!doc.downloadUrl || downloadingId) return;
    setDownloadingId(doc.id);
    try {
      haptics.tap();
      const uri = await ensureLocalCopy(doc);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: doc.mime_type || 'application/octet-stream',
          dialogTitle: `Share ${doc.label}`,
          UTI: doc.mime_type?.includes('pdf') ? 'com.adobe.pdf' : 'public.image',
        });
      } else {
        showToast('Saved', `Saved to ${uri}`, 'success');
      }
    } catch (e: any) {
      console.log('compliance download error:', e?.message || e);
      Alert.alert(
        'Could not download',
        e?.message || 'Please check your connection and try again.',
      );
    } finally {
      setDownloadingId(null);
    }
  };

  // ─── Renderers ──────────────────────────────────────────────────────────
  const renderCard = (doc: ComplianceDoc) => {
    const color = statusColor(doc.status);
    const cta =
      doc.status === 'red' ? 'Renew Now' : doc.status === 'yellow' ? 'Plan Renewal' : null;
    const showCta = doc.status !== 'green';
    const isImage =
      (doc.mime_type || '').startsWith('image/') ||
      /\.(jpe?g|png|webp|gif|bmp)$/i.test(doc.original_name || '');
    return (
      <View
        key={doc.id}
        style={[
          styles.card,
          { borderColor: color, borderWidth: doc.status === 'red' ? 2 : 1 },
        ]}
      >
        <View style={styles.cardTopRow}>
          {/* Thumbnail — tap to open the full-screen preview. For image
              docs we render the actual file (auth header passed via the
              Image source), so the user sees the verified scan inline.
              For PDFs we fall back to a 📄 tile. */}
          <TouchableOpacity
            style={styles.thumbWrap}
            onPress={() => handlePreview(doc)}
            disabled={previewingId === doc.id}
            accessibilityLabel={`Preview ${doc.label}`}
          >
            {previewingId === doc.id ? (
              <ActivityIndicator color={COLORS.PRIMARY} />
            ) : isImage && doc.downloadUrl ? (
              <RNImage
                source={
                  imgAuthHeader
                    ? { uri: doc.downloadUrl, headers: imgAuthHeader }
                    : { uri: doc.downloadUrl }
                }
                style={styles.thumbImage}
                resizeMode="cover"
              />
            ) : (
              <Text style={styles.thumbFallback}>📄</Text>
            )}
            <View style={styles.thumbHint}>
              <Text style={styles.thumbHintText}>👁 Tap to view</Text>
            </View>
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <View style={[styles.statusPill, { backgroundColor: color + '22', alignSelf: 'flex-start' }]}>
              <Text style={[styles.statusPillText, { color }]}>
                {statusEmoji(doc.status)}{' '}
                {doc.daysLeft >= 0
                  ? `${doc.daysLeft} days left`
                  : `${Math.abs(doc.daysLeft)} days overdue`}
              </Text>
            </View>
            <Text style={styles.cardLabel}>{doc.label}</Text>
            <Text style={styles.cardExpiry}>{formatExpiry(doc.expiry_date)}</Text>
            <Text style={styles.cardFile} numberOfLines={1}>
              {doc.original_name} · {formatBytes(doc.plaintext_size)}
            </Text>
          </View>
        </View>

        {!!doc.note && (
          <Text style={styles.cardNote} numberOfLines={2}>
            {doc.note}
          </Text>
        )}

        <View style={styles.cardActionsRow}>
          {/* FliponeX Digital Locker — instant download for off-site needs
              (bank, tender, customs, lawyer, insurance audit, etc.). */}
          <TouchableOpacity
            style={styles.lockerBtn}
            onPress={() => handleDownload(doc)}
            disabled={downloadingId === doc.id}
            accessibilityLabel={`Download ${doc.label}`}
          >
            {downloadingId === doc.id ? (
              <ActivityIndicator color={COLORS.PRIMARY_DARK} size="small" />
            ) : (
              <Text style={styles.lockerBtnText}>📥 Download / Share</Text>
            )}
          </TouchableOpacity>

          {showCta && cta && (
            <TouchableOpacity
              style={[
                styles.renewBtn,
                {
                  backgroundColor: doc.status === 'red' ? COLORS.ERROR : COLORS.ACCENT,
                },
              ]}
              onPress={() => handleRenew(doc)}
              disabled={renewingId === doc.id}
            >
              {renewingId === doc.id ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text
                  style={[
                    styles.renewBtnText,
                    { color: doc.status === 'red' ? '#fff' : COLORS.PRIMARY_DARK },
                  ]}
                >
                  {cta}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const renderSection = (key: 'red' | 'yellow' | 'green', title: string, list: ComplianceDoc[]) => {
    if (list.length === 0) return null;
    return (
      <View
        onLayout={(e) => {
          sectionPositions.current[key] = e.nativeEvent.layout.y;
        }}
        style={{ marginBottom: 8 }}
      >
        <Text style={styles.sectionTitle}>{title}</Text>
        {list.map(renderCard)}
      </View>
    );
  };

  const renderEmpty = () => {
    if (needsCompanyProfile) {
      return (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Company profile required</Text>
          <Text style={styles.emptySub}>
            Fill in your company details first so we can attach compliance docs to your business
            account.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.navigate('CompanyProfile')}
          >
            <Text style={styles.primaryBtnText}>Fill Company Profile</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>No compliance documents yet</Text>
        <Text style={styles.emptySub}>
          Tap + to upload your first document. We'll alert you 60 and 30 days before it expires.
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.PRIMARY} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.backPill}
          >
            <Text style={styles.backPillText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Compliance Vault</Text>
          <View style={{ width: 64 }} />
        </View>
        <Text style={styles.headerSubtitle}>
          Smart alerts for your factory licenses, NOCs and certificates
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scrollBody}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.PRIMARY} />
        }
      >
        {/* 12-month calendar strip */}
        {!loading && !needsCompanyProfile && docs.length > 0 && (
          <View style={styles.calendarWrap}>
            <Text style={styles.calendarTitle}>Next 12 months</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.calendarRow}
            >
              {calendar.map((m) => {
                const dotColor =
                  m.status === 'red'
                    ? COLORS.ERROR
                    : m.status === 'yellow'
                      ? COLORS.WARNING
                      : m.status === 'green'
                        ? COLORS.SUCCESS
                        : 'transparent';
                return (
                  <TouchableOpacity
                    key={m.key}
                    style={[
                      styles.calendarCell,
                      m.status ? { borderColor: dotColor } : null,
                    ]}
                    disabled={!m.status}
                    onPress={() => onMonthTap(m.key)}
                  >
                    <Text style={styles.calendarMonth}>{m.label}</Text>
                    <Text style={styles.calendarYear}>{String(m.year).slice(2)}</Text>
                    <View
                      style={[
                        styles.calendarDot,
                        { backgroundColor: m.status ? dotColor : 'transparent' },
                      ]}
                    />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Upload CTA */}
        {!needsCompanyProfile && (
          <TouchableOpacity
            style={styles.uploadCta}
            onPress={() => {
              haptics.tap();
              setUploadOpen(true);
            }}
          >
            <Text style={styles.uploadCtaPlus}>+</Text>
            <Text style={styles.uploadCtaText}>Upload new compliance document</Text>
          </TouchableOpacity>
        )}

        {loading ? (
          <ActivityIndicator color={COLORS.PRIMARY} style={{ marginTop: 28 }} />
        ) : docs.length === 0 ? (
          renderEmpty()
        ) : (
          <>
            {renderSection('red', '🚨 Critical', grouped.red)}
            {renderSection('yellow', '⏳ Action soon', grouped.yellow)}
            {renderSection('green', '✅ Up to date', grouped.green)}
          </>
        )}
      </ScrollView>

      {/* Upload bottom-sheet */}
      <Modal
        visible={uploadOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setUploadOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalRoot}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => !uploading && setUploadOpen(false)}
          />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>New Compliance Document</Text>

            <ScrollView
              style={{ maxHeight: 480 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Type chips */}
              <Text style={styles.fieldLabel}>Document type</Text>
              <View style={styles.chipsWrap}>
                {COMPLIANCE_TYPES.map((t) => {
                  const active = pickedType === t.value;
                  return (
                    <TouchableOpacity
                      key={t.value}
                      onPress={() => {
                        haptics.tap();
                        setPickedType(t.value);
                      }}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {t.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Expiry */}
              <Text style={styles.fieldLabel}>Expiry date</Text>
              <TouchableOpacity
                style={styles.dateBtn}
                onPress={() => setShowDatePicker(true)}
              >
                <Text style={styles.dateBtnText}>
                  {expiryDate.getDate()} {MONTH_LABELS[expiryDate.getMonth()]}{' '}
                  {expiryDate.getFullYear()}
                </Text>
              </TouchableOpacity>
              {showDatePicker && (
                <DateTimePicker
                  value={expiryDate}
                  mode="date"
                  display="default"
                  minimumDate={new Date()}
                  onChange={(_event: any, selected: Date | undefined) => {
                    setShowDatePicker(false);
                    if (selected) setExpiryDate(selected);
                  }}
                />
              )}

              {/* File picker */}
              <Text style={styles.fieldLabel}>Document file</Text>
              {pickedFile ? (
                <View style={styles.filePickedRow}>
                  <Text style={styles.filePickedName} numberOfLines={1}>
                    {pickedFile.name}
                  </Text>
                  <TouchableOpacity onPress={() => setPickedFile(null)}>
                    <Text style={styles.fileRemove}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.fileBtnRow}>
                  <TouchableOpacity style={styles.fileBtn} onPress={pickFromCamera}>
                    <Text style={styles.fileBtnText}>📷 Camera</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.fileBtn} onPress={pickFromGallery}>
                    <Text style={styles.fileBtnText}>🖼 Gallery</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.fileBtn} onPress={pickFromFiles}>
                    <Text style={styles.fileBtnText}>📄 PDF / File</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Note */}
              <Text style={styles.fieldLabel}>Note (optional)</Text>
              <TextInput
                style={styles.noteInput}
                value={note}
                onChangeText={setNote}
                placeholder="e.g. Renewed via state portal, ref #12345"
                placeholderTextColor={COLORS.TEXT_SECONDARY}
                multiline
              />
            </ScrollView>

            <View style={styles.sheetActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => !uploading && setUploadOpen(false)}
                disabled={uploading}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitBtn, (!pickedFile || uploading) && { opacity: 0.6 }]}
                onPress={submitUpload}
                disabled={uploading || !pickedFile}
              >
                {uploading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitBtnText}>Upload</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <SuccessToast
        visible={toast.visible}
        title={toast.title}
        subtitle={toast.subtitle}
        variant={toast.variant}
        onHide={() => setToast((p) => ({ ...p, visible: false }))}
      />

      {/* Full-screen preview modal — opens when the user taps any compliance
          card thumbnail. Reuses the project's DocPreviewModal component so
          look-and-feel matches the booking-flow doc preview. */}
      <DocPreviewModal
        visible={!!previewDoc}
        doc={
          previewDoc
            ? {
                uri: previewDoc.uri,
                file_url: previewDoc.uri,
                file_name: previewDoc.name,
                mime_type: previewDoc.mime,
                document_type: previewDoc.label,
              }
            : null
        }
        onClose={() => setPreviewDoc(null)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.BACKGROUND },

  // ─── Header ───────────────────────────────────────────────────────────
  header: {
    backgroundColor: COLORS.PRIMARY,
    paddingHorizontal: 18,
    paddingBottom: 18,
    ...SHADOWS.medium,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  backPill: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BORDER_RADIUS.ROUND,
  },
  backPillText: {
    color: COLORS.WHITE,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  headerTitle: {
    color: COLORS.WHITE,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },

  // ─── Body ─────────────────────────────────────────────────────────────
  scrollBody: { padding: 16, paddingBottom: 48 },

  // Calendar strip
  calendarWrap: { marginBottom: 14 },
  calendarTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.PRIMARY_DARK,
    marginBottom: 8,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  calendarRow: { paddingRight: 8 },
  calendarCell: {
    width: 56,
    paddingVertical: 8,
    marginRight: 6,
    borderRadius: BORDER_RADIUS.MEDIUM,
    alignItems: 'center',
    backgroundColor: COLORS.SURFACE,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
  },
  calendarMonth: {
    color: COLORS.PRIMARY_DARK,
    fontSize: 12,
    fontWeight: '800',
  },
  calendarYear: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: 10,
    marginTop: 1,
  },
  calendarDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 4,
  },

  // Upload CTA (also acts as a "FAB-ish" inline button at the top)
  uploadCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.PRIMARY,
    borderRadius: BORDER_RADIUS.MEDIUM,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 16,
    ...SHADOWS.light,
  },
  uploadCtaPlus: {
    color: COLORS.ACCENT,
    fontSize: 22,
    fontWeight: '900',
    marginRight: 10,
  },
  uploadCtaText: {
    color: COLORS.WHITE,
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 0.3,
  },

  // Section header
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.PRIMARY_DARK,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 4,
    marginBottom: 8,
  },

  // Doc card
  card: {
    backgroundColor: COLORS.SURFACE,
    borderRadius: BORDER_RADIUS.MEDIUM,
    padding: 14,
    marginBottom: 10,
    ...SHADOWS.light,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  cardTopRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  thumbWrap: {
    width: 84,
    height: 84,
    borderRadius: BORDER_RADIUS.MEDIUM,
    overflow: 'hidden',
    backgroundColor: '#F0F4F8',
    borderWidth: 1,
    borderColor: '#E3EEF8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbFallback: {
    fontSize: 36,
  },
  thumbHint: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(13,59,102,0.85)',
    paddingVertical: 3,
    alignItems: 'center',
  },
  thumbHintText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.ROUND,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  cardLabel: {
    color: COLORS.PRIMARY_DARK,
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
    textAlign: 'right',
    marginLeft: 8,
  },
  cardExpiry: {
    color: COLORS.PRIMARY_DARK,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  cardFile: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: 11,
    marginTop: 4,
  },
  cardNote: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: 12,
    marginTop: 6,
    fontStyle: 'italic',
  },
  cardActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  lockerBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: BORDER_RADIUS.MEDIUM,
    alignItems: 'center',
    backgroundColor: COLORS.PRIMARY_LIGHT,
    borderWidth: 1.2,
    borderColor: COLORS.PRIMARY,
  },
  lockerBtnText: {
    fontWeight: '800',
    fontSize: 12.5,
    letterSpacing: 0.3,
    color: COLORS.PRIMARY_DARK,
  },
  renewBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: BORDER_RADIUS.MEDIUM,
    alignItems: 'center',
  },
  renewBtnText: {
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.3,
  },

  // Empty state
  emptyCard: {
    backgroundColor: COLORS.SURFACE,
    borderRadius: BORDER_RADIUS.MEDIUM,
    padding: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    marginTop: 16,
  },
  emptyTitle: {
    color: COLORS.PRIMARY_DARK,
    fontWeight: '800',
    fontSize: 15,
    marginBottom: 6,
  },
  emptySub: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  primaryBtn: {
    marginTop: 16,
    backgroundColor: COLORS.PRIMARY,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: BORDER_RADIUS.MEDIUM,
  },
  primaryBtnText: {
    color: COLORS.WHITE,
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.3,
  },

  // ─── Bottom-sheet modal ───────────────────────────────────────────────
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: COLORS.SURFACE,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 24,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.GRAY_LIGHT,
    marginBottom: 12,
  },
  sheetTitle: {
    color: COLORS.PRIMARY_DARK,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 10,
  },
  fieldLabel: {
    color: COLORS.PRIMARY_DARK,
    fontWeight: '700',
    fontSize: 12,
    marginTop: 12,
    marginBottom: 6,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: BORDER_RADIUS.ROUND,
    backgroundColor: COLORS.GRAY_LIGHT,
    marginRight: 6,
    marginBottom: 6,
  },
  chipActive: { backgroundColor: COLORS.PRIMARY },
  chipText: {
    color: COLORS.PRIMARY_DARK,
    fontWeight: '700',
    fontSize: 12,
  },
  chipTextActive: { color: COLORS.WHITE },
  dateBtn: {
    backgroundColor: COLORS.PRIMARY_LIGHT,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: BORDER_RADIUS.MEDIUM,
  },
  dateBtnText: {
    color: COLORS.PRIMARY_DARK,
    fontWeight: '700',
    fontSize: 13,
  },
  fileBtnRow: { flexDirection: 'row', gap: 6 },
  fileBtn: {
    flex: 1,
    backgroundColor: COLORS.PRIMARY_LIGHT,
    paddingVertical: 12,
    borderRadius: BORDER_RADIUS.MEDIUM,
    alignItems: 'center',
    marginRight: 6,
  },
  fileBtnText: {
    color: COLORS.PRIMARY_DARK,
    fontWeight: '700',
    fontSize: 12,
  },
  filePickedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.PRIMARY_LIGHT,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: BORDER_RADIUS.MEDIUM,
  },
  filePickedName: {
    flex: 1,
    color: COLORS.PRIMARY_DARK,
    fontWeight: '700',
    fontSize: 12,
    marginRight: 8,
  },
  fileRemove: {
    color: COLORS.ERROR,
    fontWeight: '700',
    fontSize: 12,
  },
  noteInput: {
    backgroundColor: COLORS.PRIMARY_LIGHT,
    borderRadius: BORDER_RADIUS.MEDIUM,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: COLORS.TEXT_PRIMARY,
    fontSize: 13,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: BORDER_RADIUS.MEDIUM,
    alignItems: 'center',
    backgroundColor: COLORS.GRAY_LIGHT,
    marginRight: 8,
  },
  cancelBtnText: {
    color: COLORS.PRIMARY_DARK,
    fontWeight: '800',
    fontSize: 13,
  },
  submitBtn: {
    flex: 1.5,
    paddingVertical: 12,
    borderRadius: BORDER_RADIUS.MEDIUM,
    alignItems: 'center',
    backgroundColor: COLORS.PRIMARY,
  },
  submitBtnText: {
    color: COLORS.WHITE,
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.3,
  },
});

export default ComplianceScreen;

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
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { captureWithCrop, pickWithCrop } from '../utils/cropPicker';
// expo-file-system v18 (Expo SDK 54+) deprecated `createDownloadResumable`
// + `cacheDirectory` on the main entry — they now live under the
// `expo-file-system/legacy` sub-path. Trying that first means the resumable
// downloader keeps working without rewriting against the new File/Directory
// classes; we fall back to the main entry for older SDK builds.
let FS: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  FS = require('expo-file-system/legacy');
} catch (_) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  FS = require('expo-file-system');
}
import DocPreviewModal from '../components/DocPreviewModal';
import { Image as RNImage } from 'react-native';
import * as Sharing from 'expo-sharing';
import { COLORS, BORDER_RADIUS, SHADOWS } from '../constants/colors';
import {
  getComplianceDocs,
  uploadComplianceDoc,
  updateComplianceDoc,
  deleteComplianceDoc,
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

// "yellow" status (action-soon, <=60 days) maps to ACCENT — the same
// gold-yellow used for the critical "Plan renewal" chip. WARNING is
// an orange tone reserved for harsher signals; using it here made
// the action-soon state read as alarming and inconsistent with the
// rest of the compliance UI.
const statusColor = (s: ComplianceDoc['status']): string => {
  if (s === 'red') return COLORS.ERROR;
  if (s === 'yellow') return COLORS.ACCENT;
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

  // Register-specific upload fields. Free-text alongside the type chip
  // so users can register any renewable document, not just the predefined
  // enum types (e.g. "Bike Insurance", "Flat Rent Agreement").
  const [documentName, setDocumentName] = useState<string>('');
  const [issuingAuthority, setIssuingAuthority] = useState<string>('');
  const [documentNumber, setDocumentNumber] = useState<string>('');
  const [issueDate, setIssueDate] = useState<Date | null>(null);
  const [showIssueDatePicker, setShowIssueDatePicker] = useState<boolean>(false);

  // Inline-edit state for the register table. When set, opens the edit
  // modal pre-filled with the row's current values.
  const [editingDoc, setEditingDoc] = useState<ComplianceDoc | null>(null);
  const [editName, setEditName] = useState<string>('');
  // Lightweight rename-only modal — separate from the full edit sheet so
  // the common "I just want to rename this doc" path doesn't make the
  // user scroll through expiry/issuer/number fields.
  const [renamingDoc, setRenamingDoc] = useState<ComplianceDoc | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');
  const [savingRename, setSavingRename] = useState<boolean>(false);
  const [editAuthority, setEditAuthority] = useState<string>('');
  const [editNumber, setEditNumber] = useState<string>('');
  const [editIssueDate, setEditIssueDate] = useState<Date | null>(null);
  const [editExpiryDate, setEditExpiryDate] = useState<Date | null>(null);
  const [editShowIssue, setEditShowIssue] = useState<boolean>(false);
  const [editShowExpiry, setEditShowExpiry] = useState<boolean>(false);
  const [savingEdit, setSavingEdit] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
    // Find every doc expiring in this month. Used to: (a) tell the user
    // exactly what's expiring (toast) so the colored box isn't a mystery,
    // and (b) scroll to the matching section so they can act on it.
    const expiring = docs.filter((d) => monthKey(d.expiry_date) === key);
    if (expiring.length === 0) return;
    haptics.tap();
    const labels = expiring
      .map((d) => d.document_name || d.label || 'Compliance doc')
      .slice(0, 3)
      .join(', ');
    const more = expiring.length > 3 ? ` +${expiring.length - 3} more` : '';
    showToast(
      `${expiring.length} doc${expiring.length === 1 ? '' : 's'} expiring`,
      `${labels}${more}`,
      'info',
    );
    const sectionKey = expiring[0].status; // 'red' | 'yellow' | 'green'
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
      // Styled crop UI — branded toolbar + clearly-coloured tick to
      // confirm the crop, instead of Android's faint "CROP" text.
      // Wrapped in a tiny setTimeout (same as the prior expo version)
      // because launching from inside a Modal racing with the activity
      // result registry — gives the native side a frame to wire up.
      const file = await new Promise<any>((resolve, reject) => {
        setTimeout(async () => {
          try {
            resolve(await captureWithCrop({ namePrefix: 'compliance' }));
          } catch (err) { reject(err); }
        }, 100);
      });
      if (!file) return;
      setPickedFile(file);
    } catch (e: any) {
      console.log('camera pick error:', e?.message || e);
      showToast('Camera error', e?.message || 'Could not open camera', 'error');
    }
  };

  const pickFromGallery = async (): Promise<void> => {
    try {
      const file = await new Promise<any>((resolve, reject) => {
        setTimeout(async () => {
          try {
            resolve(await pickWithCrop({ namePrefix: 'compliance' }));
          } catch (err) { reject(err); }
        }, 100);
      });
      if (!file) return;
      setPickedFile(file);
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
    setDocumentName('');
    setIssuingAuthority('');
    setDocumentNumber('');
    setIssueDate(null);
  };

  const submitUpload = async (): Promise<void> => {
    if (!pickedFile) {
      showToast('Pick a file', 'Choose a document to upload first.', 'error');
      return;
    }
    // Either the type chip OR a free-text Document Name must identify
    // what this is. The mockup explicitly supports docs that aren't in
    // the enum (e.g. "Bike Insurance", "Flat Rent Agreement").
    if (!pickedType && !documentName.trim()) {
      showToast('Document name needed', 'Pick a type or enter a name.', 'error');
      return;
    }
    try {
      setUploading(true);
      haptics.tap();
      const expiry_date = expiryDate.toISOString().slice(0, 10); // YYYY-MM-DD
      await uploadComplianceDoc(pickedFile, {
        compliance_type: pickedType,
        document_name: documentName.trim() || undefined,
        issuing_authority: issuingAuthority.trim() || undefined,
        document_number: documentNumber.trim() || undefined,
        issue_date: issueDate ? issueDate.toISOString().slice(0, 10) : undefined,
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

  // Open the inline-edit modal for an existing register row. Values
  // pre-fill from the row's current state; saving sends only diff via PATCH.
  const openEdit = (doc: ComplianceDoc): void => {
    haptics.tap();
    setEditingDoc(doc);
    setEditName(doc.document_name || doc.label || '');
    setEditAuthority(doc.issuing_authority || '');
    setEditNumber(doc.document_number || '');
    setEditIssueDate(doc.issue_date ? new Date(doc.issue_date) : null);
    setEditExpiryDate(doc.expiry_date ? new Date(doc.expiry_date) : null);
  };

  const saveEdit = async (): Promise<void> => {
    if (!editingDoc) return;
    if (!editExpiryDate) {
      showToast('Expiry required', 'Pick a Valid Upto date.', 'error');
      return;
    }
    try {
      setSavingEdit(true);
      await updateComplianceDoc(editingDoc.id, {
        document_name: editName.trim() || null,
        issuing_authority: editAuthority.trim() || null,
        document_number: editNumber.trim() || null,
        issue_date: editIssueDate ? editIssueDate.toISOString().slice(0, 10) : null,
        expiry_date: editExpiryDate.toISOString().slice(0, 10),
      });
      setEditingDoc(null);
      showToast('Updated', 'Register row saved.', 'success');
      load();
    } catch (e: any) {
      showToast('Could not save', e?.message || 'Please try again.', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const openRename = (doc: ComplianceDoc): void => {
    haptics.tap();
    setRenamingDoc(doc);
    setRenameValue(doc.document_name || doc.label || '');
  };

  const submitRename = async (): Promise<void> => {
    if (!renamingDoc) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      showToast('Name required', 'Please type a document name.', 'error');
      return;
    }
    try {
      setSavingRename(true);
      await updateComplianceDoc(renamingDoc.id, { document_name: trimmed });
      setRenamingDoc(null);
      setRenameValue('');
      showToast('Renamed', 'Document name updated.', 'success');
      load();
    } catch (e: any) {
      showToast('Could not rename', e?.message || 'Please try again.', 'error');
    } finally {
      setSavingRename(false);
    }
  };

  const confirmDelete = (doc: ComplianceDoc): void => {
    Alert.alert(
      'Remove from register?',
      `This will remove "${doc.document_name || doc.label}" from your register. The file is preserved on your device's downloads.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingId(doc.id);
              await deleteComplianceDoc(doc.id);
              setEditingDoc(null);
              showToast('Removed', 'Row removed from register.', 'success');
              load();
            } catch (e: any) {
              showToast('Could not remove', e?.message || 'Please try again.', 'error');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ],
    );
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
  // Build the human-readable text we share when there's no attached file
  // (Smart Alert entries with no upload). Used as a fallback so the Share
  // button always does something visible — previously it silently returned
  // when `downloadUrl` was missing.
  const buildAlertShareMessage = (doc: ComplianceDoc): string => {
    const lines: string[] = [];
    lines.push(`📌 ${doc.label}`);
    if ((doc as any).document_number) lines.push(`Doc No: ${(doc as any).document_number}`);
    if ((doc as any).issuing_authority) lines.push(`Issued by: ${(doc as any).issuing_authority}`);
    if (doc.expiry_date) lines.push(`Valid upto: ${formatExpiry(doc.expiry_date).replace(/^expires\s*/, '')}`);
    lines.push('');
    lines.push('Tracked on FliponeX Smart Alert.');
    return lines.join('\n');
  };

  const handleDownload = async (doc: ComplianceDoc): Promise<void> => {
    if (downloadingId) return;
    setDownloadingId(doc.id);
    try {
      haptics.tap();
      // No file attached → fall back to text-only share of the alert info
      // (date, doc number, issuing authority). Previously the handler
      // returned early and the Share button looked broken to the user.
      if (!doc.downloadUrl) {
        await Share.share({
          title: doc.label,
          message: buildAlertShareMessage(doc),
        });
        return;
      }
      const uri = await ensureLocalCopy(doc);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: doc.mime_type || 'application/octet-stream',
          dialogTitle: `Share ${doc.label}`,
          UTI: doc.mime_type?.includes('pdf') ? 'com.adobe.pdf' : 'public.image',
        });
      } else {
        // expo-sharing not available on this device — fall back to the
        // RN built-in Share which doesn't need a native module rebuild.
        await Share.share({
          title: doc.label,
          message: buildAlertShareMessage(doc) + (uri ? `\n\nFile: ${uri}` : ''),
        });
      }
    } catch (e: any) {
      console.log('compliance share error:', e?.message || e);
      Alert.alert(
        'Could not share',
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
            accessibilityLabel={`Share ${doc.label}`}
          >
            {downloadingId === doc.id ? (
              <ActivityIndicator color={COLORS.PRIMARY_DARK} size="small" />
            ) : (
              // Tap opens the OS share sheet (WhatsApp, Drive, Gmail, etc.)
              // — the user can save-to-device from there if they want, so
              // exposing a separate "Download" entry-point was redundant.
              <Text style={styles.lockerBtnText}>📤 Share</Text>
            )}
          </TouchableOpacity>

          {/* Quick-rename — for when the doc was uploaded with the wrong
              name or the user wants to make it easier to find later. */}
          <TouchableOpacity
            style={styles.lockerBtn}
            onPress={() => openRename(doc)}
            accessibilityLabel={`Rename ${doc.label}`}
          >
            <Text style={styles.lockerBtnText}>✏️ Rename</Text>
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
            <Text style={styles.calendarHint}>
              Each box = one month. Coloured boxes mean a document expires
              that month. Tap a box to jump to the matching document below.
            </Text>
            <View style={styles.calendarLegend}>
              <View style={styles.calendarLegendItem}>
                <View style={[styles.calendarLegendSwatch, { backgroundColor: COLORS.ERROR }]} />
                <Text style={styles.calendarLegendText}>Critical (≤30 days)</Text>
              </View>
              <View style={styles.calendarLegendItem}>
                <View style={[styles.calendarLegendSwatch, { backgroundColor: COLORS.ACCENT }]} />
                <Text style={styles.calendarLegendText}>Action soon (≤60 days)</Text>
              </View>
              <View style={styles.calendarLegendItem}>
                <View style={[styles.calendarLegendSwatch, { backgroundColor: COLORS.SUCCESS }]} />
                <Text style={styles.calendarLegendText}>Safe</Text>
              </View>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.calendarRow}
            >
              {calendar.map((m) => {
                const fillColor =
                  m.status === 'red'
                    ? COLORS.ERROR
                    : m.status === 'yellow'
                      ? COLORS.ACCENT
                      : m.status === 'green'
                        ? COLORS.SUCCESS
                        : null;
                // When the month has expiring docs, the whole cell is now
                // a filled colored box (was a small 8px dot before — too
                // subtle to scan at a glance). Text colors flip to white
                // on the colored fill for legibility.
                const isFilled = !!fillColor;
                return (
                  <TouchableOpacity
                    key={m.key}
                    style={[
                      styles.calendarCell,
                      isFilled && {
                        backgroundColor: fillColor!,
                        borderColor: fillColor!,
                      },
                    ]}
                    disabled={!m.status}
                    onPress={() => onMonthTap(m.key)}
                  >
                    <Text
                      style={[
                        styles.calendarMonth,
                        isFilled && styles.calendarMonthFilled,
                      ]}
                    >
                      {m.label}
                    </Text>
                    <Text
                      style={[
                        styles.calendarYear,
                        isFilled && styles.calendarYearFilled,
                      ]}
                    >
                      {String(m.year).slice(2)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {loading ? (
          <ActivityIndicator color={COLORS.PRIMARY} style={{ marginTop: 28 }} />
        ) : docs.length === 0 ? (
          <>
            {renderEmpty()}
            {/* Even with zero rows, surface the Row Add Button so the
                empty state is self-explanatory. */}
            <TouchableOpacity
              style={styles.rowAddBtn}
              onPress={() => {
                haptics.tap();
                setUploadOpen(true);
              }}
            >
              <Text style={styles.rowAddBtnText}>Add  +</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {/* ─── Personal Compliance Register ──────────────────────
                Spreadsheet-style table — wide enough that we wrap it in
                a horizontal ScrollView. Sticky-ish first column shows the
                row index + tap-to-edit. Status pill auto-colors green /
                yellow / red from days-till-expiry (>60 / 30-60 / <30). */}
            <View style={styles.registerWrap}>
              <Text style={styles.registerTitle}>📋 Compliance Register</Text>
              <Text style={styles.registerSubtitle}>
                Tap any row to edit · Status auto-updates from Valid Upto date
              </Text>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator
                style={styles.registerScroll}
              >
                <View style={styles.registerTable}>
                  {/* Header row */}
                  <View style={[styles.regRow, styles.regHeader]}>
                    <Text style={[styles.cellSno, styles.regHeaderText]}>S. No</Text>
                    <Text style={[styles.cellName, styles.regHeaderText]}>Document Name</Text>
                    <Text style={[styles.cellAuthority, styles.regHeaderText]}>
                      Statutory Department / Concerned Office
                    </Text>
                    <Text style={[styles.cellDocNo, styles.regHeaderText]}>Document No</Text>
                    <Text style={[styles.cellDate, styles.regHeaderText]}>Date of Issue</Text>
                    <Text style={[styles.cellDate, styles.regHeaderText]}>Valid Upto</Text>
                    <Text style={[styles.cellStatus, styles.regHeaderText]}>Status</Text>
                    <Text style={[styles.cellPdfWrap, styles.regHeaderText]}>PDF/JPEG</Text>
                  </View>

                  {/* Data rows — sorted by urgency (most critical first) */}
                  {[...grouped.red, ...grouped.yellow, ...grouped.green].map((d, i) => {
                    const dotColor = statusColor(d.status);
                    const statusWord =
                      d.status === 'red'
                        ? 'High alert'
                        : d.status === 'yellow'
                          ? 'Little alert'
                          : 'Safe';
                    return (
                      <TouchableOpacity
                        key={d.id}
                        style={styles.regRow}
                        activeOpacity={0.7}
                        onPress={() => openEdit(d)}
                      >
                        <Text style={styles.cellSno}>{i + 1}</Text>
                        <Text style={styles.cellName} numberOfLines={2}>
                          {d.document_name || d.label}
                        </Text>
                        <Text style={styles.cellAuthority} numberOfLines={2}>
                          {d.issuing_authority || '—'}
                        </Text>
                        <Text style={styles.cellDocNo} numberOfLines={1}>
                          {d.document_number || '—'}
                        </Text>
                        <Text style={styles.cellDate}>
                          {d.issue_date
                            ? new Date(d.issue_date).toLocaleDateString('en-GB').replace(/\//g, '.')
                            : '—'}
                        </Text>
                        <Text style={styles.cellDate}>
                          {d.expiry_date
                            ? new Date(d.expiry_date).toLocaleDateString('en-GB').replace(/\//g, '.')
                            : '—'}
                        </Text>
                        <View style={styles.cellStatus}>
                          <View
                            style={[styles.regStatusPill, { backgroundColor: dotColor }]}
                          >
                            <Text style={styles.regStatusPillText}>{statusWord}</Text>
                          </View>
                          <Text style={styles.statusDays}>
                            {d.daysLeft != null
                              ? d.daysLeft < 0
                                ? `Expired ${Math.abs(d.daysLeft)}d ago`
                                : `${d.daysLeft}d left`
                              : ''}
                          </Text>
                        </View>
                        <View style={styles.cellPdfWrap}>
                          <TouchableOpacity
                            style={styles.cellPdfPreview}
                            onPress={(e) => {
                              e.stopPropagation();
                              handlePreview(d);
                            }}
                          >
                            {previewingId === d.id ? (
                              <ActivityIndicator size="small" color={COLORS.PRIMARY} />
                            ) : (
                              <View style={styles.pdfThumb}>
                                <Text style={styles.pdfThumbIcon}>
                                  {d.mime_type?.includes('pdf') ? '📄' : '🖼️'}
                                </Text>
                                <Text style={styles.pdfThumbText} numberOfLines={1}>
                                  View
                                </Text>
                              </View>
                            )}
                          </TouchableOpacity>
                          {/* Quick delete — removes the row from the
                              register without having to open the edit
                              sheet first. Same confirmation dialog the
                              edit-sheet button uses, so the destructive
                              action still needs explicit confirmation. */}
                          <TouchableOpacity
                            style={styles.cellDeleteBtn}
                            onPress={(e) => {
                              e.stopPropagation();
                              confirmDelete(d);
                            }}
                            disabled={deletingId === d.id}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            {deletingId === d.id ? (
                              <ActivityIndicator size="small" color="#0F172A" />
                            ) : (
                              // Line-drawing trash can (MaterialIcons
                              // delete-outline) — matches the reference
                              // icon. Rendered in slate-900 with no
                              // background fill per the request to drop
                              // the red chip styling.
                              <MaterialIcon name="delete-outline" size={22} color="#0F172A" />
                            )}
                          </TouchableOpacity>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>

              {/* Row Add Button — matches the mockup's red dashed-border CTA */}
              <TouchableOpacity
                style={styles.rowAddBtn}
                onPress={() => {
                  haptics.tap();
                  setUploadOpen(true);
                }}
              >
                <Text style={styles.rowAddBtnText}>Add  +</Text>
              </TouchableOpacity>
            </View>

            {/* Existing grouped card view — kept below the spreadsheet
                so customers who prefer the visual cards still have them
                available. Surfaces Renew CTA + Download/Share actions
                that the table view doesn't include. */}
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
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
                        // Auto-fill the document name from the chip label so
                        // the user doesn't have to retype it. ALWAYS
                        // overwrite (except for "Other" which has no
                        // canonical label) — the user can still edit the
                        // text afterwards if they want a custom title.
                        // Previous behaviour preserved user typing, which
                        // meant tapping a chip after typing one letter
                        // by accident left the field stuck without
                        // updating, confusing users into thinking the
                        // chip didn't auto-fill at all.
                        if (t.value !== 'other') {
                          setDocumentName(t.label);
                        }
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

              {/* Document Name (free-text, overrides the chip label in the
                  register view — mockup wants e.g. "Bike Insurance",
                  "Flat Rent Agreement" which aren't in the chip set). */}
              <Text style={styles.fieldLabel}>Document Name</Text>
              <TextInput
                style={styles.noteInput}
                value={documentName}
                onChangeText={setDocumentName}
                placeholder="e.g. Car Registration, Bike Insurance, Shop Lease Deed"
                placeholderTextColor={COLORS.TEXT_SECONDARY}
              />

              {/* Statutory Department / Concerned Office */}
              <Text style={styles.fieldLabel}>Statutory Department / Concerned Office</Text>
              <TextInput
                style={styles.noteInput}
                value={issuingAuthority}
                onChangeText={setIssuingAuthority}
                placeholder="e.g. RTO Goa, Pollution Dept (Govt. of Goa), Ashok Kumar"
                placeholderTextColor={COLORS.TEXT_SECONDARY}
              />

              {/* Document Number */}
              <Text style={styles.fieldLabel}>Document No</Text>
              <TextInput
                style={styles.noteInput}
                value={documentNumber}
                onChangeText={setDocumentNumber}
                placeholder="e.g. CTO-10559/2025/150"
                placeholderTextColor={COLORS.TEXT_SECONDARY}
                autoCapitalize="characters"
              />

              {/* Issue date */}
              <Text style={styles.fieldLabel}>Date of Issue (optional)</Text>
              <TouchableOpacity
                style={styles.dateBtn}
                onPress={() => setShowIssueDatePicker(true)}
              >
                <Text style={styles.dateBtnText}>
                  {issueDate
                    ? `${issueDate.getDate()} ${MONTH_LABELS[issueDate.getMonth()]} ${issueDate.getFullYear()}`
                    : 'Tap to pick issue date'}
                </Text>
              </TouchableOpacity>
              {showIssueDatePicker && (
                <DateTimePicker
                  value={issueDate || new Date()}
                  mode="date"
                  display="default"
                  maximumDate={new Date()}
                  onChange={(_event: any, selected: Date | undefined) => {
                    setShowIssueDatePicker(false);
                    if (selected) setIssueDate(selected);
                  }}
                />
              )}

              {/* Expiry */}
              <Text style={styles.fieldLabel}>Valid Upto (Expiry)</Text>
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

              {/* File picker — once a file is selected, show a thumbnail
                  for images (so the user sees what they're uploading) or
                  a 📄 file tile with size + extension for PDFs. */}
              <Text style={styles.fieldLabel}>Document file</Text>
              {pickedFile ? (
                <View style={styles.filePickedRow}>
                  {pickedFile.type?.startsWith('image/') ? (
                    <RNImage
                      source={{ uri: pickedFile.uri }}
                      style={styles.filePickedThumb}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.filePickedFileTile}>
                      <Text style={styles.filePickedFileTileIcon}>📄</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.filePickedName} numberOfLines={1}>
                      {pickedFile.name}
                    </Text>
                    <Text style={styles.filePickedHint}>
                      {pickedFile.type?.startsWith('image/')
                        ? 'Image · Tap Upload to save'
                        : 'PDF / File · Tap Upload to save'}
                    </Text>
                  </View>
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

      {/* Quick-rename modal — single-field "what should this be called?"
          shortcut. Avoids the full edit sheet when the user only wants
          to fix the document's display name. */}
      <Modal
        visible={!!renamingDoc}
        transparent
        animationType="fade"
        onRequestClose={() => !savingRename && setRenamingDoc(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalRoot}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => !savingRename && setRenamingDoc(null)}
          />
          <View style={[styles.sheet, { paddingBottom: 18 }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Rename Document</Text>
            <Text style={styles.fieldLabel}>Document Name</Text>
            <TextInput
              style={styles.noteInput}
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="e.g. Car Registration, Bike Insurance"
              placeholderTextColor={COLORS.TEXT_SECONDARY}
              autoFocus
            />
            <View style={styles.sheetActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => !savingRename && setRenamingDoc(null)}
                disabled={savingRename}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitBtn, savingRename && { opacity: 0.6 }]}
                onPress={submitRename}
                disabled={savingRename}
              >
                {savingRename ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Inline-edit modal — opens when the user taps any register row.
          Pre-filled with the row's current values; saving sends only the
          changed fields via PATCH. Delete button at the bottom removes
          the row entirely (with confirmation). */}
      <Modal
        visible={!!editingDoc}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingDoc(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalRoot}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => !savingEdit && setEditingDoc(null)}
          />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Edit Register Row</Text>

            <ScrollView
              style={{ maxHeight: 480 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.fieldLabel}>Document Name</Text>
              <TextInput
                style={styles.noteInput}
                value={editName}
                onChangeText={setEditName}
                placeholder="e.g. Car Registration"
                placeholderTextColor={COLORS.TEXT_SECONDARY}
              />

              <Text style={styles.fieldLabel}>Statutory Department / Concerned Office</Text>
              <TextInput
                style={styles.noteInput}
                value={editAuthority}
                onChangeText={setEditAuthority}
                placeholder="e.g. RTO Goa"
                placeholderTextColor={COLORS.TEXT_SECONDARY}
              />

              <Text style={styles.fieldLabel}>Document No</Text>
              <TextInput
                style={styles.noteInput}
                value={editNumber}
                onChangeText={setEditNumber}
                placeholder="e.g. CTO-10559/2025/150"
                placeholderTextColor={COLORS.TEXT_SECONDARY}
                autoCapitalize="characters"
              />

              <Text style={styles.fieldLabel}>Date of Issue</Text>
              <TouchableOpacity
                style={styles.dateBtn}
                onPress={() => setEditShowIssue(true)}
              >
                <Text style={styles.dateBtnText}>
                  {editIssueDate
                    ? `${editIssueDate.getDate()} ${MONTH_LABELS[editIssueDate.getMonth()]} ${editIssueDate.getFullYear()}`
                    : 'Tap to pick issue date'}
                </Text>
              </TouchableOpacity>
              {editShowIssue && (
                <DateTimePicker
                  value={editIssueDate || new Date()}
                  mode="date"
                  display="default"
                  maximumDate={new Date()}
                  onChange={(_event: any, selected: Date | undefined) => {
                    setEditShowIssue(false);
                    if (selected) setEditIssueDate(selected);
                  }}
                />
              )}

              <Text style={styles.fieldLabel}>Valid Upto</Text>
              <TouchableOpacity
                style={styles.dateBtn}
                onPress={() => setEditShowExpiry(true)}
              >
                <Text style={styles.dateBtnText}>
                  {editExpiryDate
                    ? `${editExpiryDate.getDate()} ${MONTH_LABELS[editExpiryDate.getMonth()]} ${editExpiryDate.getFullYear()}`
                    : 'Tap to pick expiry'}
                </Text>
              </TouchableOpacity>
              {editShowExpiry && (
                <DateTimePicker
                  value={editExpiryDate || new Date()}
                  mode="date"
                  display="default"
                  onChange={(_event: any, selected: Date | undefined) => {
                    setEditShowExpiry(false);
                    if (selected) setEditExpiryDate(selected);
                  }}
                />
              )}

              {editingDoc && (
                <TouchableOpacity
                  style={styles.deleteRowBtn}
                  onPress={() => editingDoc && confirmDelete(editingDoc)}
                  disabled={!!deletingId}
                >
                  <Text style={styles.deleteRowBtnText}>
                    {deletingId ? 'Removing…' : '🗑  Remove from register'}
                  </Text>
                </TouchableOpacity>
              )}
            </ScrollView>

            <View style={styles.sheetActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => !savingEdit && setEditingDoc(null)}
                disabled={savingEdit}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitBtn, savingEdit && { opacity: 0.6 }]}
                onPress={saveEdit}
                disabled={savingEdit}
              >
                {savingEdit ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitBtnText}>Save</Text>
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
    marginBottom: 4,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  calendarHint: {
    fontSize: 11,
    color: COLORS.TEXT_SECONDARY,
    marginBottom: 8,
    lineHeight: 15,
  },
  calendarLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 10,
  },
  calendarLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  calendarLegendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  calendarLegendText: {
    fontSize: 10,
    color: COLORS.TEXT_SECONDARY,
    fontWeight: '600',
  },
  calendarRow: { paddingRight: 8 },
  calendarCell: {
    width: 56,
    paddingVertical: 14,
    marginRight: 6,
    borderRadius: BORDER_RADIUS.MEDIUM,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.SURFACE,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
  },
  calendarMonth: {
    color: COLORS.PRIMARY_DARK,
    fontSize: 12,
    fontWeight: '800',
  },
  calendarMonthFilled: {
    color: '#FFFFFF',
  },
  calendarYear: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: 10,
    marginTop: 1,
  },
  calendarYearFilled: {
    color: 'rgba(255,255,255,0.9)',
  },

  // ─── Compliance Register (spreadsheet layout) ───────────────────────────
  registerWrap: {
    backgroundColor: COLORS.WHITE,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 16,
    marginBottom: 18,
    ...SHADOWS.light,
  },
  registerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.TEXT,
    marginBottom: 4,
  },
  registerSubtitle: {
    fontSize: 11,
    color: COLORS.TEXT_SECONDARY,
    marginBottom: 12,
    fontStyle: 'italic',
  },
  registerScroll: {
    marginHorizontal: -4,
  },
  registerTable: {
    backgroundColor: COLORS.WHITE,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    overflow: 'hidden',
  },
  regRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    minHeight: 56,
  },
  regHeader: {
    backgroundColor: '#5B7FB8',
  },
  regHeaderText: {
    color: COLORS.WHITE,
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.2,
  },
  cellSno: { width: 44, fontSize: 12, color: COLORS.TEXT, textAlign: 'center' },
  cellName: { width: 130, fontSize: 12, color: COLORS.TEXT, paddingHorizontal: 6, fontWeight: '600' },
  cellAuthority: { width: 170, fontSize: 11, color: COLORS.TEXT_SECONDARY, paddingHorizontal: 6 },
  cellDocNo: { width: 130, fontSize: 11, color: COLORS.TEXT, paddingHorizontal: 6, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  cellDate: { width: 90, fontSize: 11, color: COLORS.TEXT, paddingHorizontal: 6 },
  cellStatus: { width: 100, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  cellPdf: { width: 70, alignItems: 'center', justifyContent: 'center' },
  // Two-up wrapper: preview tile on the left, trash button on the right.
  // Width matches the column header so the table stays aligned.
  cellPdfWrap: {
    width: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  cellPdfPreview: { alignItems: 'center', justifyContent: 'center' },
  // Transparent delete button — icon-only, no red chip background.
  // Matches the line-drawing trash reference and keeps the table row
  // visually quiet so the data (status pill, doc preview) reads first.
  cellDeleteBtn: {
    width: 36,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Renamed from statusPill / statusPillText to avoid collision with the
  // existing card view's status badges.
  regStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 80,
    alignItems: 'center',
  },
  regStatusPillText: {
    color: COLORS.WHITE,
    fontWeight: '800',
    fontSize: 10,
    letterSpacing: 0.2,
  },
  statusDays: {
    fontSize: 9,
    color: COLORS.TEXT_SECONDARY,
    marginTop: 3,
  },
  pdfThumb: {
    width: 50,
    height: 44,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  pdfThumbIcon: { fontSize: 18 },
  pdfThumbText: { fontSize: 9, color: COLORS.TEXT_SECONDARY, fontWeight: '700' },

  // Row Add Button — red dashed border per the mockup, full-width
  rowAddBtn: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.ERROR,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowAddBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.ERROR,
    letterSpacing: 0.3,
  },

  // Inline-edit modal — Remove-row button
  deleteRowBtn: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.ERROR,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
  },
  deleteRowBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.ERROR,
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
    color: COLORS.PRIMARY_DARK,
    fontWeight: '700',
    fontSize: 12,
    marginRight: 8,
  },
  filePickedHint: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: 10,
    marginTop: 2,
  },
  filePickedThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    marginRight: 10,
    backgroundColor: '#E5E7EB',
  },
  filePickedFileTile: {
    width: 44,
    height: 44,
    borderRadius: 8,
    marginRight: 10,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filePickedFileTileIcon: {
    fontSize: 22,
  },
  fileRemove: {
    color: COLORS.ERROR,
    fontWeight: '700',
    fontSize: 12,
    marginLeft: 8,
  },
  // Crop pill on the picked-file row — bright green so the user
  // sees they can re-crop without removing + re-picking.
  filePickedCropBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    marginRight: 8,
  },
  filePickedCropBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
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

import { useState, useEffect, useCallback, FC } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getEnquiryById,
  getEnquiryStages,
  getVaultDocuments,
  getVaultDownloadUrl,
  acceptQuote,
  rejectQuote,
  cancelEnquiry,
  uploadDocument,
} from '../services/api';
import { getToken } from '../utils/storage';
import { isActivityLauncherError } from '../utils/cropPicker';

// Defensive load for expo-file-system + expo-sharing — both are native
// modules and need a dev-client rebuild to show up. Until then, the vault
// download falls back gracefully.
//
// Expo SDK 54+ deprecated `createDownloadResumable` + `cacheDirectory` on
// the main `expo-file-system` entry; they live under the `/legacy`
// sub-path now. Try the legacy path first, fall back to main for older
// SDKs so this keeps working across the version range.
let FileSystem: any = null;
let Sharing: any = null;
let fileSystemReady = false;
try {
  try {
    // eslint-disable-next-line global-require
    FileSystem = require('expo-file-system/legacy');
  } catch (_) {
    // eslint-disable-next-line global-require
    FileSystem = require('expo-file-system');
  }
  // eslint-disable-next-line global-require
  Sharing = require('expo-sharing');
  fileSystemReady = typeof FileSystem?.createDownloadResumable === 'function'
    || typeof FileSystem?.downloadAsync === 'function';
} catch (_) {
  fileSystemReady = false;
}

// Defensive load: expo-document-picker is a native module, same pattern as
// BookingScreen — only show the "Choose File" path when it's in the APK.
let DocumentPicker: any = null;
let documentPickerAvailable = false;
try {
  // eslint-disable-next-line global-require
  DocumentPicker = require('expo-document-picker');
  documentPickerAvailable = typeof DocumentPicker?.getDocumentAsync === 'function';
} catch (_) {
  documentPickerAvailable = false;
}

// Fallback timeline — used only if /enquiries/:id/stages fails (e.g. old
// enquiry created before the stages system was live). Real data comes from
// the backend and renders granular service-specific milestones.
const FALLBACK_TIMELINE = [
  { stage_key: 'pending',     label: 'Enquiry Submitted',   description: 'Waiting for admin to review and issue a quote.' },
  { stage_key: 'quoted',      label: 'Quote Received',      description: 'Review the quote and accept to start work.' },
  { stage_key: 'accepted',    label: 'Quote Accepted',      description: 'Pay the invoice; work begins once payment clears.' },
  { stage_key: 'in_progress', label: 'Work in Progress',    description: 'Your liaisoning expert is handling the application.' },
  { stage_key: 'completed',   label: 'Service Delivered',   description: 'Certificates/documents ready to download.' },
];

const TERMINAL_STATES: Record<string, { label: string; hint: string }> = {
  rejected:  { label: 'Rejected',  hint: 'This enquiry was rejected and cannot be reopened. Submit a new enquiry to retry.' },
  cancelled: { label: 'Cancelled', hint: 'You cancelled this enquiry.' },
};

const STATUS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  pending:     { bg: '#FFF4E5', color: '#A15A00', label: 'Pending Review' },
  quoted:      { bg: '#E3F2FD', color: '#0D47A1', label: 'Quote Received' },
  accepted:    { bg: '#E8F5E9', color: '#1B5E20', label: 'Accepted' },
  in_progress: { bg: '#EDE7F6', color: '#4527A0', label: 'In Progress' },
  completed:   { bg: '#E0F2F1', color: '#004D40', label: 'Completed' },
  rejected:    { bg: '#FFEBEE', color: '#B71C1C', label: 'Rejected' },
  cancelled:   { bg: '#ECEFF1', color: '#37474F', label: 'Cancelled' },
};

const formatDate = (iso: any): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  } catch (_) {
    return iso;
  }
};

const formatCurrency = (n: any): string => {
  if (n == null) return '—';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (Number.isNaN(num)) return '—';
  return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

interface Props {
  navigation: {
    navigate: (route: string, params?: Record<string, unknown>) => void;
    goBack: () => void;
    replace?: (route: string) => void;
    addListener?: (event: string, cb: () => void) => () => void;
  };
  route: { params?: { [key: string]: any } };
}

const EnquiryDetailsScreen: FC<Props> = ({ route, navigation }) => {
  const { enquiryId } = route.params || {};
  const [enquiry, setEnquiry] = useState<any>(null);
  const [stages, setStages] = useState<any[] | null>(null); // null = not yet loaded, [] = loaded empty
  const [vaultDocs, setVaultDocs] = useState<any[]>([]);
  const [downloadingId, setDownloadingId] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [uploadedDocs, setUploadedDocs] = useState<any[]>([]);

  const load = useCallback(async (): Promise<void> => {
    try {
      // Fetch in parallel so the screen hydrates as fast as possible.
      const [enqRes, stagesRes, vaultRes] = await Promise.all([
        getEnquiryById(enquiryId),
        getEnquiryStages(enquiryId).catch((e: any) => {
          console.log('[enquiry] stages fetch failed:', e?.message);
          return null;
        }),
        getVaultDocuments(enquiryId).catch((e: any) => {
          console.log('[enquiry] vault fetch failed:', e?.message);
          return null;
        }),
      ]);
      setEnquiry(enqRes?.data || enqRes);
      const stageList = stagesRes?.data || stagesRes;
      setStages(Array.isArray(stageList) ? stageList : []);
      const vaultList = vaultRes?.data || vaultRes;
      setVaultDocs(Array.isArray(vaultList) ? vaultList : []);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not load enquiry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [enquiryId]);

  useEffect(() => { load(); }, [load]);

  // Hydrate local-upload cache so uploads done on this device survive reloads.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(`enquiry_docs_${enquiryId}`);
        if (raw) setUploadedDocs(JSON.parse(raw));
      } catch (_) {}
    })();
  }, [enquiryId]);

  const persistDocs = async (next: any[]): Promise<void> => {
    setUploadedDocs(next);
    try {
      await AsyncStorage.setItem(`enquiry_docs_${enquiryId}`, JSON.stringify(next));
    } catch (_) {}
  };

  const onRefresh = (): void => { setRefreshing(true); load(); };

  // Download an encrypted vault doc. Backend streams plaintext (after
  // decrypting + auth-logging). We need the Bearer token on the GET so use
  // expo-file-system rather than a naive Linking.openURL.
  const handleDownloadVaultDoc = async (doc: any): Promise<void> => {
    if (!fileSystemReady) {
      Alert.alert(
        'Unavailable',
        'Downloading vault documents requires a fresh app build (expo-file-system native module).',
      );
      return;
    }
    try {
      setDownloadingId(doc.id);
      const token = await getToken();
      const url = getVaultDownloadUrl(doc.id);

      // Sanitize filename for local cache
      const safeName = String(doc.original_name || `vault_${doc.id}`).replace(/[^a-zA-Z0-9._-]/g, '_');
      const targetPath = `${FileSystem.cacheDirectory || ''}${Date.now()}_${safeName}`;

      const result = await FileSystem.downloadAsync(url, targetPath, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (result.status !== 200) {
        throw new Error(`Server returned ${result.status}`);
      }

      // Hand the file off to the OS share sheet so the user can save / open
      // with their preferred app. Falls back to an alert with the local
      // path if sharing isn't available.
      if (Sharing && await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, {
          mimeType: doc.mime_type || undefined,
          dialogTitle: doc.original_name,
        });
      } else {
        Alert.alert('Downloaded', `Saved to ${result.uri}`);
      }
    } catch (e: any) {
      console.error('vault download failed:', e);
      Alert.alert('Download failed', e?.message || 'Could not download the file.');
    } finally {
      setDownloadingId(null);
    }
  };

  // ─── Actions ─────────────────────────────────────────────────────────────
  const handleAccept = async (): Promise<void> => {
    Alert.alert(
      'Accept Quote?',
      'Once accepted, work begins after we receive your bank transfer for the invoiced amount.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept',
          onPress: async () => {
            try {
              setBusy(true);
              await acceptQuote(enquiryId);
              await load();
              Alert.alert('Quote Accepted', 'You will receive an invoice shortly. Pay it to have work started.');
            } catch (e: any) {
              Alert.alert('Could not accept', e?.message || 'Please try again.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const handleReject = async (): Promise<void> => {
    Alert.alert(
      'Reject Quote?',
      'This is final — the enquiry will be closed. You can submit a new enquiry later if you change your mind.',
      [
        { text: 'Keep open', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            try {
              setBusy(true);
              await rejectQuote(enquiryId);
              await load();
            } catch (e: any) {
              Alert.alert('Could not reject', e?.message || 'Please try again.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const handleCancel = async (): Promise<void> => {
    Alert.alert(
      'Cancel this enquiry?',
      'You can cancel any enquiry that has not yet been accepted. This cannot be undone.',
      [
        { text: 'Keep enquiry', style: 'cancel' },
        {
          text: 'Cancel Enquiry',
          style: 'destructive',
          onPress: async () => {
            try {
              setBusy(true);
              await cancelEnquiry(enquiryId);
              await load();
            } catch (e: any) {
              Alert.alert('Could not cancel', e?.message || 'Please try again.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  // ─── Document upload ─────────────────────────────────────────────────────
  const pickAndUploadDoc = async (): Promise<void> => {
    if (!documentPickerAvailable) {
      Alert.alert(
        'Unavailable',
        'Document picker requires a fresh app build. Use the booking flow to upload from camera/gallery for now.',
      );
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const file = result.assets[0];
      const mime = file.mimeType || 'application/octet-stream';
      const name = file.name || `enquiry_${enquiryId}_${Date.now()}`;

      setBusy(true);
      const uploadData = new FormData();
      uploadData.append('file', { uri: file.uri, type: mime, name } as any);
      // Document model uses strict Sequelize enums:
      //   document_type ∈ aadhaar_front|…|other
      //   category      ∈ kyc|booking|application
      // Enquiry docs don't map cleanly to either, so use the catch-all
      // enum values and encode the enquiry id + filename in notes so the
      // admin panel can find them later.
      uploadData.append('document_type', 'other');
      uploadData.append('category', 'application');
      uploadData.append('file_name', name);
      uploadData.append('notes', `enquiry:${enquiryId} name:${name}`);

      const res: any = await uploadDocument('', uploadData);
      const saved = {
        id: res?.data?.id || `local_${Date.now()}`,
        name,
        mime,
        uploaded_at: new Date().toISOString(),
      };
      await persistDocs([saved, ...uploadedDocs]);
      Alert.alert('Uploaded', `${name} attached to this enquiry.`);
    } catch (e: any) {
      // The host Activity can be recreated mid-pick on aggressive-memory
      // OEMs, leaving expo's file-picker launcher unregistered. Tell the
      // user plainly so they retry rather than think the upload broke.
      Alert.alert(
        'Upload failed',
        isActivityLauncherError(e)
          ? 'This device blocked the file picker. Please try again — if it keeps failing, upload the document from the booking flow using Camera or Gallery.'
          : e?.message || 'Could not upload document.',
      );
    } finally {
      setBusy(false);
    }
  };

  // ─── Derived UI values ───────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color="#0D3B66" />
      </View>
    );
  }

  if (!enquiry) {
    return (
      <View style={styles.loadingWrap}>
        <Text style={styles.errorText}>Enquiry not found.</Text>
      </View>
    );
  }

  const status = enquiry.status || 'pending';
  const badge = STATUS_BADGE[status] || STATUS_BADGE.pending;
  const isTerminal = status === 'rejected' || status === 'cancelled';
  const terminal = TERMINAL_STATES[status];

  // Decide what the tracker shows:
  //   1. If backend returned real stages (from EnquiryStage table) → use them
  //   2. Otherwise → coarse fallback derived from the enquiry.status ENUM
  const useRealStages = Array.isArray(stages) && stages.length > 0;
  const timelineItems: any[] = useRealStages
    ? (stages as any[]).map((s: any) => ({
        stage_key: s.stage_key,
        label: s.label,
        description: s.description,
        status: s.status,        // 'pending' | 'in_progress' | 'done' | 'blocked' | 'skipped'
        admin_note: s.admin_note,
        started_at: s.started_at,
        completed_at: s.completed_at,
      }))
    : FALLBACK_TIMELINE.map((s) => ({ ...s, status: 'pending' }));

  // For the fallback: derive active index from the coarse enquiry.status.
  const fallbackActiveIdx = !useRealStages
    ? FALLBACK_TIMELINE.findIndex((s) => s.stage_key === status)
    : -1;

  const canAcceptReject = status === 'quoted';
  const canCancel = status === 'pending' || status === 'quoted';
  const canUpload = !isTerminal && status !== 'completed';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Header card */}
      <View style={styles.headerCard}>
        <Text style={styles.serviceName}>{enquiry.service?.name || 'Industrial service'}</Text>
        {!!enquiry.service?.category && (
          <Text style={styles.category}>{enquiry.service.category}</Text>
        )}
        <View style={[styles.badge, { backgroundColor: badge.bg }]}>
          <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
        </View>
      </View>

      {/* Terminal state callout */}
      {isTerminal && (
        <View style={styles.terminalCard}>
          <Text style={styles.terminalTitle}>{terminal.label}</Text>
          <Text style={styles.terminalHint}>{terminal.hint}</Text>
        </View>
      )}

      {/* Milestone Tracker */}
      {!isTerminal && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📍 Progress</Text>
          <View style={styles.tracker}>
            {timelineItems.map((stage: any, idx: number) => {
              // Real data: use the stage's own status. Fallback: derive from
              // position relative to the coarse enquiry.status.
              let isDone: boolean, isCurrent: boolean, isFuture: boolean, isBlocked: boolean | undefined, isSkipped: boolean | undefined;
              if (useRealStages) {
                isDone = stage.status === 'done';
                isCurrent = stage.status === 'in_progress';
                isBlocked = stage.status === 'blocked';
                isSkipped = stage.status === 'skipped';
                isFuture = stage.status === 'pending';
              } else {
                isDone = idx < fallbackActiveIdx;
                isCurrent = idx === fallbackActiveIdx;
                isFuture = idx > fallbackActiveIdx;
              }
              return (
                <View key={stage.stage_key + idx} style={styles.stageRow}>
                  <View style={styles.stageLeft}>
                    <View
                      style={[
                        styles.stageDot,
                        isDone && styles.stageDotDone,
                        isCurrent && styles.stageDotCurrent,
                        isBlocked && styles.stageDotBlocked,
                        (isFuture || isSkipped) && styles.stageDotFuture,
                      ]}
                    >
                      {isDone && <Text style={styles.stageCheck}>✓</Text>}
                      {isBlocked && <Text style={styles.stageCheck}>!</Text>}
                    </View>
                    {idx < timelineItems.length - 1 && (
                      <View style={[styles.stageLine, isDone && styles.stageLineDone]} />
                    )}
                  </View>
                  <View style={styles.stageBody}>
                    <Text
                      style={[
                        styles.stageLabel,
                        isCurrent && styles.stageLabelCurrent,
                        isBlocked && styles.stageLabelBlocked,
                        (isFuture || isSkipped) && styles.stageLabelFuture,
                      ]}
                    >
                      {stage.label}
                      {isSkipped ? ' (skipped)' : ''}
                    </Text>
                    {(isCurrent || isBlocked) && !!stage.description && (
                      <Text style={styles.stageHint}>{stage.description}</Text>
                    )}
                    {!!stage.admin_note && (
                      <Text style={styles.stageNote}>💬 {stage.admin_note}</Text>
                    )}
                    {!!stage.completed_at && isDone && (
                      <Text style={styles.stageMeta}>Done · {formatDate(stage.completed_at)}</Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
          {!useRealStages && (
            <Text style={styles.trackerFootnote}>
              Granular milestones will appear here as your liaisoning expert advances the file.
            </Text>
          )}
        </View>
      )}

      {/* Quote card — only when quoted */}
      {status === 'quoted' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>💰 Quote</Text>
          <View style={styles.quoteCard}>
            <View style={styles.quoteRow}>
              <Text style={styles.quoteLabel}>Service Fee</Text>
              <Text style={styles.quoteValue}>{formatCurrency(enquiry.quote_service_fee)}</Text>
            </View>
            {enquiry.quote_govt_fees != null && (
              <View style={styles.quoteRow}>
                <Text style={styles.quoteLabel}>Government Fees</Text>
                <Text style={styles.quoteValue}>{formatCurrency(enquiry.quote_govt_fees)}</Text>
              </View>
            )}
            {!!enquiry.quote_cycle && (
              <View style={styles.quoteRow}>
                <Text style={styles.quoteLabel}>Cycle</Text>
                <Text style={styles.quoteValue}>{String(enquiry.quote_cycle).replace(/_/g, ' ')}</Text>
              </View>
            )}
            {!!enquiry.quote_valid_until && (
              <View style={styles.quoteRow}>
                <Text style={styles.quoteLabel}>Valid Until</Text>
                <Text style={styles.quoteValue}>{formatDate(enquiry.quote_valid_until)}</Text>
              </View>
            )}
            {!!enquiry.quote_terms && (
              <View style={styles.quoteTerms}>
                <Text style={styles.quoteTermsLabel}>Terms</Text>
                <Text style={styles.quoteTermsText}>{enquiry.quote_terms}</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Post-acceptance — admin-handoff message. */}
      {status === 'accepted' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>✅ Acceptance Recorded</Text>
          <View style={styles.infoCard}>
            <Text style={styles.infoText}>
              Thanks for accepting the quote. Our admin will review and assign a service
              representative shortly — you'll get a push notification the moment they're on
              the way. Track progress under My Bookings once the rep is assigned.
            </Text>
          </View>
        </View>
      )}

      {/* Enquiry meta */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📋 Enquiry Details</Text>
        <View style={styles.infoCard}>
          <InfoRow label="Submitted" value={formatDate(enquiry.created_at)} />
          <InfoRow label="Urgency" value={enquiry.urgency || 'standard'} />
          {!!enquiry.preferred_contact_time && (
            <InfoRow label="Preferred contact" value={enquiry.preferred_contact_time} />
          )}
          {!!enquiry.quote_issued_at && (
            <InfoRow label="Quote issued" value={formatDate(enquiry.quote_issued_at)} />
          )}
          {!!enquiry.responded_at && (
            <InfoRow label="Responded" value={formatDate(enquiry.responded_at)} />
          )}
          {!!enquiry.completed_at && (
            <InfoRow label="Completed" value={formatDate(enquiry.completed_at)} />
          )}
          {!!enquiry.notes && (
            <View style={styles.notesBlock}>
              <Text style={styles.notesLabel}>Your scope notes</Text>
              <Text style={styles.notesText}>{enquiry.notes}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Vault — admin-issued deliverables and corporate docs */}
      {vaultDocs.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🔒 Secure Documents</Text>
          <View style={styles.infoCard}>
            <Text style={styles.mutedText}>
              Encrypted documents issued by your liaisoning expert. Tap to download.
            </Text>
            {vaultDocs.map((d: any) => {
              const isDeliverable = d.tier === 'deliverable';
              const isSensitive = d.tier === 'sensitive';
              return (
                <View key={d.id} style={styles.vaultRow}>
                  <View style={styles.vaultRowLeft}>
                    <Text style={styles.vaultName} numberOfLines={1}>
                      {isDeliverable ? '🏆 ' : isSensitive ? '🔐 ' : '📄 '}
                      {d.original_name}
                    </Text>
                    <Text style={styles.vaultMeta}>
                      {(d.plaintext_size / 1024).toFixed(0)} KB · {formatDate(d.created_at)}
                    </Text>
                    {!!d.note && <Text style={styles.vaultNote}>{d.note}</Text>}
                  </View>
                  <TouchableOpacity
                    style={[styles.downloadButton, downloadingId === d.id && styles.buttonDisabled]}
                    onPress={() => handleDownloadVaultDoc(d)}
                    disabled={downloadingId === d.id}
                  >
                    <Text style={styles.downloadButtonText}>
                      {downloadingId === d.id ? '…' : '⬇'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
            {!fileSystemReady && (
              <Text style={styles.trackerFootnote}>
                Downloads require the next dev-client rebuild (expo-file-system).
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Documents */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📎 Documents</Text>
        <View style={styles.infoCard}>
          {uploadedDocs.length === 0 ? (
            <Text style={styles.mutedText}>
              Attach any supporting documents your liaisoning expert may need — past licences, board
              resolutions, GST certificate, site photos, etc.
            </Text>
          ) : (
            uploadedDocs.map((d: any) => (
              <View key={d.id} style={styles.docRow}>
                <Text style={styles.docName} numberOfLines={1}>📄 {d.name}</Text>
                <Text style={styles.docMeta}>{formatDate(d.uploaded_at)}</Text>
              </View>
            ))
          )}
          {canUpload && (
            <TouchableOpacity
              style={[styles.secondaryButton, busy && styles.buttonDisabled]}
              onPress={pickAndUploadDoc}
              disabled={busy}
            >
              <Text style={styles.secondaryButtonText}>
                {documentPickerAvailable ? '+ Upload Document' : '+ Upload Document (needs rebuild)'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        {canAcceptReject && (
          <>
            <TouchableOpacity
              style={[styles.primaryButton, busy && styles.buttonDisabled]}
              onPress={handleAccept}
              disabled={busy}
            >
              <Text style={styles.primaryButtonText}>Accept Quote</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dangerButton, busy && styles.buttonDisabled]}
              onPress={handleReject}
              disabled={busy}
            >
              <Text style={styles.dangerButtonText}>Reject Quote</Text>
            </TouchableOpacity>
          </>
        )}
        {canCancel && (
          <TouchableOpacity
            style={[styles.ghostButton, busy && styles.buttonDisabled]}
            onPress={handleCancel}
            disabled={busy}
          >
            <Text style={styles.ghostButtonText}>Cancel Enquiry</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
};

interface InfoRowProps {
  label: string;
  value: any;
}

const InfoRow: FC<InfoRowProps> = ({ label, value }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  content: { padding: 16 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F7FA' },
  errorText: { color: '#B71C1C', fontSize: 16, fontWeight: '600' },

  headerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#0D3B66', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  serviceName: { fontSize: 18, fontWeight: '800', color: '#0D3B66' },
  category: { fontSize: 13, color: '#546E7A', marginTop: 4 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginTop: 10 },
  badgeText: { fontSize: 12, fontWeight: '700' },

  terminalCard: {
    backgroundColor: '#FFF1F1',
    borderLeftWidth: 4,
    borderLeftColor: '#B71C1C',
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
  },
  terminalTitle: { fontSize: 15, fontWeight: '700', color: '#B71C1C' },
  terminalHint: { fontSize: 13, color: '#5D4037', marginTop: 4 },

  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#0D3B66', marginBottom: 8 },

  tracker: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#0D3B66', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  stageRow: { flexDirection: 'row', minHeight: 48 },
  stageLeft: { alignItems: 'center', width: 28 },
  stageDot: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#CFD8DC',
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
  },
  stageDotDone: { backgroundColor: '#2E7D32', borderColor: '#2E7D32' },
  stageDotCurrent: { backgroundColor: '#FFF3E0', borderColor: '#EF6C00', borderWidth: 3 },
  stageDotFuture: { backgroundColor: '#FFFFFF', borderColor: '#CFD8DC' },
  stageDotBlocked: { backgroundColor: '#B71C1C', borderColor: '#B71C1C' },
  stageCheck: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  stageLine: { flex: 1, width: 2, backgroundColor: '#CFD8DC', marginTop: 2 },
  stageLineDone: { backgroundColor: '#2E7D32' },
  stageBody: { flex: 1, paddingLeft: 12, paddingBottom: 16 },
  stageLabel: { fontSize: 14, fontWeight: '700', color: '#263238' },
  stageLabelCurrent: { color: '#EF6C00' },
  stageLabelFuture: { color: '#90A4AE', fontWeight: '500' },
  stageLabelBlocked: { color: '#B71C1C' },
  stageHint: { fontSize: 12, color: '#546E7A', marginTop: 2 },
  stageNote: { fontSize: 12, color: '#37474F', marginTop: 4, fontStyle: 'italic' },
  stageMeta: { fontSize: 11, color: '#90A4AE', marginTop: 3 },
  trackerFootnote: { fontSize: 11, color: '#90A4AE', marginTop: 8, fontStyle: 'italic' },

  quoteCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#0D47A1',
  },
  quoteRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  quoteLabel: { fontSize: 13, color: '#546E7A' },
  quoteValue: { fontSize: 14, fontWeight: '700', color: '#0D3B66' },
  quoteTerms: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#ECEFF1' },
  quoteTermsLabel: { fontSize: 12, color: '#78909C', fontWeight: '700', marginBottom: 4 },
  quoteTermsText: { fontSize: 13, color: '#37474F', lineHeight: 18 },

  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#0D3B66', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  infoLabel: { fontSize: 13, color: '#78909C' },
  infoValue: { fontSize: 13, color: '#263238', fontWeight: '600', maxWidth: '60%', textAlign: 'right' },
  infoText: { fontSize: 13, color: '#37474F', lineHeight: 19 },
  mutedText: { fontSize: 13, color: '#78909C', lineHeight: 18 },
  notesBlock: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#ECEFF1' },
  notesLabel: { fontSize: 12, fontWeight: '700', color: '#78909C', marginBottom: 4 },
  notesText: { fontSize: 13, color: '#37474F', lineHeight: 19 },

  docRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#ECEFF1',
  },
  docName: { fontSize: 13, color: '#263238', flex: 1, marginRight: 8 },
  docMeta: { fontSize: 11, color: '#90A4AE' },

  vaultRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#ECEFF1',
  },
  vaultRowLeft: { flex: 1, marginRight: 10 },
  vaultName: { fontSize: 13, color: '#263238', fontWeight: '600' },
  vaultMeta: { fontSize: 11, color: '#90A4AE', marginTop: 2 },
  vaultNote: { fontSize: 12, color: '#546E7A', marginTop: 4, fontStyle: 'italic' },
  downloadButton: {
    backgroundColor: '#0D3B66', width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  downloadButtonText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },

  actions: { marginTop: 4 },
  primaryButton: {
    backgroundColor: '#0D3B66',
    borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 10,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  dangerButton: {
    backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#B71C1C',
    borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginBottom: 10,
  },
  dangerButtonText: { color: '#B71C1C', fontSize: 15, fontWeight: '700' },
  ghostButton: {
    backgroundColor: 'transparent', borderWidth: 1, borderColor: '#B0BEC5',
    borderRadius: 10, paddingVertical: 12, alignItems: 'center',
  },
  ghostButtonText: { color: '#546E7A', fontSize: 14, fontWeight: '600' },
  secondaryButton: {
    marginTop: 12,
    backgroundColor: '#E3F2FD', borderRadius: 8, paddingVertical: 10, alignItems: 'center',
  },
  secondaryButtonText: { color: '#0D47A1', fontSize: 13, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
});

export default EnquiryDetailsScreen;

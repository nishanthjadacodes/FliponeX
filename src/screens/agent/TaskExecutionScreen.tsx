import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { captureWithCrop, pickWithCrop } from '../../utils/cropPicker';
import { formatBookingAddress } from '../../utils/addressFormat';
import * as Location from 'expo-location';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  updateTaskStatus,
  completeTask,
  acceptTask,
  rejectTask,
  uploadComplianceForCustomer,
} from '../../services/agent/api';
import { COLORS, SIZES } from '../../constants/agent/colors';
import { getApiBaseUrl } from '../../config/agent';
import AsyncStorage from '@react-native-async-storage/async-storage';

const COMPLIANCE_TYPES: { id: string; label: string }[] = [
  { id: 'factory_license', label: 'Factory License' },
  { id: 'fire_noc', label: 'Fire NOC' },
  { id: 'pollution_noc', label: 'Pollution NOC' },
  { id: 'gst_certificate', label: 'GST Certificate' },
  { id: 'incorporation', label: 'Certificate of Incorporation' },
  { id: 'iso_cert', label: 'ISO Certification' },
  { id: 'trade_license', label: 'Trade License' },
  { id: 'esi_pf', label: 'ESI / PF Registration' },
  { id: 'other', label: 'Other' },
];

const formatExpiryDate = (d: Date | null): string => {
  if (!d) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
};

const haversineKm = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
  const R = 6371;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
};

interface Task {
  id: string;
  customerId?: string;
  customerName: string;
  serviceName: string;
  address: string;
  amount: number;
  customerPhone: string;
  status: string;
  createdAt?: string;
  distance: string;
  preferredDate?: string;
  preferredTime?: string;
  requiredDocuments?: unknown;
}

interface StatusFlowItem {
  id: string;
  label: string;
  description: string;
}

interface PhotoAsset {
  uri: string;
  [key: string]: unknown;
}

interface NavigationLike {
  navigate: (route: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
}

interface TaskExecutionScreenProps {
  route: { params: { taskId: string } };
  navigation: NavigationLike;
}

const TaskExecutionScreen: React.FC<TaskExecutionScreenProps> = ({ route, navigation }) => {
  const { taskId } = route.params;
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [updating, setUpdating] = useState<boolean>(false);
  const [otpModalVisible, setOtpModalVisible] = useState<boolean>(false);
  const [otp, setOtp] = useState<string>('');
  // DEV-MODE OTP capture — backend returns the customer's completion OTP in
  // the work_completed response so the rep can complete the booking even if
  // the customer never received the SMS/push. Hidden in production.
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [documentsModalVisible, setDocumentsModalVisible] = useState<boolean>(false);
  const [capturedPhotos, setCapturedPhotos] = useState<PhotoAsset[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ─── Compliance upload state (rep-on-behalf-of-customer) ────────────────
  const [showComplianceModal, setShowComplianceModal] = useState<boolean>(false);
  const [complianceType, setComplianceType] = useState<string>('factory_license');
  const [complianceExpiry, setComplianceExpiry] = useState<Date | null>(null);
  const [complianceShowDate, setComplianceShowDate] = useState<boolean>(false);
  const [complianceFile, setComplianceFile] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [complianceUploading, setComplianceUploading] = useState<boolean>(false);

  const statusFlow: StatusFlowItem[] = [
    { id: 'started', label: 'Started', description: 'Task has been started' },
    { id: 'reached_location', label: 'Reached Location', description: 'Representative has reached the customer location' },
    { id: 'documents_collected', label: 'Documents Collected', description: 'Required documents have been collected' },
    { id: 'work_completed', label: 'Work Completed', description: 'Awaiting OTP verification from customer' },
  ];

  useEffect(() => {
    loadTaskDetails();
  }, [taskId]);

  const loadTaskDetails = async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const token = await AsyncStorage.getItem('agent_token');
      const response = await fetch(`${getApiBaseUrl()}/bookings/${taskId}?_t=${Date.now()}`, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const text = await response.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (_) {
        /* ignore */
      }

      if (!response.ok) {
        const reason = data?.message || `HTTP ${response.status}`;
        if (response.status === 401 || response.status === 403) {
          setLoadError(`Access denied: ${reason}. Try logging in again from Profile → Logout.`);
        } else if (response.status === 404) {
          setLoadError('This booking no longer exists or has been reassigned.');
        } else {
          setLoadError(reason);
        }
        return;
      }

      if (data.success && data.data) {
        const b = data.data;
        // Capture the dev-mode OTP if the booking is already at the
        // work_completed/submitted stage. This way navigating away and
        // back doesn't lose the OTP banner.
        if (b.completion_otp) setDevOtp(String(b.completion_otp));
        // Prefer the customer's actual coordinates (last known position
        // pinged from their device) over geocoding the typed address.
        // Android's Location.geocodeAsync returns empty on devices
        // without Google Mobile Services, which is why the previous
        // version always showed "Address unresolved".
        const customerLat = b.customer?.current_lat
          ? Number(b.customer.current_lat)
          : null;
        const customerLng = b.customer?.current_lng
          ? Number(b.customer.current_lng)
          : null;
        const nextTask: Task = {
          id: b.id,
          customerId: b.customer_id || b.customer?.id || undefined,
          customerName: b.customer_name || b.customer?.name || 'Unknown',
          serviceName: b.service?.name || 'Service',
          address: b.service_address || 'No address',
          amount: b.service?.partner_earning || b.price_quoted || 0,
          customerPhone: b.customer_mobile || b.customer?.mobile || '',
          status: mapBackendStatus(b.status),
          createdAt: b.created_at,
          distance: 'Calculating…',
          preferredDate: b.preferred_date,
          preferredTime: b.preferred_time,
          requiredDocuments: b.documents_required || b.service?.required_documents,
        };
        setTask(nextTask);
        computeDistance(nextTask.address, customerLat, customerLng);
      } else {
        setLoadError(data?.message || 'Task data is empty.');
      }
    } catch (error: any) {
      console.error('Error loading task details:', error);
      setLoadError(error?.message || 'Network error. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const computeDistance = async (
    address: string,
    customerLat: number | null,
    customerLng: number | null,
  ): Promise<void> => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setTask((t) => (t ? { ...t, distance: 'Enable location' } : t));
        return;
      }

      const agentPos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      // Path A — use the customer's actual coords if the backend has
      // them. This is the reliable path; works on every Android
      // device regardless of geocoder availability.
      if (
        customerLat != null &&
        customerLng != null &&
        Number.isFinite(customerLat) &&
        Number.isFinite(customerLng)
      ) {
        const km = haversineKm(
          agentPos.coords.latitude,
          agentPos.coords.longitude,
          customerLat,
          customerLng,
        );
        const display = km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
        setTask((t) => (t ? { ...t, distance: display } : t));
        return;
      }

      // Path B — fall back to geocoding the typed address. Often
      // returns [] on Android devices without Google Mobile Services
      // (custom ROMs, Huawei, etc.) — in that case we show a helpful
      // hint instead of pretending we know the distance.
      if (!address || address === 'No address') {
        setTask((t) => (t ? { ...t, distance: 'No address' } : t));
        return;
      }
      const geocoded = await Location.geocodeAsync(address).catch(
        () => [] as Location.LocationGeocodedLocation[],
      );
      if (!geocoded || geocoded.length === 0) {
        setTask((t) => (t ? { ...t, distance: 'Tap address to navigate' } : t));
        return;
      }
      const km = haversineKm(
        agentPos.coords.latitude,
        agentPos.coords.longitude,
        geocoded[0].latitude,
        geocoded[0].longitude,
      );
      const display = km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
      setTask((t) => (t ? { ...t, distance: display } : t));
    } catch (e: any) {
      console.log('computeDistance failed:', e?.message);
      setTask((t) => (t ? { ...t, distance: 'N/A' } : t));
    }
  };

  const mapBackendStatus = (s: string): string => {
    switch (s) {
      case 'pending':
      case 'new':
        return 'new';
      case 'assigned':
      case 'accepted':
        return 'accepted';
      case 'started':
      case 'in_progress':
      case 'reached_location':
        return s;
      case 'documents_collected':
        return 'documents_collected';
      case 'submitted':
      case 'work_completed':
        return 'work_completed';
      case 'completed':
        return 'completed';
      default:
        return s;
    }
  };

  const handleAcceptTask = async (): Promise<void> => {
    setUpdating(true);
    try {
      await acceptTask(taskId);
      setTask((t) => (t ? { ...t, status: 'accepted' } : t));
      Alert.alert('Accepted', 'Task accepted. Tap "Start Task" to begin.');
    } catch (error) {
      console.error('Error accepting task:', error);
      Alert.alert('Error', 'Failed to accept task');
    } finally {
      setUpdating(false);
    }
  };

  const handleRejectTask = (): void => {
    Alert.alert('Reject Task', 'Are you sure you want to reject this job?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: async () => {
          setUpdating(true);
          try {
            await rejectTask(taskId);
            Alert.alert('Rejected', 'Task has been rejected.', [
              { text: 'OK', onPress: () => navigation.goBack() },
            ]);
          } catch (error) {
            Alert.alert('Error', 'Failed to reject task');
          } finally {
            setUpdating(false);
          }
        },
      },
    ]);
  };

  const updateStatus = async (newStatus: string, silent = false): Promise<void> => {
    setUpdating(true);
    try {
      const res: any = await updateTaskStatus(taskId, newStatus);
      // The agent fetchAPI wrapper returns { success: false, message } for
      // some failure modes instead of throwing, so check both.
      if (res && res.success === false) {
        const msg = String(res.message || 'Failed to update status');
        Alert.alert('Cannot update status', msg);
        return;
      }
      setTask((t) => (t ? { ...t, status: newStatus } : t));
      // Backend returns the customer's completion OTP on the work_completed
      // response so we can show it in the OTP modal — handy when SMS/push
      // delivery to the customer hasn't been wired up yet.
      const otpFromServer =
        res?.completion_otp || res?.data?.completion_otp || null;
      console.log('[updateStatus] OTP from server:', otpFromServer, 'response keys:', Object.keys(res || {}));
      if (otpFromServer) setDevOtp(String(otpFromServer));
      if (!silent) {
        Alert.alert('Success', `Status updated: ${newStatus.replace(/_/g, ' ')}`);
      }
    } catch (error: any) {
      console.error('Error updating status:', error);
      const status = error?.httpStatus;
      const reason = error?.message || 'Failed to update status';
      let helpful = reason;
      if (status === 403) {
        helpful =
          'You can only update bookings assigned to you. Ask an admin to ' +
          'assign this booking to your representative ID, then retry.';
      } else if (status === 401) {
        helpful = 'Your session expired. Open Profile → Logout, then log back in.';
      } else if (status === 404) {
        helpful = 'This booking no longer exists or was reassigned.';
      } else if (status === 400) {
        helpful = `Invalid status. ${reason}`;
      }
      Alert.alert('Cannot update status', helpful);
    } finally {
      setUpdating(false);
    }
  };

  const handleStartTask = (): Promise<void> => updateStatus('started');
  const handleReachedLocation = (): Promise<void> => updateStatus('reached_location');
  const handleWorkCompleted = async (): Promise<void> => {
    // Mark the work as complete so the backend generates (or re-returns)
    // the completion OTP. The `silent: true` skips the "Status updated"
    // alert — opening the OTP modal is feedback enough. Idempotent: on
    // bookings already at work_completed, backend just re-emits the OTP.
    await updateStatus('work_completed', true);
    // Signal the dashboard to do a force-refresh on its next focus —
    // booking just transitioned to 'submitted' on the backend, so
    // /earnings now includes today's commission. The flag is read +
    // cleared by DashboardScreen's focus listener.
    AsyncStorage.setItem('dashboard_force_refresh', String(Date.now())).catch(() => {});
    setOtpModalVisible(true);
  };

  const handleCollectDocuments = (): void => {
    setDocumentsModalVisible(true);
  };

  const handleDocumentsCollected = (): void => {
    if (capturedPhotos.length === 0) {
      Alert.alert('No Photos', 'Please capture at least one document photo before proceeding.');
      return;
    }
    // Count how many docs the customer's service actually requires
    // (filtering out non-uploadable text fields like Mobile Number).
    const raw = (task as any)?.requiredDocuments;
    const list: any[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.documents)
        ? raw.documents
        : [];
    const requiredDocs = list.filter((d: any) => {
      const t = String(d?.type || '').toLowerCase();
      const l = String(d?.label || '').toLowerCase();
      const blob = `${t} ${l}`;
      // Mobile / phone / OTP entries are text fields collected in
      // step 2 of the customer flow, not photo uploads — don't count
      // them toward the "must capture" quota.
      return !/(\b|_|-)(mobile|phone|telephone|cell|sim|otp)(\b|_|-|number|no|num)?/i.test(blob);
    });
    const requiredCount = requiredDocs.length;

    // Quota check — only warns when the customer's service actually
    // declared a doc list (some services have zero required docs).
    if (requiredCount > 0 && capturedPhotos.length < requiredCount) {
      const missing = requiredCount - capturedPhotos.length;
      Alert.alert(
        `${missing} document${missing === 1 ? '' : 's'} pending`,
        `The customer's service requires ${requiredCount} document${requiredCount === 1 ? '' : 's'} but you've only captured ${capturedPhotos.length}. ` +
          `Take photos of the remaining ${missing} before submitting, or tap Confirm to proceed anyway.`,
        [
          { text: 'Capture More', style: 'cancel' },
          {
            text: 'Confirm Anyway',
            style: 'destructive',
            onPress: () => {
              updateStatus('documents_collected');
              setDocumentsModalVisible(false);
            },
          },
        ],
      );
      return;
    }

    updateStatus('documents_collected');
    setDocumentsModalVisible(false);
  };

  const handleCompleteTask = async (): Promise<void> => {
    if (!otp || otp.length !== 6) {
      Alert.alert('Error', 'Please enter a valid 6-digit OTP');
      return;
    }
    setUpdating(true);
    try {
      await completeTask(taskId, otp);
      Alert.alert('Success', 'Task completed successfully!', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      console.error('Error completing task:', error);
      Alert.alert('Error', 'Failed to complete task. Check the OTP.');
    } finally {
      setUpdating(false);
      setOtpModalVisible(false);
      setOtp('');
      setDevOtp(null);
    }
  };

  const openMaps = (): void => {
    // `task.address` may be a free-text string OR a JSON object of
    // shape { latitude, longitude, formatted } when the customer
    // booked with GPS on. We prefer the raw "lat,lng" pair when
    // available because Google Maps routes most accurately to a
    // precise pin; otherwise fall back to the formatted/free-text
    // string.
    const raw: any = task?.address;
    let dest = '';
    if (raw && typeof raw === 'object') {
      if (raw.latitude != null && raw.longitude != null) {
        dest = `${raw.latitude},${raw.longitude}`;
      } else if (typeof raw.formatted === 'string') {
        dest = raw.formatted;
      }
    } else if (typeof raw === 'string') {
      dest = raw;
    }
    if (!dest) {
      Alert.alert('No address', 'This booking has no service address yet.');
      return;
    }
    const destEnc = encodeURIComponent(dest);
    const url = Platform.select({
      android: `google.navigation:q=${destEnc}`,
      ios: `maps://app?daddr=${destEnc}`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${destEnc}`,
    });
    Linking.openURL(url as string).catch(() =>
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${destEnc}`),
    );
  };

  const callCustomer = (): void => {
    const phone = (task?.customerPhone || '').replace(/\s+/g, '');
    if (!phone) {
      Alert.alert('No Phone', 'Customer phone number is not available.');
      return;
    }
    Linking.openURL(`tel:${phone}`).catch(() => Alert.alert('Error', 'Unable to open phone dialer'));
  };

  const captureDocument = async (): Promise<void> => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Camera permission is needed to capture document photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets?.[0]) {
      setCapturedPhotos((prev) => [...prev, result.assets[0] as PhotoAsset]);
    }
  };

  const pickDocument = async (): Promise<void> => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsMultipleSelection: true,
    });
    if (!result.canceled && result.assets) {
      setCapturedPhotos((prev) => [...prev, ...(result.assets as unknown as PhotoAsset[])]);
    }
  };

  const removePhoto = (index: number): void => {
    setCapturedPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  // ─── Compliance helpers ────────────────────────────────────────────────
  const buildComplianceFile = (asset: any): { uri: string; name: string; type: string } => {
    const uri: string = asset?.uri || '';
    const inferredType: string =
      asset?.mimeType ||
      asset?.type ||
      (uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
    const fallbackName = `compliance_${Date.now()}.${inferredType.includes('png') ? 'png' : 'jpg'}`;
    const name: string = asset?.fileName || asset?.name || fallbackName;
    return { uri, name, type: inferredType };
  };

  const captureComplianceFromCamera = async (): Promise<void> => {
    // Styled crop UI — rep gets a branded cropper toolbar + clear
    // confirm tick, same as customer-side. Replaces the system "CROP"
    // overlay that was hard to spot on bright backgrounds.
    const file = await captureWithCrop({ namePrefix: 'compliance' });
    if (!file) return;
    setComplianceFile(file);
  };

  const pickComplianceFromGallery = async (): Promise<void> => {
    const file = await pickWithCrop({ namePrefix: 'compliance' });
    if (!file) return;
    setComplianceFile(file);
  };

  const handleComplianceSubmit = async (): Promise<void> => {
    if (!task?.customerId || !complianceFile || !complianceExpiry) return;
    setComplianceUploading(true);
    try {
      const expiryStr = complianceExpiry.toISOString().slice(0, 10);
      await uploadComplianceForCustomer(
        task.customerId,
        complianceFile,
        { compliance_type: complianceType, expiry_date: expiryStr },
      );
      Alert.alert(
        'Uploaded',
        'Compliance document filed successfully — the customer will see it in their Compliance Vault.',
      );
      setShowComplianceModal(false);
      // Reset for the next upload
      setComplianceFile(null);
      setComplianceExpiry(null);
      setComplianceType('factory_license');
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Try again in a moment.');
    } finally {
      setComplianceUploading(false);
    }
  };

  const getCurrentStatusIndex = (): number => {
    if (!task) return -1;
    return statusFlow.findIndex((s) => s.id === task.status);
  };

  const renderStatusFlow = () => {
    const currentIndex = getCurrentStatusIndex();
    return statusFlow.map((status, index) => {
      const isCompleted = index < currentIndex;
      const isCurrent = index === currentIndex;
      return (
        <View key={status.id} style={styles.statusItem}>
          <View style={styles.statusIndicatorContainer}>
            <View
              style={[
                styles.statusIndicator,
                isCompleted && styles.statusCompleted,
                isCurrent && styles.statusCurrent,
                !isCompleted && !isCurrent && styles.statusUpcoming,
              ]}
            >
              <Text
                style={[
                  styles.statusIndicatorText,
                  (isCompleted || isCurrent) && styles.statusIndicatorTextActive,
                ]}
              >
                {isCompleted ? '✓' : index + 1}
              </Text>
            </View>
            {index < statusFlow.length - 1 && (
              <View style={[styles.statusLine, isCompleted && styles.statusLineCompleted]} />
            )}
          </View>
          <View style={styles.statusContent}>
            <Text style={[styles.statusTitle, (isCompleted || isCurrent) && styles.statusTitleActive]}>
              {status.label}
            </Text>
            <Text style={styles.statusDescription}>{status.description}</Text>
          </View>
        </View>
      );
    });
  };

  const renderActionButtons = () => {
    switch (task?.status) {
      case 'new':
      case 'pending':
        return (
          <>
            <TouchableOpacity
              style={[styles.actionButton, styles.acceptButton]}
              onPress={handleAcceptTask}
              disabled={updating}
            >
              <Text style={styles.actionButtonText}>{updating ? 'Accepting...' : 'Accept Task'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.rejectButton]}
              onPress={handleRejectTask}
              disabled={updating}
            >
              <Text style={styles.rejectButtonText}>Reject</Text>
            </TouchableOpacity>
          </>
        );
      case 'accepted':
        return (
          <TouchableOpacity
            style={[styles.actionButton, styles.primaryButton]}
            onPress={handleStartTask}
            disabled={updating}
          >
            <Text style={styles.actionButtonText}>{updating ? 'Updating...' : 'Start Task'}</Text>
          </TouchableOpacity>
        );
      case 'started':
        return (
          <>
            <TouchableOpacity
              style={[styles.actionButton, styles.primaryButton]}
              onPress={handleReachedLocation}
              disabled={updating}
            >
              <Text style={styles.actionButtonText}>{updating ? 'Updating...' : 'Reached Location'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, styles.secondaryButton]} onPress={openMaps}>
              <Text style={styles.secondaryButtonText}>Navigate (Google Maps)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, styles.callButton]} onPress={callCustomer}>
              <Text style={styles.callButtonText}>Call Customer</Text>
            </TouchableOpacity>
          </>
        );
      case 'reached_location':
        return (
          <>
            <TouchableOpacity
              style={[styles.actionButton, styles.primaryButton]}
              onPress={handleCollectDocuments}
              disabled={updating}
            >
              <Text style={styles.actionButtonText}>Collect Documents</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, styles.callButton]} onPress={callCustomer}>
              <Text style={styles.callButtonText}>Call Customer</Text>
            </TouchableOpacity>
          </>
        );
      case 'documents_collected':
        return (
          <TouchableOpacity
            style={[styles.actionButton, styles.primaryButton]}
            onPress={handleWorkCompleted}
            disabled={updating}
          >
            <Text style={styles.actionButtonText}>Complete Work</Text>
          </TouchableOpacity>
        );
      case 'work_completed':
      case 'submitted':
        // Work has been marked complete server-side. The "Enter Customer
        // OTP" tap re-runs handleWorkCompleted so:
        //   1. If the OTP is missing (older bookings that transitioned
        //      before the OTP-on-work_completed backend change), the
        //      backend generates one now and returns it in the response.
        //   2. The DEV banner is freshly populated.
        //   3. The modal opens.
        // Idempotent — backend re-uses any existing OTP rather than
        // generating a new one each time.
        return (
          <>
            <View style={styles.awaitingOtpBox}>
              <Text style={styles.awaitingOtpTitle}>⏳ Awaiting OTP</Text>
              <Text style={styles.awaitingOtpHint}>
                Ask the customer for their 6-digit completion OTP.
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.actionButton, styles.primaryButton]}
              onPress={handleWorkCompleted}
              disabled={updating}
            >
              <Text style={styles.actionButtonText}>Enter Customer OTP</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.callButton]}
              onPress={callCustomer}
            >
              <Text style={styles.callButtonText}>Call Customer</Text>
            </TouchableOpacity>
          </>
        );
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading task details...</Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.loadingContainer}>
        <Text
          style={[
            styles.loadingText,
            { color: '#DC2626', textAlign: 'center', paddingHorizontal: 24, marginBottom: 16 },
          ]}
        >
          {loadError}
        </Text>
        <TouchableOpacity
          style={[styles.actionButton, styles.primaryButton, { marginHorizontal: 24, marginBottom: 8 }]}
          onPress={loadTaskDetails}
        >
          <Text style={styles.actionButtonText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.secondaryButton, { marginHorizontal: 24 }]}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.secondaryButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <View style={styles.container}>
      <ScrollView style={styles.content} stickyHeaderIndices={[0]} keyboardShouldPersistTaps="handled">
        {/* Customer name at the very top — matches the customer's own
            booking confirmation summary so the rep instantly knows who
            the job is for before scanning service name / address. */}
        <View style={styles.taskHeader}>
          <Text style={styles.taskCustomer}>{task?.customerName || 'Customer'}</Text>
          <Text style={styles.taskTitle}>{task?.serviceName}</Text>
          <View style={styles.taskHeaderMeta}>
            <Text style={styles.taskAmount}>
              {'₹'}
              {task?.amount}
            </Text>
            <Text style={styles.taskDistance}>{task?.distance || 'N/A'}</Text>
          </View>
        </View>

        <View style={styles.taskDetails}>
          {/* Explicit Customer row at the top of the details section —
              redundant with the header label above but matches the
              customer-app summary layout the user asked us to mirror. */}
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Customer</Text>
            <Text style={styles.detailValue}>{task?.customerName || 'N/A'}</Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Address</Text>
            <Text style={styles.detailValue}>{formatBookingAddress(task?.address) || 'N/A'}</Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Phone</Text>
            <TouchableOpacity onPress={callCustomer}>
              <Text style={[styles.detailValue, { color: COLORS.primary }]}>
                {task?.customerPhone || 'N/A'}
              </Text>
            </TouchableOpacity>
          </View>
          {task?.preferredDate && (
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Preferred Date</Text>
              <Text style={styles.detailValue}>{task.preferredDate}</Text>
            </View>
          )}
          {task?.preferredTime && (
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Preferred Time</Text>
              <Text style={styles.detailValue}>{task.preferredTime}</Text>
            </View>
          )}
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Distance</Text>
            <Text style={styles.detailValue}>{task?.distance}</Text>
          </View>
        </View>

        <View style={styles.statusFlowContainer}>
          <Text style={styles.sectionTitle}>Task Progress</Text>
          {renderStatusFlow()}
        </View>

        <View style={styles.actionsContainer}>{renderActionButtons()}</View>

        {task?.customerId ? (
          <View style={styles.complianceCta}>
            <Text style={styles.complianceCtaTitle}>📅 Upload Compliance Document</Text>
            <Text style={styles.complianceCtaSubtitle}>
              Renewed a Factory Licence / Fire NOC / Pollution Certificate for this customer? File it
              here so the Smart Alert system tracks the new expiry.
            </Text>
            <TouchableOpacity
              style={[styles.actionButton, styles.primaryButton, { marginTop: 12 }]}
              onPress={() => setShowComplianceModal(true)}
            >
              <Text style={styles.actionButtonText}>Add Compliance Document</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>

      <Modal
        animationType="slide"
        transparent
        visible={otpModalVisible}
        onRequestClose={() => setOtpModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Complete Task</Text>
            <Text style={styles.modalDescription}>Enter the 6-digit OTP provided by the customer</Text>

            {/* DEV MODE banner — shows the customer's OTP when SMS/push
                delivery isn't wired up. Auto-fills the input when tapped. */}
            {devOtp && (
              <TouchableOpacity
                style={styles.devOtpBanner}
                onPress={() => setOtp(devOtp)}
                activeOpacity={0.85}
              >
                <Text style={styles.devOtpBannerLabel}>DEV MODE · Customer&apos;s OTP</Text>
                <Text style={styles.devOtpBannerCode}>{devOtp}</Text>
                <Text style={styles.devOtpBannerHint}>Tap to auto-fill</Text>
              </TouchableOpacity>
            )}

            <TextInput
              style={styles.otpInput}
              placeholder="Enter 6-digit OTP"
              keyboardType="numeric"
              maxLength={6}
              value={otp}
              onChangeText={setOtp}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelModalBtn]}
                onPress={() => {
                  setOtpModalVisible(false);
                  setOtp('');
                }}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmBtn]}
                onPress={handleCompleteTask}
                disabled={updating}
              >
                <Text style={styles.confirmBtnText}>{updating ? 'Completing...' : 'Complete'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        animationType="slide"
        transparent
        visible={documentsModalVisible}
        onRequestClose={() => setDocumentsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '85%' }]}>
            <Text style={styles.modalTitle}>Collect Documents</Text>
            <Text style={styles.modalDescription}>
              Capture photos of the required documents from the customer
            </Text>

            <ScrollView style={{ maxHeight: 300 }}>
              {capturedPhotos.length > 0 && (
                <View style={styles.photosGrid}>
                  {capturedPhotos.map((photo, index) => (
                    <View key={index} style={styles.photoItem}>
                      <Image source={{ uri: photo.uri }} style={styles.photoThumb} />
                      <TouchableOpacity style={styles.removePhotoBtn} onPress={() => removePhoto(index)}>
                        <Text style={styles.removePhotoBtnText}>X</Text>
                      </TouchableOpacity>
                      <Text style={styles.photoLabel}>Doc {index + 1}</Text>
                    </View>
                  ))}
                </View>
              )}

              {capturedPhotos.length === 0 && (
                <Text style={styles.noPhotosText}>No documents captured yet</Text>
              )}
            </ScrollView>

            <View style={{ gap: 8, marginVertical: 12 }}>
              <TouchableOpacity style={[styles.actionButton, styles.primaryButton]} onPress={captureDocument}>
                <Text style={styles.actionButtonText}>Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionButton, styles.secondaryButton]} onPress={pickDocument}>
                <Text style={styles.secondaryButtonText}>Pick from Gallery</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.photoCount}>{capturedPhotos.length} document(s) captured</Text>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelModalBtn]}
                onPress={() => setDocumentsModalVisible(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmBtn]}
                onPress={handleDocumentsCollected}
              >
                <Text style={styles.confirmBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        transparent
        visible={showComplianceModal}
        onRequestClose={() => setShowComplianceModal(false)}
      >
        <View style={styles.complianceModalOverlay}>
          <View style={styles.complianceSheet}>
            <View style={styles.complianceHeader}>
              <Text style={styles.complianceHeaderTitle}>Upload Compliance Document</Text>
              <TouchableOpacity
                onPress={() => setShowComplianceModal(false)}
                style={styles.complianceCloseBtn}
                accessibilityLabel="Close"
              >
                <Text style={styles.complianceCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.complianceSubtitle}>For: {task?.customerName}</Text>

            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.complianceSectionLabel}>Type</Text>
              <View style={styles.chipsWrap}>
                {COMPLIANCE_TYPES.map((opt) => {
                  const active = opt.id === complianceType;
                  return (
                    <TouchableOpacity
                      key={opt.id}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => setComplianceType(opt.id)}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.complianceSectionLabel}>Expiry Date</Text>
              <TouchableOpacity
                style={styles.complianceFieldButton}
                onPress={() => setComplianceShowDate(true)}
              >
                <Text
                  style={[
                    styles.complianceFieldText,
                    !complianceExpiry && { color: COLORS.textMuted },
                  ]}
                >
                  {complianceExpiry ? formatExpiryDate(complianceExpiry) : 'Pick expiry date'}
                </Text>
              </TouchableOpacity>
              {complianceShowDate && (
                <DateTimePicker
                  value={complianceExpiry || new Date()}
                  mode="date"
                  display="default"
                  minimumDate={new Date()}
                  onChange={(_event: any, selectedDate: any) => {
                    setComplianceShowDate(false);
                    if (selectedDate) {
                      setComplianceExpiry(selectedDate);
                    }
                  }}
                />
              )}

              <Text style={styles.complianceSectionLabel}>Document</Text>
              <View style={styles.complianceDocRow}>
                <TouchableOpacity
                  style={[styles.complianceDocBtn, styles.complianceDocBtnPrimary]}
                  onPress={captureComplianceFromCamera}
                >
                  <Text style={styles.complianceDocBtnPrimaryText}>📷 Take Photo</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.complianceDocBtn, styles.complianceDocBtnSecondary]}
                  onPress={pickComplianceFromGallery}
                >
                  <Text style={styles.complianceDocBtnSecondaryText}>🖼 From Gallery</Text>
                </TouchableOpacity>
              </View>

              {complianceFile ? (
                <View style={styles.compliancePreview}>
                  <Image source={{ uri: complianceFile.uri }} style={styles.compliancePreviewImg} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.compliancePreviewName} numberOfLines={1}>
                      {complianceFile.name}
                    </Text>
                    <TouchableOpacity onPress={() => setComplianceFile(null)}>
                      <Text style={styles.complianceReplaceLink}>Replace</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
            </ScrollView>

            <TouchableOpacity
              style={[
                styles.complianceUploadBtn,
                (!complianceFile || !complianceExpiry || complianceUploading) &&
                  styles.complianceUploadBtnDisabled,
              ]}
              onPress={handleComplianceSubmit}
              disabled={!complianceFile || !complianceExpiry || complianceUploading}
            >
              {complianceUploading ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.complianceUploadBtnText}>Upload</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: SIZES.font, color: COLORS.textSecondary, marginTop: SIZES.base },
  content: { flex: 1 },
  taskHeader: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SIZES.padding * 1.5,
    paddingTop: 56,
    paddingBottom: 16,
    shadowColor: '#F4A100',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 10,
  },
  taskTitle: {
    fontSize: SIZES.font + 2,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.92)',
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  // Customer name is the visual anchor now — first thing the rep reads.
  taskCustomer: {
    fontSize: SIZES.h2,
    fontWeight: '900',
    color: COLORS.white,
    marginBottom: 2,
    letterSpacing: 0.3,
  },
  taskHeaderMeta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2,
  },
  taskAmount: { fontSize: SIZES.h3, fontWeight: '900', color: COLORS.white, letterSpacing: 0.2 },
  taskDistance: {
    fontSize: 12, color: 'rgba(255,255,255,0.95)', fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.18)', paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 12, overflow: 'hidden',
  },
  taskDetails: {
    backgroundColor: COLORS.white, margin: SIZES.padding, padding: SIZES.padding,
    borderRadius: SIZES.radius, elevation: 3,
  },
  detailItem: { marginBottom: SIZES.padding },
  detailLabel: { fontSize: SIZES.h6, color: COLORS.textSecondary, marginBottom: 2 },
  detailValue: { fontSize: SIZES.font, color: COLORS.text },
  statusFlowContainer: { padding: SIZES.padding },
  sectionTitle: { fontSize: SIZES.h3, fontWeight: 'bold', color: COLORS.text, marginBottom: SIZES.padding },
  statusItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: SIZES.padding * 2 },
  statusIndicatorContainer: { alignItems: 'center', marginRight: SIZES.padding },
  statusIndicator: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: COLORS.lightGray,
    justifyContent: 'center', alignItems: 'center',
  },
  statusCompleted: { backgroundColor: COLORS.success },
  statusCurrent: { backgroundColor: COLORS.primary },
  statusUpcoming: { backgroundColor: COLORS.lightGray },
  statusIndicatorText: { fontSize: SIZES.h6, color: COLORS.textSecondary },
  statusIndicatorTextActive: { color: COLORS.white, fontWeight: 'bold' },
  statusLine: { width: 2, height: 40, backgroundColor: COLORS.lightGray, marginTop: 4 },
  statusLineCompleted: { backgroundColor: COLORS.success },
  statusContent: { flex: 1 },
  statusTitle: { fontSize: SIZES.font, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 2 },
  statusTitleActive: { color: COLORS.text },
  statusDescription: { fontSize: SIZES.h6, color: COLORS.textSecondary },
  actionsContainer: { padding: SIZES.padding, gap: SIZES.base },
  actionButton: { padding: SIZES.padding, borderRadius: SIZES.radius, alignItems: 'center' },
  primaryButton: {
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  secondaryButton: { backgroundColor: COLORS.white, borderWidth: 1.5, borderColor: COLORS.primary },
  callButton: {
    backgroundColor: '#10B981',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  acceptButton: {
    backgroundColor: '#10B981',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  rejectButton: { backgroundColor: COLORS.white, borderWidth: 1.5, borderColor: '#DC2626' },
  actionButtonText: { color: COLORS.white, fontSize: SIZES.font, fontWeight: '800', letterSpacing: 0.3 },
  secondaryButtonText: { color: COLORS.primary, fontSize: SIZES.font, fontWeight: '700' },
  callButtonText: { color: COLORS.white, fontSize: SIZES.font, fontWeight: '800', letterSpacing: 0.3 },
  rejectButtonText: { color: '#DC2626', fontSize: SIZES.font, fontWeight: '800', letterSpacing: 0.3 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: {
    backgroundColor: COLORS.white, borderRadius: SIZES.radius,
    padding: SIZES.padding * 2, width: '90%', maxWidth: 400,
  },
  modalTitle: {
    fontSize: SIZES.h2, fontWeight: 'bold', color: COLORS.text,
    marginBottom: SIZES.base, textAlign: 'center',
  },
  modalDescription: {
    fontSize: SIZES.font, color: COLORS.textSecondary,
    marginBottom: SIZES.padding, textAlign: 'center',
  },
  otpInput: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: SIZES.radius,
    padding: SIZES.padding, fontSize: 18, textAlign: 'center',
    marginBottom: SIZES.padding, letterSpacing: 8,
  },
  awaitingOtpBox: {
    backgroundColor: '#E3EEF8',
    borderWidth: 1,
    borderColor: '#1B4B72',
    borderRadius: SIZES.radius,
    paddingVertical: SIZES.base + 2,
    paddingHorizontal: SIZES.padding,
    marginBottom: SIZES.base,
  },
  awaitingOtpTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0D3B66',
    marginBottom: 2,
  },
  awaitingOtpHint: {
    fontSize: 12,
    color: '#1B4B72',
  },
  devOtpBanner: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1.5,
    borderColor: '#F59E0B',
    borderRadius: SIZES.radius,
    paddingVertical: SIZES.base + 4,
    paddingHorizontal: SIZES.base,
    alignItems: 'center',
    marginBottom: SIZES.base + 4,
  },
  devOtpBannerLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: '#92400E',
    letterSpacing: 1.2,
  },
  devOtpBannerCode: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0D3B66',
    letterSpacing: 6,
    marginVertical: 4,
    fontVariant: ['tabular-nums'],
  },
  devOtpBannerHint: {
    fontSize: 10,
    color: '#92400E',
    fontWeight: '600',
  },
  modalActions: { flexDirection: 'row', gap: SIZES.base },
  modalButton: { flex: 1, padding: SIZES.padding, borderRadius: SIZES.radius, alignItems: 'center' },
  cancelModalBtn: { backgroundColor: COLORS.lightGray },
  confirmBtn: { backgroundColor: COLORS.primary },
  cancelBtnText: { color: COLORS.text, fontWeight: '600' },
  confirmBtnText: { color: COLORS.white, fontWeight: '600' },
  photosGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  photoItem: { alignItems: 'center', position: 'relative' },
  photoThumb: { width: 80, height: 80, borderRadius: 8, borderWidth: 1, borderColor: COLORS.lightGray },
  removePhotoBtn: {
    position: 'absolute', top: -6, right: -6, backgroundColor: '#F44336',
    borderRadius: 10, width: 20, height: 20, justifyContent: 'center', alignItems: 'center',
  },
  removePhotoBtnText: { color: COLORS.white, fontSize: 10, fontWeight: 'bold' },
  photoLabel: { fontSize: 10, color: COLORS.textSecondary, marginTop: 2 },
  noPhotosText: { textAlign: 'center', color: COLORS.textSecondary, fontStyle: 'italic', marginVertical: 16 },
  photoCount: { textAlign: 'center', color: COLORS.textSecondary, fontSize: 12, marginBottom: 8 },

  // ─── Compliance CTA + modal ───────────────────────────────────────────
  complianceCta: {
    backgroundColor: COLORS.white,
    marginHorizontal: SIZES.padding,
    marginBottom: SIZES.padding,
    padding: SIZES.padding,
    borderRadius: SIZES.radius,
    borderWidth: 1,
    borderColor: '#E6EEF4',
    shadowColor: '#003153',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  complianceCtaTitle: {
    fontSize: SIZES.h3,
    fontWeight: '800',
    color: '#0D3B66',
    marginBottom: 6,
  },
  complianceCtaSubtitle: {
    fontSize: SIZES.h6,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  complianceModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  complianceSheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: SIZES.padding * 1.25,
    paddingBottom: SIZES.padding * 1.5,
    maxHeight: '92%',
  },
  complianceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  complianceHeaderTitle: {
    fontSize: SIZES.h2,
    fontWeight: '800',
    color: '#0D3B66',
    flex: 1,
  },
  complianceCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E6EEF4',
  },
  complianceCloseBtnText: {
    color: '#0D3B66',
    fontSize: 16,
    fontWeight: '700',
  },
  complianceSubtitle: {
    fontSize: SIZES.font,
    color: COLORS.textSecondary,
    marginBottom: SIZES.padding,
  },
  complianceSectionLabel: {
    fontSize: SIZES.h6,
    fontWeight: '700',
    color: '#0D3B66',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: SIZES.padding,
    marginBottom: 8,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#E6EEF4',
    borderWidth: 1,
    borderColor: '#E6EEF4',
  },
  chipActive: {
    backgroundColor: '#0D3B66',
    borderColor: '#0D3B66',
  },
  chipText: {
    fontSize: 13,
    color: '#1B4B72',
    fontWeight: '600',
  },
  chipTextActive: {
    color: COLORS.white,
    fontWeight: '700',
  },
  complianceFieldButton: {
    borderWidth: 1,
    borderColor: '#E6EEF4',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  complianceFieldText: {
    fontSize: SIZES.font,
    color: '#0D3B66',
    fontWeight: '600',
  },
  complianceDocRow: {
    flexDirection: 'row',
    gap: 10,
  },
  complianceDocBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  complianceDocBtnPrimary: {
    backgroundColor: '#0D3B66',
  },
  complianceDocBtnPrimaryText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: SIZES.font,
  },
  complianceDocBtnSecondary: {
    backgroundColor: COLORS.white,
    borderWidth: 1.5,
    borderColor: '#0D3B66',
  },
  complianceDocBtnSecondaryText: {
    color: '#0D3B66',
    fontWeight: '700',
    fontSize: SIZES.font,
  },
  compliancePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 10,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#E6EEF4',
  },
  compliancePreviewImg: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#E6EEF4',
  },
  compliancePreviewName: {
    fontSize: SIZES.h6,
    fontWeight: '600',
    color: '#0D3B66',
    marginBottom: 4,
  },
  complianceReplaceLink: {
    fontSize: SIZES.h6,
    color: '#1B4B72',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  // Green crop pill alongside the picked compliance file preview.
  complianceCropBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  complianceCropBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  complianceUploadBtn: {
    backgroundColor: '#0D3B66',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SIZES.padding,
  },
  complianceUploadBtnDisabled: {
    backgroundColor: '#94A3B8',
  },
  complianceUploadBtnText: {
    color: COLORS.white,
    fontWeight: '800',
    fontSize: SIZES.font + 1,
    letterSpacing: 0.3,
  },
});

export default TaskExecutionScreen;

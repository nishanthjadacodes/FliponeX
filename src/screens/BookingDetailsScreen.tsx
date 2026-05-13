import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SIZES, BORDER_RADIUS } from '../constants/colors';
import {
  getBookingDetails,
  verifyCompletion,
  cancelBooking,
  submitReview,
  createPaymentOrder,
  verifyPayment,
  rescheduleMyBooking,
} from '../services/api';
import DateTimePicker from '@react-native-community/datetimepicker';
import RazorpayCheckout from 'react-native-razorpay';
import * as haptics from '../utils/haptics';
import { formatBookingId } from '../utils/bookingId';
import DocPreviewModal, { fixDocUrl } from '../components/DocPreviewModal';

// Defensive load — expo-print and expo-sharing are native modules that
// only show up after a dev-client rebuild. Same pattern used elsewhere in
// the app so the bundle still resolves before the rebuild lands.
let Print: any = null;
let Sharing: any = null;
try {
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  Print = require('expo-print');
} catch (_) {
  Print = null;
}
try {
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  Sharing = require('expo-sharing');
} catch (_) {
  Sharing = null;
}

interface NavigationProp {
  navigate: (route: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
  replace?: (route: string) => void;
  addListener?: (event: string, cb: () => void) => () => void;
}

interface RouteProp {
  params?: { [key: string]: any };
}

interface Props {
  navigation: NavigationProp;
  route: RouteProp;
}

// Strip an orphan booking from the locally-cached list so it stops showing
// in MyBookings. Triggered on 404 — the server has no record of it.
const purgeLocalBooking = async (id: any): Promise<void> => {
  try {
    const stored = await AsyncStorage.getItem('my_bookings');
    if (!stored) return;
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return;
    const cleaned = parsed.filter((b: any) => b?.id !== id);
    if (cleaned.length !== parsed.length) {
      await AsyncStorage.setItem('my_bookings', JSON.stringify(cleaned));
    }
  } catch (e: any) {
    console.log('purgeLocalBooking error:', e?.message);
  }
};

const BookingDetailsScreen: React.FC<Props> = ({ navigation, route }) => {
  const { bookingId } = route.params || {};
  // Top inset so the custom header (back button + title) sits below the
  // status bar / notch on phones that have one. Without this the back
  // arrow appears clipped on Android 12+ and iPhone X+.
  const insets = useSafeAreaInsets();
  const [booking, setBooking] = useState<any>(null);
  // Currently-previewed doc (set when user taps a doc row) — null = closed.
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [otp, setOtp] = useState<string>('');
  const [verificationLoading, setVerificationLoading] = useState<boolean>(false);
  const [showRating, setShowRating] = useState<boolean>(false);
  const [rating, setRating] = useState<number>(0);
  const [reviewText, setReviewText] = useState<string>('');
  const [submittingReview, setSubmittingReview] = useState<boolean>(false);
  // Deferred payment — set true while the Razorpay popup is open / order is
  // being created. Locks the "Pay Now" button so the user can't double-tap.
  const [paying, setPaying] = useState<boolean>(false);
  // Reschedule modal state — owns the new preferred date/time + reason
  // and the loading flag while the PUT /bookings/:id/reschedule is in
  // flight. Replaces the earlier "navigate back to Booking" stub which
  // silently dropped the booking-id and looked broken to users.
  const [showReschedule, setShowReschedule] = useState<boolean>(false);
  const [rescheduleDate, setRescheduleDate] = useState<Date | null>(null);
  const [rescheduleTime, setRescheduleTime] = useState<Date | null>(null);
  const [rescheduleReason, setRescheduleReason] = useState<string>('');
  const [rescheduling, setRescheduling] = useState<boolean>(false);
  const [showRescheduleDatePicker, setShowRescheduleDatePicker] = useState<boolean>(false);
  const [showRescheduleTimePicker, setShowRescheduleTimePicker] = useState<boolean>(false);

  useEffect(() => {
    loadBookingDetails();
  }, [bookingId]);

  // Pay Now handler — creates a Razorpay order, opens the native checkout,
  // verifies the signature server-side, then refreshes the booking so the
  // "Pay Now" CTA is replaced by a "Paid" badge.
  const handlePayNow = async (): Promise<void> => {
    if (paying) return;
    haptics.tap();
    setPaying(true);
    try {
      const amount =
        Number(booking?.total_amount || booking?.price_quoted || booking?.amount || 0);
      if (!amount || amount <= 0) {
        Alert.alert('Cannot pay', 'No amount on this booking. Contact support.');
        return;
      }

      const orderRes: any = await createPaymentOrder({
        booking_id: bookingId,
        amount,
      });
      const order = orderRes?.data;
      if (!order?.order_id || !order?.key_id) {
        throw new Error('Could not initiate payment.');
      }

      const options = {
        key: order.key_id,
        amount: Math.round(amount * 100), // Razorpay wants paise
        currency: 'INR',
        name: 'FliponeX',
        description: booking?.service?.name || 'Service',
        order_id: order.order_id,
        prefill: {
          name: booking?.user?.name || booking?.customer_name || '',
          email: booking?.user?.email || booking?.customer_email || '',
          contact: booking?.customer_mobile || booking?.user?.mobile || '',
        },
        theme: { color: '#0D3B66' },
      };

      const result: any = await RazorpayCheckout.open(options);
      // Verify with backend so the booking row is marked paid.
      await verifyPayment({
        booking_id: bookingId,
        razorpay_payment_id: result.razorpay_payment_id,
        razorpay_order_id: result.razorpay_order_id,
        razorpay_signature: result.razorpay_signature,
      });
      Alert.alert('Payment successful', 'Thank you! Your booking is now paid.');
      await loadBookingDetails();
    } catch (e: any) {
      const msg = e?.description || e?.message || 'Payment was not completed.';
      // User-cancelled is fine; only alert on real errors.
      if (!/cancel/i.test(String(msg))) {
        Alert.alert('Payment failed', msg);
      }
    } finally {
      setPaying(false);
    }
  };

  const loadBookingDetails = async (): Promise<void> => {
    try {
      setLoading(true);
      const response: any = await getBookingDetails(bookingId);
      console.log('=== BOOKING DETAILS RESPONSE ===');
      console.log('Full response:', JSON.stringify(response, null, 2));

      // Handle different response structures
      let bookingData: any = response.data || response;
      if (bookingData && bookingData.data) {
        bookingData = bookingData.data;
      }

      console.log('Final booking data:', JSON.stringify(bookingData, null, 2));
      console.log('Booking fields:', Object.keys(bookingData || {}));

      // Log specific fields we're looking for
      console.log('Amount fields:', {
        total_amount: bookingData?.total_amount,
        amount: bookingData?.amount,
        totalExpense: bookingData?.totalExpense,
        total_expense: bookingData?.total_expense,
        user_cost: bookingData?.user_cost,
        cost: bookingData?.cost,
        price: bookingData?.price
      });

      console.log('Address fields:', {
        address: bookingData?.address,
        user_address: bookingData?.user_address,
        customer_address: bookingData?.customer_address,
        full_address: bookingData?.full_address,
        location: bookingData?.location
      });

      console.log('Document fields:', {
        documents: bookingData?.documents,
        uploaded_documents: bookingData?.uploaded_documents,
        files: bookingData?.files,
        attachments: bookingData?.attachments
      });

      console.log('===============================');

      setBooking(bookingData);
    } catch (error: any) {
      console.error('Error loading booking details:', error);
      // Server has no record of this booking — drop it from local cache so
      // it stops appearing in MyBookings, then bounce back.
      const status = error?.response?.status || error?.status;
      const notFound =
        status === 404 ||
        /not found/i.test(error?.message || '') ||
        /not found/i.test(error?.response?.data?.message || '');
      if (notFound) {
        await purgeLocalBooking(bookingId);
        Alert.alert('Booking unavailable', 'This booking is no longer available.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else {
        Alert.alert('Error', 'Failed to load booking details');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCompletion = async (): Promise<void> => {
    if (!otp.trim()) {
      Alert.alert('Error', 'Please enter OTP');
      return;
    }

    try {
      setVerificationLoading(true);
      const response: any = await verifyCompletion(bookingId, otp);

      if (response.success) {
        Alert.alert('Success', 'Booking verified successfully');
        loadBookingDetails(); // Refresh booking details
      } else {
        Alert.alert('Error', response.message || 'Verification failed');
      }
    } catch (error) {
      console.error('Verification error:', error);
      Alert.alert('Error', 'Failed to verify completion');
    } finally {
      setVerificationLoading(false);
      setOtp('');
    }
  };

  // Submit a reschedule request to the backend. Backend gates on >=2h
  // before the original scheduled time and returns a friendly message
  // when the window is closed — we surface it as-is so the user knows
  // to call support rather than blame the app.
  const handleSubmitReschedule = async (): Promise<void> => {
    if (!rescheduleDate || !rescheduleTime) {
      Alert.alert('Pick a date & time', 'Please select both a new date and time.');
      return;
    }
    setRescheduling(true);
    try {
      const yyyy = rescheduleDate.getFullYear();
      const mm = String(rescheduleDate.getMonth() + 1).padStart(2, '0');
      const dd = String(rescheduleDate.getDate()).padStart(2, '0');
      const hh = String(rescheduleTime.getHours()).padStart(2, '0');
      const mi = String(rescheduleTime.getMinutes()).padStart(2, '0');
      await rescheduleMyBooking(String(bookingId), {
        preferred_date: `${yyyy}-${mm}-${dd}`,
        preferred_time: `${hh}:${mi}`,
        reason: rescheduleReason.trim() || undefined,
      });
      haptics.success();
      setShowReschedule(false);
      setRescheduleDate(null);
      setRescheduleTime(null);
      setRescheduleReason('');
      Alert.alert('Rescheduled', 'Your booking has been rescheduled successfully.');
      await loadBookingDetails();
    } catch (e: any) {
      haptics.error();
      const msg = e?.message || 'Could not reschedule. Please try again or contact support.';
      Alert.alert('Reschedule failed', msg);
    } finally {
      setRescheduling(false);
    }
  };

  const handleCancelBooking = async (): Promise<void> => {
    Alert.alert(
      'Cancel Booking',
      'Are you sure you want to cancel this booking?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes',
          onPress: async () => {
            try {
              await cancelBooking(bookingId);
              Alert.alert('Success', 'Booking cancelled successfully');
              navigation.goBack();
            } catch (error) {
              Alert.alert('Error', 'Failed to cancel booking');
            }
          }
        },
      ]
    );
  };

  // ─── Rating & Review ───
  const handleSubmitReview = async (): Promise<void> => {
    if (rating === 0) {
      Alert.alert('Rating Required', 'Please select a star rating');
      return;
    }
    setSubmittingReview(true);
    try {
      await submitReview(bookingId, { rating, review: reviewText.trim() });
      haptics.success();
      setShowRating(false);
      setRating(0);
      setReviewText('');
      Alert.alert('Thank You!', 'Your review has been submitted');
      loadBookingDetails();
    } catch (error) {
      haptics.error();
      Alert.alert('Error', 'Failed to submit review');
    } finally {
      setSubmittingReview(false);
    }
  };

  // ─── Digital Receipt (PDF via expo-print, shared via expo-sharing) ───
  const handleShareReceipt = async (): Promise<void> => {
    haptics.tap();
    try {
      if (!Print || typeof Print.printToFileAsync !== 'function') {
        Alert.alert('Receipt', 'Could not generate PDF');
        return;
      }
      const total = booking?.total_amount || booking?.price_quoted || booking?.final_price || booking?.amount || 0;
      const bookingNo = formatBookingId(booking?.booking_number || bookingId);
      const serviceName = booking?.service?.name || booking?.service_name || booking?.serviceName || 'Service';
      const customerName = booking?.user?.name || booking?.customer_name || booking?.full_name || booking?.name || 'N/A';
      const dateStr = new Date(booking?.created_at || Date.now()).toLocaleDateString();
      const status = booking?.status || 'pending';
      const payment = booking?.payment_method || booking?.payment_status || 'pending';

      const escape = (v: any): string =>
        String(v ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

      const html = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1A1A1A; padding: 32px; }
      h1 { color: #0D3B66; font-size: 22px; margin: 0 0 4px 0; }
      .subtitle { color: #6C757D; font-size: 12px; margin-bottom: 24px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      td { padding: 10px 8px; border-bottom: 1px solid #E9ECEF; font-size: 13px; }
      td.label { color: #6C757D; width: 40%; }
      td.value { color: #1A1A1A; font-weight: 600; text-align: right; }
      .total-row td { border-top: 2px solid #0D3B66; border-bottom: none; padding-top: 14px; font-size: 15px; }
      .footer { margin-top: 36px; text-align: center; color: #6C757D; font-size: 11px; border-top: 1px solid #E9ECEF; padding-top: 14px; }
    </style>
  </head>
  <body>
    <h1>FliponeX Digital — Receipt</h1>
    <div class="subtitle">Generated ${escape(new Date().toLocaleString())}</div>
    <table>
      <tr><td class="label">Booking Number</td><td class="value">${escape(bookingNo)}</td></tr>
      <tr><td class="label">Service</td><td class="value">${escape(serviceName)}</td></tr>
      <tr><td class="label">Customer</td><td class="value">${escape(customerName)}</td></tr>
      <tr><td class="label">Date</td><td class="value">${escape(dateStr)}</td></tr>
      <tr><td class="label">Status</td><td class="value">${escape(status)}</td></tr>
      <tr><td class="label">Payment Method</td><td class="value">${escape(payment)}</td></tr>
      <tr class="total-row"><td class="label">Total Amount</td><td class="value">&#8377;${escape(total)}</td></tr>
    </table>
    <div class="footer">Thank you for choosing FliponeX Digital. This is a computer-generated receipt.</div>
  </body>
</html>`;

      const result: any = await Print.printToFileAsync({ html, base64: false });
      const uri: string | undefined = result?.uri;
      if (!uri) {
        Alert.alert('Receipt', 'Could not generate PDF');
        return;
      }
      if (Sharing && typeof Sharing.shareAsync === 'function') {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Receipt' });
      } else {
        Alert.alert('Receipt', 'Could not generate PDF');
      }
    } catch (e) {
      Alert.alert('Receipt', 'Could not generate PDF');
    }
  };

  const getStatusColor = (): string => {
    switch (booking?.status) {
      case 'pending':    return '#FFC107';
      case 'confirmed':  return '#4CAF50';
      case 'assigned':   return '#2196F3';
      case 'accepted':   return '#FF9800';
      case 'documents_collected': return '#9C27B0';
      case 'submitted':  return '#00BCD4';
      case 'completed':  return '#4CAF50';
      case 'cancelled':  return '#F44336';
      default:           return '#757575';
    }
  };

  const getStatusText = (): string => {
    switch (booking?.status) {
      case 'pending':    return 'Pending';
      case 'confirmed':  return 'Confirmed';
      case 'assigned':   return 'Assigned';
      case 'accepted':   return 'Accepted';
      case 'documents_collected': return 'Documents Collected';
      case 'submitted':  return 'Submitted';
      case 'completed':  return 'Completed';
      case 'cancelled':  return 'Cancelled';
      default:           return booking?.status || 'Unknown';
    }
  };

  const renderProgressBar = () => {
    const statusSteps = ['pending', 'assigned', 'accepted', 'documents_collected', 'submitted', 'completed'];
    const currentStepIndex = statusSteps.indexOf(booking?.status);
    const progressPercentage = ((currentStepIndex + 1) / statusSteps.length) * 100;

    return (
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              { width: `${progressPercentage}%` }
            ]}
          />
        </View>
        <Text style={styles.progressText}>{getStatusText()}</Text>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.PRIMARY} />
        <Text style={styles.loadingText}>Loading booking details...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: 12 + insets.top }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Booking Details</Text>
        <View style={{ width: 56 }} />
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        // Reserve space for the device's gesture / home-indicator bar
        // plus a 16px buffer. Without this, the bottom action row
        // (Track / Receipt / Reschedule / Cancel) was sitting under
        // Android's 3-button bar — the user had to scroll past it.
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      >
        {/* Booking Status */}
        <View style={styles.statusContainer}>
          <Text style={styles.bookingNumber}>{formatBookingId(booking?.booking_number || bookingId)}</Text>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor() }]}>
            <Text style={styles.statusText}>{getStatusText()}</Text>
          </View>
        </View>

        {/* Service Details */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Service Details</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Service:</Text>
            <Text style={styles.detailValue}>
              {booking?.service?.name || booking?.service_name || booking?.serviceName || 'N/A'}
            </Text>
          </View>
          {/* Preferred date — was previously missing from BookingDetails,
              so customers couldn't see when they'd scheduled the visit.
              Falls back to created_at (the booking creation date) so
              older bookings without preferred_date still show something. */}
          {(booking?.preferred_date || booking?.created_at) && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Date:</Text>
              <Text style={styles.detailValue}>
                {(() => {
                  const raw = booking?.preferred_date || booking?.created_at;
                  const d = new Date(raw);
                  return Number.isNaN(d.getTime())
                    ? String(raw)
                    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
                })()}
              </Text>
            </View>
          )}
          {/* Time slot — what the customer picked on step 4. Previously
              hidden entirely from BookingDetails. */}
          {booking?.preferred_time && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Time Slot:</Text>
              <Text style={styles.detailValue}>{booking.preferred_time}</Text>
            </View>
          )}
          {/* Service mode + urgency — surfaces the deliveryMode and
              serviceMode the customer chose, so booking history matches
              what they confirmed at checkout. */}
          {booking?.delivery_mode && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Mode:</Text>
              <Text style={styles.detailValue}>
                {booking.delivery_mode === 'online'
                  ? '💻 Online (Operator)'
                  : '🏠 Offline (Doorstep)'}
              </Text>
            </View>
          )}
          {booking?.service_mode && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Urgency:</Text>
              <Text style={styles.detailValue}>
                {booking.service_mode === 'fast_track'
                  ? '⚡ High Priority (Fast-Track)'
                  : 'Low Priority (Regular)'}
              </Text>
            </View>
          )}
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Amount:</Text>
            <Text style={styles.detailValue}>
              ₹{booking?.total_amount || booking?.price_quoted || booking?.final_price || booking?.amount || 0}
            </Text>
          </View>
          {booking?.expected_timeline && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Timeline:</Text>
              <Text style={styles.detailValue}>{booking.expected_timeline}</Text>
            </View>
          )}
        </View>

        {/* Customer Details */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Customer Details</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Name:</Text>
            <Text style={styles.detailValue}>
              {booking?.user?.name || booking?.customer_name || booking?.full_name || booking?.name || 'N/A'}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Email:</Text>
            <Text style={styles.detailValue}>
              {booking?.user?.email || booking?.customer_email || booking?.email || 'N/A'}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Mobile:</Text>
            <Text style={styles.detailValue}>
              {booking?.user?.mobile || booking?.customer_mobile || booking?.mobile || 'N/A'}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Address:</Text>
            <Text
              style={styles.detailValue}
              onPress={() => {
                // If the stored address looks like "lat, lng", open
                // Google Maps so the customer can verify the pin. Bare
                // coords are normally a sign that reverse-geocoding
                // failed on the booking flow — this gives them a way
                // to actually see what the address resolves to.
                const raw =
                  booking?.service_address || booking?.address || booking?.customer_address || '';
                const m = String(raw).match(
                  /^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/,
                );
                if (m) {
                  const url = `https://www.google.com/maps/search/?api=1&query=${m[1]},${m[2]}`;
                  try {
                    require('react-native').Linking.openURL(url).catch(() => {});
                  } catch {}
                }
              }}
            >
              {(() => {
                // Display logic — pure lat/lng strings get a clearer
                // "Location pin (lat, lng)" prefix + tap-to-map hint.
                // Customers used to see naked "12.345678, 77.123456"
                // and wonder if the address even got saved.
                const raw =
                  booking?.service_address || booking?.address || booking?.customer_address;
                if (!raw) return 'N/A';
                const m = String(raw).match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
                if (m) {
                  return `📍 Map pin: ${Number(m[1]).toFixed(5)}, ${Number(m[2]).toFixed(5)} (tap to open)`;
                }
                return String(raw);
              })()}
            </Text>
          </View>
        </View>

        {/* Progress Bar */}
        {renderProgressBar()}

        {/* Documents */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Documents</Text>
          {
            (() => {
              const documents: any[] = booking?.documents || booking?.uploaded_documents ||
                                booking?.files || booking?.attachments || [];

              console.log('=== DOCUMENTS DEBUG ===');
              console.log('Documents found:', documents);
              console.log('Documents length:', documents?.length || 0);
              console.log('Document array type:', Array.isArray(documents));

              if (documents && Array.isArray(documents) && documents.length > 0) {
                return documents.map((doc: any, index: number) => {
                  const label = (doc.document_type || doc.type || doc.name || doc.file_name || `Document ${index + 1}`).replace(/_/g, ' ');
                  const verified = doc.verified || doc.is_verified || doc.status === 'verified';
                  const previewUrl = fixDocUrl(doc.file_url || doc.fileUrl || doc.uri, doc.category);
                  const isImage =
                    !!previewUrl &&
                    (
                      /\.(jpe?g|png|webp|gif|bmp|heic|heif)(\?|$)/i.test(previewUrl) ||
                      (typeof doc.mime_type === 'string' && doc.mime_type.startsWith('image/'))
                    );
                  return (
                    <TouchableOpacity
                      key={doc.id || index}
                      style={styles.documentItem}
                      onPress={() => setPreviewDoc(doc)}
                      activeOpacity={0.75}
                    >
                      {isImage && previewUrl ? (
                        <Image
                          source={{ uri: previewUrl }}
                          style={styles.documentThumb}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.documentThumbFallback}>
                          <Text style={{ fontSize: 20 }}>📄</Text>
                        </View>
                      )}
                      <View style={styles.documentInfo}>
                        <Text style={styles.documentName}>{label}</Text>
                        {doc.uploaded_at && (
                          <Text style={styles.documentDate}>
                            Uploaded {new Date(doc.uploaded_at).toLocaleDateString()}
                          </Text>
                        )}
                        <Text style={styles.documentTapHint}>Tap to preview</Text>
                      </View>
                      <View style={[styles.documentStatus, {
                        backgroundColor: verified ? '#4CAF50' : '#FFC107',
                      }]}>
                        <Text style={styles.documentStatusText}>
                          {verified ? 'Verified' : doc.status === 'rejected' ? 'Rejected' : 'In Review'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                });
              } else {
                return (
                  <View>
                    <Text style={styles.noDocuments}>No documents uploaded</Text>
                    <Text style={styles.noDocumentsSubtext}>
                      Upload required documents to proceed with your booking
                    </Text>
                    <TouchableOpacity
                      style={styles.uploadButton}
                      onPress={() => navigation.navigate('Documents', { bookingId })}
                    >
                      <Text style={styles.uploadButtonText}>Upload Documents</Text>
                    </TouchableOpacity>
                  </View>
                );
              }
            })()
          }
        </View>

        {/* Payment receipt — shown ONLY after a successful Razorpay
            transaction. Surfaces the full trail (UPI/Card/etc + transaction
            id + amount + paid timestamp) so the customer has a verifiable
            proof of payment without leaving the booking screen. */}
        {booking?.payment_status === 'paid' && (
          <View style={styles.paymentReceipt}>
            <View style={styles.paymentReceiptHeader}>
              <Text style={styles.paymentReceiptIcon}>✅</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.paymentReceiptTitle}>Payment Successful</Text>
                {booking?.paid_at && (
                  <Text style={styles.paymentReceiptSubtitle}>
                    {new Date(booking.paid_at).toLocaleString('en-IN', {
                      day: '2-digit', month: 'short', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </Text>
                )}
              </View>
              <Text style={styles.paymentReceiptAmount}>
                ₹{booking?.amount_paid ?? booking?.total_amount ?? booking?.price_quoted ?? 0}
              </Text>
            </View>
            <View style={styles.paymentReceiptDivider} />
            <View style={styles.paymentReceiptRow}>
              <Text style={styles.paymentReceiptLabel}>Method</Text>
              <Text style={styles.paymentReceiptValue}>
                {(booking?.payment_method || 'online').toUpperCase()}
              </Text>
            </View>
            {booking?.transaction_id && (
              <View style={styles.paymentReceiptRow}>
                <Text style={styles.paymentReceiptLabel}>Transaction ID</Text>
                <TouchableOpacity
                  onPress={async () => {
                    await Clipboard.setStringAsync(String(booking.transaction_id));
                    Alert.alert('Copied', 'Transaction ID copied to clipboard.');
                  }}
                >
                  <Text
                    style={[styles.paymentReceiptValue, styles.paymentReceiptCopyable]}
                    numberOfLines={1}
                  >
                    {booking.transaction_id}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            <Text style={styles.paymentReceiptHint}>
              Tap the transaction ID to copy. Save it for your records.
            </Text>
          </View>
        )}

        {/* Deferred Pay Now banner — shown only after the representative
            marks the work complete AND payment hasn't been collected yet.
            Customer pays via Razorpay (UPI / Card / Netbanking / Wallets). */}
        {booking?.status === 'completed' &&
          booking?.payment_status !== 'paid' &&
          !booking?.paid_at && (
            <View style={styles.payBanner}>
              <Text style={styles.payBannerEmoji}>💳</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.payBannerTitle}>
                  Service complete — pay now
                </Text>
                <Text style={styles.payBannerSubtitle}>
                  ₹{booking?.total_amount || booking?.price_quoted || booking?.amount || 0}
                  {' · '}UPI / Cards / Netbanking / Wallets
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.payBannerBtn, paying && { opacity: 0.6 }]}
                onPress={handlePayNow}
                disabled={paying}
              >
                {paying ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.payBannerBtnText}>Pay Now</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

        {/* Customer-facing OTP — shown when the rep has marked work
            completed and is waiting for the customer to verify. The
            customer reads this aloud to the rep, who types it on their
            app to close the booking. Tap-to-copy makes it dictation-
            friendly. The OTP arrives via push/SMS in production; this
            in-app banner is the dev-mode fallback so testing works
            without an SMS gateway. */}
        {booking?.completion_otp &&
          ['submitted', 'work_completed', 'in_progress'].includes(booking?.status) && (
            <View style={styles.otpBanner}>
              <Text style={styles.otpBannerLabel}>YOUR SUCCESS CODE</Text>
              <Text style={styles.otpBannerCode} selectable>
                {booking.completion_otp}
              </Text>
              <Text style={styles.otpBannerHint}>
                Read this code to your representative when they ask.
              </Text>
              <TouchableOpacity
                style={styles.otpBannerCopyBtn}
                onPress={async () => {
                  await Clipboard.setStringAsync(String(booking.completion_otp));
                  Alert.alert('Copied', 'OTP copied to clipboard.');
                }}
              >
                <Text style={styles.otpBannerCopyBtnText}>Tap to copy</Text>
              </TouchableOpacity>
            </View>
        )}

        {/* Rate & Review (only for completed bookings without rating yet) */}
        {booking?.status === 'completed' && !booking?.customer_rating && (
          <View style={styles.rateBanner}>
            <Text style={styles.rateBannerEmoji}>⭐</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.rateBannerTitle}>How was your experience?</Text>
              <Text style={styles.rateBannerSubtitle}>Share your feedback in seconds</Text>
            </View>
            <TouchableOpacity style={styles.rateBannerBtn} onPress={() => { haptics.tap(); setShowRating(true); }}>
              <Text style={styles.rateBannerBtnText}>Rate</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Show submitted rating (read-only) */}
        {booking?.customer_rating > 0 && (
          <View style={styles.ratedCard}>
            <Text style={styles.ratedTitle}>Your Rating</Text>
            <View style={styles.ratedStars}>
              {[1,2,3,4,5].map(n => (
                <Text key={n} style={[styles.ratedStar, n <= booking.customer_rating && styles.ratedStarFilled]}>★</Text>
              ))}
            </View>
            {booking.customer_feedback ? (
              <Text style={styles.ratedFeedback}>"{booking.customer_feedback}"</Text>
            ) : null}
          </View>
        )}

        {/* Action buttons row */}
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate('Tracking', { bookingId })}>
            <Text style={styles.actionBtnIcon}>📍</Text>
            <Text style={styles.actionBtnLabel}>Track Order</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={handleShareReceipt}>
            <Text style={styles.actionBtnIcon}>🧾</Text>
            <Text style={styles.actionBtnLabel}>Receipt</Text>
          </TouchableOpacity>
          {(booking?.status === 'pending' || booking?.status === 'assigned' || booking?.status === 'accepted') && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => { haptics.tap(); setShowReschedule(true); }}
            >
              <Text style={styles.actionBtnIcon}>📅</Text>
              <Text style={styles.actionBtnLabel}>Reschedule</Text>
            </TouchableOpacity>
          )}
          {(booking?.status === 'pending' || booking?.status === 'assigned') && (
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnDanger]} onPress={handleCancelBooking}>
              <Text style={styles.actionBtnIcon}>❌</Text>
              <Text style={[styles.actionBtnLabel, { color: '#E63946' }]}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {/* Rating Modal */}
      <Modal visible={showRating} transparent animationType="slide" onRequestClose={() => setShowRating(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <View style={styles.modalOverlay}>
          <View style={styles.ratingCard}>
            <Text style={styles.ratingTitle}>Rate Your Experience</Text>
            <Text style={styles.ratingSubtitle}>Tap the stars to rate</Text>

            <View style={styles.starsRow}>
              {[1,2,3,4,5].map(n => (
                <TouchableOpacity key={n} onPress={() => { haptics.selection(); setRating(n); }}>
                  <Text style={[styles.bigStar, n <= rating && styles.bigStarFilled]}>★</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.reviewInput}
              placeholder="Tell us what went well or could be better (optional)"
              placeholderTextColor="#9E9E9E"
              value={reviewText}
              onChangeText={setReviewText}
              multiline
              maxLength={300}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => { setShowRating(false); setRating(0); setReviewText(''); }}
              >
                <Text style={{ color: '#1A1A1A', fontWeight: '700' }}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnSubmit]}
                onPress={handleSubmitReview}
                disabled={submittingReview}
              >
                {submittingReview ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Tap-to-preview modal — opens when the user taps any doc row above. */}
      <DocPreviewModal
        visible={!!previewDoc}
        doc={previewDoc}
        onClose={() => setPreviewDoc(null)}
      />

      {/* Reschedule modal — replaces the broken "navigate to Booking"
          flow. Customer picks a new date + time + optional reason and
          we hit PUT /bookings/:id/reschedule directly. Backend gates on
          >=2h before scheduled time. */}
      <Modal
        visible={showReschedule}
        transparent
        animationType="slide"
        onRequestClose={() => setShowReschedule(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.rescheduleCard}>
            <Text style={styles.rescheduleTitle}>Reschedule Booking</Text>
            <Text style={styles.rescheduleSubtitle}>
              Pick a new date & time. Must be at least 2 hours before the
              original scheduled time.
            </Text>

            <Text style={styles.rescheduleLabel}>New Date *</Text>
            <TouchableOpacity
              style={styles.rescheduleInput}
              onPress={() => setShowRescheduleDatePicker(true)}
            >
              <Text style={{ color: rescheduleDate ? '#1F2937' : '#94A3B8' }}>
                {rescheduleDate ? rescheduleDate.toLocaleDateString('en-IN') : 'Select date'}
              </Text>
            </TouchableOpacity>
            {showRescheduleDatePicker && (
              <DateTimePicker
                value={rescheduleDate || new Date()}
                mode="date"
                display="default"
                minimumDate={new Date()}
                maximumDate={new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)}
                onChange={(_event: any, d: any) => {
                  setShowRescheduleDatePicker(false);
                  if (d) setRescheduleDate(d);
                }}
              />
            )}

            <Text style={styles.rescheduleLabel}>New Time *</Text>
            <TouchableOpacity
              style={styles.rescheduleInput}
              onPress={() => setShowRescheduleTimePicker(true)}
            >
              <Text style={{ color: rescheduleTime ? '#1F2937' : '#94A3B8' }}>
                {rescheduleTime
                  ? rescheduleTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                  : 'Select time'}
              </Text>
            </TouchableOpacity>
            {showRescheduleTimePicker && (
              <DateTimePicker
                value={rescheduleTime || new Date()}
                mode="time"
                display="default"
                is24Hour={false}
                onChange={(_event: any, t: any) => {
                  setShowRescheduleTimePicker(false);
                  if (t) setRescheduleTime(t);
                }}
              />
            )}

            <Text style={styles.rescheduleLabel}>Reason (optional)</Text>
            <TextInput
              style={[styles.rescheduleInput, { height: 80, textAlignVertical: 'top', paddingTop: 10 }]}
              placeholder="Why are you rescheduling?"
              placeholderTextColor="#94A3B8"
              value={rescheduleReason}
              onChangeText={setRescheduleReason}
              multiline
            />

            <View style={styles.rescheduleActions}>
              <TouchableOpacity
                style={styles.rescheduleCancelBtn}
                onPress={() => setShowReschedule(false)}
                disabled={rescheduling}
              >
                <Text style={styles.rescheduleCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rescheduleSubmitBtn, rescheduling && { opacity: 0.7 }]}
                onPress={handleSubmitReschedule}
                disabled={rescheduling}
              >
                {rescheduling ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.rescheduleSubmitText}>Confirm Reschedule</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  // ─── Payment receipt (shown after Razorpay confirms `captured`) ───
  paymentReceipt: {
    margin: SIZES.BASE,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  paymentReceiptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  paymentReceiptIcon: { fontSize: 24 },
  paymentReceiptTitle: { fontSize: 15, fontWeight: '800', color: '#065F46' },
  paymentReceiptSubtitle: { fontSize: 11, color: '#047857', marginTop: 2 },
  paymentReceiptAmount: { fontSize: 18, fontWeight: '900', color: '#065F46' },
  paymentReceiptDivider: { height: 1, backgroundColor: '#A7F3D0', marginVertical: 10 },
  paymentReceiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  paymentReceiptLabel: { fontSize: 12, color: '#047857' },
  paymentReceiptValue: { fontSize: 13, fontWeight: '700', color: '#0F172A', maxWidth: '60%' },
  paymentReceiptCopyable: { textDecorationLine: 'underline', color: '#059669' },
  paymentReceiptHint: {
    fontSize: 10,
    color: '#047857',
    fontStyle: 'italic',
    marginTop: 6,
    textAlign: 'right',
  },

  // ─── Pay Now banner (shown after status=completed, before payment) ───
  payBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E3EEF8',
    margin: SIZES.BASE,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#0D3B66',
    shadowColor: '#082B4C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  payBannerEmoji: { fontSize: 28, marginRight: 12 },
  payBannerTitle: { fontSize: 14, fontWeight: '800', color: '#0D3B66' },
  payBannerSubtitle: { fontSize: 11, color: '#5C6A7A', marginTop: 2 },
  payBannerBtn: {
    backgroundColor: '#0D3B66',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 90,
    alignItems: 'center',
  },
  payBannerBtnText: { color: '#fff', fontWeight: '800', fontSize: 13, letterSpacing: 0.3 },

  // ─── Rating banner (prompts user to rate after completion) ───
  rateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8E1',
    margin: SIZES.BASE,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  rateBannerEmoji: { fontSize: 28, marginRight: 12 },
  rateBannerTitle: { fontSize: 14, fontWeight: '800', color: '#1A1A1A' },
  rateBannerSubtitle: { fontSize: 11, color: '#6C757D', marginTop: 2 },
  rateBannerBtn: { backgroundColor: '#F9A825', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  rateBannerBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  // ─── Submitted rating display ───
  ratedCard: {
    backgroundColor: '#fff',
    margin: SIZES.BASE,
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
    elevation: 2,
  },
  ratedTitle: { fontSize: 12, fontWeight: '700', color: '#6C757D', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  ratedStars: { flexDirection: 'row', marginBottom: 6 },
  ratedStar: { fontSize: 22, color: '#E0E0E0', marginHorizontal: 2 },
  ratedStarFilled: { color: '#F9A825' },
  ratedFeedback: { fontSize: 13, color: '#1A1A1A', fontStyle: 'italic', textAlign: 'center', marginTop: 4 },

  // ─── Action buttons row (Track / Receipt / Cancel) ───
  actionRow: { flexDirection: 'row', margin: SIZES.BASE, gap: 8 },
  actionBtn: {
    flex: 1,
    backgroundColor: '#fff',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F0F2F5',
  },
  actionBtnDanger: { borderColor: '#FCE4E6' },
  actionBtnIcon: { fontSize: 20, marginBottom: 4 },
  actionBtnLabel: { fontSize: 12, fontWeight: '700', color: '#1A1A1A' },

  // ─── Rating modal ───
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  ratingCard: { backgroundColor: '#fff', borderRadius: 20, padding: 24 },
  ratingTitle: { fontSize: 22, fontWeight: '800', color: '#1A1A1A', textAlign: 'center', marginBottom: 4 },
  ratingSubtitle: { fontSize: 13, color: '#6C757D', textAlign: 'center', marginBottom: 18 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 18 },
  bigStar: { fontSize: 44, color: '#E0E0E0', marginHorizontal: 4 },
  bigStarFilled: { color: '#F9A825' },
  reviewInput: {
    borderWidth: 1, borderColor: '#E9ECEF', borderRadius: 12,
    padding: 12, fontSize: 14, color: '#1A1A1A',
    minHeight: 80, textAlignVertical: 'top',
    marginBottom: 14, backgroundColor: '#FAFAFA',
  },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  modalBtnCancel: { backgroundColor: '#F0F2F5' },
  modalBtnSubmit: { backgroundColor: '#E63946' },

  // ─── Reschedule modal ───
  rescheduleCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 22,
    maxHeight: '90%',
  },
  rescheduleTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0D3B66',
    marginBottom: 4,
  },
  rescheduleSubtitle: {
    fontSize: 12,
    color: '#6C757D',
    marginBottom: 16,
  },
  rescheduleLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 6,
    marginTop: 8,
  },
  rescheduleInput: {
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    color: '#1F2937',
    backgroundColor: '#F8FAFC',
  },
  rescheduleActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  rescheduleCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#F0F2F5',
  },
  rescheduleCancelText: {
    color: '#1F2937',
    fontWeight: '700',
  },
  rescheduleSubmitBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#0D3B66',
  },
  rescheduleSubmitText: {
    color: '#fff',
    fontWeight: '800',
  },

  container: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SIZES.BASE,
    paddingTop: 30,
    backgroundColor: COLORS.PRIMARY,
  },
  backButton: {
    fontSize: 16,
    color: COLORS.WHITE,
    fontWeight: '800',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
    letterSpacing: 0.4,
  },
  title: {
    fontSize: SIZES.LARGE,
    fontWeight: 'bold',
    color: COLORS.WHITE,
  },
  content: {
    flex: 1,
    padding: SIZES.BASE,
  },
  statusContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SIZES.BASE,
  },
  bookingNumber: {
    fontSize: SIZES.FONT,
    fontWeight: 'bold',
    color: COLORS.BLACK,
  },
  statusBadge: {
    paddingHorizontal: SIZES.BASE,
    paddingVertical: SIZES.BASE / 2,
    borderRadius: BORDER_RADIUS.SMALL,
  },
  statusText: {
    fontSize: SIZES.SMALL,
    fontWeight: '600',
    color: COLORS.WHITE,
  },
  section: {
    backgroundColor: COLORS.WHITE,
    padding: SIZES.BASE,
    borderRadius: BORDER_RADIUS.MEDIUM,
    marginBottom: SIZES.BASE,
  },
  sectionTitle: {
    fontSize: SIZES.LARGE,
    fontWeight: 'bold',
    color: COLORS.BLACK,
    marginBottom: SIZES.BASE,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SIZES.BASE / 2,
  },
  detailLabel: {
    fontSize: SIZES.FONT,
    color: COLORS.GRAY,
    flex: 1,
  },
  detailValue: {
    fontSize: SIZES.FONT,
    fontWeight: '600',
    color: COLORS.BLACK,
    flex: 2,
    textAlign: 'right',
  },
  progressContainer: {
    marginVertical: SIZES.BASE,
  },
  progressBar: {
    height: 8,
    backgroundColor: COLORS.LIGHT_GRAY,
    borderRadius: BORDER_RADIUS.SMALL,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.PRIMARY,
    borderRadius: BORDER_RADIUS.SMALL,
  },
  progressText: {
    fontSize: SIZES.SMALL,
    color: COLORS.GRAY,
    textAlign: 'center',
    marginTop: SIZES.BASE / 2,
  },
  documentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SIZES.BASE / 2,
    gap: 10,
  },
  documentThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#F0F2F5',
  },
  documentThumbFallback: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#F0F2F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  documentName: {
    fontSize: SIZES.FONT,
    color: COLORS.BLACK,
    flex: 1,
  },
  documentStatus: {
    paddingHorizontal: SIZES.BASE,
    paddingVertical: SIZES.BASE / 4,
    borderRadius: BORDER_RADIUS.SMALL,
  },
  documentStatusText: {
    fontSize: SIZES.SMALL,
    fontWeight: '600',
    color: COLORS.WHITE,
  },
  noDocuments: {
    fontSize: SIZES.FONT,
    color: COLORS.GRAY,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  otpContainer: {
    alignItems: 'center',
  },
  otpInput: {
    backgroundColor: COLORS.WHITE,
    borderWidth: 1,
    borderColor: COLORS.LIGHT_GRAY,
    borderRadius: BORDER_RADIUS.SMALL,
    padding: SIZES.BASE,
    fontSize: SIZES.FONT,
    textAlign: 'center',
    marginBottom: SIZES.BASE,
  },
  verifyButton: {
    backgroundColor: COLORS.PRIMARY,
    paddingHorizontal: SIZES.BASE * 2,
    paddingVertical: SIZES.BASE,
    borderRadius: BORDER_RADIUS.SMALL,
    alignItems: 'center',
  },
  verifyButtonText: {
    color: COLORS.WHITE,
    fontSize: SIZES.FONT,
    fontWeight: '600',
  },
  disabledButton: {
    backgroundColor: COLORS.GRAY,
  },
  cancelButton: {
    backgroundColor: '#F44336',
    padding: SIZES.BASE,
    borderRadius: BORDER_RADIUS.SMALL,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: COLORS.WHITE,
    fontSize: SIZES.FONT,
    fontWeight: '600',
  },
  trackButton: {
    backgroundColor: COLORS.SECONDARY,
    padding: SIZES.BASE,
    borderRadius: BORDER_RADIUS.SMALL,
    alignItems: 'center',
  },
  trackButtonText: {
    color: COLORS.WHITE,
    fontSize: SIZES.FONT,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: SIZES.BASE,
    fontSize: SIZES.FONT,
    color: COLORS.GRAY,
  },
  uploadButton: {
    backgroundColor: COLORS.PRIMARY,
    padding: SIZES.BASE,
    borderRadius: BORDER_RADIUS.SMALL,
    alignItems: 'center',
    marginTop: SIZES.BASE,
  },
  uploadButtonText: {
    color: COLORS.WHITE,
    fontSize: SIZES.FONT,
    fontWeight: '600',
  },
  documentInfo: {
    flex: 1,
  },
  documentPath: {
    fontSize: SIZES.SMALL,
    color: COLORS.GRAY,
    fontStyle: 'italic',
    marginTop: 2,
  },
  documentDate: {
    fontSize: SIZES.SMALL,
    color: COLORS.GRAY,
    marginTop: 2,
  },
  documentTapHint: {
    fontSize: 10, color: '#1976D2', fontWeight: '600', marginTop: 4, letterSpacing: 0.3,
  },
  otpBanner: {
    margin: SIZES.BASE,
    backgroundColor: '#FEF3C7',
    borderWidth: 2,
    borderColor: '#F59E0B',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#92400E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  otpBannerLabel: {
    color: '#92400E',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  otpBannerCode: {
    color: '#0F172A',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 8,
    marginBottom: 6,
  },
  otpBannerHint: {
    color: '#78350F',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 10,
  },
  otpBannerCopyBtn: {
    backgroundColor: '#0D3B66',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 18,
  },
  otpBannerCopyBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  noDocumentsSubtext: {
    fontSize: SIZES.SMALL,
    color: COLORS.GRAY,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: SIZES.BASE / 2,
    marginBottom: SIZES.BASE,
  },
});

export default BookingDetailsScreen;

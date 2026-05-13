import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Linking,
  Image,
} from 'react-native';
import { COLORS, SIZES, BORDER_RADIUS } from '../constants/colors';
import { STRINGS } from '../constants/strings';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBookingDetails } from '../services/api';
import { formatBookingId } from '../utils/bookingId';
import DocPreviewModal, { fixDocUrl } from '../components/DocPreviewModal';
// react-native-maps is already in package.json. Defensive require so a
// dev-client missing the native module falls back to the placeholder
// instead of crashing.
let MapView: any = null;
let Marker: any = null;
let mapAvailable = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const m = require('react-native-maps');
  MapView = m.default || m;
  Marker = m.Marker;
  mapAvailable = !!MapView && !!Marker;
} catch (_) {
  mapAvailable = false;
}

interface Navigation {
  navigate: (route: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
  replace?: (route: string) => void;
  addListener?: (event: string, cb: () => void) => () => void;
}

interface Route {
  params?: { [key: string]: any };
}

interface Props {
  navigation: Navigation;
  route: Route;
}

const TrackingScreen: React.FC<Props> = ({ navigation, route }) => {
  const { bookingId } = route.params as { bookingId: any };
  // Top inset so the back button isn't clipped behind status bar/notch
  // now that the React Navigation stack header is hidden for this screen.
  const insets = useSafeAreaInsets();
  const [booking, setBooking] = useState<any>(null);
  // Currently-previewed doc (set when user taps a doc row).
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    loadBookingDetails();
  }, [bookingId]);

  // Poll booking details every 30s so the rep's `current_lat/lng`
  // (refreshed by the rep app's location ping every 60s) propagates to
  // the customer's map without a manual pull-to-refresh. Stops when
  // the screen unmounts so we don't leak intervals.
  useEffect(() => {
    const t = setInterval(() => {
      loadBookingDetails();
    }, 30_000);
    return () => clearInterval(t);
  }, [bookingId]);

  const loadBookingDetails = async (): Promise<void> => {
    try {
      setLoading(true);
      const response: any = await getBookingDetails(bookingId);
      // Backend may return { success, data: booking } OR booking directly
      const data = response?.data || response;
      setBooking(data);
    } catch (error) {
      console.error('Error loading booking details:', error);
      Alert.alert('Error', 'Failed to load tracking information');
    } finally {
      setLoading(false);
    }
  };

  const handleCallAgent = (): void => {
    if (booking?.agent?.mobile) {
      const phoneNumber = booking.agent.mobile;
      Linking.openURL(`tel:${phoneNumber}`);
    } else {
      Alert.alert('Info', 'Representative contact number not available');
    }
  };

  const handleWhatsApp = (): void => {
    if (booking?.agent?.mobile) {
      const phoneNumber = booking.agent.mobile;
      const message = `Hi, I'm inquiring about my booking #${booking.booking_number || bookingId}. Please provide an update.`;
      Linking.openURL(`whatsapp://send?phone=${phoneNumber}&text=${encodeURIComponent(message)}`);
    } else {
      Alert.alert('Info', 'Representative contact not available for WhatsApp');
    }
  };

  const getStatusColor = (): string => {
    switch (booking?.status) {
      case 'pending':
        return '#FFC107';
      case 'assigned':
        return '#2196F3';
      case 'accepted':
        return '#FF9800';
      case 'documents_collected':
        return '#9C27B0';
      case 'submitted':
        return '#00BCD4';
      case 'completed':
        return '#4CAF50';
      case 'cancelled':
        return '#F44336';
      default:
        return '#757575';
    }
  };

  const getStatusText = (): string => {
    switch (booking?.status) {
      case 'pending':
        return 'Booking Placed';
      case 'assigned':
        return 'Representative Dispatched';
      case 'accepted':
        return 'Representative Arrived';
      case 'documents_collected':
        return 'Work In-Progress';
      case 'submitted':
        return 'Work In-Progress';
      case 'completed':
        return 'Job Completed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return 'Unknown';
    }
  };

  // Spec timeline stages: Dispatched → Arrived → Work In-Progress → Completed
  const TIMELINE_STAGES: Array<{ key: string; label: string; statuses: string[] }> = [
    { key: 'placed', label: 'Booking Placed', statuses: ['pending', 'assigned', 'accepted', 'documents_collected', 'submitted', 'completed'] },
    { key: 'dispatched', label: 'Representative Dispatched', statuses: ['assigned', 'accepted', 'documents_collected', 'submitted', 'completed'] },
    { key: 'arrived', label: 'Representative Arrived', statuses: ['accepted', 'documents_collected', 'submitted', 'completed'] },
    { key: 'in_progress', label: 'Work In-Progress', statuses: ['documents_collected', 'submitted', 'completed'] },
    { key: 'completed', label: 'Job Completed', statuses: ['completed'] },
  ];

  const isStageReached = (stage: { statuses: string[] }): boolean =>
    !!booking?.status && stage.statuses.includes(booking.status);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.PRIMARY} />
        <Text style={styles.loadingText}>Loading tracking information...</Text>
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
        <Text style={styles.title}>Track Order</Text>
        <View style={{ width: 56 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Status Section */}
        <View style={styles.statusSection}>
          <Text style={styles.sectionTitle}>Current Status</Text>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor() }]}>
            <Text style={styles.statusText}>{getStatusText()}</Text>
          </View>
          <Text style={styles.bookingNumber}>{formatBookingId(booking?.booking_number || bookingId)}</Text>
        </View>

        {/* Uploaded Documents — give the customer a single source of truth
            for what's been attached to this booking. Backends differ on the
            field name AND shape (some return wrapped objects), so normalise. */}
        {(() => {
          const raw =
            booking?.documents ||
            booking?.uploaded_documents ||
            booking?.files ||
            booking?.attachments ||
            booking?.required_documents ||
            [];
          // Unwrap {documents: [...]} shape used by some seeds.
          const docs = (Array.isArray(raw)
            ? raw
            : Array.isArray(raw?.documents)
            ? raw.documents
            : []
          ).filter(Boolean);
          return (
            <View style={styles.docsSection}>
              <Text style={styles.sectionTitle}>📎 Uploaded Documents</Text>
              {docs.length === 0 ? (
                <Text style={styles.docsEmpty}>
                  No documents attached to this booking yet.
                </Text>
              ) : (
                docs.map((d: any, i: number) => {
                  const label =
                    d?.document_type || d?.type || d?.name || d?.file_name || `Document ${i + 1}`;
                  const verified = d?.verified || d?.is_verified || d?.status === 'verified';
                  const rejected = d?.status === 'rejected';
                  const badge = verified
                    ? { text: 'Verified', bg: '#E8F5E9', color: '#2E7D32' }
                    : rejected
                    ? { text: 'Rejected', bg: '#FFEBEE', color: '#B71C1C' }
                    : { text: 'In Review', bg: '#FFF8E1', color: '#A15A00' };
                  const previewUrl = fixDocUrl(d?.file_url || d?.fileUrl || d?.uri, d?.category);
                  const isImage =
                    !!previewUrl &&
                    (
                      /\.(jpe?g|png|webp|gif|bmp|heic|heif)(\?|$)/i.test(previewUrl) ||
                      (typeof d?.mime_type === 'string' && d.mime_type.startsWith('image/'))
                    );
                  return (
                    <TouchableOpacity
                      key={d?.id || i}
                      style={styles.docItemRow}
                      activeOpacity={0.75}
                      onPress={() => setPreviewDoc(d)}
                    >
                      {isImage && previewUrl ? (
                        <Image
                          source={{ uri: previewUrl }}
                          style={styles.docThumb}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.docThumbFallback}>
                          <Text style={{ fontSize: 20 }}>📄</Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.docItemName} numberOfLines={1}>
                          {String(label).replace(/_/g, ' ')}
                        </Text>
                        {d?.uploaded_at && (
                          <Text style={styles.docItemMeta}>
                            {new Date(d.uploaded_at).toLocaleString()}
                          </Text>
                        )}
                        <Text style={styles.docItemTapHint}>Tap to preview</Text>
                      </View>
                      <View style={[styles.docItemBadge, { backgroundColor: badge.bg }]}>
                        <Text style={[styles.docItemBadgeText, { color: badge.color }]}>
                          {badge.text}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          );
        })()}

        {/* Progress Bar */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: booking?.status === 'completed' ? '100%' : '50%' }
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {booking?.status === 'completed' ? 'Delivered' : 'In Transit'}
          </Text>
        </View>

        {/* Agent Information */}
        {booking?.agent && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Representative Information</Text>
            <View style={styles.agentCard}>
              <View style={styles.agentInfo}>
                <Text style={styles.agentName}>{booking.agent.name}</Text>
                <View style={styles.agentRating}>
                  <Text style={styles.ratingStars}>
                    {'★'.repeat(booking.agent.rating || 0)}
                  </Text>
                  <Text style={styles.ratingNumber}>({booking.agent.rating || 0}.0)</Text>
                </View>
              </View>
              <Text style={styles.agentMobile}>{booking.agent.mobile}</Text>
            </View>

            <View style={styles.actionButtons}>
              <TouchableOpacity style={styles.callButton} onPress={handleCallAgent}>
                <Text style={styles.actionButtonText}>📞 Call</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.whatsappButton} onPress={handleWhatsApp}>
                <Text style={styles.actionButtonText}>💬 WhatsApp</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Address Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Service Address</Text>
          <View style={styles.addressCard}>
            <Text style={styles.addressText}>
              {booking?.service_address || booking?.address || booking?.customer_address || 'N/A'}
            </Text>
          </View>
        </View>

        {/* Live Location — real react-native-maps MapView showing the
            rep's last-known position (refreshed every 30s) + the
            customer's destination. Falls back to the old placeholder
            text only when the native map module isn't bundled, or
            when no coords are available yet. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Live Location</Text>
          {(() => {
            const agentLat =
              Number(booking?.agent?.current_lat ?? booking?.assigned_agent?.current_lat ?? NaN);
            const agentLng =
              Number(booking?.agent?.current_lng ?? booking?.assigned_agent?.current_lng ?? NaN);
            const hasAgentCoords =
              Number.isFinite(agentLat) && Number.isFinite(agentLng) &&
              (agentLat !== 0 || agentLng !== 0);

            const destLat = Number(booking?.latitude ?? booking?.customer?.current_lat ?? NaN);
            const destLng = Number(booking?.longitude ?? booking?.customer?.current_lng ?? NaN);
            const hasDestCoords =
              Number.isFinite(destLat) && Number.isFinite(destLng) &&
              (destLat !== 0 || destLng !== 0);

            // Map needs at least one coord to render. If neither side
            // has shared a position yet, fall back to the helpful
            // hint card so the user knows what's coming.
            if (!mapAvailable || (!hasAgentCoords && !hasDestCoords)) {
              return (
                <View style={styles.mapPlaceholder}>
                  <Text style={styles.mapText}>📍 Live Map</Text>
                  <Text style={styles.mapSubtext}>
                    {!mapAvailable
                      ? 'Map module not bundled yet — update the app to see live tracking.'
                      : booking?.agent
                        ? 'Waiting for the representative to share their location… (refreshes every 30s)'
                        : 'Location tracking will be available once a representative is assigned.'}
                  </Text>
                </View>
              );
            }

            // Centre the map on whichever coord is available; if both,
            // bias slightly toward the midpoint so both markers fit
            // inside a reasonable zoom level.
            const centreLat = hasAgentCoords && hasDestCoords
              ? (agentLat + destLat) / 2
              : hasAgentCoords ? agentLat : destLat;
            const centreLng = hasAgentCoords && hasDestCoords
              ? (agentLng + destLng) / 2
              : hasAgentCoords ? agentLng : destLng;
            const latDelta = hasAgentCoords && hasDestCoords
              ? Math.max(0.02, Math.abs(agentLat - destLat) * 1.6)
              : 0.02;
            const lngDelta = hasAgentCoords && hasDestCoords
              ? Math.max(0.02, Math.abs(agentLng - destLng) * 1.6)
              : 0.02;

            return (
              <View style={styles.mapWrap}>
                <MapView
                  style={styles.mapView}
                  region={{
                    latitude: centreLat,
                    longitude: centreLng,
                    latitudeDelta: latDelta,
                    longitudeDelta: lngDelta,
                  }}
                  showsUserLocation={false}
                  showsMyLocationButton={false}
                >
                  {hasAgentCoords && (
                    <Marker
                      coordinate={{ latitude: agentLat, longitude: agentLng }}
                      title={booking?.agent?.name || 'Representative'}
                      description="Live position"
                      pinColor="#0D3B66"
                    />
                  )}
                  {hasDestCoords && (
                    <Marker
                      coordinate={{ latitude: destLat, longitude: destLng }}
                      title="Service address"
                      description={booking?.address || ''}
                      pinColor="#E63946"
                    />
                  )}
                </MapView>
                <View style={styles.mapLegend}>
                  <View style={styles.mapLegendItem}>
                    <View style={[styles.mapLegendDot, { backgroundColor: '#0D3B66' }]} />
                    <Text style={styles.mapLegendText}>
                      {hasAgentCoords ? 'Rep' : 'Rep (waiting)'}
                    </Text>
                  </View>
                  <View style={styles.mapLegendItem}>
                    <View style={[styles.mapLegendDot, { backgroundColor: '#E63946' }]} />
                    <Text style={styles.mapLegendText}>Service address</Text>
                  </View>
                </View>
              </View>
            );
          })()}
        </View>

        {/* Timeline — spec stages: Dispatched → Arrived → Work In-Progress → Completed */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Timeline</Text>
          <View style={styles.timeline}>
            {TIMELINE_STAGES.map((stage) => {
              const reached = isStageReached(stage);
              return (
                <View key={stage.key} style={styles.timelineItem}>
                  <View
                    style={[
                      styles.timelineDot,
                      { backgroundColor: reached ? getStatusColor() : '#CFD8DC' },
                    ]}
                  />
                  <View style={styles.timelineContent}>
                    <Text
                      style={[
                        styles.timelineTitle,
                        { color: reached ? '#212121' : '#9E9E9E' },
                      ]}
                    >
                      {stage.label}
                    </Text>
                    {stage.key === 'placed' && (
                      <Text style={styles.timelineDate}>
                        {booking?.created_at
                          ? new Date(booking.created_at).toLocaleDateString()
                          : 'N/A'}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {/* Full-screen image preview when a doc row is tapped. */}
      <DocPreviewModal
        visible={!!previewDoc}
        doc={previewDoc}
        onClose={() => setPreviewDoc(null)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
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
  statusSection: {
    backgroundColor: COLORS.WHITE,
    padding: SIZES.BASE,
    borderRadius: BORDER_RADIUS.MEDIUM,
    marginBottom: SIZES.BASE,
    alignItems: 'center',
  },
  docsSection: {
    backgroundColor: COLORS.WHITE,
    padding: SIZES.BASE,
    borderRadius: BORDER_RADIUS.MEDIUM,
    marginBottom: SIZES.BASE,
  },
  docsEmpty: {
    fontSize: 13, color: '#90A4AE', fontStyle: 'italic',
  },
  docItemRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F0F2F5',
    gap: 10,
  },
  docThumb: {
    width: 48, height: 48, borderRadius: 8, backgroundColor: '#F0F2F5',
  },
  docThumbFallback: {
    width: 48, height: 48, borderRadius: 8, backgroundColor: '#F0F2F5',
    alignItems: 'center', justifyContent: 'center',
  },
  docItemName: { fontSize: 13, color: '#263238', fontWeight: '600' },
  docItemMeta: { fontSize: 11, color: '#90A4AE', marginTop: 2 },
  docItemBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginLeft: 8 },
  docItemBadgeText: { fontSize: 11, fontWeight: '700' },
  docItemTapHint: { fontSize: 10, color: '#1976D2', fontWeight: '600', marginTop: 4, letterSpacing: 0.3 },
  sectionTitle: {
    fontSize: SIZES.LARGE,
    fontWeight: 'bold',
    color: COLORS.BLACK,
    marginBottom: SIZES.BASE,
  },
  statusBadge: {
    paddingHorizontal: SIZES.BASE,
    paddingVertical: SIZES.BASE / 2,
    borderRadius: BORDER_RADIUS.SMALL,
  },
  statusText: {
    fontSize: SIZES.FONT,
    fontWeight: '600',
    color: COLORS.WHITE,
  },
  bookingNumber: {
    fontSize: SIZES.FONT,
    fontWeight: 'bold',
    color: COLORS.BLACK,
    marginTop: SIZES.BASE / 2,
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
  section: {
    backgroundColor: COLORS.WHITE,
    padding: SIZES.BASE,
    borderRadius: BORDER_RADIUS.MEDIUM,
    marginBottom: SIZES.BASE,
  },
  agentCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SIZES.BASE,
  },
  agentInfo: {
    flex: 1,
  },
  agentName: {
    fontSize: SIZES.LARGE,
    fontWeight: 'bold',
    color: COLORS.BLACK,
  },
  agentRating: {
    alignItems: 'center',
    marginTop: SIZES.BASE / 4,
  },
  ratingStars: {
    fontSize: SIZES.FONT,
    color: COLORS.PRIMARY,
  },
  ratingNumber: {
    fontSize: SIZES.SMALL,
    color: COLORS.GRAY,
    marginLeft: SIZES.BASE / 4,
  },
  agentMobile: {
    fontSize: SIZES.FONT,
    color: COLORS.PRIMARY,
    fontWeight: '600',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: SIZES.BASE,
  },
  callButton: {
    backgroundColor: COLORS.PRIMARY,
    padding: SIZES.BASE,
    borderRadius: BORDER_RADIUS.SMALL,
    flex: 1,
    alignItems: 'center',
  },
  whatsappButton: {
    backgroundColor: '#25D366',
    padding: SIZES.BASE,
    borderRadius: BORDER_RADIUS.SMALL,
    flex: 1,
    alignItems: 'center',
  },
  actionButtonText: {
    color: COLORS.WHITE,
    fontSize: SIZES.SMALL,
    fontWeight: '600',
  },
  addressCard: {
    backgroundColor: COLORS.WHITE,
    padding: SIZES.BASE,
    borderRadius: BORDER_RADIUS.SMALL,
    borderWidth: 1,
    borderColor: COLORS.LIGHT_GRAY,
  },
  addressText: {
    fontSize: SIZES.FONT,
    color: COLORS.BLACK,
  },
  mapPlaceholder: {
    backgroundColor: COLORS.WHITE,
    padding: SIZES.BASE * 2,
    borderRadius: BORDER_RADIUS.MEDIUM,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.LIGHT_GRAY,
  },
  mapText: {
    fontSize: SIZES.XLARGE,
    color: COLORS.PRIMARY,
    marginBottom: SIZES.BASE / 2,
  },
  mapSubtext: {
    fontSize: SIZES.SMALL,
    color: COLORS.GRAY,
    textAlign: 'center',
  },
  // Real MapView container — fixed height so it doesn't collapse
  // inside the ScrollView. Legend pinned to bottom-left.
  mapWrap: {
    backgroundColor: COLORS.WHITE,
    borderRadius: BORDER_RADIUS.MEDIUM,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.LIGHT_GRAY,
  },
  mapView: {
    width: '100%',
    height: 240,
  },
  mapLegend: {
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#F0F2F5',
    backgroundColor: '#FFFFFF',
  },
  mapLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mapLegendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  mapLegendText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  timeline: {
    paddingLeft: SIZES.BASE,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SIZES.BASE,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.LIGHT_GRAY,
    marginTop: SIZES.BASE / 2,
  },
  timelineContent: {
    flex: 1,
    marginLeft: SIZES.BASE,
  },
  timelineTitle: {
    fontSize: SIZES.FONT,
    fontWeight: '600',
    color: COLORS.BLACK,
    marginBottom: SIZES.BASE / 4,
  },
  timelineDate: {
    fontSize: SIZES.SMALL,
    color: COLORS.GRAY,
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
});

export default TrackingScreen;

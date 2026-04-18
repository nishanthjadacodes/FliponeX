import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { COLORS, SIZES, BORDER_RADIUS } from '../constants/colors';
import { STRINGS } from '../constants/strings';
import { getBookingDetails } from '../services/api';

const TrackingScreen = ({ navigation, route }) => {
  const { bookingId } = route.params;
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadBookingDetails();
  }, [bookingId]);

  const loadBookingDetails = async () => {
    try {
      setLoading(true);
      const response = await getBookingDetails(bookingId);
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

  const handleCallAgent = () => {
    if (booking?.agent?.mobile) {
      const phoneNumber = booking.agent.mobile;
      Linking.openURL(`tel:${phoneNumber}`);
    } else {
      Alert.alert('Info', 'Agent contact number not available');
    }
  };

  const handleWhatsApp = () => {
    if (booking?.agent?.mobile) {
      const phoneNumber = booking.agent.mobile;
      const message = `Hi, I'm inquiring about my booking #${booking.booking_number || bookingId}. Please provide an update.`;
      Linking.openURL(`whatsapp://send?phone=${phoneNumber}&text=${encodeURIComponent(message)}`);
    } else {
      Alert.alert('Info', 'Agent contact not available for WhatsApp');
    }
  };

  const getStatusColor = () => {
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

  const getStatusText = () => {
    switch (booking?.status) {
      case 'pending':
        return 'Pending';
      case 'assigned':
        return 'Agent Assigned';
      case 'accepted':
        return 'In Progress';
      case 'documents_collected':
        return 'Documents Collected';
      case 'submitted':
        return 'Submitted';
      case 'completed':
        return 'Completed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return 'Unknown';
    }
  };

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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Track Order</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Status Section */}
        <View style={styles.statusSection}>
          <Text style={styles.sectionTitle}>Current Status</Text>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor() }]}>
            <Text style={styles.statusText}>{getStatusText()}</Text>
          </View>
          <Text style={styles.bookingNumber}>#{booking?.booking_number || bookingId}</Text>
        </View>

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
            <Text style={styles.sectionTitle}>Agent Information</Text>
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

        {/* Live Location Map Placeholder */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Live Location</Text>
          <View style={styles.mapPlaceholder}>
            <Text style={styles.mapText}>📍 Map View</Text>
            <Text style={styles.mapSubtext}>
              {booking?.latitude && booking?.longitude 
                ? `Lat: ${booking.latitude}, Lng: ${booking.longitude}`
                : 'Location tracking will be available once agent is assigned'
              }
            </Text>
          </View>
        </View>

        {/* Timeline */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Timeline</Text>
          <View style={styles.timeline}>
            <View style={styles.timelineItem}>
              <View style={styles.timelineDot} />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineTitle}>Order Placed</Text>
                <Text style={styles.timelineDate}>
                  {booking?.created_at ? new Date(booking.created_at).toLocaleDateString() : 'N/A'}
                </Text>
              </View>
            </View>
            
            <View style={styles.timelineItem}>
              <View style={[styles.timelineDot, { backgroundColor: getStatusColor() }]} />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineTitle}>{getStatusText()}</Text>
                <Text style={styles.timelineDate}>
                  {booking?.updated_at ? new Date(booking.updated_at).toLocaleDateString() : 'N/A'}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
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
    fontSize: SIZES.FONT,
    color: COLORS.WHITE,
    fontWeight: '600',
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

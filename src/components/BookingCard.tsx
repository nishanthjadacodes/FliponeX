import React, { useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { COLORS, SIZES, BORDER_RADIUS } from '../constants/colors';
import * as haptics from '../utils/haptics';
import { formatBookingId } from '../utils/bookingId';

// Loose booking shape — accepts both snake_case (backend) and camelCase
// variants the older screens use, so callers don't have to normalize first.
export interface BookingCardItem {
  id?: string | number;
  booking_number?: string | number;
  bookingNumber?: string | number;
  status?: string;
  service_name?: string;
  serviceName?: string;
  service?: { name?: string };
  customer_name?: string;
  customerName?: string;
  fullName?: string;
  customer_mobile?: string;
  mobile?: string;
  created_at?: string;
  createdAt?: string;
  total_amount?: number;
  totalAmount?: number;
  price_quoted?: number;
  service_address?: string;
  address?: string;
  // Scheduled visit slot — surfaced on the card so ongoing bookings
  // show exactly when the rep is expected. Previously only the
  // create-date was shown, which made it look like the booking had
  // no scheduling info.
  preferred_date?: string | null;
  preferred_time?: string | null;
  // Payment status — surfaces a green "✓ PAID" pill next to the amount
  // when the customer has paid online (Razorpay) or cash-on-completion.
  payment_status?: 'pending' | 'paid' | 'refunded' | string;
  payment_method?: string;
}

export interface BookingCardProps {
  booking: BookingCardItem;
  onPress?: () => void;
}

const BookingCard: React.FC<BookingCardProps> = ({ booking, onPress }) => {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = (): void => {
    Animated.timing(scale, { toValue: 0.97, duration: 80, useNativeDriver: true }).start();
  };
  const handlePressOut = (): void => {
    Animated.timing(scale, { toValue: 1, duration: 80, useNativeDriver: true }).start();
  };
  const handlePress = (): void => {
    haptics.tap();
    onPress?.();
  };

  const getStatusColor = (): string => {
    switch (booking.status) {
      case 'pending': return '#FFC107';
      case 'confirmed': return '#4CAF50';
      case 'assigned': return '#2196F3';
      case 'accepted': return '#FF9800';
      case 'documents_collected': return '#9C27B0';
      case 'submitted': return '#00BCD4';
      case 'completed': return '#4CAF50';
      case 'cancelled': return '#F44336';
      default: return '#757575';
    }
  };

  const getStatusText = (): string => {
    switch (booking.status) {
      case 'pending': return 'Pending';
      case 'confirmed': return 'Confirmed';
      case 'assigned': return 'Assigned';
      case 'accepted': return 'Accepted';
      case 'documents_collected': return 'Docs Collected';
      case 'submitted': return 'Submitted';
      case 'completed': return 'Completed';
      case 'cancelled': return 'Cancelled';
      default: return booking.status || 'Unknown';
    }
  };

  const formatDate = (dateString?: string): string => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Invalid Date';
      return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (error) {
      return 'Invalid Date';
    }
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        style={styles.card}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
      >
        <View style={styles.header}>
          <View style={styles.bookingInfo}>
            <Text style={styles.bookingNumber}>
              {formatBookingId(booking.booking_number ?? booking.bookingNumber ?? booking.id)}
            </Text>
            <Text style={styles.serviceName} numberOfLines={2}>
              {booking.service_name || booking.serviceName || booking.service?.name || 'Service'}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor() }]}>
            <Text style={styles.statusText}>{getStatusText()}</Text>
          </View>
        </View>

        <View style={styles.details}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Customer:</Text>
            <Text style={styles.detailValue}>
              {booking.customer_name || booking.customerName || booking.fullName || 'N/A'}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Mobile:</Text>
            <Text style={styles.detailValue}>{booking.customer_mobile || booking.mobile || 'N/A'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Date:</Text>
            <Text style={styles.detailValue}>
              {/* Prefer the customer's scheduled date over booking-creation
                  date — that's the date the visit actually happens on. */}
              {formatDate(
                booking.preferred_date || booking.created_at || booking.createdAt,
              )}
            </Text>
          </View>
          {/* Time slot — was missing from the card. Now visible on every
              ongoing booking so the customer can see the appointment
              window without tapping into details. */}
          {booking.preferred_time && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Time Slot:</Text>
              <Text style={styles.detailValue}>{booking.preferred_time}</Text>
            </View>
          )}
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Amount:</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.detailValue}>
                ₹{booking.total_amount || booking.totalAmount || booking.price_quoted || 0}
              </Text>
              {booking.payment_status === 'paid' && (
                <View style={styles.paidPill}>
                  <Text style={styles.paidPillText}>✓ PAID</Text>
                </View>
              )}
              {booking.payment_status === 'pending' && (
                <View style={styles.pendingPill}>
                  <Text style={styles.pendingPillText}>Pay later</Text>
                </View>
              )}
            </View>
          </View>
          {(booking.address || booking.service_address) && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Address:</Text>
              <Text style={styles.detailValue} numberOfLines={2}>
                {(() => {
                  // If the stored "address" is actually just lat,lng
                  // (reverse-geocoding failed at booking time), show a
                  // friendlier "📍 Map pin" label instead of raw coords.
                  const raw = booking.address || booking.service_address || '';
                  const m = String(raw).match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
                  if (m) {
                    return `📍 Map pin: ${Number(m[1]).toFixed(4)}, ${Number(m[2]).toFixed(4)}`;
                  }
                  return raw;
                })()}
              </Text>
            </View>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.WHITE, borderRadius: BORDER_RADIUS.MEDIUM,
    marginHorizontal: SIZES.BASE,
    marginBottom: SIZES.BASE,
    padding: SIZES.BASE,
    shadowColor: COLORS.CARD_SHADOW, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 3.84, elevation: 5,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SIZES.BASE },
  bookingInfo: { flex: 1 },
  bookingNumber: { fontSize: SIZES.SMALL, fontWeight: 'bold', color: COLORS.BLACK },
  serviceName: { fontSize: SIZES.FONT, color: COLORS.BLACK, flex: 1 },
  statusBadge: { paddingHorizontal: SIZES.BASE / 2, paddingVertical: SIZES.BASE / 4, borderRadius: BORDER_RADIUS.SMALL, minWidth: 80 },
  statusText: { fontSize: SIZES.SMALL, fontWeight: '600', color: COLORS.WHITE },
  details: { marginTop: SIZES.BASE / 2 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SIZES.BASE / 4 },
  detailLabel: { fontSize: SIZES.SMALL, color: COLORS.GRAY },
  detailValue: { fontSize: SIZES.SMALL, fontWeight: '600', color: COLORS.BLACK },
  paidPill: {
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  paidPillText: {
    color: '#065F46',
    fontWeight: '800',
    fontSize: 10,
    letterSpacing: 0.3,
  },
  pendingPill: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  pendingPillText: {
    color: '#92400E',
    fontWeight: '700',
    fontSize: 10,
  },
});

export default BookingCard;

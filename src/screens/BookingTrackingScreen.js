import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { getBookingDetails, updateBookingStatus, submitReview } from '../services/api';

const BookingTrackingScreen = ({ route, navigation }) => {
  const { bookingId } = route.params;
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  useEffect(() => {
    loadBookingDetails();
    // Set up real-time updates (polling every 30 seconds)
    const interval = setInterval(loadBookingDetails, 30000);
    return () => clearInterval(interval);
  }, [bookingId]);

  const loadBookingDetails = async () => {
    try {
      const bookingData = await getBookingDetails(bookingId);
      setBooking(bookingData);
    } catch (error) {
      console.error('Error loading booking details:', error);
      Alert.alert('Error', 'Failed to load booking details');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'confirmed': return '#4CAF50';
      case 'agent_assigned': return '#2196F3';
      case 'in_progress': return '#FF9800';
      case 'completed': return '#4CAF50';
      case 'cancelled': return '#F44336';
      default: return '#757575';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'confirmed': return 'Booking Confirmed';
      case 'agent_assigned': return 'Agent Assigned';
      case 'in_progress': return 'Service In Progress';
      case 'completed': return 'Service Completed';
      case 'cancelled': return 'Booking Cancelled';
      default: return 'Unknown Status';
    }
  };

  const getProgressPercentage = (status) => {
    switch (status) {
      case 'confirmed': return 25;
      case 'agent_assigned': return 50;
      case 'in_progress': return 75;
      case 'completed': return 100;
      default: return 0;
    }
  };

  const handleCallAgent = () => {
    if (booking?.agent?.phone) {
      Alert.alert(
        'Call Agent',
        `Would you like to call ${booking.agent.name} at ${booking.agent.phone}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Call', onPress: () => console.log('Calling agent...') }
        ]
      );
    }
  };

  const handleSubmitReview = async () => {
    if (rating === 0) {
      Alert.alert('Error', 'Please select a rating');
      return;
    }

    setSubmittingReview(true);
    try {
      await submitReview(bookingId, { rating, review: reviewText });
      Alert.alert('Success', 'Thank you for your review!');
      setShowReviewModal(false);
      setRating(0);
      setReviewText('');
      loadBookingDetails(); // Reload to show review submitted
    } catch (error) {
      Alert.alert('Error', 'Failed to submit review');
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleDownloadReceipt = () => {
    Alert.alert(
      'Digital Receipt',
      'Your digital receipt is being prepared. This feature will be available soon.',
      [{ text: 'OK' }]
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#E63946" />
        <Text style={styles.loadingText}>Loading booking details...</Text>
      </View>
    );
  }

  if (!booking) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Booking not found</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={loadBookingDetails}
        >
          <Text style={styles.retryBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.bookingNumber}>#{booking.booking_number}</Text>
          <Text style={styles.serviceName}>{booking.service?.name}</Text>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(booking.status) }]}>
            <Text style={styles.statusText}>{getStatusText(booking.status)}</Text>
          </View>
        </View>

        {/* Progress Tracker */}
        <View style={styles.progressContainer}>
          <Text style={styles.progressTitle}>Service Progress</Text>
          <View style={styles.progressBar}>
            <View 
              style={[styles.progressFill, { width: `${getProgressPercentage(booking.status)}%` }]} 
            />
          </View>
          <View style={styles.progressSteps}>
            <View style={styles.progressStep}>
              <View style={[styles.progressDot, booking.status === 'confirmed' || booking.status === 'agent_assigned' || booking.status === 'in_progress' || booking.status === 'completed' ? styles.progressCompleted : styles.progressPending]} />
              <Text style={styles.progressStepText}>Confirmed</Text>
            </View>
            <View style={styles.progressStep}>
              <View style={[styles.progressDot, booking.status === 'agent_assigned' || booking.status === 'in_progress' || booking.status === 'completed' ? styles.progressCompleted : styles.progressPending]} />
              <Text style={styles.progressStepText}>Agent Assigned</Text>
            </View>
            <View style={styles.progressStep}>
              <View style={[styles.progressDot, booking.status === 'in_progress' || booking.status === 'completed' ? styles.progressCompleted : styles.progressPending]} />
              <Text style={styles.progressStepText}>In Progress</Text>
            </View>
            <View style={styles.progressStep}>
              <View style={[styles.progressDot, booking.status === 'completed' ? styles.progressCompleted : styles.progressPending]} />
              <Text style={styles.progressStepText}>Completed</Text>
            </View>
          </View>
        </View>

        {/* Agent Information */}
        {booking.agent && (
          <View style={styles.agentContainer}>
            <Text style={styles.agentTitle}>Assigned Agent</Text>
            <View style={styles.agentInfo}>
              <View style={styles.agentAvatar}>
                <Text style={styles.avatarText}>
                  {booking.agent.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                </Text>
              </View>
              <View style={styles.agentDetails}>
                <Text style={styles.agentName}>{booking.agent.name}</Text>
                <Text style={styles.agentRole}>{booking.agent.role}</Text>
                <Text style={styles.agentRating}>Rating: {booking.agent.rating}</Text>
              </View>
              <View style={styles.agentActions}>
                <TouchableOpacity style={styles.callBtn} onPress={handleCallAgent}>
                  <Text style={styles.callBtnText}>Call</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Booking Details */}
        <View style={styles.detailsContainer}>
          <Text style={styles.detailsTitle}>Booking Details</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Date & Time:</Text>
            <Text style={styles.detailValue}>
              {new Date(booking.booking_date).toLocaleDateString()} at {booking.booking_time_slot}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Address:</Text>
            <Text style={styles.detailValue}>{booking.service_address}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Service Mode:</Text>
            <Text style={styles.detailValue}>
              {booking.service_mode === 'fast_track' ? 'Fast-Track Service' : 'Regular Service'}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Payment:</Text>
            <Text style={styles.detailValue}>
              {booking.payment_method === 'pay_online' ? 'Paid Online' : 'Pay After Service'}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Total Amount:</Text>
            <Text style={[styles.detailValue, styles.amountValue]}>${booking.total_amount}</Text>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actionsContainer}>
          {booking.status === 'completed' && !booking.review && (
            <TouchableOpacity
              style={styles.reviewBtn}
              onPress={() => setShowReviewModal(true)}
            >
              <Text style={styles.reviewBtnText}>Rate Service</Text>
            </TouchableOpacity>
          )}
          
          <TouchableOpacity
            style={styles.receiptBtn}
            onPress={handleDownloadReceipt}
          >
            <Text style={styles.receiptBtnText}>Download Receipt</Text>
          </TouchableOpacity>
        </View>

        {/* Review Modal */}
        <Modal
          visible={showReviewModal}
          animationType="slide"
          presentationStyle="pageSheet"
        >
          <KeyboardAvoidingView style={styles.modalContainer} behavior="padding">
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Rate Your Service</Text>
              <TouchableOpacity onPress={() => setShowReviewModal(false)}>
                <Text style={styles.modalClose}>×</Text>
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalContent}>
              <View style={styles.ratingContainer}>
                <Text style={styles.ratingLabel}>How was your service?</Text>
                <View style={styles.starsContainer}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <TouchableOpacity
                      key={star}
                      onPress={() => setRating(star)}
                      style={styles.starBtn}
                    >
                      <Text style={[styles.star, star <= rating ? styles.starFilled : styles.starEmpty]}>
                        {star <= rating ? 'filled' : 'empty'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              
              <View style={styles.reviewInputContainer}>
                <Text style={styles.reviewLabel}>Additional Comments (Optional)</Text>
                <TextInput
                  style={styles.reviewInput}
                  multiline
                  numberOfLines={4}
                  value={reviewText}
                  onChangeText={setReviewText}
                  placeholder="Share your experience..."
                />
              </View>
              
              <TouchableOpacity
                style={[styles.submitReviewBtn, submittingReview && styles.disabledBtn]}
                onPress={handleSubmitReview}
                disabled={submittingReview}
              >
                {submittingReview ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.submitReviewBtnText}>Submit Review</Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: '#757575',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#F44336',
    fontSize: 16,
  },
  retryBtn: {
    marginTop: 20,
    backgroundColor: '#E63946',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  header: {
    backgroundColor: '#E63946',
    padding: 20,
    paddingTop: 40,
  },
  bookingNumber: {
    color: '#fff',
    fontSize: 14,
    opacity: 0.8,
  },
  serviceName: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 5,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 10,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  progressContainer: {
    backgroundColor: '#fff',
    margin: 15,
    padding: 20,
    borderRadius: 10,
  },
  progressTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#212121',
  },
  progressBar: {
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    marginBottom: 15,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
    borderRadius: 4,
  },
  progressSteps: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressStep: {
    alignItems: 'center',
    flex: 1,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginBottom: 5,
  },
  progressCompleted: {
    backgroundColor: '#4CAF50',
  },
  progressPending: {
    backgroundColor: '#E0E0E0',
  },
  progressStepText: {
    fontSize: 10,
    color: '#757575',
    textAlign: 'center',
  },
  agentContainer: {
    backgroundColor: '#fff',
    margin: 15,
    padding: 20,
    borderRadius: 10,
  },
  agentTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#212121',
  },
  agentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  agentAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#E63946',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  avatarText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  agentDetails: {
    flex: 1,
  },
  agentName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
  },
  agentRole: {
    fontSize: 14,
    color: '#757575',
    marginTop: 2,
  },
  agentRating: {
    fontSize: 12,
    color: '#FF9800',
    marginTop: 2,
  },
  agentActions: {
    marginLeft: 10,
  },
  callBtn: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
  },
  callBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  detailsContainer: {
    backgroundColor: '#fff',
    margin: 15,
    padding: 20,
    borderRadius: 10,
  },
  detailsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#212121',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  detailLabel: {
    fontSize: 14,
    color: '#757575',
    flex: 1,
  },
  detailValue: {
    fontSize: 14,
    color: '#212121',
    fontWeight: '600',
    flex: 2,
    textAlign: 'right',
  },
  amountValue: {
    color: '#E63946',
    fontSize: 16,
  },
  actionsContainer: {
    margin: 15,
  },
  reviewBtn: {
    backgroundColor: '#FF9800',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  reviewBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  receiptBtn: {
    backgroundColor: '#2196F3',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  receiptBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#212121',
  },
  modalClose: {
    fontSize: 24,
    color: '#757575',
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  ratingContainer: {
    alignItems: 'center',
    marginBottom: 30,
  },
  ratingLabel: {
    fontSize: 16,
    color: '#212121',
    marginBottom: 15,
  },
  starsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  starBtn: {
    padding: 5,
  },
  star: {
    fontSize: 30,
  },
  starFilled: {
    color: '#FF9800',
  },
  starEmpty: {
    color: '#E0E0E0',
  },
  reviewInputContainer: {
    marginBottom: 30,
  },
  reviewLabel: {
    fontSize: 16,
    color: '#212121',
    marginBottom: 10,
  },
  reviewInput: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  submitReviewBtn: {
    backgroundColor: '#E63946',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  disabledBtn: {
    opacity: 0.6,
  },
  submitReviewBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default BookingTrackingScreen;

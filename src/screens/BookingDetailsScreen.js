import React, { useState, useEffect } from 'react';
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
  Share,
} from 'react-native';
import { COLORS, SIZES, BORDER_RADIUS } from '../constants/colors';
import { getBookingDetails, verifyCompletion, cancelBooking, submitReview } from '../services/api';
import * as haptics from '../utils/haptics';

const BookingDetailsScreen = ({ navigation, route }) => {
  const { bookingId } = route.params;
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(false);
  const [otp, setOtp] = useState('');
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  useEffect(() => {
    loadBookingDetails();
  }, [bookingId]);

  const loadBookingDetails = async () => {
    try {
      setLoading(true);
      const response = await getBookingDetails(bookingId);
      console.log('=== BOOKING DETAILS RESPONSE ===');
      console.log('Full response:', JSON.stringify(response, null, 2));
      
      // Handle different response structures
      let bookingData = response.data || response;
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
    } catch (error) {
      console.error('Error loading booking details:', error);
      Alert.alert('Error', 'Failed to load booking details');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCompletion = async () => {
    if (!otp.trim()) {
      Alert.alert('Error', 'Please enter OTP');
      return;
    }

    try {
      setVerificationLoading(true);
      const response = await verifyCompletion(bookingId, otp);
      
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

  const handleCancelBooking = async () => {
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
  const handleSubmitReview = async () => {
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

  // ─── Digital Receipt (share via system share sheet) ───
  const handleShareReceipt = async () => {
    haptics.tap();
    const total = booking?.total_amount || booking?.price_quoted || 0;
    const message =
      `🧾 FlipOn Digital — Receipt\n\n` +
      `Booking ID: #${booking?.booking_number || bookingId}\n` +
      `Service: ${booking?.service?.name || booking?.service_name || 'Service'}\n` +
      `Date: ${new Date(booking?.created_at || Date.now()).toLocaleDateString()}\n` +
      `Amount: ₹${total}\n` +
      `Status: ${booking?.status || 'pending'}\n` +
      `Payment: ${booking?.payment_status || 'pending'}\n\n` +
      `Thank you for choosing FlipOn Digital!`;
    try {
      await Share.share({ message, title: 'Booking Receipt' });
    } catch (e) {
      Alert.alert('Error', 'Could not share receipt');
    }
  };

  const getStatusColor = () => {
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

  const getStatusText = () => {
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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Booking Details</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Booking Status */}
        <View style={styles.statusContainer}>
          <Text style={styles.bookingNumber}>#{booking?.booking_number || bookingId}</Text>
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
            <Text style={styles.detailValue}>
              {booking?.service_address || booking?.address || booking?.customer_address || 'N/A'}
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
              const documents = booking?.documents || booking?.uploaded_documents || 
                                booking?.files || booking?.attachments || [];
              
              console.log('=== DOCUMENTS DEBUG ===');
              console.log('Documents found:', documents);
              console.log('Documents length:', documents?.length || 0);
              console.log('Document array type:', Array.isArray(documents));
              
              if (documents && Array.isArray(documents) && documents.length > 0) {
                return documents.map((doc, index) => {
                  console.log(`Document ${index}:`, doc);
                  return (
                    <View key={index} style={styles.documentItem}>
                      <View style={styles.documentInfo}>
                        <Text style={styles.documentName}>
                          {doc.document_type || doc.type || doc.name || doc.file_name || `Document ${index + 1}`}
                        </Text>
                        {doc.file_path && (
                          <Text style={styles.documentPath}>{doc.file_path}</Text>
                        )}
                        {doc.uploaded_at && (
                          <Text style={styles.documentDate}>
                            Uploaded: {new Date(doc.uploaded_at).toLocaleDateString()}
                          </Text>
                        )}
                      </View>
                      <View style={[styles.documentStatus, { 
                        backgroundColor: doc.verified || doc.is_verified || doc.status === 'verified' ? '#4CAF50' : '#FFC107' 
                      }]}>
                        <Text style={styles.documentStatusText}>
                          {doc.verified || doc.is_verified || doc.status === 'verified' ? 'Verified' : 
                           doc.status === 'pending' ? 'Pending' : 'Processing'}
                        </Text>
                      </View>
                    </View>
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

        {/* OTP Verification Section */}
        {booking?.status === 'completed' && !booking?.verified && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Verify Completion</Text>
            <View style={styles.otpContainer}>
              <TextInput
                style={styles.otpInput}
                placeholder="Enter OTP"
                value={otp}
                onChangeText={setOtp}
                keyboardType="numeric"
                maxLength={6}
              />
              <TouchableOpacity
                style={[styles.verifyButton, !otp.trim() && styles.disabledButton]}
                onPress={handleVerifyCompletion}
                disabled={!otp.trim() || verificationLoading}
              >
                {verificationLoading ? (
                  <ActivityIndicator size="small" color={COLORS.WHITE} />
                ) : (
                  <Text style={styles.verifyButtonText}>Verify</Text>
                )}
              </TouchableOpacity>
            </View>
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
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SIZES.BASE / 2,
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

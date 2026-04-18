import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getToken } from '../utils/storage';
import { API_BASE_URL } from '../config';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  async (config) => {
    const token = await getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Handle unauthorized - token expired
      // You might want to dispatch logout action here
    }
    return Promise.reject(error);
  }
);


export const sendOTP = async (mobile) => {
  try {
    const response = await api.post('/auth/send-otp', { mobile });
    // Clear any stale offline OTP so verifyOTP doesn't compare against an old local value
    await AsyncStorage.removeItem(`otp_${mobile}`);
    return response.data;
  } catch (error) {
    // Network unreachable — generate a local OTP so the user can still log in offline
    if (!error.response) {
      console.log('Network unavailable, falling back to offline OTP mode');
      const localOTP = Math.floor(100000 + Math.random() * 900000).toString();
      const offlineOTPData = {
        mobile,
        otp: localOTP,
        timestamp: new Date().toISOString(),
        offlineMode: true,
      };
      await AsyncStorage.setItem(`otp_${mobile}`, JSON.stringify(offlineOTPData));
      return {
        success: true,
        message: `Offline OTP: ${localOTP} (no network)`,
        otp: localOTP,
        offlineMode: true,
      };
    }
    // Server responded with an error — propagate the message
    throw error.response.data || { message: 'Failed to send OTP' };
  }
};

export const verifyOTP = async (mobile, otp) => {
  try {
    console.log('=== VERIFYING OTP ===');
    console.log('Mobile:', mobile, 'OTP:', otp);

    // Check for locally stored OTP (generated in offline mode)
    const storedOTPData = await AsyncStorage.getItem(`otp_${mobile}`);

    if (storedOTPData) {
      // Offline mode — verify locally
      const parsedOTPData = JSON.parse(storedOTPData);

      const otpTime = new Date(parsedOTPData.timestamp);
      const currentTime = new Date();
      const timeDiff = (currentTime - otpTime) / 1000 / 60; // minutes

      if (timeDiff > 5) {
        await AsyncStorage.removeItem(`otp_${mobile}`);
        throw { message: 'OTP has expired. Please request a new OTP.' };
      }

      if (parsedOTPData.otp === otp) {
        console.log('Local OTP verification successful');
        await AsyncStorage.removeItem(`otp_${mobile}`);
        return {
          success: true,
          message: 'OTP verified successfully (Offline Mode)',
          token: 'offline_token_' + Date.now(),
          user: { mobile: mobile, verified: true },
          offlineMode: true
        };
      } else {
        throw { message: 'Invalid OTP. Please try again.' };
      }
    }

    // No local OTP — OTP was sent via real API, verify with API
    try {
      const response = await api.post('/auth/verify-otp', { mobile, otp });
      console.log('API OTP verification successful');
      return response.data;
    } catch (apiError) {
      console.error('API verification failed:', apiError.response?.data || apiError.message);
      if (apiError.response?.data?.message) {
        throw apiError.response.data;
      } else if (apiError.code === 'ERR_NETWORK' || apiError.code === 'ECONNABORTED') {
        throw { message: 'Network error. Please check your connection and try again.' };
      } else {
        throw { message: 'OTP verification failed. Please try again.' };
      }
    }
  } catch (error) {
    console.error('OTP verification error:', error);
    throw error;
  }
};

export const signup = async (userData) => {
  try {
    console.log('=== SIGNUP API ===');
    console.log('Signup data:', userData);
    console.log('Making request to:', API_BASE_URL + '/auth/signup');
    
    const response = await api.post('/auth/signup', userData);
    console.log('Signup response:', response.data);
    console.log('================');
    
    return response.data;
  } catch (error) {
    console.error('=== SIGNUP ERROR ===');
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      config: {
        url: error.config?.url,
        method: error.config?.method,
        baseURL: error.config?.baseURL
      },
      response: error.response ? {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      } : 'No response received'
    });
    console.error('====================');
    
    throw error.response?.data || { message: 'Failed to create account' };
  }
};

export const getServices = async (type = 'consumer') => {
  try {
    const endpoint = `/services?type=${type}`;
    console.log('=== GET SERVICES DEBUG ===');
    console.log('Making API request to:', API_BASE_URL + endpoint);
    console.log('Request type:', type);
    
    const response = await api.get(endpoint);
    
    console.log('API Response status:', response.status);
    console.log('API Response data type:', typeof response.data);
    console.log('API Response data:', response.data);
    
    // Check if data is an array and count services
    if (response.data && Array.isArray(response.data)) {
      console.log('Total services returned:', response.data.length);
      console.log('Service names:', response.data.map(s => s.name));
      
      // Count all service categories
      const aadhaarServices = response.data.filter(s => 
        s.name && s.name.toLowerCase().includes('aadhaar')
      );
      const panServices = response.data.filter(s => 
        s.name && s.name.toLowerCase().includes('pan')
      );
      const voterIdServices = response.data.filter(s => 
        s.name && (s.name.toLowerCase().includes('voter') || s.name.toLowerCase().includes('voter id'))
      );
      const rationCardServices = response.data.filter(s => 
        s.name && (s.name.toLowerCase().includes('ration') || s.name.toLowerCase().includes('ration card'))
      );
      const drivingLicenseServices = response.data.filter(s => 
        s.name && (s.name.toLowerCase().includes('driving') || s.name.toLowerCase().includes('license') || s.name.toLowerCase().includes('driving license'))
      );
      const incomeServices = response.data.filter(s => 
        s.name && s.name.toLowerCase().includes('income')
      );
      console.log('Driving License service names:', drivingLicenseServices.map(s => s.name));
      
      const totalKnownServices = aadhaarServices.length + panServices.length + voterIdServices.length + rationCardServices.length + drivingLicenseServices.length;
      console.log('Total known services:', totalKnownServices);
      console.log('Total services from API:', response.data.length);
      
      // Show other services that don't fall into these categories
      const otherServices = response.data.filter(s => 
        !s.name || (
          !s.name.toLowerCase().includes('aadhaar') &&
          !s.name.toLowerCase().includes('pan') &&
          !s.name.toLowerCase().includes('voter') &&
          !s.name.toLowerCase().includes('ration') &&
          !s.name.toLowerCase().includes('driving') &&
          !s.name.toLowerCase().includes('license')
        )
      );
      if (otherServices.length > 0) {
        console.log('Other services found:', otherServices.length);
        console.log('Other service names:', otherServices.map(s => s.name));
      }
      console.log('================================');
    } else if (response.data && response.data.data) {
      console.log('Response has nested data structure');
      console.log('Nested data length:', response.data.data.length);
      console.log('Nested service names:', response.data.data.map(s => s.name));
    } else {
      console.log('Unexpected response structure');
    }
    
    console.log('========================');
    
    return response.data;
  } catch (error) {
    console.error('=== GET SERVICES ERROR ===');
    console.error('API Error Details:', {
      message: error.message,
      code: error.code,
      config: {
        url: error.config?.url,
        method: error.config?.method,
        baseURL: error.config?.baseURL
      },
      response: error.response ? {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      } : 'No response received'
    });
    console.error('==========================');
    
    throw error.response?.data || { message: 'Failed to fetch services' };
  }
};

export const getServiceById = async (id) => {
  try {
    const response = await api.get(`/services/${id}`);
    // Backend returns { success: true, data: service }
    // ServiceDetailsScreen extracts .data from this, so return the full wrapper
    return response.data;
  } catch (error) {
    console.error('Service details error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      response: error.response ? {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      } : 'No response received'
    });
    
    // Provide more specific error messages
    let errorMessage = 'Failed to fetch service details';
    if (error.response) {
      switch (error.response.status) {
        case 404:
          errorMessage = 'Service not found. Please try again later.';
          break;
        case 500:
          errorMessage = 'Server error. Please try again later.';
          break;
        case 0:
        case undefined:
          errorMessage = 'Network error. Please check your connection and retry.';
          break;
        default:
          errorMessage = error.response.data?.message || 'Failed to fetch service details. Please retry.';
      }
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'Request timeout. Please check your connection and retry.';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    throw { message: errorMessage, originalError: error };
  }
};

export const createBooking = async (bookingData) => {
  try {
    console.log('Creating booking with data:', bookingData);
    const response = await api.post('/bookings', bookingData);
    console.log('Booking created successfully:', response.data);
    return response.data;
  } catch (error) {
    console.error('Booking creation error:', error);
    throw error.response?.data || { message: 'Failed to create booking' };
  }
};

export const getBookings = async (userId) => {
  try {
    const response = await api.get(`/bookings/user/${userId}`);
    return response.data;
  } catch (error) {
    throw error.response?.data || { message: 'Failed to fetch bookings' };
  }
};

export const updateBooking = async (bookingId, updateData) => {
  try {
    console.log('Updating booking:', bookingId, updateData);
    const response = await api.put(`/bookings/${bookingId}`, updateData);
    console.log('Booking updated successfully:', response.data);
    return response.data;
  } catch (error) {
    console.error('Booking update error:', error);
    throw error.response?.data || { message: 'Failed to update booking' };
  }
};

export const getProfile = async () => {
  try {
    console.log('Fetching user profile...');
    const response = await api.get('/profile');
    console.log('Profile response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error fetching profile:', error);
    throw error.response?.data || { message: 'Failed to fetch profile' };
  }
};

export const updateProfile = async (profileData) => {
  try {
    console.log('Updating profile with data:', profileData);
    const response = await api.put('/profile', profileData);
    console.log('Profile updated successfully:', response.data);
    return response.data;
  } catch (error) {
    console.error('Update profile error:', error);
    throw error.response?.data || { message: 'Failed to update profile' };
  }
};

export const getMyDocuments = async () => {
  try {
    const response = await api.get('/documents/kyc/my');
    return response.data;
  } catch (error) {
    console.log('Get KYC docs error:', error?.response?.status);
    throw error.response?.data || { message: 'Failed to fetch documents' };
  }
};

export const uploadKYCDocument = async (documentType, file) => {
  // Use fetch directly — axios + multipart has issues with boundary headers in React Native
  const token = await getToken();
  const formData = new FormData();
  formData.append('file', file);
  formData.append('document_type', documentType);
  formData.append('category', 'kyc');

  const url = `${API_BASE_URL}/documents/upload`;
  console.log('[KYC Upload] →', url, '| type:', documentType, '| file:', file?.name);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        // IMPORTANT: do NOT set Content-Type — let fetch set the multipart boundary
      },
      body: formData,
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { data = { message: text || 'Server returned non-JSON' }; }

    console.log(`[KYC Upload] ← ${response.status}`, data);

    if (!response.ok) {
      throw { message: data.message || `Upload failed (HTTP ${response.status})`, status: response.status, data };
    }
    return data;
  } catch (error) {
    console.log('[KYC Upload] error:', error?.message || error);
    throw error?.message ? error : { message: 'Network error — check your connection' };
  }
};

export const uploadDocument = async (bookingId = '', fileData) => {
  try {
    console.log('=== DOCUMENT UPLOAD API ===');
    console.log('Booking ID:', bookingId);
    console.log('File Data type:', typeof fileData);
    console.log('FormData entries:');
    
    // Log FormData entries for debugging
    if (fileData instanceof FormData) {
      for (let [key, value] of fileData.entries()) {
        console.log(`${key}:`, value);
        if (key === 'document_type') {
          console.log('Document type found:', value);
        }
      }
    }
    
    // Ensure we have the required document_type parameter
    if (fileData instanceof FormData) {
      const hasDocumentType = Array.from(fileData.keys()).includes('document_type');
      if (!hasDocumentType) {
        console.error('document_type parameter is missing from FormData');
        throw new Error('document_type parameter is required');
      }
    }
    
    // Build URL with optional booking ID
    const uploadUrl = bookingId ? `/documents/upload` : `/documents/upload`;
    const response = await api.post(uploadUrl, fileData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    
    console.log('Document uploaded successfully:', response.data);
    console.log('========================');
    return response.data;
  } catch (error) {
    console.error('Document upload error:', error);
    console.error('Error response:', error.response?.data);
    
    // Enhanced error handling
    if (error.response?.data?.message) {
      throw error.response.data;
    } else if (error.message) {
      throw { message: error.message };
    } else {
      throw { message: 'Failed to upload document' };
    }
  }
};

export const getMyBookings = async () => {
  try {
    console.log('Fetching my bookings...');
    const response = await api.get('/bookings/my-bookings');
    console.log('My bookings response:', response.data);
    
    // Ensure proper data structure
    if (response.data && Array.isArray(response.data)) {
      return response.data;
    } else if (response.data && response.data.data && Array.isArray(response.data.data)) {
      return response.data.data;
    } else {
      console.warn('Unexpected booking data structure:', response.data);
      return response.data ? [response.data] : [];
    }
  } catch (error) {
    console.error('Error fetching my bookings:', error);
    throw error.response?.data || { message: 'Failed to fetch bookings' };
  }
};

export const getBookingDetails = async (bookingId) => {
  try {
    console.log('Fetching booking details for:', bookingId);
    const response = await api.get(`/bookings/${bookingId}`);
    console.log('Booking details response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error fetching booking details:', error);
    throw error.response?.data || { message: 'Failed to fetch booking details' };
  }
};

export const verifyCompletion = async (bookingId, otp) => {
  try {
    console.log('Verifying completion for booking:', bookingId, 'OTP:', otp);
    const response = await api.post(`/bookings/${bookingId}/verify-completion`, { otp });
    console.log('Verification response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Verification error:', error);
    throw error.response?.data || { message: 'Failed to verify completion' };
  }
};

// Booking tracking and review functions
export const updateBookingStatus = async (bookingId, status) => {
  try {
    console.log('Updating booking status:', bookingId, 'to:', status);
    const response = await api.put(`/bookings/${bookingId}/status`, { status });
    console.log('Status updated successfully:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error updating booking status:', error);
    throw error.response?.data || { message: 'Failed to update booking status' };
  }
};

export const submitReview = async (bookingId, reviewData) => {
  try {
    console.log('Submitting review for booking:', bookingId);
    console.log('Review data:', reviewData);
    const response = await api.post(`/bookings/${bookingId}/review`, reviewData);
    console.log('Review submitted successfully:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error submitting review:', error);
    throw error.response?.data || { message: 'Failed to submit review' };
  }
};

export const getBookingReviews = async (bookingId) => {
  try {
    console.log('Fetching reviews for booking:', bookingId);
    const response = await api.get(`/bookings/${bookingId}/reviews`);
    console.log('Reviews fetched successfully:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error fetching reviews:', error);
    throw error.response?.data || { message: 'Failed to fetch reviews' };
  }
};

export const generateDigitalReceipt = async (bookingId) => {
  try {
    console.log('Generating digital receipt for booking:', bookingId);
    const response = await api.get(`/bookings/${bookingId}/receipt`);
    console.log('Digital receipt generated:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error generating digital receipt:', error);
    throw error.response?.data || { message: 'Failed to generate digital receipt' };
  }
};

export const getAgentDetails = async (agentId) => {
  try {
    console.log('Fetching agent details:', agentId);
    const response = await api.get(`/agents/${agentId}`);
    console.log('Agent details fetched:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error fetching agent details:', error);
    throw error.response?.data || { message: 'Failed to fetch agent details' };
  }
};

export const cancelBooking = async (bookingId) => {
  try {
    console.log('Cancelling booking:', bookingId);
    const response = await api.put(`/bookings/${bookingId}/cancel`);
    console.log('Cancel booking response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Cancel booking error:', error);
    throw error.response?.data || { message: 'Failed to cancel booking' };
  }
};

export const processPayment = async (paymentData) => {
  try {
    console.log('=== PROCESSING PAYMENT ===');
    console.log('Payment data:', paymentData);
    
    // Network connectivity check temporarily disabled
    // const networkCheck = await checkNetworkConnectivity();
    // if (!networkCheck.connected) {
    //   throw new Error(`Network connectivity issue: ${networkCheck.message}`);
    // }
    
    // Real payment gateway - backend endpoint is now available
    const response = await api.post('/payments/process', paymentData);
    console.log('Payment processed successfully:', response.data);
    console.log('========================');
    return response.data;
  } catch (error) {
    console.error('Payment processing error:', error);
    console.error('Error response:', error.response?.data);
    
    if (error.response?.data?.message) {
      throw error.response.data;
    } else if (error.message) {
      throw { message: error.message };
    } else {
      throw { message: 'Failed to process payment' };
    }
  }
};

// Geolocation API endpoints
export const getCurrentLocation = async () => {
  try {
    console.log('=== GET CURRENT LOCATION DEBUG ===');
    console.log('Making API request to:', API_BASE_URL + '/location/current');
    
    const response = await api.get('/location/current');
    
    console.log('Location API Response status:', response.status);
    console.log('Location API Response data:', response.data);
    
    return response.data;
  } catch (error) {
    console.error('Get current location error:', error);
    throw error;
  }
};

export const getLocationFromAddress = async (address) => {
  try {
    console.log('=== GET LOCATION FROM ADDRESS DEBUG ===');
    console.log('Making API request to:', API_BASE_URL + '/location/geocode');
    console.log('Address:', address);
    
    const response = await api.post('/location/geocode', { address });
    
    console.log('Geocode API Response status:', response.status);
    console.log('Geocode API Response data:', response.data);
    
    return response.data;
  } catch (error) {
    console.error('Get location from address error:', error);
    throw error;
  }
};

export const validateLocation = async (latitude, longitude) => {
  try {
    console.log('=== VALIDATE LOCATION DEBUG ===');
    console.log('Making API request to:', API_BASE_URL + '/location/validate');
    console.log('Coordinates:', { latitude, longitude });
    
    const response = await api.post('/location/validate', { latitude, longitude });
    
    console.log('Validate Location API Response status:', response.status);
    console.log('Validate Location API Response data:', response.data);
    
    return response.data;
  } catch (error) {
    console.error('Validate location error:', error);
    throw error;
  }
};

// Tasks API endpoints
export const getTasks = async (status = null) => {
  try {
    console.log('=== GET TASKS DEBUG ===');
    const endpoint = status ? `/tasks?status=${status}` : '/tasks';
    console.log('Making API request to:', API_BASE_URL + endpoint);
    
    const response = await api.get(endpoint);
    
    console.log('Tasks API Response status:', response.status);
    console.log('Tasks API Response data:', response.data);
    
    return response.data;
  } catch (error) {
    console.error('Get tasks error:', error);
    // Return empty array if endpoint doesn't exist yet
    if (error.response?.status === 404) {
      console.log('Tasks endpoint not found, returning empty array');
      return [];
    }
    throw error;
  }
};

// ─── B2B / Industrial — Company Profile + NDA ──────────────────────────────
export const getCompanyProfile = async () => {
  try {
    const { data } = await api.get('/company-profile');
    return data;
  } catch (error) {
    throw error.response?.data || { message: 'Failed to load company profile' };
  }
};

export const upsertCompanyProfile = async (payload) => {
  try {
    const { data } = await api.put('/company-profile', payload);
    return data;
  } catch (error) {
    throw error.response?.data || { message: 'Failed to save company profile' };
  }
};

export const getB2BReadiness = async () => {
  try {
    const { data } = await api.get('/company-profile/status');
    return data;
  } catch (error) {
    throw error.response?.data || { message: 'Failed to check B2B readiness' };
  }
};

export const acceptNDA = async () => {
  try {
    const { data } = await api.post('/company-profile/nda/accept');
    return data;
  } catch (error) {
    throw error.response?.data || { message: 'Failed to record NDA' };
  }
};

// ─── Enquiries (B2B quote-based booking sibling) ───────────────────────────
export const createEnquiry = async (payload) => {
  try {
    const { data } = await api.post('/enquiries', payload);
    return data;
  } catch (error) {
    throw error.response?.data || { message: 'Failed to submit enquiry' };
  }
};

export const getMyEnquiries = async () => {
  try {
    const { data } = await api.get('/enquiries/mine');
    return data;
  } catch (error) {
    throw error.response?.data || { message: 'Failed to load enquiries' };
  }
};

export const getEnquiryById = async (id) => {
  try {
    const { data } = await api.get(`/enquiries/${id}`);
    return data;
  } catch (error) {
    throw error.response?.data || { message: 'Failed to load enquiry' };
  }
};

export const acceptQuote = async (id) => {
  try {
    const { data } = await api.post(`/enquiries/${id}/accept`);
    return data;
  } catch (error) {
    throw error.response?.data || { message: 'Failed to accept quote' };
  }
};

export const rejectQuote = async (id) => {
  try {
    const { data } = await api.post(`/enquiries/${id}/reject`);
    return data;
  } catch (error) {
    throw error.response?.data || { message: 'Failed to reject quote' };
  }
};

export const cancelEnquiry = async (id) => {
  try {
    const { data } = await api.post(`/enquiries/${id}/cancel`);
    return data;
  } catch (error) {
    throw error.response?.data || { message: 'Failed to cancel enquiry' };
  }
};

export default api;

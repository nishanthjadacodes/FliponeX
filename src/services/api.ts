import axios, {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getToken, storeToken, storeUser, clearAuthSession } from '../utils/storage';
import { API_BASE_URL, API_BASE_URL_CANDIDATES } from '../config';
import type { ApiResponse, Booking, DocumentRecord, Service, User } from '../types';

const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  // Render free tier cold-starts take 30–60s after ~15 min idle
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Internal config marker — we set ad-hoc flags on the request config to avoid
// retry loops. Declare them so TypeScript stops complaining about excess props.
interface RetryableConfig extends InternalAxiosRequestConfig {
  _authRetried?: boolean;
  _fallbackTried?: boolean;
}

api.interceptors.request.use(
  async (config) => {
    const token = await getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ─── Auto-rotate base URL on ERR_NETWORK ────────────────────────────────────
const isNetworkError = (err: any): boolean =>
  err?.code === 'ERR_NETWORK' || err?.message === 'Network Error' || !err?.response;

// Promise-coalesce concurrent recoveries so we only run guest-login once even
// if multiple requests 401 simultaneously (typical on screen mount).
let inFlightRecovery: Promise<string | undefined> | null = null;

const recoverAuth = async (): Promise<string | undefined> => {
  if (!inFlightRecovery) {
    inFlightRecovery = (async () => {
      await clearAuthSession();
      // Plain axios call — bypass `api` so no auth header / interceptor recursion.
      const { data } = await axios.post<{ token?: string; user?: User }>(
        `${api.defaults.baseURL}/auth/guest-login`,
        {},
        { timeout: 60000 },
      );
      if (data?.token) await storeToken(data.token);
      if (data?.user) await storeUser(data.user);
      return data?.token;
    })().finally(() => {
      // Release the lock once the recovery promise settles.
      setTimeout(() => {
        inFlightRecovery = null;
      }, 0);
    });
  }
  return inFlightRecovery;
};

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ message?: string }>) => {
    const original = error.config as RetryableConfig | undefined;

    // Stale token from another env (e.g. local dev token after switching to
    // production backend with a different JWT_SECRET) → guest-login + retry.
    const msg = error.response?.data?.message;
    if (
      error.response?.status === 401 &&
      (msg === 'Invalid token' || msg === 'Token expired') &&
      original &&
      !original._authRetried &&
      !original.url?.includes('/auth/')
    ) {
      try {
        const newToken = await recoverAuth();
        if (newToken) {
          original._authRetried = true;
          original.headers = {
            ...(original.headers || {}),
            Authorization: `Bearer ${newToken}`,
          } as any;
          return axios.request(original);
        }
      } catch (e: any) {
        console.log('[api] auto guest-login failed:', e?.message || e);
      }
      return Promise.reject(error);
    }

    if (error.response?.status === 401) {
      // Other 401s (no token, etc.) — let callers handle
      return Promise.reject(error);
    }

    // Only retry on pure network failures, and only once per request
    if (!isNetworkError(error) || !original || original._fallbackTried) {
      return Promise.reject(error);
    }

    const currentBase = api.defaults.baseURL;
    const remaining = (API_BASE_URL_CANDIDATES || []).filter((u) => u && u !== currentBase);
    for (const candidate of remaining) {
      try {
        console.log(`[api] ${currentBase} unreachable — trying ${candidate}`);
        original._fallbackTried = true;
        original.baseURL = candidate;
        const response = await axios.request(original);
        // Remember the working URL for the rest of the session
        api.defaults.baseURL = candidate;
        console.log(`[api] switched baseURL to ${candidate}`);
        return response;
      } catch (e: any) {
        if (!isNetworkError(e)) return Promise.reject(e);
        // try next candidate
      }
    }

    return Promise.reject(error);
  },
);

// ─── Public payload / response shapes ──────────────────────────────────────
export interface SendOTPResponse {
  success: boolean;
  message: string;
  devOtp?: string;
  otp?: string;
  offlineMode?: boolean;
}

export interface VerifyOTPResponse {
  success: boolean;
  message: string;
  token: string;
  user: Partial<User> & { mobile: string; verified?: boolean };
  offlineMode?: boolean;
}

export interface SignupPayload {
  name?: string;
  mobile: string;
  email?: string;
  [key: string]: unknown;
}

// ─── Auth ──────────────────────────────────────────────────────────────────
export const sendOTP = async (mobile: string): Promise<SendOTPResponse> => {
  try {
    const response = await api.post<SendOTPResponse>('/auth/send-otp', { mobile });
    // Clear any stale offline OTP so verifyOTP doesn't compare against an old local value
    await AsyncStorage.removeItem(`otp_${mobile}`);
    return response.data;
  } catch (error: any) {
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
        message: `Offline OTP (backend unreachable): ${localOTP}`,
        devOtp: localOTP,
        otp: localOTP,
        offlineMode: true,
      };
    }
    throw error.response.data || { message: 'Failed to send OTP' };
  }
};

export const verifyOTP = async (mobile: string, otp: string): Promise<VerifyOTPResponse> => {
  try {
    console.log('=== VERIFYING OTP ===');
    console.log('Mobile:', mobile, 'OTP:', otp);

    const storedOTPData = await AsyncStorage.getItem(`otp_${mobile}`);

    if (storedOTPData) {
      const parsedOTPData = JSON.parse(storedOTPData);

      const otpTime = new Date(parsedOTPData.timestamp);
      const currentTime = new Date();
      const timeDiff = (currentTime.getTime() - otpTime.getTime()) / 1000 / 60; // minutes

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
          user: { mobile, verified: true },
          offlineMode: true,
        };
      } else {
        throw { message: 'Invalid OTP. Please try again.' };
      }
    }

    try {
      // Explicit role='customer' so new accounts created via this app get
      // the customer role. Backend defaults to 'agent' otherwise, which
      // would then trip the role gate on the customer login screen.
      const response = await api.post<VerifyOTPResponse>('/auth/verify-otp', {
        mobile,
        otp,
        role: 'customer',
      });
      console.log('API OTP verification successful');
      return response.data;
    } catch (apiError: any) {
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

export const signup = async (userData: SignupPayload): Promise<ApiResponse<User>> => {
  try {
    console.log('=== SIGNUP API ===');
    const response = await api.post<ApiResponse<User>>('/auth/signup', userData);
    return response.data;
  } catch (error: any) {
    console.error('=== SIGNUP ERROR ===');
    throw error.response?.data || { message: 'Failed to create account' };
  }
};

// ─── Services ──────────────────────────────────────────────────────────────
export interface ServicesResponse {
  data?: Service[];
  success?: boolean;
}

export const getServices = async (
  type: 'consumer' | 'industrial' | string = 'consumer',
): Promise<ServicesResponse | Service[]> => {
  try {
    const endpoint = `/services?type=${type}`;
    console.log('=== GET SERVICES DEBUG ===');
    console.log('Making API request to:', API_BASE_URL + endpoint);

    const response = await api.get<ServicesResponse | Service[]>(endpoint);
    console.log('API Response status:', response.status);
    return response.data;
  } catch (error: any) {
    console.error('=== GET SERVICES ERROR ===');
    throw error.response?.data || { message: 'Failed to fetch services' };
  }
};

export const getServiceById = async (id: string): Promise<ApiResponse<Service>> => {
  try {
    const response = await api.get<ApiResponse<Service>>(`/services/${id}`);
    return response.data;
  } catch (error: any) {
    console.error('Service details error:', error);

    let errorMessage = 'Failed to fetch service details';
    if (error.response) {
      switch (error.response.status) {
        case 404:
          errorMessage = 'Service not found. Please try again later.';
          break;
        case 500:
          errorMessage = 'Server error. Please try again later.';
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

// ─── Bookings ──────────────────────────────────────────────────────────────
export interface CreateBookingPayload {
  service_id: string;
  booking_type?: 'consumer' | 'industrial';
  customer_name: string;
  customer_mobile: string;
  customer_email?: string;
  service_address: string | Record<string, unknown>;
  preferred_date?: string;
  preferred_time?: string;
  notes?: string;
  document_ids?: string[];
  dynamic_fields?: Record<string, unknown>;
  [key: string]: unknown;
}

export const createBooking = async (
  bookingData: CreateBookingPayload,
): Promise<ApiResponse<Booking>> => {
  try {
    const response = await api.post<ApiResponse<Booking>>('/bookings', bookingData);
    return response.data;
  } catch (error: any) {
    console.error('Booking creation error:', error);
    throw error.response?.data || { message: 'Failed to create booking' };
  }
};

export const getBookings = async (userId: string): Promise<ApiResponse<Booking[]>> => {
  try {
    const response = await api.get<ApiResponse<Booking[]>>(`/bookings/user/${userId}`);
    return response.data;
  } catch (error: any) {
    throw error.response?.data || { message: 'Failed to fetch bookings' };
  }
};

export const updateBooking = async (
  bookingId: string,
  updateData: Partial<Booking>,
): Promise<ApiResponse<Booking>> => {
  try {
    const response = await api.put<ApiResponse<Booking>>(`/bookings/${bookingId}`, updateData);
    return response.data;
  } catch (error: any) {
    console.error('Booking update error:', error);
    throw error.response?.data || { message: 'Failed to update booking' };
  }
};

// ─── Profile ───────────────────────────────────────────────────────────────
export const getProfile = async (): Promise<ApiResponse<User> | User> => {
  try {
    const response = await api.get<ApiResponse<User> | User>('/profile');
    return response.data;
  } catch (error: any) {
    console.error('Error fetching profile:', error);
    throw error.response?.data || { message: 'Failed to fetch profile' };
  }
};

export const updateProfile = async (
  profileData: Partial<User>,
): Promise<ApiResponse<User>> => {
  try {
    const response = await api.put<ApiResponse<User>>('/profile', profileData);
    return response.data;
  } catch (error: any) {
    console.error('Update profile error:', error);
    throw error.response?.data || { message: 'Failed to update profile' };
  }
};

// ─── Documents ─────────────────────────────────────────────────────────────
export const getMyDocuments = async (): Promise<ApiResponse<DocumentRecord[]> | DocumentRecord[]> => {
  try {
    const response = await api.get<ApiResponse<DocumentRecord[]> | DocumentRecord[]>(
      '/documents/kyc/my',
    );
    return response.data;
  } catch (error: any) {
    console.log('Get KYC docs error:', error?.response?.status);
    throw error.response?.data || { message: 'Failed to fetch documents' };
  }
};

// File handle types — RN-friendly. The Expo image-picker / document-picker
// returns objects shaped like { uri, name, type } which FormData accepts as
// any cast.
export type RNFileLike =
  | File
  | Blob
  | { uri: string; name?: string; type?: string }
  | unknown;

export interface UploadResponse {
  success?: boolean;
  message?: string;
  data?: DocumentRecord;
  status?: number;
}

export const uploadKYCDocument = async (
  documentType: string,
  file: RNFileLike,
): Promise<UploadResponse> => {
  // Use fetch directly — axios + multipart has issues with boundary headers in React Native
  const token = await getToken();
  const formData = new FormData();
  formData.append('file', file as any);
  formData.append('document_type', documentType);
  formData.append('category', 'kyc');

  const url = `${API_BASE_URL}/documents/upload`;
  console.log('[KYC Upload] →', url, '| type:', documentType);

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
    let data: UploadResponse;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { message: text || 'Server returned non-JSON' };
    }

    console.log(`[KYC Upload] ← ${response.status}`, data);

    if (!response.ok) {
      throw {
        message: data.message || `Upload failed (HTTP ${response.status})`,
        status: response.status,
        data,
      };
    }
    return data;
  } catch (error: any) {
    console.log('[KYC Upload] error:', error?.message || error);
    throw error?.message ? error : { message: 'Network error — check your connection' };
  }
};

export const uploadDocument = async (
  bookingId: string = '',
  fileData: FormData,
): Promise<UploadResponse> => {
  if (!(fileData instanceof FormData)) {
    throw { message: 'Internal error: uploadDocument expects FormData' };
  }
  // FormData.has() is supported on both web and RN runtimes; the RN typing
  // doesn't expose `.keys()` so we use the equally-typed `.has()` instead.
  if (!(fileData as any).has?.('document_type')) {
    throw { message: 'document_type is required for upload' };
  }
  if (bookingId && !(fileData as any).has?.('booking_id')) {
    fileData.append('booking_id', bookingId);
  }

  // Always ensure we have a real customer token before attempting upload.
  // Without one, backend's ADMIN_DEV_OPEN mode falls back to a synthetic
  // super_admin (id=0) which then fails the user_id FK constraint on insert.
  let token = await getToken();
  if (!token) {
    try {
      console.log('[upload] no token — running guest-login first');
      const { data: gl } = await axios.post<{ token?: string; user?: User }>(
        `${api.defaults.baseURL}/auth/guest-login`,
        {},
        { timeout: 60000 },
      );
      if (gl?.token) {
        await storeToken(gl.token);
        if (gl.user) await storeUser(gl.user);
        token = gl.token;
      }
    } catch (e: any) {
      console.log('[upload] guest-login pre-fetch failed:', e?.message);
    }
  }

  const url = `${api.defaults.baseURL}/documents/upload`;
  console.log('[upload] →', url, token ? '(with token)' : '(NO token)');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: fileData,
    });
  } catch (networkErr: any) {
    console.log('[upload] network error:', networkErr?.message);
    throw { message: 'Network error — check your connection and try again' };
  }

  const text = await response.text();
  let data: UploadResponse;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = { message: text || 'Server returned non-JSON' };
  }

  console.log(`[upload] ← ${response.status}`, data);

  if (!response.ok) {
    if (response.status === 401) {
      try {
        const { data: gl } = await axios.post<{ token?: string; user?: User }>(
          `${api.defaults.baseURL}/auth/guest-login`,
          {},
        );
        if (gl?.token) {
          await storeToken(gl.token);
          if (gl.user) await storeUser(gl.user);
          return uploadDocument(bookingId, fileData); // retry with fresh token
        }
      } catch (_) {
        /* fall through */
      }
    }
    throw {
      message: data.message || `Upload failed (HTTP ${response.status})`,
      status: response.status,
      data,
    };
  }
  return data;
};

// ─── My bookings / details / status ────────────────────────────────────────
export const getMyBookings = async (): Promise<Booking[]> => {
  try {
    const response = await api.get<Booking[] | ApiResponse<Booking[]>>('/bookings/my-bookings');

    if (response.data && Array.isArray(response.data)) {
      return response.data;
    } else if (response.data && (response.data as ApiResponse<Booking[]>).data && Array.isArray((response.data as ApiResponse<Booking[]>).data)) {
      return (response.data as ApiResponse<Booking[]>).data!;
    } else {
      console.warn('Unexpected booking data structure:', response.data);
      return response.data ? [response.data as unknown as Booking] : [];
    }
  } catch (error: any) {
    console.error('Error fetching my bookings:', error);
    throw error.response?.data || { message: 'Failed to fetch bookings' };
  }
};

export const getBookingDetails = async (bookingId: string): Promise<ApiResponse<Booking>> => {
  try {
    const response = await api.get<ApiResponse<Booking>>(`/bookings/${bookingId}`);
    return response.data;
  } catch (error: any) {
    console.error('Error fetching booking details:', error);
    throw error.response?.data || { message: 'Failed to fetch booking details' };
  }
};

export const verifyCompletion = async (
  bookingId: string,
  otp: string,
): Promise<ApiResponse<Booking>> => {
  try {
    const response = await api.post<ApiResponse<Booking>>(
      `/bookings/${bookingId}/verify-completion`,
      { otp },
    );
    return response.data;
  } catch (error: any) {
    console.error('Verification error:', error);
    throw error.response?.data || { message: 'Failed to verify completion' };
  }
};

export const updateBookingStatus = async (
  bookingId: string,
  status: string,
): Promise<ApiResponse<Booking>> => {
  try {
    const response = await api.put<ApiResponse<Booking>>(
      `/bookings/${bookingId}/status`,
      { status },
    );
    return response.data;
  } catch (error: any) {
    console.error('Error updating booking status:', error);
    throw error.response?.data || { message: 'Failed to update booking status' };
  }
};

export interface ReviewPayload {
  rating: number;
  feedback?: string;
  [key: string]: unknown;
}

export const submitReview = async (
  bookingId: string,
  reviewData: ReviewPayload,
): Promise<ApiResponse<unknown>> => {
  try {
    const response = await api.post<ApiResponse<unknown>>(
      `/bookings/${bookingId}/review`,
      reviewData,
    );
    return response.data;
  } catch (error: any) {
    console.error('Error submitting review:', error);
    throw error.response?.data || { message: 'Failed to submit review' };
  }
};

export const getBookingReviews = async (bookingId: string): Promise<ApiResponse<unknown>> => {
  try {
    const response = await api.get<ApiResponse<unknown>>(`/bookings/${bookingId}/reviews`);
    return response.data;
  } catch (error: any) {
    console.error('Error fetching reviews:', error);
    throw error.response?.data || { message: 'Failed to fetch reviews' };
  }
};

export const generateDigitalReceipt = async (bookingId: string): Promise<ApiResponse<unknown>> => {
  try {
    const response = await api.get<ApiResponse<unknown>>(`/bookings/${bookingId}/receipt`);
    return response.data;
  } catch (error: any) {
    console.error('Error generating digital receipt:', error);
    throw error.response?.data || { message: 'Failed to generate digital receipt' };
  }
};

export const getAgentDetails = async (agentId: string): Promise<ApiResponse<User>> => {
  try {
    const response = await api.get<ApiResponse<User>>(`/agents/${agentId}`);
    return response.data;
  } catch (error: any) {
    console.error('Error fetching agent details:', error);
    throw error.response?.data || { message: 'Failed to fetch representative details' };
  }
};

export const cancelBooking = async (bookingId: string): Promise<ApiResponse<Booking>> => {
  try {
    const response = await api.put<ApiResponse<Booking>>(`/bookings/${bookingId}/cancel`);
    return response.data;
  } catch (error: any) {
    console.error('Cancel booking error:', error);
    throw error.response?.data || { message: 'Failed to cancel booking' };
  }
};

// ─── Payments (Razorpay) ───────────────────────────────────────────────────
export interface CreatePaymentOrderPayload {
  booking_id: string;
  amount: number;
}

export interface CreatePaymentOrderResponse {
  order_id: string;
  amount: number;
  currency: string;
  key_id: string;
}

export const createPaymentOrder = async ({
  booking_id,
  amount,
}: CreatePaymentOrderPayload): Promise<CreatePaymentOrderResponse> => {
  try {
    const { data } = await api.post<CreatePaymentOrderResponse>('/payments/create-order', {
      booking_id,
      amount,
    });
    return data;
  } catch (error: any) {
    throw error.response?.data || { message: 'Failed to create payment order' };
  }
};

export interface VerifyPaymentPayload {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  booking_id?: string;
  [key: string]: unknown;
}

export const verifyPayment = async (
  payload: VerifyPaymentPayload,
): Promise<ApiResponse<unknown>> => {
  try {
    const { data } = await api.post<ApiResponse<unknown>>('/payments/verify', payload);
    return data;
  } catch (error: any) {
    throw error.response?.data || { message: 'Failed to verify payment' };
  }
};

export const processPayment = async (
  paymentData: Record<string, unknown>,
): Promise<ApiResponse<unknown>> => {
  try {
    const response = await api.post<ApiResponse<unknown>>('/payments/process', paymentData);
    return response.data;
  } catch (error: any) {
    console.error('Payment processing error:', error);
    if (error.response?.data?.message) {
      throw error.response.data;
    } else if (error.message) {
      throw { message: error.message };
    } else {
      throw { message: 'Failed to process payment' };
    }
  }
};

// ─── Geolocation ───────────────────────────────────────────────────────────
export interface ReverseGeocodeResult {
  formatted_address?: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
  [key: string]: unknown;
}

export const getCurrentLocation = async (): Promise<ApiResponse<unknown>> => {
  try {
    const response = await api.get<ApiResponse<unknown>>('/location/current');
    return response.data;
  } catch (error) {
    console.error('Get current location error:', error);
    throw error;
  }
};

export const reverseGeocodeCoords = async (
  latitude: number | string,
  longitude: number | string,
): Promise<ReverseGeocodeResult> => {
  try {
    const response = await api.get<ApiResponse<ReverseGeocodeResult> | ReverseGeocodeResult>(
      '/geolocation/reverse-geocode',
      { params: { latitude, longitude } },
    );
    return ((response.data as ApiResponse<ReverseGeocodeResult>)?.data ||
      (response.data as ReverseGeocodeResult));
  } catch (error: any) {
    console.error('reverseGeocodeCoords error:', error?.response?.data || error?.message);
    throw error;
  }
};

// Back-compat shim: old call sites passed "lat,lng" as a single string.
export const getLocationFromAddress = async (input: string): Promise<ReverseGeocodeResult> => {
  const m = typeof input === 'string' && input.match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
  if (m) {
    return reverseGeocodeCoords(m[1], m[2]);
  }
  throw new Error('Forward geocoding not supported');
};

export const validateLocation = async (
  latitude: number,
  longitude: number,
): Promise<ApiResponse<unknown>> => {
  try {
    const response = await api.post<ApiResponse<unknown>>('/location/validate', {
      latitude,
      longitude,
    });
    return response.data;
  } catch (error) {
    console.error('Validate location error:', error);
    throw error;
  }
};

// ─── Tasks ─────────────────────────────────────────────────────────────────
export const getTasks = async (status: string | null = null): Promise<unknown> => {
  try {
    const endpoint = status ? `/tasks?status=${status}` : '/tasks';
    const response = await api.get<unknown>(endpoint);
    return response.data;
  } catch (error: any) {
    console.error('Get tasks error:', error);
    if (error.response?.status === 404) {
      console.log('Tasks endpoint not found, returning empty array');
      return [];
    }
    throw error;
  }
};

// ─── B2B / Industrial — Company Profile + NDA ──────────────────────────────
export interface CompanyProfilePayload {
  company_name?: string;
  gstin?: string;
  poc_name?: string;
  poc_mobile?: string;
  poc_email?: string;
  [key: string]: unknown;
}

export const getCompanyProfile = async (): Promise<ApiResponse<unknown>> => {
  try {
    const { data } = await api.get<ApiResponse<unknown>>('/company-profile');
    return data;
  } catch (error: any) {
    throw error.response?.data || { message: 'Failed to load company profile' };
  }
};

export const upsertCompanyProfile = async (
  payload: CompanyProfilePayload,
): Promise<ApiResponse<unknown>> => {
  try {
    const { data } = await api.put<ApiResponse<unknown>>('/company-profile', payload);
    return data;
  } catch (error: any) {
    throw error.response?.data || { message: 'Failed to save company profile' };
  }
};

export const getB2BReadiness = async (): Promise<ApiResponse<unknown>> => {
  try {
    const { data } = await api.get<ApiResponse<unknown>>('/company-profile/status');
    return data;
  } catch (error: any) {
    throw error.response?.data || { message: 'Failed to check B2B readiness' };
  }
};

export const acceptNDA = async (): Promise<ApiResponse<unknown>> => {
  try {
    const { data } = await api.post<ApiResponse<unknown>>('/company-profile/nda/accept');
    return data;
  } catch (error: any) {
    throw error.response?.data || { message: 'Failed to record NDA' };
  }
};

// ─── Enquiries (B2B quote-based booking sibling) ───────────────────────────
export interface EnquiryPayload {
  service_id?: string;
  description?: string;
  quantity?: number;
  [key: string]: unknown;
}

export const createEnquiry = async (payload: EnquiryPayload): Promise<ApiResponse<unknown>> => {
  try {
    const { data } = await api.post<ApiResponse<unknown>>('/enquiries', payload);
    return data;
  } catch (error: any) {
    throw error.response?.data || { message: 'Failed to submit enquiry' };
  }
};

export const getMyEnquiries = async (): Promise<ApiResponse<unknown>> => {
  try {
    const { data } = await api.get<ApiResponse<unknown>>('/enquiries/mine');
    return data;
  } catch (error: any) {
    throw error.response?.data || { message: 'Failed to load enquiries' };
  }
};

export const getEnquiryById = async (id: string): Promise<ApiResponse<unknown>> => {
  try {
    const { data } = await api.get<ApiResponse<unknown>>(`/enquiries/${id}`);
    return data;
  } catch (error: any) {
    throw error.response?.data || { message: 'Failed to load enquiry' };
  }
};

export const getEnquiryStages = async (id: string): Promise<ApiResponse<unknown>> => {
  try {
    const { data } = await api.get<ApiResponse<unknown>>(`/enquiries/${id}/stages`);
    return data;
  } catch (error: any) {
    throw error.response?.data || { message: 'Failed to load stages' };
  }
};

export const getVaultDocuments = async (
  enquiryId: string,
): Promise<ApiResponse<DocumentRecord[]> | DocumentRecord[]> => {
  try {
    const { data } = await api.get<ApiResponse<DocumentRecord[]> | DocumentRecord[]>(
      `/vault/enquiry/${enquiryId}`,
    );
    return data;
  } catch (error: any) {
    throw error.response?.data || { message: 'Failed to load vault documents' };
  }
};

export const getVaultDownloadUrl = (vaultDocId: string): string =>
  `${api.defaults.baseURL}/vault/${vaultDocId}/download`;

// ─── Push notifications ────────────────────────────────────────────────────
export const registerPushToken = async (
  token: string,
  platform: string,
): Promise<ApiResponse<unknown>> => {
  try {
    const { data } = await api.post<ApiResponse<unknown>>('/notifications/register-token', {
      token,
      platform,
    });
    return data;
  } catch (error: any) {
    throw error.response?.data || { message: 'Failed to register push token' };
  }
};

export const clearPushToken = async (): Promise<ApiResponse<unknown>> => {
  try {
    const { data } = await api.delete<ApiResponse<unknown>>('/notifications/register-token');
    return data;
  } catch (error: any) {
    throw error.response?.data || { message: 'Failed to clear push token' };
  }
};

// ─── Quote actions ─────────────────────────────────────────────────────────
export const acceptQuote = async (id: string): Promise<ApiResponse<unknown>> => {
  try {
    const { data } = await api.post<ApiResponse<unknown>>(`/enquiries/${id}/accept`);
    return data;
  } catch (error: any) {
    throw error.response?.data || { message: 'Failed to accept quote' };
  }
};

export const rejectQuote = async (id: string): Promise<ApiResponse<unknown>> => {
  try {
    const { data } = await api.post<ApiResponse<unknown>>(`/enquiries/${id}/reject`);
    return data;
  } catch (error: any) {
    throw error.response?.data || { message: 'Failed to reject quote' };
  }
};

export const cancelEnquiry = async (id: string): Promise<ApiResponse<unknown>> => {
  try {
    const { data } = await api.post<ApiResponse<unknown>>(`/enquiries/${id}/cancel`);
    return data;
  } catch (error: any) {
    throw error.response?.data || { message: 'Failed to cancel enquiry' };
  }
};

// ─── Guest login ───────────────────────────────────────────────────────────
export interface GuestLoginResponse {
  success: boolean;
  token: string;
  user: User;
}

export const guestLogin = async (): Promise<GuestLoginResponse> => {
  try {
    const { data } = await api.post<GuestLoginResponse>('/auth/guest-login');
    return data;
  } catch (error: any) {
    if (error.response?.data?.message) throw error.response.data;
    if (error.message === 'Network Error' || !error.response) {
      throw {
        message:
          'Cannot reach backend at ' +
          (error.config?.baseURL || 'API_BASE_URL') +
          '. Check the server is running.',
      };
    }
    throw { message: `Guest login failed (${error.response?.status || '?'})` };
  }
};

// ─── Wallet ───────────────────────────────────────────────────────────────
export interface WalletTransaction {
  id: string;
  type: 'credit' | 'debit';
  amount: number;
  source: string;
  description?: string;
  bookingId?: string | null;
  balanceAfter: number;
  createdAt: string;
}

export interface WalletBalanceResponse {
  success: boolean;
  balance: number;
  transactions: WalletTransaction[];
}

export const getWalletBalance = async (): Promise<WalletBalanceResponse> => {
  const { data } = await api.get<WalletBalanceResponse>('/wallet/balance');
  return data;
};

export interface RedeemWalletResponse {
  success: boolean;
  balance: number;
  redeemed: number;
  message?: string;
}

export const redeemWallet = async (
  bookingId: string,
  amount: number,
): Promise<RedeemWalletResponse> => {
  const { data } = await api.post<RedeemWalletResponse>('/wallet/redeem', { bookingId, amount });
  return data;
};

// ─── Customer-side referral ───────────────────────────────────────────────
export interface CustomerReferralData {
  success: boolean;
  referralCode: string;
  referralLink: string;
  totalReferrals: number;
  successfulReferrals: number;
  totalEarned: number;
  availableCredits: number;
}

export const getCustomerReferral = async (): Promise<CustomerReferralData> => {
  const { data } = await api.get<CustomerReferralData>('/referrals');
  return data;
};

export const applyReferralCode = async (
  referralCode: string,
): Promise<{ success: boolean; message?: string; discount?: number }> => {
  const { data } = await api.post('/referrals/apply', { referralCode });
  return data;
};

export const trackReferralShare = async (
  referralCode: string,
  source: string = 'app',
): Promise<{ success: boolean }> => {
  const { data } = await api.post('/referrals/track', { referralCode, source });
  return data;
};

// ─── Trending services & promotional offers ───────────────────────────────
export interface OfferItem {
  id: string;
  title: string;
  description: string;
  discount: number;
  type: string;
  validUntil: string | null;
  bannerColor: string;
}

export const getTrendingServices = async (): Promise<ApiResponse<Service[]>> => {
  const { data } = await api.get<ApiResponse<Service[]>>('/services/trending');
  return data;
};

export const getOffers = async (): Promise<ApiResponse<OfferItem[]>> => {
  const { data } = await api.get<ApiResponse<OfferItem[]>>('/services/offers');
  return data;
};

// ─── Compliance Vault (B2B) ───────────────────────────────────────────────
export type ComplianceType =
  | 'factory_license'
  | 'fire_noc'
  | 'pollution_noc'
  | 'gst_certificate'
  | 'incorporation'
  | 'iso_cert'
  | 'trade_license'
  | 'esi_pf'
  | 'other';

export type ComplianceStatus = 'green' | 'yellow' | 'red';

export interface ComplianceDoc {
  id: string;
  original_name: string;
  mime_type: string;
  plaintext_size: number;
  note?: string | null;
  compliance_type: ComplianceType;
  expiry_date: string; // YYYY-MM-DD
  status: ComplianceStatus;
  daysLeft: number;
  label: string;
  downloadUrl: string;
  created_at: string;
}

export interface ComplianceListResponse {
  success: boolean;
  data: ComplianceDoc[];
  needsCompanyProfile?: boolean;
}

export const getComplianceDocs = async (): Promise<ComplianceListResponse> => {
  const { data } = await api.get<ComplianceListResponse>('/compliance');
  return data;
};

export const uploadComplianceDoc = async (
  file: { uri: string; name: string; type: string },
  fields: { compliance_type: ComplianceType | string; expiry_date: string; note?: string },
): Promise<{ success: boolean; data: ComplianceDoc }> => {
  const fd = new FormData();
  fd.append('file', file as any);
  fd.append('compliance_type', fields.compliance_type);
  fd.append('expiry_date', fields.expiry_date);
  if (fields.note) fd.append('note', fields.note);

  // Use raw fetch so we don't double-set Content-Type — multipart needs a
  // boundary that fetch generates automatically when given a FormData body.
  const token = await getToken();
  const res = await fetch(`${api.defaults.baseURL}/compliance/upload`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: fd as any,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((json as any)?.message || `Upload failed (HTTP ${res.status})`);
  }
  return json as { success: boolean; data: ComplianceDoc };
};

export const renewComplianceDoc = async (
  id: string,
): Promise<{ success: boolean; message: string }> => {
  const { data } = await api.post<{ success: boolean; message: string }>(
    `/compliance/${id}/renew`,
  );
  return data;
};

// Re-export shared types so screens can import them from `services/api` directly
// without needing to know they originate in `../types`.
export type { ApiResponse, Service } from '../types';

export default api;

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiBaseUrl } from '../../config/agent';
import type { ApiResponse, User } from '../../types';

// ─── Working-endpoint cache ──────────────────────────────────────────────
// Once we've found a URL that actually responds, remember it so subsequent
// polls don't retry the whole candidate list.
let _workingTasksEndpoint: string | null = null;

interface FetchAPIOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: string;
  headers?: Record<string, string>;
}

interface FetchAPIResult {
  success?: boolean;
  message?: string;
  fallback?: boolean;
  [key: string]: unknown;
}

interface FetchAPIError extends Error {
  httpStatus?: number;
  endpointExists?: boolean;
}

// Static field used to track whether the dyno has been warmed up.
type FetchAPIFn = ((endpoint: string, options?: FetchAPIOptions) => Promise<any>) & {
  _warmedUp?: boolean;
};

// Simple fetch wrapper with better timeout handling
const fetchAPI: FetchAPIFn = async (endpoint, options = {}) => {
  const url = `${getApiBaseUrl()}${endpoint}`;
  let token = await AsyncStorage.getItem('agent_token');

  // Clean stale demo tokens left over from the earlier tester build so the
  // backend gets a proper "no token" 401 instead of a forged bearer.
  if (token && typeof token === 'string' && token.startsWith('demo_token_')) {
    await AsyncStorage.removeItem('agent_token');
    token = null;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const method = options.method || 'GET';
  const cacheBustedUrl =
    method === 'GET'
      ? `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`
      : url;

  const config: RequestInit = { method, headers };
  if (options.body) config.body = options.body;

  console.log(`API Request: ${method} ${url}`);

  try {
    // First request of a session may hit a cold Render dyno (~20–45 s to wake).
    const isFirstCall = !fetchAPI._warmedUp;
    const TIMEOUT_MS = isFirstCall ? 45000 : 8000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(cacheBustedUrl, {
      ...config,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    fetchAPI._warmedUp = true;

    const text = await response.text();

    let data: any;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      console.error('JSON parse error:', text.substring(0, 200));
      throw new Error('Invalid server response');
    }

    if (!response.ok) {
      console.log(
        `API ${method} ${endpoint} → HTTP ${response.status}`,
        (data && data.message) || text.substring(0, 200),
      );
      const err: FetchAPIError = new Error(data.message || `HTTP ${response.status}`);
      err.httpStatus = response.status;
      err.endpointExists = true;
      throw err;
    }

    return data;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.log(`API ${options.method || 'GET'} ${endpoint} → timeout`);
      return { success: false, message: 'Request timeout', fallback: true };
    }
    if (error.endpointExists) {
      console.log(`API ${options.method || 'GET'} ${endpoint} → HTTP ${error.httpStatus}`);
      throw error;
    }
    console.log(`API ${options.method || 'GET'} ${endpoint} → error: ${error.message}`);
    return { success: false, message: error.message || 'Network error', fallback: true };
  }
};

// ─── Hardcoded OTP mapping ────────────────────────────────────────────────
const getHardcodedOTP = (mobile: string): string => {
  const otpMap: Record<string, string> = {
    '9876543210': '123456',
    '9876543211': '111111',
    '9876543212': '222222',
    '9876543213': '333333',
    '9876543214': '444444',
    '9876543215': '555555',
    '9876543216': '666666',
    '9876543217': '777777',
    '9876543218': '888888',
    '9876543219': '999999',
    '9000000000': '000000',
    '9000000001': '101010',
    '9000000002': '202020',
    '9000000003': '303030',
    '9000000004': '404040',
    '9000000005': '505050',
    '9000000006': '606060',
    '9000000007': '707070',
    '9000000008': '808080',
    '9000000009': '909090',
  };

  if (otpMap[mobile]) return otpMap[mobile];

  // Generate consistent OTP based on mobile number (deterministic)
  let hash = 0;
  for (let i = 0; i < mobile.length; i++) {
    hash = ((hash << 5) - hash) + mobile.charCodeAt(i);
    hash = hash & hash;
  }
  const otp = Math.abs(hash) % 1000000;
  return otp.toString().padStart(6, '0');
};

const generateOTP = (mobile: string): string => {
  const otp = getHardcodedOTP(mobile);
  console.log('\n' + '='.repeat(50));
  console.log('OTP FOR TESTING');
  console.log('='.repeat(50));
  console.log('Mobile: +91' + mobile);
  console.log('OTP: ' + otp);
  console.log('Time: ' + new Date().toLocaleString());
  console.log('='.repeat(50));
  console.log('Use this OTP: ' + otp);
  console.log('='.repeat(50) + '\n');
  return otp;
};

export const getOTPForMobile = (mobile: string): string => getHardcodedOTP(mobile);

// ─── Auth APIs ────────────────────────────────────────────────────────────
export type OTPMethod = 'sms' | 'email' | 'app' | 'whatsapp';

export interface SendOTPResult {
  success: boolean;
  message: string;
  devOtp?: string | null;
  source?: 'backend' | 'backend-dev' | 'offline';
  offlineMode?: boolean;
}

export const sendOTP = async (mobile: string, method: OTPMethod = 'sms'): Promise<SendOTPResult> => {
  if (!mobile || mobile.length !== 10) {
    throw new Error('Invalid mobile number');
  }

  const response = await fetchAPI('/auth/send-otp', {
    method: 'POST',
    body: JSON.stringify({ mobile }),
  });

  if (response.success && !response.fallback) {
    await AsyncStorage.removeItem('current_otp');
    const devOtp =
      response.devOtp ||
      response.dev_otp ||
      response.otp ||
      (typeof response.message === 'string'
        ? (response.message.match(/\b\d{6}\b/) || [])[0]
        : null) ||
      null;

    console.log(
      devOtp
        ? `OTP for +91${mobile}: ${devOtp} (dev mode)`
        : `OTP sent via backend for +91${mobile}`,
    );

    return {
      success: true,
      message: `OTP sent to +91${mobile}`,
      devOtp,
      source: devOtp ? 'backend-dev' : 'backend',
    };
  }

  // Backend unreachable — generate local OTP so the agent can still log in offline
  console.log('Backend unreachable, generating offline OTP');
  const otp = generateOTP(mobile);
  await AsyncStorage.setItem(
    'current_otp',
    JSON.stringify({ mobile, otp, timestamp: Date.now() }),
  );
  return {
    success: true,
    message: `Offline OTP: ${otp}`,
    devOtp: otp,
    source: 'offline',
    offlineMode: true,
  };
};

export interface VerifyOTPResult {
  success: boolean;
  token: string;
  user: Partial<User> & { mobile?: string; role?: string };
  offline?: boolean;
}

export const verifyOTP = async (
  mobile: string,
  otp: string,
  role: string = 'agent',
): Promise<VerifyOTPResult> => {
  if (!otp || otp.length !== 6) {
    throw new Error('Please enter a valid 6-digit OTP');
  }

  const stored = await AsyncStorage.getItem('current_otp');
  if (stored) {
    const otpData = JSON.parse(stored);
    if (otpData.mobile === mobile) {
      if (Date.now() - otpData.timestamp > 5 * 60 * 1000) {
        await AsyncStorage.removeItem('current_otp');
        throw new Error('OTP has expired. Please request a new OTP.');
      }
      if (otpData.otp === otp) {
        await AsyncStorage.removeItem('current_otp');
        return {
          success: true,
          token: 'offline_token_' + Date.now(),
          user: { mobile, name: 'Representative (Offline)', role: 'agent' },
          offline: true,
        };
      }
      throw new Error('Invalid OTP. Please try again.');
    }
  }

  const response = await fetchAPI('/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ mobile, otp, role }),
  });

  if (response.success && response.token) {
    const backendRole = response.user?.role;
    if (backendRole && backendRole !== 'agent' && backendRole !== 'partner') {
      throw new Error(
        `This number is already registered as a ${backendRole}. Please use a different mobile number for the representative app.`,
      );
    }
    await AsyncStorage.removeItem('current_otp');
    return response as VerifyOTPResult;
  }

  throw new Error(response.message || 'OTP verification failed. Please try again.');
};

export const resendOTP = async (mobile: string, method: OTPMethod = 'sms'): Promise<SendOTPResult> => {
  console.log('Resending OTP to:', mobile, 'via:', method);
  await AsyncStorage.removeItem('current_otp');
  return await sendOTP(mobile, method);
};

export interface OTPMethodOption {
  id: OTPMethod;
  name: string;
  description: string;
  icon: string;
}

export const getAvailableOTPMethods = (): OTPMethodOption[] => [
  { id: 'sms', name: 'SMS', description: 'Receive OTP via SMS', icon: '📱' },
  { id: 'email', name: 'Email', description: 'Receive OTP via Email', icon: '📧' },
  { id: 'app', name: 'Authenticator App', description: 'Use authenticator app', icon: '🔐' },
  { id: 'whatsapp', name: 'WhatsApp', description: 'Receive OTP via WhatsApp', icon: '💬' },
];

// ─── Booking normalization ────────────────────────────────────────────────
export type AgentTaskStatus =
  | 'new'
  | 'accepted'
  | 'in_progress'
  | 'documents_collected'
  | 'work_completed'
  | 'completed'
  | 'cancelled';

const mapBackendStatusToFrontend = (s: string | undefined): AgentTaskStatus => {
  switch (s) {
    case 'assigned':
    case 'new':
      return 'new';
    case 'accepted':
      return 'accepted';
    case 'started':
    case 'in_progress':
    case 'reached_location':
      return 'in_progress';
    case 'documents_collected':
      return 'documents_collected';
    case 'submitted':
    case 'work_completed':
      return 'work_completed';
    case 'completed':
      return 'completed';
    case 'pending':
    case 'cancelled':
    case 'rejected':
      return 'cancelled';
    default:
      return (s as AgentTaskStatus) || 'new';
  }
};

const mapFrontendStatusToBackend = (s: string): string => {
  switch (s) {
    case 'new':
      return 'new';
    case 'accepted':
      return 'accepted';
    case 'in_progress':
      return 'in_progress';
    case 'completed':
      return 'completed';
    default:
      return s;
  }
};

export interface AgentTask {
  id: string;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  serviceType: string;
  address: string;
  amount: number;
  distance: string;
  status: AgentTaskStatus;
  rawStatus: string;
  createdAt: string;
  completedAt: string | null;
  preferredDate: string | null;
  preferredTime: string | null;
  requiredDocuments: unknown;
  paymentStatus: string;
}

const normalizeBooking = (b: any): AgentTask | null => {
  if (!b) return null;
  const rawStatus = b.status ?? b.booking_status ?? 'pending';
  const amount = b.price_quoted ?? b.partner_earning ?? b.service?.partner_earning ?? b.amount ?? 0;
  return {
    id: b.id ?? b._id ?? b.booking_id,
    customerName: b.customer_name ?? b.customer?.name ?? b.customerName ?? 'Customer',
    customerPhone: b.customer_mobile ?? b.customer?.mobile ?? b.customerPhone ?? '',
    serviceName: b.service?.name ?? b.service_name ?? b.serviceName ?? 'Service',
    serviceType: b.service?.category ?? b.service_type ?? b.serviceType ?? '',
    address: b.service_address ?? b.address ?? 'Address not provided',
    amount: parseFloat(amount) || 0,
    distance: b.distance ?? 'N/A',
    status: mapBackendStatusToFrontend(rawStatus),
    rawStatus,
    createdAt: b.created_at ?? b.createdAt ?? new Date().toISOString(),
    completedAt: b.completed_at ?? b.completedAt ?? null,
    preferredDate: b.preferred_date ?? b.preferredDate ?? null,
    preferredTime: b.preferred_time ?? b.preferredTime ?? null,
    requiredDocuments:
      b.documents_required ?? b.service?.required_documents ?? b.requiredDocuments ?? [],
    paymentStatus: b.payment_status ?? b.paymentStatus ?? 'pending',
  };
};

// ─── Dashboard ────────────────────────────────────────────────────────────
export interface DashboardData {
  tasks: AgentTask[];
  todayEarnings: number;
  totalJobs: number;
  newRequests: number;
  pendingTasks: number;
  completedJobs: number;
  rating: number;
  isOnline: boolean;
}

export const getDashboard = async (): Promise<DashboardData> => {
  const tasksResponse = await getTasks();
  const tasks = tasksResponse?.tasks || [];

  const today = new Date().toDateString();
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const todayCompleted = completedTasks.filter(
    (t) => new Date(t.completedAt || t.createdAt).toDateString() === today,
  );
  const todayEarnings = todayCompleted.reduce(
    (sum, t) => sum + (parseFloat(String(t.amount)) || 0),
    0,
  );

  return {
    tasks,
    todayEarnings,
    totalJobs: tasks.length,
    newRequests: tasks.filter((t) => t.status === 'new').length,
    pendingTasks: tasks.filter((t) => t.status === 'accepted' || t.status === 'in_progress').length,
    completedJobs: completedTasks.length,
    rating: completedTasks.length > 0 ? 4.5 : 0,
    isOnline: false,
  };
};

// Dig through arbitrary nesting to find the first array that looks like bookings.
const findBookingsArray = (node: any, depth: number = 0): any[] | null => {
  if (!node || depth > 4) return null;
  if (Array.isArray(node)) {
    if (node.length === 0) return node;
    const first = node[0];
    if (
      first &&
      typeof first === 'object' &&
      ('id' in first ||
        '_id' in first ||
        'booking_id' in first ||
        'status' in first ||
        'service' in first ||
        'customer_name' in first)
    )
      return node;
    return null;
  }
  if (typeof node !== 'object') return null;
  const preferred = ['tasks', 'bookings', 'data', 'result', 'results', 'items', 'rows', 'list'];
  for (const key of preferred) {
    if (key in node) {
      const found = findBookingsArray(node[key], depth + 1);
      if (found) return found;
    }
  }
  for (const key of Object.keys(node)) {
    const found = findBookingsArray(node[key], depth + 1);
    if (found) return found;
  }
  return null;
};

// ─── Tasks ────────────────────────────────────────────────────────────────
export interface TasksResponse {
  tasks: AgentTask[];
}

export const getTasks = async (status: string | null = null): Promise<TasksResponse> => {
  const backendStatus = status && status !== 'all' ? mapFrontendStatusToBackend(status) : null;
  const qs = backendStatus ? `?status=${encodeURIComponent(backendStatus)}` : '';

  // /bookings/tasks is the canonical agent endpoint. The other paths are
  // legacy fallbacks from earlier API iterations — kept so older builds
  // can still resolve, but they're tried only after the canonical one.
  const candidates = _workingTasksEndpoint
    ? [`${_workingTasksEndpoint}${qs}`]
    : [
        `/bookings/tasks${qs}`,
        `/agent/bookings${qs}`,
        `/agent/tasks${qs}`,
        `/tasks${qs}`,
        `/partner/bookings${qs}`,
      ];

  let rawList: any[] | null = null;
  let pickedEndpoint: string | null = null;

  for (const endpoint of candidates) {
    let response: any;
    try {
      response = await fetchAPI(endpoint);
    } catch (err: any) {
      // CRITICAL: don't poison the cache here. A 4xx/5xx ("endpointExists")
      // means the route is real but rejected this request — could be a
      // genuine auth error, or a transient server hiccup. Either way,
      // caching this URL as "the working endpoint" would lock us into a
      // dead path forever. Just continue to the next candidate.
      console.log(`[getTasks] ${endpoint} → ${err?.httpStatus || 'error'}: ${err?.message}`);
      continue;
    }

    // Cold-dyno fallback (timeout) — try the next candidate, but DO NOT
    // cache the timed-out endpoint as broken; it might warm up on next
    // poll. Without this we'd never recover from a single cold start.
    if (response?.fallback) {
      console.log(`[getTasks] ${endpoint} → cold-start timeout, trying next`);
      continue;
    }

    const list = findBookingsArray(response);
    if (Array.isArray(list)) {
      rawList = list;
      pickedEndpoint = endpoint;
      // Only cache when we successfully extracted a bookings array. This
      // is the "this URL works" signal — anything else (404, timeout,
      // shape-mismatch) leaves the cache empty so the next call re-tries
      // the full candidate list.
      _workingTasksEndpoint = endpoint.split('?')[0];
      break;
    }
  }

  if (!rawList) {
    // Total failure — clear any stale cached endpoint so the next poll
    // sweeps the full candidate list again. This is what unsticks reps
    // whose previous session cached a bad endpoint.
    _workingTasksEndpoint = null;
    return { tasks: [] };
  }

  console.log(`getTasks: using ${pickedEndpoint}, received ${rawList.length} booking(s)`);

  const tasks = rawList.map(normalizeBooking).filter((t): t is AgentTask => Boolean(t));
  const filtered =
    status && status !== 'all' ? tasks.filter((t) => t.status === status) : tasks;
  filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { tasks: filtered };
};

export const acceptTask = async (taskId: string): Promise<FetchAPIResult> => {
  return await fetchAPI(`/bookings/${taskId}/accept`, { method: 'POST' });
};

export const rejectTask = async (taskId: string): Promise<FetchAPIResult> => {
  return await fetchAPI(`/bookings/${taskId}/reject`, { method: 'POST' });
};

// Update job status — uses /job-status (not /status, which is reserved for
// accept/reject). The backend accepts the agent app's full status flow:
// started, reached_location, documents_collected, work_completed, completed.
export const updateTaskStatus = async (
  taskId: string,
  status: string,
): Promise<FetchAPIResult> => {
  return await fetchAPI(`/bookings/${taskId}/job-status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
};

export const completeTask = async (
  taskId: string,
  otp: string,
): Promise<FetchAPIResult> => {
  return await fetchAPI(`/bookings/${taskId}/verify-completion`, {
    method: 'POST',
    body: JSON.stringify({ otp }),
  });
};

// ─── Earnings ────────────────────────────────────────────────────────────
export interface EarningRecord {
  id: string;
  taskId: string;
  customerName: string;
  serviceName: string;
  amount: number;
  commission: number;
  date: string;
  status: 'completed';
  paymentStatus: string;
}

export interface EarningsSummary {
  earnings: EarningRecord[];
  total: number;
  today: number;
  week: number;
}

export const getEarnings = async (): Promise<EarningsSummary> => {
  // Hit the dedicated backend endpoint — uses service.partner_earning as
  // the rep's actual commission (not the gross booking value), and computes
  // real today/week/month sums on the server.
  try {
    const response: any = await fetchAPI('/earnings');
    if (response?.success && Array.isArray(response.earnings)) {
      return {
        earnings: response.earnings as EarningRecord[],
        total: Number(response.total || 0),
        today: Number(response.today || 0),
        week: Number(response.week || 0),
      };
    }
  } catch (e: any) {
    console.warn('[earnings] backend fetch failed, falling back to local compute:', e?.message);
  }

  // Fallback — derive from in-memory tasks if the dedicated endpoint
  // can't be reached (cold start, transient error). Worst case: shows
  // gross amount as commission, not the partner_earning split.
  const tasksResponse = await getTasks();
  const tasks = tasksResponse?.tasks || [];
  const completed = tasks.filter((t) => t.status === 'completed');

  const earnings: EarningRecord[] = completed.map((t) => ({
    id: t.id,
    taskId: t.id?.substring(0, 8) || t.id,
    customerName: t.customerName || 'Customer',
    serviceName: t.serviceName || 'Service',
    amount: parseFloat(String(t.amount)) || 0,
    commission: parseFloat(String(t.amount)) || 0,
    date: t.completedAt || t.createdAt || new Date().toISOString(),
    status: 'completed',
    paymentStatus: t.paymentStatus || 'pending',
  }));

  const now = new Date();
  const todayStr = now.toDateString();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);

  const total = earnings.reduce((s, e) => s + e.commission, 0);
  const today = earnings
    .filter((e) => new Date(e.date).toDateString() === todayStr)
    .reduce((s, e) => s + e.commission, 0);
  const week = earnings
    .filter((e) => new Date(e.date) >= weekAgo)
    .reduce((s, e) => s + e.commission, 0);

  return { earnings, total, today, week };
};

// ─── Referrals ────────────────────────────────────────────────────────────
export interface ReferralResponse {
  referralCode: string;
  referralLink: string;
  totalReferrals: number;
  successfulReferrals: number;
  totalEarned: number;
  availableCredits: number;
  usedCredits: number;
  expiredCredits: number;
  referrals: unknown[];
  milestones: Record<string, unknown>;
  royalty: Record<string, unknown>;
  [key: string]: unknown;
}

export const getReferrals = async (): Promise<ReferralResponse> => {
  const response = await fetchAPI('/referrals');
  if (response.success) return response as ReferralResponse;
  return {
    referralCode: '',
    referralLink: '',
    totalReferrals: 0,
    successfulReferrals: 0,
    totalEarned: 0,
    availableCredits: 0,
    usedCredits: 0,
    expiredCredits: 0,
    referrals: [],
    milestones: {},
    royalty: {},
  };
};

export const generateReferralCode = async (): Promise<FetchAPIResult> => {
  return await fetchAPI('/referrals/generate', { method: 'POST' });
};

export const trackReferralClick = async (
  referralCode: string,
  source: string = 'app',
): Promise<FetchAPIResult> => {
  return await fetchAPI('/referrals/track', {
    method: 'POST',
    body: JSON.stringify({ referralCode, source }),
  });
};

export interface ReferralStats {
  totalReferrals: number;
  successfulReferrals: number;
  conversionRate: number;
  monthlyReferrals: number;
}

export const getReferralStats = async (): Promise<ReferralStats> => {
  const response = await fetchAPI('/referrals/stats');
  if (response.success) return response as ReferralStats;
  return { totalReferrals: 0, successfulReferrals: 0, conversionRate: 0, monthlyReferrals: 0 };
};

export const applyReferralCode = async (referralCode: string): Promise<FetchAPIResult> => {
  return await fetchAPI('/referrals/apply', {
    method: 'POST',
    body: JSON.stringify({ referralCode }),
  });
};

// ─── Profile ──────────────────────────────────────────────────────────────
export const getProfile = async (): Promise<User | Record<string, unknown>> => {
  const response = await fetchAPI('/profile');
  if (response.success || response.id || response.name) return response;
  const stored = await AsyncStorage.getItem('agent_data');
  return stored ? JSON.parse(stored) : { name: 'Representative', mobile: '', email: '' };
};

export const updateProfile = async (
  profileData: Partial<User>,
): Promise<ApiResponse<User>> => {
  return await fetchAPI('/profile', {
    method: 'PUT',
    body: JSON.stringify(profileData),
  });
};

export interface OnlineStatusResponse {
  success: boolean;
  isOnline: boolean;
  message: string;
  note?: string;
}

export const updateOnlineStatus = async (isOnline: boolean): Promise<OnlineStatusResponse> => {
  console.log('Updating online status to:', isOnline);
  try {
    return (await fetchAPI('/agent/status', {
      method: 'PUT',
      body: JSON.stringify({ online_status: isOnline }),
    })) as OnlineStatusResponse;
  } catch (error: any) {
    console.log('Update status API failed, using fallback -', error.message);
    return {
      success: true,
      isOnline,
      message: `Status updated to ${isOnline ? 'Online' : 'Offline'} (mock)`,
      note: 'Using mock data - backend not reachable',
    };
  }
};

// ─── Representative-side compliance upload ────────────────────────────────
// Lets the rep upload a renewed compliance doc (Factory Licence, Fire NOC,
// Pollution NOC, etc.) on behalf of the customer during a service visit.
// Backend recognises the 'agent' role and uses the customer_id from the
// body instead of req.user.id when filing the doc.
export const uploadComplianceForCustomer = async (
  customerId: string,
  file: { uri: string; name: string; type: string },
  fields: { compliance_type: string; expiry_date: string; note?: string },
): Promise<{ success: boolean; data?: any; message?: string }> => {
  const fd = new FormData();
  // RN's FormData accepts file objects in this {uri,type,name} shape — cast
  // to any so TS doesn't complain about Blob/File mismatch.
  fd.append('file', file as any);
  fd.append('customer_id', customerId);
  fd.append('compliance_type', fields.compliance_type);
  fd.append('expiry_date', fields.expiry_date);
  if (fields.note) fd.append('note', fields.note);

  const token = await AsyncStorage.getItem('agent_token');
  const url = `${getApiBaseUrl()}/compliance/upload`;
  console.log('[rep compliance upload] →', url, 'customer:', customerId);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // IMPORTANT: do NOT set Content-Type — fetch sets the multipart boundary.
    },
    body: fd,
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_) {
    json = { message: text };
  }
  if (!res.ok) {
    throw new Error(json?.message || `Upload failed (HTTP ${res.status})`);
  }
  return json;
};

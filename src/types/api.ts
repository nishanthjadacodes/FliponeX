// Backend response shapes — expand as files migrate to .ts.
// Kept loose (most fields optional) so existing JS callers aren't broken
// when you start importing these types from converted files.

export type Id = string;
export type ISODate = string;

// ─── Auth / User ──────────────────────────────────────────────────────────
export type UserRole = 'customer' | 'agent' | 'partner' | 'super_admin' | 'operations_manager';

export interface User {
  id: Id;
  name?: string;
  mobile?: string;
  email?: string;
  role?: UserRole;
  rating?: number;
  total_jobs_completed?: number;
  referral_code?: string;
  is_active?: boolean;
  created_at?: ISODate;
}

// ─── Service catalog ──────────────────────────────────────────────────────
export type BookingType = 'consumer' | 'industrial';

export interface Service {
  id: Id;
  name: string;
  category?: string;
  description?: string;
  user_cost?: number;
  govt_fees?: number;
  partner_earning?: number;
  total_expense?: number;
  company_margin?: number;
  expected_timeline?: string;
  required_documents?: RequiredDocument[] | { documents?: RequiredDocument[] };
  remarks?: string;
  form_fields?: { fields?: ServiceFormField[] };
}

export interface RequiredDocument {
  type: string;
  label?: string;
  required?: boolean;
}

export interface ServiceFormField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'date' | 'phone' | 'email' | string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

// ─── Bookings ─────────────────────────────────────────────────────────────
export type BookingStatus =
  | 'pending'
  | 'assigned'
  | 'accepted'
  | 'documents_collected'
  | 'submitted'
  | 'completed'
  | 'cancelled';

export interface Booking {
  id: Id;
  booking_number?: number;
  customer_id: Id;
  agent_id?: Id | null;
  service_id: Id;
  service?: Service;
  customer?: Pick<User, 'id' | 'name' | 'mobile'>;
  agent?: Pick<User, 'id' | 'name' | 'mobile' | 'rating'>;
  booking_type: BookingType;
  status: BookingStatus;
  customer_name: string;
  customer_mobile: string;
  customer_email?: string;
  service_address?: string | Record<string, unknown>;
  preferred_date?: string;
  preferred_time?: string;
  documents_required?: RequiredDocument[];
  documents?: DocumentRecord[];
  dynamic_fields?: Record<string, unknown> | null;
  price_quoted?: number;
  notes?: string;
  agent_notes?: string;
  completion_otp?: string;
  created_at?: ISODate;
  completed_at?: ISODate;
}

// ─── Documents ────────────────────────────────────────────────────────────
export interface DocumentRecord {
  id: Id;
  document_type: string;
  category?: string;
  file_name?: string;
  file_url?: string;
  mime_type?: string;
  is_verified?: boolean;
  status?: 'pending' | 'verified' | 'rejected';
  uploaded_at?: ISODate;
  uploaded_by?: Id;
  booking_id?: Id | null;
}

// ─── Referrals (agent referral / network) ─────────────────────────────────
export interface ReferralListItem {
  id: Id;
  refereeId?: Id;
  name: string;
  mobile?: string;
  status: 'pending' | 'completed' | 'expired';
  isActive?: boolean;
  signupDate?: ISODate;
  reward?: number;
  rewardDate?: ISODate;
  expiryDate?: ISODate;
  children?: ReferralListItem[];
}

export interface RoyaltyData {
  totalTeamBusiness: number;
  lastMonthTeamBusiness?: number;
  activeMentees: number;
  currentMonthRoyalty: number;
  lastMonthRoyalty?: number;
  personalTasksCompleted: number;
  minimumTeamTurnoverMet: boolean;
  qualityScore: number;
}

export interface ReferralData {
  referralCode: string;
  referralLink: string;
  totalReferrals: number;
  successfulReferrals: number;
  activeReferrals?: number;
  inactiveReferrals?: number;
  totalEarned: number;
  availableCredits: number;
  usedCredits?: number;
  expiredCredits?: number;
  referrals: ReferralListItem[];
  milestones?: Record<string, { required: number; achieved: boolean; bonus: number }>;
  royalty?: RoyaltyData;
}

// ─── Generic API envelope ─────────────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// React Navigation route + param-list types. Drop the `RootStackParamList`
// into a Stack.Navigator<RootStackParamList> and any new .tsx screen will
// get fully-typed `navigation` + `route` props for free.
import type { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Splash: undefined;
  LanguageSelect: undefined;
  ModeSelect: undefined;

  // Customer surface
  HomeTabs: NavigatorScreenParams<HomeTabParamList> | undefined;
  ServiceDetails: { serviceId: string };
  Booking: { serviceId: string; service?: unknown };
  BookingDetails: { bookingId: string };
  Tracking: { bookingId: string };
  Documents: undefined;
  CompanyProfile: undefined;
  NDA: undefined;
  Enquiry: { serviceId?: string };
  EnquiryDetails: { enquiryId: string };
  Wallet: undefined;
  Compliance: undefined;

  // Agent surface
  AgentTabs: NavigatorScreenParams<AgentTabParamList> | undefined;
  TaskExecution: { taskId: string };

  // Embedded webviews
  WebView: { url: string; title?: string };

  // Auth entry — phone + OTP. The customer screen routes to HomeTabs on
  // success; the agent screen routes to AgentTabs and rejects non-rep
  // accounts. `referralCode` is the code prefilled from a deep link
  // (fliponex://refer/CODE).
  Login: { referralCode?: string } | undefined;
  AgentLogin: { referralCode?: string } | undefined;
};

export type HomeTabParamList = {
  Home: undefined;
  MyBookings: undefined;
  Profile: undefined;
};

export type AgentTabParamList = {
  Dashboard: undefined;
  Tasks: { initialFilter?: 'all' | 'new' | 'accepted' | 'in_progress' | 'completed' } | undefined;
  Earnings: undefined;
  Referral: undefined;
  Profile: undefined;
};

// Convenience helpers for screen prop typing in .tsx screens.
// Uses @react-navigation/stack (the version this app installs); switch to
// native-stack if you ever upgrade.
import type { StackScreenProps } from '@react-navigation/stack';
export type RootScreenProps<T extends keyof RootStackParamList> = StackScreenProps<
  RootStackParamList,
  T
>;

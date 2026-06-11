import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SIZES, BORDER_RADIUS } from '../constants/colors';
import { getMyBookings, getMyEnquiries } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BookingCard from '../components/BookingCard';
import { useRefetchOnFocus } from '../lib/useRefetchOnFocus';

interface NavigationProp {
  navigate: (route: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
  replace?: (route: string) => void;
  addListener?: (event: string, cb: () => void) => () => void;
  setParams?: (params: Record<string, unknown>) => void;
}

interface RouteProp {
  params?: { [key: string]: any };
}

interface Props {
  navigation: NavigationProp & { setParams: (params: Record<string, unknown>) => void };
  route: RouteProp;
}

interface Booking {
  id?: string | number;
  booking_number?: string;
  status?: string;
  service_id?: string | number;
  service_name?: string;
  service?: { name?: string; category?: string };
  [key: string]: any;
}

interface Enquiry {
  id: string | number;
  status?: string;
  urgency?: string;
  service?: { name?: string; category?: string };
  quote_service_fee?: number | null;
  quote_govt_fees?: number | null;
  [key: string]: any;
}

// ─── Query functions ────────────────────────────────────────────────
// Extracted as module-level functions so TanStack Query owns them.
// Both are RESILIENT — an API failure falls back to whatever data is
// available rather than throwing, so the screen is never blocked
// (matches the old hand-rolled behaviour).

// API bookings merged with not-yet-synced local bookings.
const fetchBookings = async (): Promise<Booking[]> => {
  let apiBookings: Booking[] = [];
  try {
    const response: any = await getMyBookings();
    apiBookings = Array.isArray(response) ? response : [];
  } catch (apiError: any) {
    console.log('API unavailable, showing local bookings only:', apiError?.message);
  }

  // Build lookup: service_id → service name (from API data).
  const serviceNameByServiceId: Record<string, string> = {};
  const apiBookingIds = new Set<any>();
  apiBookings.forEach((b: Booking) => {
    apiBookingIds.add(b.id);
    if (b.service_id && b.service?.name) {
      serviceNameByServiceId[b.service_id as any] = b.service.name;
    }
  });

  // Local bookings not yet returned by the API (just created, unsynced).
  let localOnlyBookings: Booking[] = [];
  try {
    const stored = await AsyncStorage.getItem('my_bookings');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        localOnlyBookings = parsed
          .filter((b: Booking) => !apiBookingIds.has(b.id))
          .map((b: Booking) => ({
            ...b,
            service_name: b.service_name || serviceNameByServiceId[b.service_id as any] || '',
          }));
      }
    }
  } catch (error) {
    console.log('Error reading local bookings:', error);
  }

  return [...apiBookings, ...localOnlyBookings];
};

// Enquiries (B2B) — separate backend table.
const fetchEnquiries = async (): Promise<Enquiry[]> => {
  try {
    const enqRes: any = await getMyEnquiries();
    return Array.isArray(enqRes?.data) ? enqRes.data : [];
  } catch (e: any) {
    console.log('Enquiries unavailable:', e?.message);
    return [];
  }
};

const MyBookingsScreen: React.FC<Props> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<string>('ongoing');

  // ─── Server state via TanStack Query ──────────────────────────────
  // Replaces the old useState + useEffect + isLoadingRef + manual
  // focus-listener plumbing. Query gives us caching, request dedup,
  // background refresh and loading/fetching flags for free.
  const {
    data: bookings = [],
    isLoading: bookingsLoading,
    isFetching,
    refetch: refetchBookings,
  } = useQuery({ queryKey: ['bookings'], queryFn: fetchBookings });

  const {
    data: enquiries = [],
    refetch: refetchEnquiries,
  } = useQuery({ queryKey: ['enquiries'], queryFn: fetchEnquiries });

  const onRefresh = useCallback((): void => {
    refetchBookings();
    refetchEnquiries();
  }, [refetchBookings, refetchEnquiries]);

  // Refetch both lists when the tab regains focus (replaces the old
  // navigation.addListener('focus') wiring).
  useRefetchOnFocus(onRefresh);

  // Refresh if coming from booking confirmation with refresh parameter.
  useEffect(() => {
    if (route.params?.refresh) {
      onRefresh();
      navigation.setParams({ refresh: undefined });
    }
  }, [route.params?.refresh, onRefresh, navigation]);

  // Honour an explicit `tab` param from callers. This screen lives in
  // the bottom-tab navigator, so it stays mounted and keeps whatever
  // tab the user last left it on. After a successful booking the
  // "Track My Booking" button passes { tab: 'ongoing' } so the user
  // always lands on the ongoing list (where their fresh pending
  // booking is) instead of whatever tab — e.g. 'completed' — was
  // active from a previous visit.
  useEffect(() => {
    const requested = route.params?.tab;
    if (requested && requested !== activeTab) {
      setActiveTab(requested);
    }
    if (requested) {
      navigation.setParams({ tab: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.tab]);

  const getBookingsByTab = (): Booking[] => {
    // Drop malformed entries (no id AND no booking_number) — they show
    // up after AsyncStorage cache corruption and produce duplicate
    // FlatList keys, which can crash Hermes on some Android builds.
    return bookings.filter((booking: Booking) => {
      if (booking.id == null && booking.booking_number == null) return false;
      const status = booking.status || 'unknown';
      switch (activeTab) {
        case 'ongoing':
          return ['pending', 'assigned', 'accepted', 'documents_collected', 'submitted', 'confirmed'].includes(status);
        case 'completed':
          return status === 'completed';
        case 'cancelled':
          return status === 'cancelled';
        default:
          return false;
      }
    });
  };

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>📋</Text>
      <Text style={styles.emptyTitle}>No Bookings Found</Text>
      <Text style={styles.emptyMessage}>
        You don't have any {activeTab} bookings yet.
      </Text>
      <TouchableOpacity
        style={styles.refreshButton}
        onPress={onRefresh}
      >
        <Text style={styles.refreshButtonText}>Refresh</Text>
      </TouchableOpacity>
    </View>
  );

  // One stable press handler for every card — receives the booking,
  // so each BookingCard gets the SAME onPress reference. Combined
  // with React.memo on BookingCard, unchanged rows skip re-rendering
  // when the list refetches.
  const handleBookingPress = useCallback(
    (b: { id?: string | number; booking_number?: string | number }) => {
      navigation.navigate('BookingDetails', {
        bookingId: b.id || b.booking_number,
      });
    },
    [navigation],
  );

  const renderBookingItem = useCallback(
    ({ item }: { item: Booking }) => (
      <BookingCard booking={item} onPress={handleBookingPress} />
    ),
    [handleBookingPress],
  );

  const renderTabBar = () => (
    <View style={styles.tabBar}>
      {['ongoing', 'completed', 'cancelled', 'enquiries'].map((tab) => (
        <TouchableOpacity
          key={tab}
          style={[
            styles.tab,
            activeTab === tab && styles.activeTab,
          ]}
          onPress={() => setActiveTab(tab)}
        >
          <Text style={[
            styles.tabText,
            activeTab === tab && styles.activeTabText,
          ]}>
            {tab === 'enquiries'
              ? `B2B${enquiries.length ? ` · ${enquiries.length}` : ''}`
              : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  // ─── Enquiry (B2B) card renderer ──────────────────────────────────────────
  const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
    pending:     { bg: '#FFF8E1', color: '#F57F17', label: 'Pending review' },
    quoted:      { bg: '#E3F2FD', color: '#1565C0', label: 'Quote ready' },
    accepted:    { bg: '#E8F5E9', color: '#2E7D32', label: 'Accepted' },
    rejected:    { bg: '#FCE4E6', color: '#C62828', label: 'Rejected' },
    in_progress: { bg: '#EDE7F6', color: '#5E35B1', label: 'In progress' },
    completed:   { bg: '#E8F5E9', color: '#2E7D32', label: 'Completed' },
    cancelled:   { bg: '#F0F2F5', color: '#6C757D', label: 'Cancelled' },
  };

  const renderEnquiryItem = ({ item }: { item: Enquiry }) => {
    const s = STATUS_STYLES[item.status as string] || STATUS_STYLES.pending;
    return (
      <TouchableOpacity
        style={styles.enqCard}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('EnquiryDetails', { enquiryId: item.id })}
      >
        <View style={styles.enqTopRow}>
          <Text style={styles.enqName} numberOfLines={1}>
            {item.service?.name || 'Industrial service'}
          </Text>
          <View style={[styles.enqChip, { backgroundColor: s.bg }]}>
            <Text style={[styles.enqChipText, { color: s.color }]}>{s.label}</Text>
          </View>
        </View>
        {!!item.service?.category && (
          <Text style={styles.enqCategory} numberOfLines={1}>{item.service.category}</Text>
        )}
        <View style={styles.enqMetaRow}>
          <Text style={styles.enqMeta}>Urgency · {item.urgency || 'standard'}</Text>
          {item.status === 'quoted' && item.quote_service_fee != null && (
            <Text style={styles.enqQuote}>
              Quote: ₹{item.quote_service_fee}
              {item.quote_govt_fees ? ` + ₹${item.quote_govt_fees} govt` : ''}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderEnquiryEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>🏭</Text>
      <Text style={styles.emptyTitle}>No Enquiries Yet</Text>
      <Text style={styles.emptyMessage}>
        Industrial (B2B) services run on custom quotes. Browse industrial services and tap "Request Quote" to start.
      </Text>
      <TouchableOpacity style={styles.refreshButton} onPress={onRefresh}>
        <Text style={styles.refreshButtonText}>Refresh</Text>
      </TouchableOpacity>
    </View>
  );

  // Inline the FlatList — defining tabs as inner components inside
  // the parent (the old pattern: const OngoingTab = () => …) creates
  // a fresh component identity on every state change, which made
  // React unmount + remount the FlatList constantly. On some Android
  // devices (Samsung One UI, Xiaomi MIUI, low-RAM phones) that churn
  // crashed the app when the user tapped the Bookings tab. Inlining
  // keeps the same FlatList instance across re-renders.
  //
  // keyExtractor uses index as a last-resort fallback so two bookings
  // with the same (or null) id never produce duplicate keys — Hermes
  // throws on duplicate keys and that's a hard crash too.
  const renderContent = () => {
    if (activeTab === 'enquiries') {
      return (
        <FlatList
          data={enquiries}
          renderItem={renderEnquiryItem}
          keyExtractor={(item, index) => String(item.id ?? `enq-${index}`)}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={renderEnquiryEmptyState}
        />
      );
    }
    return (
      <FlatList
        data={getBookingsByTab()}
        renderItem={renderBookingItem}
        keyExtractor={(item, index) =>
          String(item.id ?? item.booking_number ?? `bk-${index}`)
        }
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={onRefresh} />}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmptyState}
      />
    );
  };

  if (bookingsLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.PRIMARY} />
        <Text style={styles.loadingText}>Loading your bookings...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* paddingTop from the safe-area inset so "My Bookings" never
          sits under the status bar / notch — the old hardcoded
          paddingTop: 30 was too short on tall-status-bar phones. */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.title}>My Bookings</Text>
      </View>

      {renderTabBar()}

      <View style={styles.content}>
        {renderContent()}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
  },
  header: {
    backgroundColor: COLORS.PRIMARY,
    padding: SIZES.BASE,
    paddingTop: 30,
    // Breathing room below the "My Bookings" title before the
    // header's bottom edge.
    paddingBottom: 18,
  },
  title: {
    fontSize: SIZES.XLARGE,
    fontWeight: 'bold',
    color: COLORS.WHITE,
  },
  tabBar: {
    backgroundColor: COLORS.WHITE,
    flexDirection: 'row',
    paddingHorizontal: SIZES.BASE,
    paddingVertical: SIZES.BASE / 2,
  },
  tab: {
    flex: 1,
    paddingVertical: SIZES.BASE / 2,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: COLORS.LIGHT_GRAY,
  },
  activeTab: {
    borderBottomColor: COLORS.PRIMARY,
  },
  tabText: {
    fontSize: SIZES.FONT,
    color: COLORS.GRAY,
    fontWeight: '600',
  },
  activeTabText: {
    color: COLORS.PRIMARY,
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
  },
  // ─── Enquiry (B2B) card ──────────────────────────────────────────────
  enqCard: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 12,
    padding: 12,
    borderLeftWidth: 3, borderLeftColor: '#1976D2',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 1,
  },
  enqTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  enqName: { flex: 1, fontSize: 13, fontWeight: '800', color: '#1A1A1A', marginRight: 8 },
  enqChip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  enqChipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.2 },
  enqCategory: { fontSize: 11, color: '#6C757D', marginTop: 3 },
  enqMetaRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 8,
  },
  enqMeta: { fontSize: 11, color: '#6C757D', fontWeight: '600' },
  enqQuote: { fontSize: 12, color: '#1976D2', fontWeight: '800' },
  listContainer: {
    // Clear gap between the ongoing/completed/cancelled/B2B tab row
    // and the first booking card. BookingCard uses marginBottom only,
    // so cards still stack neatly without doubled padding.
    paddingTop: SIZES.BASE * 2,
    paddingHorizontal: 0,
    paddingBottom: SIZES.BASE,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SIZES.BASE * 4,
  },
  emptyIcon: {
    fontSize: 60,
    marginBottom: SIZES.BASE,
  },
  emptyTitle: {
    fontSize: SIZES.LARGE,
    fontWeight: 'bold',
    color: COLORS.BLACK,
    marginBottom: SIZES.BASE / 2,
  },
  emptyMessage: {
    fontSize: SIZES.FONT,
    color: COLORS.GRAY,
    textAlign: 'center',
    lineHeight: SIZES.FONT * 1.5,
  },
  refreshButton: {
    backgroundColor: COLORS.PRIMARY,
    paddingHorizontal: SIZES.BASE,
    paddingVertical: SIZES.BASE / 2,
    borderRadius: BORDER_RADIUS.SMALL,
  },
  refreshButtonText: {
    color: COLORS.WHITE,
    fontSize: SIZES.SMALL,
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
});

export default MyBookingsScreen;

import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Alert,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { COLORS, SIZES, BORDER_RADIUS } from '../constants/colors';
import { getMyBookings, getMyEnquiries } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BookingCard from '../components/BookingCard';

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

const MyBookingsScreen: React.FC<Props> = ({ navigation, route }) => {
  const [activeTab, setActiveTab] = useState<string>('ongoing');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const isLoadingRef = useRef<boolean>(false);

  // Load bookings whenever the screen comes into focus
  useEffect(() => {
    const unsubscribe = navigation.addListener?.('focus', () => {
      loadBookings();
    });
    return unsubscribe;
  }, [navigation]);

  // Also refresh if coming from booking confirmation with refresh parameter
  useEffect(() => {
    if (route.params?.refresh) {
      loadBookings();
      // Reset the refresh parameter to avoid infinite loops
      navigation.setParams({ refresh: undefined });
    }
  }, [route.params?.refresh]);

  const loadBookings = async (): Promise<void> => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    try {
      setLoading(true);

      // --- 1. API bookings (primary source, has full data + service association) ---
      let apiBookings: Booking[] = [];
      try {
        const response: any = await getMyBookings();
        apiBookings = Array.isArray(response) ? response : [];
      } catch (apiError: any) {
        console.log('API unavailable, showing local bookings only:', apiError?.message);
      }

      // Build lookup: service_id → service name (from API data)
      const serviceNameByServiceId: Record<string, string> = {};
      const apiBookingIds = new Set<any>();
      apiBookings.forEach((b: Booking) => {
        apiBookingIds.add(b.id);
        if (b.service_id && b.service?.name) {
          serviceNameByServiceId[b.service_id as any] = b.service.name;
        }
      });

      // --- 2. Local bookings (my_bookings only — single source of truth) ---
      // Only include bookings not already returned by the API (recently created, not yet synced)
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
                // Fill in service_name from API data if the local copy is missing it
                service_name: b.service_name || serviceNameByServiceId[b.service_id as any] || '',
              }));
          }
        }
      } catch (error) {
        console.log('Error reading local bookings:', error);
      }

      // API bookings first (complete data), then local-only ones (recently created, not yet synced)
      setBookings([...apiBookings, ...localOnlyBookings]);

      // Enquiries run on a separate table on the backend — pull them too so
      // the Enquiries tab is always up to date alongside Bookings.
      try {
        const enqRes: any = await getMyEnquiries();
        setEnquiries(Array.isArray(enqRes?.data) ? enqRes.data : []);
      } catch (e: any) {
        console.log('Enquiries unavailable:', e?.message);
      }

    } catch (error) {
      console.error('Error loading bookings:', error);
      Alert.alert('Error', 'Failed to load bookings');
      setBookings([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
      isLoadingRef.current = false;
    }
  };

  const onRefresh = (): void => {
    setRefreshing(true);
    loadBookings();
  };

  const getBookingsByTab = (): Booking[] => {
    console.log('=== FILTERING BOOKINGS ===');
    console.log('Active tab:', activeTab);
    console.log('Total bookings:', bookings.length);

    const filteredBookings = bookings.filter((booking: Booking) => {
      const status = booking.status || 'unknown';
      console.log(`Booking ${booking.id || booking.booking_number} status: ${status}`);

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

    console.log(`Filtered ${filteredBookings.length} bookings for ${activeTab} tab`);
    console.log('======================');

    return filteredBookings;
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

  const renderBookingItem = ({ item }: { item: Booking }) => (
    <BookingCard
      booking={item}
      onPress={() => navigation.navigate('BookingDetails', { bookingId: item.id || item.booking_number })}
    />
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

  const EnquiriesTab: React.FC = () => (
    <FlatList
      data={enquiries}
      renderItem={renderEnquiryItem}
      keyExtractor={(item) => String(item.id)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      contentContainerStyle={styles.listContainer}
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={renderEnquiryEmptyState}
    />
  );

  const OngoingTab: React.FC = () => (
    <FlatList
      data={getBookingsByTab()}
      renderItem={renderBookingItem}
      keyExtractor={(item) => String(item.id || item.booking_number)}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
      contentContainerStyle={styles.listContainer}
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={renderEmptyState}
    />
  );

  const CompletedTab: React.FC = () => (
    <FlatList
      data={getBookingsByTab()}
      renderItem={renderBookingItem}
      keyExtractor={(item) => String(item.id || item.booking_number)}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
      contentContainerStyle={styles.listContainer}
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={renderEmptyState}
    />
  );

  const CancelledTab: React.FC = () => (
    <FlatList
      data={getBookingsByTab()}
      renderItem={renderBookingItem}
      keyExtractor={(item) => String(item.id || item.booking_number)}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
      contentContainerStyle={styles.listContainer}
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={renderEmptyState}
    />
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'ongoing':
        return <OngoingTab />;
      case 'completed':
        return <CompletedTab />;
      case 'cancelled':
        return <CancelledTab />;
      case 'enquiries':
        return <EnquiriesTab />;
      default:
        return <OngoingTab />;
    }
  };

  if (loading && bookings.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.PRIMARY} />
        <Text style={styles.loadingText}>Loading your bookings...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
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
    // Tiny top padding so the first card has breathing space below the
    // tab bar but isn't shifted way down. BookingCard now uses marginBottom
    // only so cards stack neatly without doubled padding.
    paddingTop: SIZES.BASE / 2,
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

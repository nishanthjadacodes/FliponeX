import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Animated,
} from 'react-native';
import { getEarnings, type EarningRecord } from '../../services/agent/api';
import { readCache, writeCache } from '../../utils/agent/cache';
import { COLORS } from '../../constants/agent/colors';
import { LinearGradient } from 'expo-linear-gradient';

type PeriodId = 'all' | 'today' | 'week' | 'month';

interface PeriodOption {
  id: PeriodId;
  label: string;
}

interface EarningsCacheValue {
  earnings: EarningRecord[];
  total: number;
  today: number;
  week: number;
}

interface NavigationLike {
  addListener: (event: string, cb: () => void) => () => void;
}

interface EarningsScreenProps {
  navigation: NavigationLike;
}

const EarningsScreen: React.FC<EarningsScreenProps> = ({ navigation }) => {
  const [earnings, setEarnings] = useState<EarningRecord[]>([]);
  const [totalEarnings, setTotalEarnings] = useState<number>(0);
  const [todayEarnings, setTodayEarnings] = useState<number>(0);
  const [weekEarnings, setWeekEarnings] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodId>('all');

  // Animation values
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const totalEarningsAnim = useRef(new Animated.Value(0)).current;
  const todayEarningsAnim = useRef(new Animated.Value(0)).current;
  const weekEarningsAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    (async () => {
      const cached = await readCache<EarningsCacheValue>('earnings');
      if (cached?.value) {
        const e = cached.value;
        setEarnings(e.earnings || []);
        setTotalEarnings(e.total || 0);
        setTodayEarnings(e.today || 0);
        setWeekEarnings(e.week || 0);
      }
      loadEarningsData();
    })();
  }, []);

  // Refresh on focus
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadEarningsData();
    });
    return unsubscribe;
  }, [navigation]);

  // Start animations when data loads
  useEffect(() => {
    if (!loading) {
      startAnimations();
    }
  }, [loading]);

  const startAnimations = (): void => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]).start();

    Animated.parallel([
      Animated.timing(totalEarningsAnim, {
        toValue: totalEarnings,
        duration: 1500,
        useNativeDriver: false,
      }),
      Animated.timing(todayEarningsAnim, {
        toValue: todayEarnings,
        duration: 1200,
        useNativeDriver: false,
      }),
      Animated.timing(weekEarningsAnim, {
        toValue: weekEarnings,
        duration: 1300,
        useNativeDriver: false,
      }),
    ]).start();
  };

  const loadEarningsData = async (): Promise<void> => {
    try {
      const response = await getEarnings();
      const earningsList = response.earnings || [];
      setEarnings(earningsList);
      setTotalEarnings(response.total || 0);
      setTodayEarnings(response.today || 0);
      setWeekEarnings(response.week || 0);
      writeCache<EarningsCacheValue>('earnings', {
        earnings: earningsList,
        total: response.total || 0,
        today: response.today || 0,
        week: response.week || 0,
      });
    } catch (error) {
      console.error('Error loading earnings:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = (): void => {
    setRefreshing(true);
    loadEarningsData();
  };

  const formatDate = (dateString?: string): string => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const getFilteredEarnings = (): EarningRecord[] => {
    const now = new Date();
    switch (selectedPeriod) {
      case 'today':
        return earnings.filter((e) => new Date(e.date).toDateString() === now.toDateString());
      case 'week': {
        const weekAgo = new Date(now.getTime() - 7 * 86400000);
        return earnings.filter((e) => new Date(e.date) >= weekAgo);
      }
      case 'month': {
        const monthAgo = new Date(now.getTime() - 30 * 86400000);
        return earnings.filter((e) => new Date(e.date) >= monthAgo);
      }
      default:
        return earnings;
    }
  };

  const filteredEarnings = getFilteredEarnings();
  // Completed-jobs count for the simplified summary card. We no
  // longer split into "paid" vs "pay-after to settle" — the rep
  // earns the same commission regardless of how the customer paid,
  // and the previous split caused confusion ("why is half my money
  // marked 'to settle'?"). Now it's just total earned + count.
  const completedJobsCount = earnings.length;

  const periods: PeriodOption[] = [
    { id: 'all', label: 'All Time' },
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This Week' },
    { id: 'month', label: 'This Month' },
  ];

  return (
    <LinearGradient colors={COLORS.bgGradient} style={styles.container}>
      <ScrollView>
        <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          {/* Stats Header — render React state DIRECTLY via plain Text.
              The previous version read `(todayEarningsAnim as any)._value`
              on Animated.Text, which froze at whatever the animation
              last targeted (the initial 0 from cache / cold start).
              Animated.Text doesn't animate text children — only style
              props — so React re-renders triggered by setTodayEarnings
              etc. never reached the displayed value. Same fix as the
              home dashboard's Today's Earnings tile. */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Earnings & Collections</Text>
            <Animated.View style={[styles.statsRow, { transform: [{ scale: scaleAnim }] }]}>
              <View style={styles.statCard}>
                <LinearGradient colors={COLORS.goldGradient} style={styles.statCardGradient}>
                  <Text style={styles.statValue}>
                    {'₹'}{Math.floor(todayEarnings)}
                  </Text>
                  <Text style={styles.statLabel}>Today</Text>
                </LinearGradient>
              </View>
              <View style={styles.statCard}>
                <LinearGradient colors={COLORS.blueGradient} style={styles.statCardGradient}>
                  <Text style={styles.statValue}>
                    {'₹'}{Math.floor(weekEarnings)}
                  </Text>
                  <Text style={styles.statLabel}>This Week</Text>
                </LinearGradient>
              </View>
              <View style={styles.statCard}>
                <LinearGradient colors={COLORS.sunset} style={styles.statCardGradient}>
                  <Text style={styles.statValue}>
                    {'₹'}{Math.floor(totalEarnings)}
                  </Text>
                  <Text style={styles.statLabel}>Total</Text>
                </LinearGradient>
              </View>
            </Animated.View>
          </View>
        </Animated.View>

        {/* Earnings Summary — simplified. Just total earned + jobs
            count. Removed the previous "Received" vs "Pay-After-Service
            To Settle" split since the rep's commission is the same
            regardless of how the customer paid, and the split misled
            reps into thinking half their money was being held back. */}
        <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.collectionCard}>
            <Text style={styles.collectionTitle}>Earnings Summary</Text>
            <View style={styles.collectionRow}>
              <Text style={styles.collectionLabel}>Completed Jobs</Text>
              <Text style={styles.collectionValue}>
                {completedJobsCount}
              </Text>
            </View>
            <View
              style={[
                styles.collectionRow,
                { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 8 },
              ]}
            >
              <Text style={[styles.collectionLabel, { fontWeight: 'bold' }]}>Total Earned</Text>
              <Text style={[styles.collectionValue, { fontWeight: 'bold', color: '#10B981' }]}>
                {'₹'}
                {totalEarnings}
              </Text>
            </View>
          </View>
        </Animated.View>

        {/* Period Filter */}
        <View style={styles.filterContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {periods.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[styles.filterChip, selectedPeriod === p.id && styles.activeChip]}
                onPress={() => setSelectedPeriod(p.id)}
              >
                <Text
                  style={[styles.filterText, selectedPeriod === p.id && styles.activeChipText]}
                >
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Earnings Ledger */}
        <ScrollView
          style={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <Text style={styles.ledgerTitle}>Earnings Ledger ({filteredEarnings.length})</Text>

          {filteredEarnings.length > 0 ? (
            filteredEarnings.map((earning) => (
              <View key={earning.id} style={styles.earningCard}>
                <View style={styles.earningHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.earningCustomer}>{earning.customerName}</Text>
                    <Text style={styles.earningService}>{earning.serviceName}</Text>
                    <Text style={styles.earningDate}>{formatDate(earning.date)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.earningAmount}>
                      {'₹'}
                      {earning.commission}
                    </Text>
                    {/* Always green "Completed" — the rep earned this
                        money the moment the task was done, regardless
                        of how the customer paid. No more "To Settle"
                        confusion. */}
                    <View style={[styles.paymentBadge, styles.completedBadge]}>
                      <Text style={[styles.paymentBadgeText, styles.completedBadgeText]}>
                        Completed
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No earnings for this period</Text>
              <Text style={styles.emptySubtext}>Complete tasks to start earning commissions</Text>
            </View>
          )}

          {/* Pay-After-Service settlement section removed — every
              completed task contributes the same commission to the
              rep's earnings regardless of how the customer paid. */}

          <View style={{ height: 20 }} />
        </ScrollView>
      </ScrollView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFBEB' },
  content: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFBEB' },
  loadingText: { fontSize: 15, color: '#475569', fontWeight: '600' },

  header: { paddingTop: 56, paddingBottom: 18, paddingHorizontal: 16 },
  headerTitle: {
    fontSize: 24, fontWeight: '900', color: '#0F172A', letterSpacing: 0.2, marginBottom: 14,
  },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1, borderRadius: 16, overflow: 'hidden',
    shadowColor: '#1E293B', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12, shadowRadius: 12, elevation: 5,
  },
  statCardGradient: { paddingVertical: 18, paddingHorizontal: 10, alignItems: 'center', borderRadius: 16 },
  statValue: {
    fontSize: 18, fontWeight: '900', color: '#FFFFFF', marginBottom: 2,
    textShadowColor: 'rgba(0,0,0,0.2)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
  statLabel: { fontSize: 11, color: 'rgba(255,255,255,0.9)', fontWeight: '700', letterSpacing: 0.4 },

  collectionCard: {
    backgroundColor: '#FFFFFF', marginHorizontal: 16, marginTop: 14, padding: 16, borderRadius: 16,
    borderWidth: 1, borderColor: '#FEF3C7',
    shadowColor: '#F4A100', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 10, elevation: 3,
  },
  collectionTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginBottom: 10, letterSpacing: 0.2 },
  collectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  collectionLabel: { fontSize: 13, color: '#475569' },
  collectionValue: { fontSize: 14, fontWeight: '700', color: '#0F172A' },

  filterContainer: { paddingVertical: 14, paddingHorizontal: 16, marginTop: 6 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', marginRight: 8,
  },
  activeChip: {
    backgroundColor: '#F4A100', borderColor: '#F4A100',
    shadowColor: '#F4A100', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 6, elevation: 3,
  },
  filterText: { fontSize: 12, color: '#475569', fontWeight: '700', letterSpacing: 0.3 },
  activeChipText: { color: '#FFFFFF' },

  list: { flex: 1, paddingHorizontal: 16 },
  ledgerTitle: {
    fontSize: 12, fontWeight: '800', color: '#475569',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10, marginTop: 6,
  },
  earningCard: {
    backgroundColor: '#FFFFFF', padding: 14, borderRadius: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#E5E7EB',
    shadowColor: '#1E293B', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 1,
  },
  earningHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  earningCustomer: { fontSize: 14, fontWeight: '700', color: '#0F172A', marginBottom: 2 },
  earningService: { fontSize: 12, color: '#475569', marginBottom: 2 },
  earningDate: { fontSize: 11, color: '#94A3B8' },
  earningAmount: { fontSize: 16, fontWeight: '900', color: '#F4A100', marginBottom: 4 },
  paymentBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  // Green "Completed" badge — every earning record is fully earned
  // regardless of payment method. Same emerald-green palette as the
  // dashboard's Recent Activity completed status, for visual
  // consistency across screens.
  completedBadge: { backgroundColor: '#D1FAE5', borderWidth: 1, borderColor: '#10B981' },
  completedBadgeText: { color: '#065F46' },
  paymentBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, color: '#065F46' },

  emptyContainer: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 14, color: '#0F172A', fontWeight: '700', marginBottom: 4 },
  emptySubtext: { fontSize: 12, color: '#64748B' },

  settleSection: {
    backgroundColor: '#FFFBEB', padding: 14, borderRadius: 14, marginTop: 16, marginBottom: 8,
    borderWidth: 1, borderColor: '#FCD34D',
  },
  settleTitle: { fontSize: 13, fontWeight: '800', color: '#92400E', marginBottom: 4, letterSpacing: 0.3 },
  settleSubtext: { fontSize: 11, color: '#B45309', marginBottom: 10 },
  settleCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#FFFFFF', padding: 10, borderRadius: 10, marginBottom: 6,
    borderWidth: 1, borderColor: '#FEF3C7',
  },
  settleTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: '#FDE68A', paddingTop: 8, marginTop: 4,
  },
  settleTotalLabel: { fontSize: 13, fontWeight: '800', color: '#92400E' },
  settleTotalValue: { fontSize: 16, fontWeight: '900', color: '#F4A100' },
});

export default EarningsScreen;

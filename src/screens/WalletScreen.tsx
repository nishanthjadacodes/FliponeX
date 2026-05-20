import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { getWalletBalance, type WalletTransaction } from '../services/api';
import { useRefetchOnFocus } from '../lib/useRefetchOnFocus';

interface WalletScreenProps {
  navigation: { goBack: () => void };
}

const WalletScreen: React.FC<WalletScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  // Wallet balance + transactions — fetched & cached by TanStack Query.
  const {
    data: wallet,
    isLoading: loading,
    isFetching: refreshing,
    refetch,
  } = useQuery({
    queryKey: ['wallet'],
    queryFn: getWalletBalance,
  });
  const balance: number = wallet?.balance || 0;
  const transactions: WalletTransaction[] = wallet?.transactions || [];

  const onRefresh = useCallback((): void => {
    refetch();
  }, [refetch]);
  useRefetchOnFocus(onRefresh);

  const formatDate = (iso: string): string => {
    try {
      return new Date(iso).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const sourceLabel = (s: string): string => {
    switch (s) {
      case 'referral_reward':
        return 'Referral Reward';
      case 'referral_signup_bonus':
        return 'Signup Bonus';
      case 'booking_redeem':
        return 'Used for Booking';
      case 'refund':
        return 'Refund';
      case 'promo':
        return 'Promo';
      case 'admin_adjustment':
        return 'Admin Adjustment';
      default:
        return s;
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#001F3F" />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <LinearGradient
          colors={['#001F3F', '#003153']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.back}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>My Wallet</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available Balance</Text>
          <Text style={styles.balanceValue}>₹{balance.toFixed(2)}</Text>
          <Text style={styles.balanceHint}>
            Use up to 50% of any booking value from your wallet credits.
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollBody}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#003153" />}
      >
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        {loading ? (
          <ActivityIndicator color="#003153" style={{ marginTop: 24 }} />
        ) : transactions.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No activity yet</Text>
            <Text style={styles.emptySub}>
              Refer friends to earn ₹50 cashback when they complete their first service.
            </Text>
          </View>
        ) : (
          transactions.map((t) => (
            <View key={t.id} style={styles.txnRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.txnSource}>{sourceLabel(t.source)}</Text>
                {!!t.description && <Text style={styles.txnDesc}>{t.description}</Text>}
                <Text style={styles.txnDate}>{formatDate(t.createdAt)}</Text>
              </View>
              <Text
                style={[
                  styles.txnAmount,
                  { color: t.type === 'credit' ? '#2E7D32' : '#C62828' },
                ]}
              >
                {t.type === 'credit' ? '+' : '−'}₹{t.amount.toFixed(2)}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F6FA' },
  header: {
    paddingHorizontal: 18,
    paddingBottom: 24,
    backgroundColor: '#001F3F',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  back: { color: '#fff', fontSize: 30, fontWeight: '300' },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.4 },
  balanceCard: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(252,211,77,0.4)',
  },
  balanceLabel: {
    color: '#FCD34D',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  balanceValue: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '900',
    marginTop: 4,
    letterSpacing: 0.3,
  },
  balanceHint: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    marginTop: 6,
  },
  scrollBody: { padding: 16, paddingBottom: 32 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#003153',
    marginBottom: 12,
    letterSpacing: 0.3,
  },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E7ECF2',
  },
  emptyTitle: { color: '#003153', fontWeight: '800', fontSize: 14, marginBottom: 4 },
  emptySub: { color: '#5C6A7A', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E7ECF2',
    marginBottom: 8,
  },
  txnSource: { color: '#003153', fontWeight: '700', fontSize: 13 },
  txnDesc: { color: '#5C6A7A', fontSize: 11, marginTop: 2 },
  txnDate: { color: '#94A3B8', fontSize: 10, marginTop: 4 },
  txnAmount: { fontWeight: '900', fontSize: 14, marginLeft: 12 },
});

export default WalletScreen;

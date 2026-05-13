// Team Tree View + Income Summary — rep-side breakdown of every direct
// downline's contribution to this rep's referral / royalty income for the
// current month. Mirrors the screenshot the product owner shared:
//   • Header strip with title
//   • Search box → filters downlines by name / referee id
//   • One vertically-stacked card per direct downline:
//       - id, name, DOJ, phone + WhatsApp action buttons
//       - Wallet "Total" + Income / Other Credits split
//       - Team Referral Income line + TDS line
//       - Tap "Details" → expands a per-booking table:
//           # | Date | Level No | Gross | TDS | Net | Desc
//
// Per-row math: TDS = Rs.10 flat per booking. Net = Gross − TDS.
// Aggregates: Total / Income = sum of all rows.net for that downline.
import { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Linking,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SIZES } from '../../constants/agent/colors';
import {
  getTeamIncomeSummary,
  type TeamIncomeSummary,
  type DownlineSummary,
} from '../../services/agent/api';

interface NavigationProp {
  goBack: () => void;
  navigate: (route: string, params?: Record<string, unknown>) => void;
}

interface Props {
  navigation: NavigationProp;
}

const formatCurrency = (n: number): string =>
  `Rs.${(Number.isFinite(n) ? n : 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatDate = (iso: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

const TeamTreeIncomeScreen: React.FC<Props> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<TeamIncomeSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>('');
  const [appliedSearch, setAppliedSearch] = useState<string>('');
  // Per-downline table-visibility map. Tapping the "Details" button on
  // a downline's wallet card flips its entry. Default is `undefined`
  // which renders as visible — so on first load every downline shows
  // its full transaction list.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const load = async (): Promise<void> => {
    setError(null);
    try {
      const res = await getTeamIncomeSummary();
      setData(res);
    } catch (e: any) {
      setError(e?.message || 'Failed to load team income.');
    }
  };

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, []);

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const visibleDownlines = useMemo<DownlineSummary[]>(() => {
    if (!data) return [];
    const q = appliedSearch.trim().toLowerCase();
    if (!q) return data.downlines;
    return data.downlines.filter((d) => {
      const refIdShort = String(d.refereeId || '').slice(0, 8).toLowerCase();
      return (
        (d.name || '').toLowerCase().includes(q) ||
        (d.mobile || '').toLowerCase().includes(q) ||
        refIdShort.includes(q) ||
        String(d.refereeId || '').toLowerCase().includes(q)
      );
    });
  }, [data, appliedSearch]);

  const callDownline = (mobile: string): void => {
    if (!mobile) {
      Alert.alert('No mobile', "This downline's mobile number isn't on file.");
      return;
    }
    Linking.openURL(`tel:${mobile}`).catch(() => {
      Alert.alert('Cannot place call', 'Your device does not support phone calls.');
    });
  };

  const whatsappDownline = (mobile: string): void => {
    if (!mobile) {
      Alert.alert('No mobile', "This downline's mobile number isn't on file.");
      return;
    }
    const phone = mobile.startsWith('+') ? mobile.replace(/\D/g, '') : `91${mobile.replace(/\D/g, '')}`;
    Linking.openURL(`whatsapp://send?phone=${phone}`).catch(() => {
      Alert.alert(
        'WhatsApp not installed',
        'Install WhatsApp from the Play Store and try again.',
      );
    });
  };

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading team income…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.headerBack}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Team Tree View & Income Summary
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />}
      >
        {/* Search */}
        <Text style={styles.searchLabel}>Search</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name, mobile, or ID"
            placeholderTextColor="#94A3B8"
            returnKeyType="search"
            onSubmitEditing={() => setAppliedSearch(search)}
          />
          <TouchableOpacity
            style={styles.searchBtn}
            onPress={() => setAppliedSearch(search)}
            activeOpacity={0.85}
          >
            <Text style={styles.searchBtnText}>Show</Text>
          </TouchableOpacity>
        </View>
        {appliedSearch.length > 0 && (
          <TouchableOpacity
            onPress={() => { setSearch(''); setAppliedSearch(''); }}
            style={styles.clearSearchPill}
          >
            <Text style={styles.clearSearchText}>Clear search ✕</Text>
          </TouchableOpacity>
        )}

        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Couldn't load team income</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Master totals strip — sum across every visible downline */}
        {data && (
          <View style={styles.masterStrip}>
            <View style={styles.masterCol}>
              <Text style={styles.masterLabel}>This Month Income</Text>
              <Text style={styles.masterValue}>{formatCurrency(data.totals.net)}</Text>
            </View>
            <View style={styles.masterDivider} />
            <View style={styles.masterCol}>
              <Text style={styles.masterLabel}>Active Downlines</Text>
              <Text style={styles.masterValue}>{data.totals.downlineCount}</Text>
            </View>
            <View style={styles.masterDivider} />
            <View style={styles.masterCol}>
              <Text style={styles.masterLabel}>TDS</Text>
              <Text style={styles.masterValue}>{formatCurrency(data.totals.tds)}</Text>
            </View>
          </View>
        )}

        {/* Downline cards */}
        {data && visibleDownlines.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>👥</Text>
            <Text style={styles.emptyTitle}>
              {appliedSearch ? 'No matches' : 'No downlines yet'}
            </Text>
            <Text style={styles.emptyBody}>
              {appliedSearch
                ? `Nothing matches "${appliedSearch}". Try a different search.`
                : 'Once you refer other representatives via your code, they\'ll appear here with a per-downline income breakdown.'}
            </Text>
          </View>
        )}

        {visibleDownlines.map((d) => {
          const id = String(d.refereeId || `dl-${d.name}`);
          const refIdShort = String(d.refereeId || '').slice(0, 8);
          const isCollapsed = !!collapsed[id];
          const toggleDetails = (): void =>
            setCollapsed((p) => ({ ...p, [id]: !p[id] }));
          return (
            <View key={id} style={styles.downlineBlock}>
              {/* ─── Identity row ──────────────────────────────────
                  Mockup layout: ID green, NAME bold uppercase, DOJ
                  subtitle, then phone + WhatsApp icons stacked under
                  the DOJ. Pull-quote styling — no card, just left-
                  aligned text. */}
              <View style={styles.identityRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.downlineId}>{refIdShort || '—'}</Text>
                  <Text style={styles.downlineName} numberOfLines={1}>
                    {(d.name || 'Pending Signup').toUpperCase()}
                  </Text>
                  <Text style={styles.downlineDoj}>
                    DOJ : {formatDate(d.doj)}
                  </Text>
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionBtnCall]}
                      onPress={() => callDownline(d.mobile)}
                      disabled={!d.mobile}
                    >
                      <Text style={styles.actionBtnIcon}>📞</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionBtnWa]}
                      onPress={() => whatsappDownline(d.mobile)}
                      disabled={!d.mobile}
                    >
                      <Text style={styles.actionBtnIcon}>💬</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* ─── Wallet + Income breakdown card (joined) ──────
                  Single card with internal dividers — matches the
                  mockup's "Total → Income/Other Credits → Team Referral
                  Income → TDS" stack. */}
              <View style={styles.walletCard}>
                {/* Total — earnings icon centered above the big amount.
                    Was 👛 (purse) which read as feminine; swapped for
                    💰 (money bag) which reads as universal "earnings". */}
                <View style={styles.walletTopBlock}>
                  <Text style={styles.walletIcon}>💰</Text>
                  <Text style={styles.walletTopLabel}>Total</Text>
                  <Text style={styles.walletTopValue}>{formatCurrency(d.totals.net)}</Text>
                </View>

                <View style={styles.cardDivider} />

                {/* Income / Other Credits tabs — Income active with red underline */}
                <View style={styles.splitRow}>
                  <View style={[styles.splitCol, styles.splitColActive]}>
                    <Text style={[styles.splitTitle, styles.splitTitleActive]}>Income</Text>
                    <Text style={[styles.splitAmount, styles.splitAmountActive]}>
                      ({formatCurrency(d.totals.net)})
                    </Text>
                  </View>
                  <View style={styles.splitCol}>
                    <Text style={styles.splitTitle}>Other Credits</Text>
                    <Text style={styles.splitAmount}>(Rs.0.00)</Text>
                  </View>
                </View>

                <View style={styles.cardDivider} />

                {/* Team Referral Income line — left-aligned label + amount,
                    optional Details on the right (kept as a no-op anchor for
                    visual parity with the mockup; the per-booking table is
                    always shown below). */}
                <View style={styles.lineRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineLabel}>Team Referral Income</Text>
                    <Text style={styles.lineValue}>{formatCurrency(d.totals.net)}</Text>
                  </View>
                  {/* Tap to collapse / expand the per-booking table below.
                      Default is expanded; tapping hides the table to keep
                      the screen short when the user is just scanning
                      summaries. */}
                  {d.rows.length > 0 && (
                    <TouchableOpacity
                      style={styles.detailsBadge}
                      onPress={toggleDetails}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.detailsBadgeText}>
                        {isCollapsed ? 'Details ▾' : 'Hide ▴'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                <View style={styles.cardDivider} />

                {/* TDS line */}
                <View style={styles.lineRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineLabel}>TDS</Text>
                    <Text style={styles.lineTdsValue}>{formatCurrency(d.totals.tds)}</Text>
                  </View>
                </View>

                {/* Calculation hint — explains the flat-TDS formula so the
                    rep can verify the math against any single row in the
                    table below: Net = Gross − Rs.10 TDS per booking. */}
                <Text style={styles.calcHint}>
                  Net = Gross − TDS · TDS = Rs.10 flat per booking
                </Text>
              </View>

              {/* ─── Per-booking details table ──────────────────
                  Seven columns: # | Date | Lvl | Gross | TDS | Net | Desc.
                  The numeric columns + Desc together exceed phone width,
                  so we wrap the whole table in a horizontal ScrollView —
                  user can swipe left to reveal the Desc text. Header and
                  body scroll together because they're inside the same
                  inner container. */}
              {d.rows.length > 0 && !isCollapsed && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator
                  style={styles.tableScroll}
                  contentContainerStyle={{ flexGrow: 1 }}
                >
                  <View style={styles.tableWrap}>
                    <View style={[styles.tableRow, styles.tableHeader]}>
                      <Text style={[styles.cellHash, styles.tableHeaderText]}>#</Text>
                      <Text style={[styles.cellDate, styles.tableHeaderText]}>Date</Text>
                      <Text style={[styles.cellLevel, styles.tableHeaderText]}>Lvl</Text>
                      <Text style={[styles.cellNum, styles.tableHeaderText]}>Gross</Text>
                      <Text style={[styles.cellNum, styles.tableHeaderText]}>TDS</Text>
                      <Text style={[styles.cellNum, styles.tableHeaderText]}>Net</Text>
                      <Text style={[styles.cellDesc, styles.tableHeaderText]}>Desc</Text>
                    </View>
                    {d.rows.map((r) => (
                      <View key={`${id}-r-${r.index}`} style={styles.tableRow}>
                        <Text style={styles.cellHash}>{r.index}</Text>
                        <Text style={styles.cellDate}>{formatDate(r.date)}</Text>
                        <Text style={styles.cellLevel}>{r.level}</Text>
                        <Text style={styles.cellNum}>{r.gross.toFixed(0)}</Text>
                        <Text style={styles.cellNum}>{r.tds.toFixed(2)}</Text>
                        <Text style={styles.cellNum}>{r.net.toFixed(2)}</Text>
                        <Text style={styles.cellDesc} numberOfLines={2}>
                          {r.desc}
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              )}

              {d.rows.length > 0 && isCollapsed && (
                <Text style={styles.collapsedHint}>
                  Tap "Details ▾" above to view all {d.rows.length} transaction{d.rows.length === 1 ? '' : 's'}.
                </Text>
              )}

              {/* Empty state per-downline if zero bookings this month */}
              {d.rows.length === 0 && (
                <View style={styles.zeroCard}>
                  <Text style={styles.zeroText}>
                    No completed bookings this month. Encourage {d.name?.split(' ')[0] || 'your downline'} to
                    take on a service so your referral income kicks in.
                  </Text>
                </View>
              )}
            </View>
          );
        })}

        <View style={{ height: 24 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F7FA' },
  loadingText: { marginTop: 12, color: COLORS.textSecondary, fontSize: SIZES.font },

  header: {
    backgroundColor: '#E63946',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    elevation: 2,
  },
  headerBack: { color: '#FFFFFF', fontSize: 30, fontWeight: '700', lineHeight: 30 },
  headerTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },

  scrollContent: { padding: 14 },

  searchLabel: { fontSize: 14, color: '#1F2937', fontWeight: '700', marginBottom: 6 },
  searchRow: { flexDirection: 'row', gap: 8 },
  searchInput: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1F2937',
  },
  searchBtn: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 22,
    borderRadius: 10,
    justifyContent: 'center',
  },
  searchBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  clearSearchPill: { alignSelf: 'flex-start', marginTop: 8 },
  clearSearchText: { color: COLORS.primary, fontWeight: '600', fontSize: 12 },

  errorCard: {
    marginTop: 12,
    padding: 14,
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#DC2626',
  },
  errorTitle: { fontSize: 14, fontWeight: '700', color: '#7F1D1D', marginBottom: 4 },
  errorBody: { fontSize: 12, color: '#7F1D1D' },
  retryBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#DC2626',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  retryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },

  masterStrip: {
    marginTop: 14,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  masterCol: { flex: 1, alignItems: 'center' },
  masterDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.18)' },
  masterLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 10, letterSpacing: 0.5, marginBottom: 2 },
  masterValue: { color: '#FCD34D', fontSize: 16, fontWeight: '800' },

  // Each downline section is a vertically-stacked block:
  //   [identity row] → [joined wallet card] → [details table]
  // Generous bottom margin so consecutive downlines read as separate
  // sections rather than one merged list.
  downlineBlock: {
    marginTop: 22,
    paddingBottom: 4,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  downlineId: { color: '#10B981', fontWeight: '800', fontSize: 15 },
  downlineName: { color: '#0F172A', fontWeight: '900', fontSize: 18, marginTop: 4 },
  downlineDoj: { color: '#64748B', fontSize: 13, marginTop: 4, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
  },
  actionBtnCall: { backgroundColor: '#1E88E5' },
  actionBtnWa: { backgroundColor: '#25D366' },
  actionBtnIcon: { fontSize: 16, color: '#FFFFFF' },

  // Single joined card holding wallet + tabs + lines, with internal
  // hairline dividers between sections — matches the mockup exactly.
  walletCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    elevation: 1,
    paddingVertical: 4,
  },
  walletTopBlock: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  walletIcon: { fontSize: 26, marginBottom: 4 },
  walletTopLabel: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  walletTopValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0F172A',
    marginTop: 4,
    letterSpacing: 0.3,
  },

  cardDivider: { height: 1, backgroundColor: '#EEF1F4', marginHorizontal: 0 },

  splitRow: {
    flexDirection: 'row',
  },
  splitCol: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  splitColActive: { borderBottomWidth: 2.5, borderBottomColor: '#E63946' },
  splitTitle: { fontSize: 14, fontWeight: '700', color: '#64748B' },
  splitTitleActive: { color: '#0F172A', fontWeight: '800' },
  splitAmount: { fontSize: 12, color: '#94A3B8', marginTop: 4 },
  splitAmountActive: { color: '#E63946', fontWeight: '700' },

  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  lineLabel: { fontSize: 12, color: '#64748B', marginBottom: 4, letterSpacing: 0.2 },
  lineValue: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  lineTdsValue: { fontSize: 15, fontWeight: '800', color: '#DC2626' },
  detailsBadge: {
    borderWidth: 1.5,
    borderColor: '#10B981',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  detailsBadgeText: { color: '#10B981', fontWeight: '700', fontSize: 12 },

  // Math hint below the breakdown — shows the upline how the net was
  // computed (otherwise 2% looks suspiciously small). Subtle gray text,
  // not a heavy disclaimer.
  calcHint: {
    fontSize: 11,
    color: '#94A3B8',
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 4,
    fontStyle: 'italic',
    lineHeight: 16,
  },

  // Per-booking table — wrapped in a horizontal ScrollView because the
  // 7th "Desc" column pushes total width past phone width. Numeric cells
  // are fixed widths, Desc is wide enough for the longest description.
  tableScroll: {
    marginTop: 10,
  },
  tableWrap: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    alignItems: 'center',
  },
  tableHeader: { backgroundColor: '#F8FAFC' },
  tableHeaderText: { fontWeight: '800', color: '#0F172A', fontSize: 11 },
  cellHash: { width: 28, fontSize: 12, color: '#1F2937', fontWeight: '600' },
  cellDate: { width: 78, fontSize: 12, color: '#1F2937' },
  cellLevel: { width: 34, fontSize: 12, color: '#1F2937', textAlign: 'center' },
  cellNum: { width: 60, fontSize: 12, color: '#1F2937', textAlign: 'right', paddingRight: 4 },
  cellDesc: {
    width: 220,
    fontSize: 11,
    color: '#475569',
    paddingLeft: 8,
    lineHeight: 14,
  },
  collapsedHint: {
    marginTop: 10,
    fontSize: 12,
    color: '#94A3B8',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 8,
  },

  // Per-downline empty state — month with zero completions
  zeroCard: {
    marginTop: 10,
    padding: 14,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    borderRadius: 10,
  },
  zeroText: {
    fontSize: 12,
    color: '#9A3412',
    lineHeight: 18,
  },

  emptyCard: {
    marginTop: 24,
    padding: 24,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  emptyIcon: { fontSize: 42, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#0F172A', marginBottom: 6 },
  emptyBody: { fontSize: 13, color: '#64748B', textAlign: 'center', lineHeight: 18 },
});

export default TeamTreeIncomeScreen;

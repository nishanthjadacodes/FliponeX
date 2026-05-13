import { useState, useEffect, useRef, type ReactNode } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Share,
  RefreshControl,
  Animated,
  Easing,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  getReferrals,
  trackReferralClick,
  getReferralStats,
  backfillReferralRewards,
  type ReferralResponse,
  type ReferralStats,
} from '../../services/agent/api';
import { COLORS, SIZES } from '../../constants/agent/colors';

type ReferralStatus = 'completed' | 'pending' | 'expired' | string;

interface ReferralPerson {
  id: string;
  name: string;
  mobile?: string;
  signupDate?: string;
  status: ReferralStatus;
  isActive?: boolean;
  reward?: number;
  rewardDate?: string;
  expiryDate?: string;
  children?: ReferralPerson[];
}

interface MilestoneInfo {
  achieved?: boolean;
}

interface RoyaltyInfo {
  currentMonthRoyalty?: number;
  lastMonthRoyalty?: number;
  totalTeamBusiness?: number;
  qualifyingTeamBusiness?: number;
  lastMonthTeamBusiness?: number;
  lastMonthQualifyingBusiness?: number;
  activeMentees?: number;
  personalTasksCompleted?: number;
  lastMonthPersonalTasksCompleted?: number;
  qualityScore?: number;
  priorityUser?: boolean;
}

interface ReferralData extends ReferralResponse {
  activeReferrals?: number;
  inactiveReferrals?: number;
  referrals: ReferralPerson[];
  milestones: {
    bronze?: MilestoneInfo;
    silver?: MilestoneInfo;
    gold?: MilestoneInfo;
    [key: string]: unknown;
  };
  royalty: RoyaltyInfo & Record<string, unknown>;
}

interface TabDef {
  id: string;
  label: string;
  render: () => ReactNode;
}

type ShareType = 'whatsapp' | 'general' | string;

const ReferralScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [referralData, setReferralData] = useState<ReferralData | null>(null);
  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
  const [, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const [syncingRewards, setSyncingRewards] = useState<boolean>(false);

  // Animated counter for the "Current Month Royalty (Est.)" headline. We
  // tween from 0 → server-provided value whenever the data refreshes so
  // the user sees the figure tick up — matches the live-counter UX the
  // policy view calls for.
  const royaltyAnim = useRef(new Animated.Value(0)).current;
  const [animatedRoyalty, setAnimatedRoyalty] = useState<number>(0);
  useEffect(() => {
    const id = royaltyAnim.addListener(({ value }) => {
      setAnimatedRoyalty(Math.round(value));
    });
    return () => royaltyAnim.removeListener(id);
  }, [royaltyAnim]);

  useEffect(() => {
    loadReferralData();
  }, []);

  // Live refresh — while the user is sitting on the Royalty tab we re-fetch
  // every 30s so the headline counter reflects new completed bookings as
  // they land. Cleanup on tab switch / unmount.
  useEffect(() => {
    if (activeTab !== 'royalty') return;
    const interval = setInterval(() => {
      loadReferralData();
    }, 30 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const loadReferralData = async (): Promise<void> => {
    setLoading(true);
    try {
      const [referralResponse, statsResponse] = await Promise.all([
        getReferrals(),
        getReferralStats(),
      ]);

      const next = referralResponse as ReferralData;
      setReferralData(next);
      setReferralStats(statsResponse);
      setLastRefreshAt(new Date());

      // Tween the headline counter from its previous value to the new one.
      // 800ms is short enough to feel responsive; longer feels laggy on
      // back-to-back polls (every 30s while the tab is open).
      const target = Number(next?.royalty?.currentMonthRoyalty || 0);
      Animated.timing(royaltyAnim, {
        toValue: target,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false, // we read the animated value via listener
      }).start();

      // If the user already has referrals, jump straight to the network/list
      // tab the first time the screen loads. Otherwise stay on Overview so
      // they see the share-code CTA. Don't override an explicit tab choice.
      const list = next?.referrals;
      if (Array.isArray(list) && list.length > 0 && activeTab === 'overview') {
        setActiveTab('referrals');
      }
    } catch (error) {
      console.error('Error loading referral data:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    await loadReferralData();
    setRefreshing(false);
  };

  const handleSyncRewards = async (): Promise<void> => {
    if (syncingRewards) return;
    setSyncingRewards(true);
    try {
      const res = await backfillReferralRewards();
      if (res?.success) {
        const credited = res?.credited || 0;
        const total = res?.totalAmount || 0;
        Alert.alert(
          credited > 0 ? 'Rewards synced' : 'Nothing to sync',
          credited > 0
            ? `Credited Rs.${total} across ${credited} previously-missed referral${credited === 1 ? '' : 's'}.`
            : res?.message || 'No referrals were eligible — your downlines haven\'t completed a paid service yet.',
          [{ text: 'OK', onPress: () => loadReferralData() }],
        );
      } else {
        Alert.alert('Sync failed', res?.message || 'Try again in a moment.');
      }
    } catch (e: any) {
      Alert.alert('Sync failed', e?.message || 'Network error');
    } finally {
      setSyncingRewards(false);
    }
  };

  const handleShareReferral = async (type: ShareType = 'general'): Promise<void> => {
    try {
      const message =
        type === 'whatsapp'
          ? `Help a friend save time! I'm using FlipOneX and it's amazing. Use my code ${referralData?.referralCode} to get *Rs.20 discount* on your first service. Download now: ${referralData?.referralLink}`
          : `Help a friend save time! Refer FlipOneX and earn Rs.20 for every friend who books their first service. Use my code: ${referralData?.referralCode}\n\nDownload: ${referralData?.referralLink}`;

      await Share.share({
        message,
        title: 'FlipOneX Referral',
      });

      if (referralData?.referralCode) {
        await trackReferralClick(referralData.referralCode, type);
      }
    } catch (error) {
      console.error('Error sharing referral:', error);
    }
  };

  const handleCopyCode = async (): Promise<void> => {
    await Clipboard.setStringAsync(referralData?.referralCode || '');
    Alert.alert('Copied', `Code ${referralData?.referralCode} copied to clipboard!`);
  };

  const handleCopyLink = async (): Promise<void> => {
    await Clipboard.setStringAsync(referralData?.referralLink || '');
    Alert.alert('Copied', 'Referral link copied to clipboard!');
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const getStatusColor = (status: ReferralStatus): string => {
    switch (status) {
      case 'completed':
        return COLORS.success;
      case 'pending':
        return COLORS.warning;
      case 'expired':
        return COLORS.error;
      default:
        return COLORS.gray;
    }
  };

  const getStatusText = (status: ReferralStatus): string => {
    switch (status) {
      case 'completed':
        return 'Completed';
      case 'pending':
        return 'Pending First Service';
      case 'expired':
        return 'Expired';
      default:
        return String(status);
    }
  };

  const renderOverviewTab = (): ReactNode => (
    <ScrollView style={styles.tabContent}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Your Referral Code</Text>
        <View style={styles.referralCodeContainer}>
          {/* Compact, single-line, auto-fit. Long server codes used to
              wrap and dominate the card; numberOfLines + adjustsFontSizeToFit
              keep them on one line and shrink to fit. We never truncate
              the displayed string because Copy / Share / WhatsApp all use
              the same value — display and clipboard must match. */}
          <Text
            style={styles.referralCode}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.55}
            ellipsizeMode="middle"
          >
            {referralData?.referralCode || 'FLIPON2026'}
          </Text>
          <TouchableOpacity style={styles.copyButton} onPress={handleCopyCode}>
            <Text style={styles.copyButtonText}>Copy</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.referralLink}>
          {referralData?.referralLink || 'https://flipon.app/referral/FLIPON2026'}
        </Text>
        <TouchableOpacity style={styles.copyButton} onPress={handleCopyLink}>
          <Text style={styles.copyButtonText}>Copy Link</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Share & Earn</Text>
        <Text style={styles.cardDescription}>
          Help a friend save time! Refer FlipOneX and earn Rs.20 for every friend who books their
          first service.
        </Text>
        <View style={styles.shareButtons}>
          <TouchableOpacity
            style={[styles.shareButton, styles.whatsappButton]}
            onPress={() => handleShareReferral('whatsapp')}
          >
            <Text style={styles.shareButtonText}>Send Invite on WhatsApp</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.shareButton, styles.generalButton]}
            onPress={() => handleShareReferral('general')}
          >
            <Text style={styles.shareButtonText}>Share via Other Apps</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.disclaimer}>
          Terms apply. Referral bonus credited after friend's first completed service.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Earnings Overview</Text>
        <View style={styles.earningsGrid}>
          <View style={styles.earningItem}>
            <Text style={styles.earningValue}>Rs.{referralData?.totalEarned || 0}</Text>
            <Text style={styles.earningLabel}>Total Earned</Text>
          </View>
          <View style={styles.earningItem}>
            <Text style={styles.earningValue}>Rs.{referralData?.availableCredits || 0}</Text>
            <Text style={styles.earningLabel}>Available Credits</Text>
          </View>
          <View style={styles.earningItem}>
            <Text style={styles.earningValue}>Rs.{referralData?.usedCredits || 0}</Text>
            <Text style={styles.earningLabel}>Used Credits</Text>
          </View>
        </View>

        {/* One-tap sync — credits any referral rewards that should have
            fired but didn't (legacy completions from before the agent-side
            trigger landed). Idempotent on the backend, so tapping more
            than once is safe. */}
        <TouchableOpacity
          style={styles.syncButton}
          disabled={syncingRewards}
          onPress={handleSyncRewards}
          activeOpacity={0.85}
        >
          <Text style={styles.syncButtonText}>
            {syncingRewards ? 'Syncing…' : '🔄 Sync missed rewards'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.syncHint}>
          Tap if a downline completed a job but your credit didn't appear.
        </Text>

        {/* Open the per-downline income breakdown screen. Lives outside the
            tab navigator so the user can dive in/out without losing the
            referral context. */}
        <TouchableOpacity
          style={styles.teamTreeButton}
          onPress={() => navigation.navigate('TeamTreeIncome')}
          activeOpacity={0.85}
        >
          <Text style={styles.teamTreeButtonText}>
            🌳 Team Tree View & Income Summary
          </Text>
        </TouchableOpacity>
        <Text style={styles.syncHint}>
          See per-downline this-month income, with date / level / gross / TDS / net details.
        </Text>
      </View>

      {referralStats && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Referral Statistics</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{referralData?.totalReferrals || 0}</Text>
              <Text style={styles.statLabel}>Total Referrals</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{referralData?.successfulReferrals || 0}</Text>
              <Text style={styles.statLabel}>Successful</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{referralStats?.conversionRate || 0}%</Text>
              <Text style={styles.statLabel}>Conversion Rate</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{referralStats?.monthlyReferrals || 0}</Text>
              <Text style={styles.statLabel}>This Month</Text>
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  );

  const renderReferralsTab = (): ReactNode => {
    const list: ReferralPerson[] = referralData?.referrals || [];
    const active = list.filter((r) => r.isActive);
    const inactive = list.filter((r) => !r.isActive);
    const activeCount = referralData?.activeReferrals ?? active.length;
    const inactiveCount = referralData?.inactiveReferrals ?? inactive.length;

    const renderReferralRow = (referral: ReferralPerson, level: number = 0): ReactNode => (
      <View
        key={`${level}-${referral.id}`}
        style={[styles.networkRow, level > 0 && styles.networkChild]}
      >
        {level > 0 && <View style={styles.networkBranch} />}
        <View
          style={[
            styles.networkAvatar,
            referral.isActive ? styles.networkAvatarActive : styles.networkAvatarInactive,
          ]}
        >
          <Text style={styles.networkAvatarText}>{(referral.name || 'P')[0].toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.networkName}>{referral.name}</Text>
          {!!referral.mobile && <Text style={styles.networkMobile}>{referral.mobile}</Text>}
          {!!referral.signupDate && (
            <Text style={styles.networkDate}>Joined {formatDate(referral.signupDate)}</Text>
          )}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: getStatusColor(referral.status), marginBottom: 4 },
            ]}
          >
            <Text style={styles.statusText}>{getStatusText(referral.status)}</Text>
          </View>
          <View
            style={[
              styles.activityBadge,
              referral.isActive ? styles.activityBadgeActive : styles.activityBadgeInactive,
            ]}
          >
            <Text
              style={[
                styles.activityBadgeText,
                referral.isActive ? styles.activityBadgeTextActive : styles.activityBadgeTextInactive,
              ]}
            >
              {referral.isActive ? 'Active' : 'Inactive'}
            </Text>
          </View>
        </View>
      </View>
    );

    return (
      <ScrollView style={styles.tabContent}>
        <Text style={styles.sectionTitle}>My Network</Text>

        <View style={styles.networkSummary}>
          <View style={[styles.summaryChip, styles.summaryChipActive]}>
            <Text style={styles.summaryChipValue}>{activeCount}</Text>
            <Text style={styles.summaryChipLabel}>Active</Text>
          </View>
          <View style={[styles.summaryChip, styles.summaryChipInactive]}>
            <Text style={styles.summaryChipValue}>{inactiveCount}</Text>
            <Text style={styles.summaryChipLabel}>Inactive</Text>
          </View>
          <View style={[styles.summaryChip, styles.summaryChipTotal]}>
            <Text style={styles.summaryChipValue}>{list.length}</Text>
            <Text style={styles.summaryChipLabel}>Total</Text>
          </View>
        </View>

        {list.length === 0 ? (
          <View style={styles.emptyNetwork}>
            <Text style={styles.emptyNetworkTitle}>No referrals yet</Text>
            <Text style={styles.emptyNetworkSub}>
              Share your referral code from the Overview tab to start building your network.
            </Text>
          </View>
        ) : (
          <>
            {active.length > 0 && (
              <View style={styles.networkGroup}>
                <Text style={styles.networkGroupTitle}>{'●'} Active ({active.length})</Text>
                {active.map((referral) => (
                  <View key={referral.id} style={styles.networkBranchWrap}>
                    {renderReferralRow(referral, 0)}
                    {referral.children && referral.children.length > 0 && (
                      <View style={styles.networkChildren}>
                        {referral.children.map((child) => renderReferralRow(child, 1))}
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}

            {inactive.length > 0 && (
              <View style={styles.networkGroup}>
                <Text style={[styles.networkGroupTitle, { color: COLORS.textSecondary }]}>
                  {'○'} Inactive ({inactive.length})
                </Text>
                {inactive.map((referral) => (
                  <View key={referral.id} style={styles.networkBranchWrap}>
                    {renderReferralRow(referral, 0)}
                    {referral.children && referral.children.length > 0 && (
                      <View style={styles.networkChildren}>
                        {referral.children.map((child) => renderReferralRow(child, 1))}
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {list.filter((r) => r.status === 'completed').length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Rewards Earned</Text>
            {list
              .filter((r) => r.status === 'completed')
              .map((referral) => (
                <View key={`reward-${referral.id}`} style={styles.referralReward}>
                  <Text style={styles.rewardAmount}>
                    Rs.{referral.reward} — {referral.name}
                  </Text>
                  {!!referral.rewardDate && (
                    <Text style={styles.rewardDate}>Earned: {formatDate(referral.rewardDate)}</Text>
                  )}
                  {!!referral.expiryDate && (
                    <Text style={styles.expiryDate}>Expires: {formatDate(referral.expiryDate)}</Text>
                  )}
                </View>
              ))}
          </View>
        )}
      </ScrollView>
    );
  };

  const renderMilestonesTab = (): ReactNode => {
    const successful = referralData?.successfulReferrals || 0;
    return (
      <ScrollView style={styles.tabContent}>
        <Text style={styles.sectionTitle}>Milestone Rewards</Text>

        <View style={styles.milestoneCard}>
          <View
            style={[
              styles.milestoneHeader,
              referralData?.milestones?.bronze?.achieved && styles.achievedHeader,
            ]}
          >
            <View style={styles.milestoneInfo}>
              <Text style={styles.milestoneTitle}>Bronze Super Referrer</Text>
              <Text style={styles.milestoneRequirement}>5 Successful Referrals</Text>
            </View>
            <View style={styles.milestoneReward}>
              <Text style={styles.rewardAmount}>Rs.50 Bonus</Text>
              {referralData?.milestones?.bronze?.achieved && (
                <Text style={styles.achievedText}>Achieved! {'✓'}</Text>
              )}
            </View>
          </View>
          <Text style={styles.milestoneDescription}>
            Refer 5 friends who complete their first service and earn an extra Rs.50 bonus!
          </Text>
        </View>

        <View style={styles.milestoneCard}>
          <View
            style={[
              styles.milestoneHeader,
              referralData?.milestones?.silver?.achieved && styles.achievedHeader,
            ]}
          >
            <View style={styles.milestoneInfo}>
              <Text style={styles.milestoneTitle}>Silver Super Referrer</Text>
              <Text style={styles.milestoneRequirement}>10 Successful Referrals</Text>
            </View>
            <View style={styles.milestoneReward}>
              <Text style={styles.rewardAmount}>Rs.150 Bonus</Text>
              {referralData?.milestones?.silver?.achieved && (
                <Text style={styles.achievedText}>Achieved! {'✓'}</Text>
              )}
            </View>
          </View>
          <Text style={styles.milestoneDescription}>
            Reach 10 successful referrals and unlock the Rs.150 Silver bonus!
          </Text>
        </View>

        <View style={styles.milestoneCard}>
          <View
            style={[
              styles.milestoneHeader,
              referralData?.milestones?.gold?.achieved && styles.achievedHeader,
            ]}
          >
            <View style={styles.milestoneInfo}>
              <Text style={styles.milestoneTitle}>Gold Star Super Referrer</Text>
              <Text style={styles.milestoneRequirement}>25 Successful Referrals</Text>
            </View>
            <View style={styles.milestoneReward}>
              <Text style={styles.rewardAmount}>Rs.500 Bonus</Text>
              <Text style={styles.rewardStatus}>Priority User Status</Text>
              {referralData?.milestones?.gold?.achieved && (
                <Text style={styles.achievedText}>Achieved! {'✓'}</Text>
              )}
            </View>
          </View>
          <Text style={styles.milestoneDescription}>
            Become a Gold Star referrer with 25 successful referrals and earn Rs.500 plus Priority
            User status!
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Current Progress</Text>
          <Text style={styles.progressText}>
            You have {successful} successful referrals.
            {successful < 5 && ` Need ${5 - successful} more for Bronze milestone.`}
            {successful >= 5 &&
              successful < 10 &&
              ` Need ${10 - successful} more for Silver milestone.`}
            {successful >= 10 &&
              successful < 25 &&
              ` Need ${25 - successful} more for Gold milestone.`}
            {successful >= 25 && ` Congratulations! You've achieved all milestones!`}
          </Text>
        </View>
      </ScrollView>
    );
  };

  const renderRoyaltyTab = (): ReactNode => {
    const r: RoyaltyInfo = referralData?.royalty || {};
    const noTeamYet = (referralData?.referrals?.length || 0) === 0;
    const teamBusiness = r.totalTeamBusiness || 0;
    const qualifyingBusiness = r.qualifyingTeamBusiness || 0;
    const activeMentees = r.activeMentees || 0;
    const personalTasks = r.personalTasksCompleted || 0;
    const qualityScore = r.qualityScore || 0;

    // Format the "as of HH:MM" line under the live counter so the user
    // can tell when the figure was last refreshed (and that polling is on).
    const refreshedLabel = lastRefreshAt
      ? lastRefreshAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      : '—';

    return (
      <ScrollView style={styles.tabContent}>
        <Text style={styles.sectionTitle}>2% Royalty Tracker</Text>

        {noTeamYet && (
          <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: COLORS.warning }]}>
            <Text style={styles.cardTitle}>No team yet</Text>
            <Text style={styles.cardDescription}>
              Royalty is paid as 2% of your downline representatives' completed business each month. Refer
              other representatives using your code (Overview tab) to start earning.
            </Text>
          </View>
        )}

        {/* Headline KPI trio per spec — Total Team Business, Active
            Mentees, Current Month Royalty (Est.). The royalty value
            tweens from 0 → live total whenever data refreshes (every 30s
            while this tab is open) so it reads as a live counter. */}
        <View style={styles.kpiCard}>
          <View style={styles.kpiHeader}>
            <Text style={styles.kpiHeaderTitle}>Live Royalty Tracker</Text>
            <View style={styles.liveDot}>
              <View style={styles.liveDotPulse} />
              <Text style={styles.liveDotText}>LIVE</Text>
            </View>
          </View>

          <Text style={styles.kpiBigValue}>
            {'Rs.'}
            {animatedRoyalty.toLocaleString('en-IN')}
          </Text>
          <Text style={styles.kpiBigLabel}>Current Month Royalty (Est.)</Text>
          <Text style={styles.kpiCaption}>
            Based on the 2% rule · As of {refreshedLabel}
          </Text>

          <View style={styles.kpiSplit}>
            <View style={styles.kpiSplitItem}>
              <Text style={styles.kpiSplitValue}>
                {'Rs.'}
                {teamBusiness.toLocaleString('en-IN')}
              </Text>
              <Text style={styles.kpiSplitLabel}>Total Team Business</Text>
              {qualifyingBusiness !== teamBusiness && qualifyingBusiness > 0 && (
                <Text style={styles.kpiSplitHint}>
                  {'Rs.'}
                  {qualifyingBusiness.toLocaleString('en-IN')} qualifying
                </Text>
              )}
            </View>
            <View style={styles.kpiSplitDivider} />
            <View style={styles.kpiSplitItem}>
              <Text style={styles.kpiSplitValue}>{activeMentees}</Text>
              <Text style={styles.kpiSplitLabel}>Active Mentees</Text>
              <Text style={styles.kpiSplitHint}>
                completed ≥1 task this month
              </Text>
            </View>
          </View>
        </View>

        {/* Last month + current snapshot, kept for context but no longer
            the headline. Useful for comparing month-over-month. */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Period Snapshot</Text>
          <View style={styles.royaltyGrid}>
            <View style={styles.royaltyItem}>
              <Text style={styles.royaltyValue}>Rs.{r.currentMonthRoyalty || 0}</Text>
              <Text style={styles.royaltyLabel}>This Month Royalty</Text>
            </View>
            <View style={styles.royaltyItem}>
              <Text style={styles.royaltyValue}>Rs.{r.lastMonthRoyalty || 0}</Text>
              <Text style={styles.royaltyLabel}>Last Month Royalty</Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Royalty Requirements</Text>
          <View style={styles.requirementItem}>
            <Text style={styles.requirementText}>Personal Activity: {personalTasks}/5 tasks</Text>
            <Text
              style={[
                styles.requirementStatus,
                personalTasks >= 5 ? styles.met : styles.notMet,
              ]}
            >
              {personalTasks >= 5 ? 'Met' : 'Not Met'}
            </Text>
          </View>
          <View style={styles.requirementItem}>
            <Text style={styles.requirementText}>
              Per-Downline Floor: Rs.5,000/month each
            </Text>
            <Text
              style={[
                styles.requirementStatus,
                qualifyingBusiness > 0 ? styles.met : styles.notMet,
              ]}
            >
              {qualifyingBusiness > 0 ? 'Met' : 'Not Met'}
            </Text>
          </View>
          <View style={styles.requirementItem}>
            <Text style={styles.requirementText}>Quality Score: {qualityScore}/5.0</Text>
            <Text
              style={[
                styles.requirementStatus,
                qualityScore >= 3.5 ? styles.met : styles.notMet,
              ]}
            >
              {qualityScore >= 3.5 ? 'Met' : 'Not Met'}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Royalty Calculation</Text>
          <Text style={styles.calculationText}>
            Qualifying Business: Rs.{qualifyingBusiness.toLocaleString('en-IN')} × 2% = Rs.
            {r.currentMonthRoyalty || 0}
          </Text>
          <Text style={styles.payoutInfo}>Payout Cycle: Monthly (by 5th of next month)</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Terms & Governance</Text>
          <Text style={styles.termsText}>
            {'•'} Quality Assurance: Royalty suspended if average rating falls below 3.5 stars
            {'\n'}
            {'•'} Anti-Poaching Rule: Strictly prohibited to shift representatives between
            teams{'\n'}
            {'•'} No Self-Referral: Multiple accounts for self-referral will result in
            termination{'\n'}
            {'•'} Passive Income: Build long-term wealth by mentoring high-performing teams
          </Text>
        </View>
      </ScrollView>
    );
  };

  const renderTermsTab = (): ReactNode => (
    <ScrollView style={styles.tabContent}>
      <Text style={styles.sectionTitle}>Referral Program Terms</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>The Referral Offer</Text>
        <Text style={styles.termsText}>
          <Text style={styles.termsHighlight}>For the Referrer:</Text> Earn Rs.20 Credits for every
          successful referral.{'\n\n'}
          <Text style={styles.termsHighlight}>For the Referee:</Text> Get Rs.20 Discount on their
          first service booking.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>How it Works</Text>
        <Text style={styles.termsText}>
          <Text style={styles.termsStep}>1. Invite:</Text> Share your unique Referral Code/Link
          from the FlipOneX App.{'\n\n'}
          <Text style={styles.termsStep}>2. Sign-up:</Text> Your friend downloads the app and signs
          up using your code.{'\n\n'}
          <Text style={styles.termsStep}>3. Completion:</Text> Your friend completes their first
          service (minimum booking value: Rs.99).{'\n\n'}
          <Text style={styles.termsStep}>4. Reward:</Text> Once the service is marked "Completed,"
          the rewards are instantly credited to both wallets.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Reward Redemption Rules</Text>
        <Text style={styles.termsText}>
          <Text style={styles.termsHighlight}>Wallet Use:</Text> Referral credits can be used to
          pay for any service on the FlipOneX App.{'\n\n'}
          <Text style={styles.termsHighlight}>Usage Limit:</Text> A maximum of 50% of the service
          value can be paid using referral credits per booking (e.g., if the service is Rs.100, you
          can use Rs.50 from credits and pay Rs.50 via cash/UPI).{'\n\n'}
          <Text style={styles.termsHighlight}>Validity:</Text> Referral credits are valid for 90
          days from the date of credit.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Terms & Conditions</Text>
        <Text style={styles.termsText}>
          <Text style={styles.termsHighlight}>Successful Referral:</Text> A referral is considered
          "Successful" only after the new user completes their first paid service. Cancellations do
          not count.{'\n\n'}
          <Text style={styles.termsHighlight}>New Users Only:</Text> The referee must be a
          first-time user of FlipOneX with a unique mobile number and device.{'\n\n'}
          <Text style={styles.termsHighlight}>No Self-Referral:</Text> Users are prohibited from
          creating multiple accounts to refer themselves.{'\n\n'}
          <Text style={styles.termsHighlight}>Modification:</Text> FlipOneX reserves the right to
          change the reward amount or terminate the referral program at any time without prior
          notice.
        </Text>
      </View>
    </ScrollView>
  );

  const tabs: TabDef[] = [
    { id: 'overview', label: 'Overview', render: renderOverviewTab },
    { id: 'referrals', label: 'Referrals', render: renderReferralsTab },
    { id: 'milestones', label: 'Milestones', render: renderMilestonesTab },
    { id: 'royalty', label: 'Royalty', render: renderRoyaltyTab },
    { id: 'terms', label: 'Terms', render: renderTermsTab },
  ];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + SIZES.padding }]}>
        <Text style={styles.headerTitle}>Referral Program</Text>
      </View>

      <View style={styles.tabContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, activeTab === tab.id && styles.activeTab]}
              onPress={() => setActiveTab(tab.id)}
            >
              <Text style={[styles.tabText, activeTab === tab.id && styles.activeTabText]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        style={styles.content}
      >
        {tabs.find((tab) => tab.id === activeTab)?.render()}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: SIZES.font, color: COLORS.textSecondary },
  header: {
    backgroundColor: COLORS.white,
    padding: SIZES.padding,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: { fontSize: SIZES.h2, fontWeight: 'bold', color: COLORS.text },
  tabContainer: {
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tab: {
    paddingHorizontal: SIZES.padding,
    paddingVertical: SIZES.base,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: { borderBottomColor: COLORS.primary },
  tabText: { fontSize: SIZES.font, color: COLORS.textSecondary },
  activeTabText: { color: COLORS.primary, fontWeight: '600' },
  content: { flex: 1 },
  tabContent: { flex: 1, padding: SIZES.padding },
  sectionTitle: {
    fontSize: SIZES.h3,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: SIZES.padding,
  },
  card: {
    backgroundColor: COLORS.white,
    padding: SIZES.padding,
    borderRadius: SIZES.radius,
    // Cards stacked back-to-back used base (8) which felt cramped — bump
    // to padding (16) so each card reads as its own block on long
    // sections like Terms / Royalty Governance.
    marginBottom: SIZES.padding - 4,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: SIZES.h3,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: SIZES.base + 4,
  },
  cardDescription: {
    fontSize: SIZES.font,
    color: COLORS.textSecondary,
    marginBottom: SIZES.padding,
    // Comfortable reading line-height (~1.55× font size). Previously set
    // to base*1.5 = 12px which was smaller than the font itself, jamming
    // wrapped lines together.
    lineHeight: 22,
  },
  referralCodeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.lightGray,
    padding: SIZES.padding,
    borderRadius: SIZES.radius,
    marginBottom: SIZES.base,
  },
  referralCode: {
    fontSize: SIZES.h2,
    fontWeight: 'bold',
    color: COLORS.primary,
    flex: 1,
    marginRight: SIZES.base,
    // Wider letter-spacing reads as a typed code, not a word, so even
    // shortened to fit it doesn't get mistaken for a generic label.
    letterSpacing: 0.5,
  },
  copyButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SIZES.padding,
    paddingVertical: SIZES.base / 2,
    borderRadius: SIZES.radius / 2,
  },
  copyButtonText: { color: COLORS.white, fontSize: SIZES.font, fontWeight: '600' },
  referralLink: { fontSize: SIZES.h6, color: COLORS.textSecondary, marginBottom: SIZES.base },
  // Slightly larger gap between the WhatsApp + General share buttons so
  // they don't read as one merged block.
  shareButtons: { gap: SIZES.base + 4 },
  shareButton: { padding: SIZES.padding, borderRadius: SIZES.radius, alignItems: 'center' },
  whatsappButton: { backgroundColor: '#25D366' },
  generalButton: { backgroundColor: COLORS.primary },
  shareButtonText: { color: COLORS.white, fontSize: SIZES.font, fontWeight: '600' },
  disclaimer: {
    fontSize: SIZES.h6,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    marginTop: SIZES.base + 4,
    lineHeight: 18,
  },
  earningsGrid: { flexDirection: 'row', gap: SIZES.base },
  earningItem: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: COLORS.background,
    padding: SIZES.padding,
    borderRadius: SIZES.radius,
  },
  earningValue: {
    fontSize: SIZES.h2,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: SIZES.base / 2,
  },
  earningLabel: { fontSize: SIZES.h6, color: COLORS.textSecondary, textAlign: 'center' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SIZES.base },
  statItem: {
    width: '48%',
    backgroundColor: COLORS.background,
    padding: SIZES.padding,
    borderRadius: SIZES.radius,
    alignItems: 'center',
  },
  statValue: {
    fontSize: SIZES.h2,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: SIZES.base / 2,
  },
  statLabel: { fontSize: SIZES.h6, color: COLORS.textSecondary, textAlign: 'center' },
  referralCard: {
    backgroundColor: COLORS.white,
    padding: SIZES.padding,
    borderRadius: SIZES.radius,
    marginBottom: SIZES.base,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  referralHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SIZES.base,
  },
  referralInfo: { flex: 1 },
  referralName: {
    fontSize: SIZES.font,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: SIZES.base / 4,
  },
  referralMobile: {
    fontSize: SIZES.h6,
    color: COLORS.textSecondary,
    marginBottom: SIZES.base / 4,
  },
  referralDate: { fontSize: SIZES.h6, color: COLORS.textSecondary },
  statusBadge: {
    paddingHorizontal: SIZES.base,
    paddingVertical: SIZES.base / 2,
    borderRadius: SIZES.radius / 2,
  },
  statusText: { fontSize: SIZES.h6, color: COLORS.white, fontWeight: '600' },
  referralReward: {
    backgroundColor: COLORS.background,
    padding: SIZES.padding,
    borderRadius: SIZES.radius,
  },
  rewardAmount: {
    fontSize: SIZES.h3,
    fontWeight: 'bold',
    color: COLORS.success,
    // Was base/2 (4px) — bumped so the bonus amount + "Priority User
    // Status" subtitle don't sit on top of each other on the Gold card.
    marginBottom: 6,
    lineHeight: 22,
  },
  rewardDate: {
    fontSize: SIZES.h6,
    color: COLORS.textSecondary,
    marginBottom: SIZES.base / 4,
  },
  rewardStatus: { fontSize: SIZES.h6, color: COLORS.textSecondary, lineHeight: 18 },
  expiryDate: { fontSize: SIZES.h6, color: COLORS.warning },
  pendingInfo: {
    backgroundColor: COLORS.background,
    padding: SIZES.padding,
    borderRadius: SIZES.radius,
  },
  pendingText: {
    fontSize: SIZES.font,
    color: COLORS.warning,
    marginBottom: SIZES.base / 2,
  },
  pendingSubtext: { fontSize: SIZES.h6, color: COLORS.textSecondary },
  milestoneCard: {
    backgroundColor: COLORS.white,
    padding: SIZES.padding,
    borderRadius: SIZES.radius,
    // Was base (8) — bumped so milestone cards don't visually merge
    // with each other on the long Milestones tab.
    marginBottom: SIZES.padding - 4,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  milestoneHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    // Bumped from base (8) → 14 so the header (title + requirement) is
    // clearly separated from the description paragraph below it.
    marginBottom: 14,
  },
  achievedHeader: {
    backgroundColor: COLORS.success + '20',
    padding: SIZES.padding,
    borderRadius: SIZES.radius,
  },
  milestoneInfo: { flex: 1, paddingRight: SIZES.base },
  milestoneTitle: {
    fontSize: SIZES.h3,
    fontWeight: 'bold',
    color: COLORS.text,
    // Was base/4 (2px) — too tight, the requirement line crashed into
    // the title. Bumped to 6 + lineHeight for proper title spacing.
    marginBottom: 6,
    lineHeight: 24,
  },
  milestoneRequirement: {
    fontSize: SIZES.h6,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  milestoneReward: { alignItems: 'flex-end' },
  milestoneDescription: {
    fontSize: SIZES.font,
    color: COLORS.textSecondary,
    // Was base * 1.5 = 12px — actively negative leading on a 14px font,
    // so wrapped lines collided. Bump to 22 = ~1.55× for readable rhythm.
    lineHeight: 22,
  },
  achievedText: { fontSize: SIZES.h6, color: COLORS.success, fontWeight: 'bold' },
  progressText: { fontSize: SIZES.font, color: COLORS.text, lineHeight: 22 },
  royaltyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SIZES.base },
  royaltyItem: {
    width: '48%',
    backgroundColor: COLORS.background,
    padding: SIZES.padding,
    borderRadius: SIZES.radius,
    alignItems: 'center',
  },
  royaltyValue: {
    fontSize: SIZES.h2,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: SIZES.base / 2,
  },
  royaltyLabel: { fontSize: SIZES.h6, color: COLORS.textSecondary, textAlign: 'center' },
  requirementItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    // Bumped from base (8) → padding (16) so each requirement row has
    // proper breathing room. Was reading as a tight cluster previously.
    marginBottom: SIZES.padding - 4,
    paddingVertical: 4,
  },
  requirementText: { fontSize: SIZES.font, color: COLORS.text, flex: 1, lineHeight: 22 },
  requirementStatus: { fontSize: SIZES.h6, fontWeight: '600', marginLeft: SIZES.base },
  met: { color: COLORS.success },
  notMet: { color: COLORS.error },
  calculationText: { fontSize: SIZES.font, color: COLORS.text, marginBottom: SIZES.base + 4, lineHeight: 22 },
  payoutInfo: { fontSize: SIZES.h6, color: COLORS.textSecondary, lineHeight: 18 },
  // Bullets / multi-paragraph terms need a generous line-height — readers
  // skim these, so cramming the lines together makes the section feel
  // dense. 24px on 14px font = ~1.7× — comfortable reading rhythm.
  termsText: { fontSize: SIZES.font, color: COLORS.text, lineHeight: 24 },
  termsHighlight: { fontWeight: 'bold', color: COLORS.primary },
  termsStep: { fontWeight: 'bold', color: COLORS.text },

  networkSummary: { flexDirection: 'row', gap: SIZES.base, marginBottom: SIZES.padding },
  summaryChip: {
    flex: 1,
    paddingVertical: SIZES.padding,
    paddingHorizontal: SIZES.base,
    borderRadius: SIZES.radius,
    alignItems: 'center',
    borderWidth: 1,
  },
  summaryChipActive: { backgroundColor: '#E8F7EE', borderColor: '#10B981' },
  summaryChipInactive: { backgroundColor: '#F1F5F9', borderColor: '#94A3B8' },
  summaryChipTotal: { backgroundColor: '#FEF3C7', borderColor: COLORS.primary },
  summaryChipValue: { fontSize: SIZES.h2, fontWeight: '900', color: COLORS.text },
  summaryChipLabel: {
    fontSize: SIZES.h6,
    color: COLORS.textSecondary,
    fontWeight: '700',
    marginTop: 2,
  },
  emptyNetwork: {
    backgroundColor: COLORS.white,
    padding: SIZES.padding * 1.5,
    borderRadius: SIZES.radius,
    alignItems: 'center',
    marginBottom: SIZES.padding,
  },
  emptyNetworkTitle: {
    fontSize: SIZES.h3,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 6,
  },
  emptyNetworkSub: {
    fontSize: SIZES.font,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: SIZES.font * 1.5,
  },
  networkGroup: { marginBottom: SIZES.padding },
  networkGroupTitle: {
    fontSize: SIZES.font,
    fontWeight: '800',
    color: '#10B981',
    marginBottom: SIZES.base,
    letterSpacing: 0.4,
  },
  networkBranchWrap: {
    backgroundColor: COLORS.white,
    borderRadius: SIZES.radius,
    padding: SIZES.base,
    marginBottom: SIZES.base,
  },
  networkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SIZES.base,
    paddingHorizontal: SIZES.base,
  },
  networkChild: {
    paddingLeft: SIZES.padding * 1.6,
    borderLeftWidth: 2,
    borderLeftColor: '#FCD34D',
    marginLeft: SIZES.base,
  },
  networkBranch: {
    width: 12,
    height: 2,
    backgroundColor: '#FCD34D',
    marginRight: 6,
    marginLeft: -SIZES.padding,
  },
  networkAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  networkAvatarActive: { backgroundColor: '#10B981' },
  networkAvatarInactive: { backgroundColor: '#94A3B8' },
  networkAvatarText: { color: COLORS.white, fontWeight: '900', fontSize: 14 },
  networkName: { fontSize: SIZES.font, fontWeight: '700', color: COLORS.text },
  networkMobile: { fontSize: SIZES.h6, color: COLORS.textSecondary, marginTop: 1 },
  networkDate: { fontSize: SIZES.h6 - 1, color: COLORS.textSecondary, marginTop: 1 },
  networkChildren: { marginLeft: SIZES.base * 2 },
  activityBadge: {
    paddingHorizontal: SIZES.base,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  activityBadgeActive: { backgroundColor: '#E8F7EE', borderColor: '#10B981' },
  activityBadgeInactive: { backgroundColor: '#F1F5F9', borderColor: '#94A3B8' },
  activityBadgeText: { fontSize: SIZES.h6 - 1, fontWeight: '800', letterSpacing: 0.3 },
  activityBadgeTextActive: { color: '#10B981' },
  activityBadgeTextInactive: { color: '#64748B' },

  // ─── Royalty Tracker headline card (live counter + Total Business + Mentees) ───
  kpiCard: {
    backgroundColor: '#0F172A',
    borderRadius: SIZES.radius * 1.2,
    padding: SIZES.padding,
    marginBottom: SIZES.padding,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  kpiHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SIZES.base,
  },
  kpiHeaderTitle: {
    color: '#E2E8F0',
    fontSize: SIZES.h6,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  liveDot: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  liveDotPulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22C55E',
    marginRight: 5,
  },
  liveDotText: {
    color: '#22C55E',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  kpiBigValue: {
    color: '#FCD34D',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 0.4,
    marginTop: 4,
  },
  kpiBigLabel: {
    color: '#F1F5F9',
    fontSize: SIZES.font,
    fontWeight: '700',
    marginTop: 2,
  },
  kpiCaption: {
    color: '#94A3B8',
    fontSize: SIZES.h6,
    marginTop: 4,
  },
  kpiSplit: {
    flexDirection: 'row',
    marginTop: SIZES.padding,
    paddingTop: SIZES.padding,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  kpiSplitItem: { flex: 1 },
  kpiSplitValue: {
    color: '#F1F5F9',
    fontSize: SIZES.h2,
    fontWeight: '900',
  },
  kpiSplitLabel: {
    color: '#CBD5E1',
    fontSize: SIZES.h6,
    fontWeight: '700',
    marginTop: 2,
  },
  kpiSplitHint: {
    color: '#64748B',
    fontSize: SIZES.h6 - 1,
    marginTop: 2,
  },
  kpiSplitDivider: {
    width: 1,
    backgroundColor: '#1E293B',
    marginHorizontal: SIZES.padding,
  },

  syncButton: {
    marginTop: SIZES.padding,
    backgroundColor: COLORS.lightGray,
    paddingVertical: SIZES.base + 2,
    borderRadius: SIZES.radius,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  syncButtonText: {
    fontSize: SIZES.font,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: 0.3,
  },
  syncHint: {
    fontSize: SIZES.h6,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    fontStyle: 'italic',
  },
  teamTreeButton: {
    marginTop: SIZES.padding,
    backgroundColor: '#0F172A',
    paddingVertical: SIZES.base + 4,
    borderRadius: SIZES.radius,
    alignItems: 'center',
  },
  teamTreeButtonText: {
    fontSize: SIZES.font,
    fontWeight: '800',
    color: '#FCD34D',
    letterSpacing: 0.3,
  },
});

export default ReferralScreen;

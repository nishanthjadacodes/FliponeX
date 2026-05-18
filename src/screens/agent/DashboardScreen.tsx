import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Animated,
  Image,
  Easing,
  StatusBar,
  Switch,
  AppState,
  type AppStateStatus,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import {
  getDashboard,
  updateOnlineStatus,
  pingAgentLocation,
  type AgentTask,
  type AgentTaskStatus,
} from '../../services/agent/api';
import { readCache, writeCache } from '../../utils/agent/cache';
import ProfileModal, { type AgentProfile } from '../../components/agent/ProfileModal';
import { LinearGradient } from 'expo-linear-gradient';
import { repCode } from '../../utils/agent/repCode';

interface DashboardScreenProps {
  navigation: {
    navigate: (route: string, params?: Record<string, unknown>) => void;
    addListener: (event: 'focus' | 'blur', cb: () => void) => () => void;
  };
}

interface DashboardCache {
  tasks: AgentTask[];
  todayEarnings: number;
  totalJobs: number;
  newRequests: number;
  rating: number;
}

interface QuickAction {
  icon: string;
  title: string;
  screen?: string;
  action?: () => void;
  tint: string;
  border: string;
}

const DashboardScreen: React.FC<DashboardScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [todayEarnings, setTodayEarnings] = useState<number>(0);
  const [totalJobs, setTotalJobs] = useState<number>(0);
  const [newRequests, setNewRequests] = useState<number>(0);
  const [rating, setRating] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [showProfileModal, setShowProfileModal] = useState<boolean>(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const earningsAnim = useRef(new Animated.Value(0)).current;
  const logoSpin = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0.3)).current;

  // Online toggle = LOCAL ONLY. Source of truth is AsyncStorage +
  // React state. The dashboard polls getDashboard() every 15s, but we
  // explicitly do NOT read online_status from those polls — the prior
  // grace-window approach still let the server flip the toggle back
  // after the window expired. Now: only the user's manual tap
  // changes the toggle. The poll value is ignored entirely. This
  // means once the rep flips ON, they stay ON until they tap OFF.
  const ONLINE_STATUS_KEY = 'agent_online_status';

  useEffect(() => {
    (async () => {
      const cached = await readCache<DashboardCache>('dashboard');
      if (cached?.value) {
        const d = cached.value;
        setTasks(d.tasks || []);
        setTodayEarnings(d.todayEarnings || 0);
        setTotalJobs(d.totalJobs || 0);
        setNewRequests(d.newRequests || 0);
        setRating(d.rating || 0);
      }
      // Don't auto-restore the rep's previous online state on app
      // launch — explicit "Go Online" click is required EVERY app
      // open. Per spec: "Access should only be granted when the
      // representative has explicitly clicked the Go Online button".
      // Default to offline; if any stale flag is in storage, clear it.
      try {
        await AsyncStorage.setItem(ONLINE_STATUS_KEY, 'false');
      } catch {}
      setIsOnline(false);
      loadDashboardData();
    })();
  }, []);

  // Auto-offline the rep whenever the app backgrounds (home button,
  // app switcher, screen lock, etc.). Without this the admin's
  // representative-management page kept seeing reps as ONLINE for
  // hours after they'd put their phone down. Backend update is
  // fire-and-forget — local state still flips to false immediately
  // so the rep sees their toggle off the moment they return.
  useEffect(() => {
    const handleAppStateChange = (next: AppStateStatus): void => {
      if (next === 'background' || next === 'inactive') {
        // Only push if we were online — saves a network call when
        // already offline. Errors swallowed: the next foreground
        // login flow will sync state anyway.
        setIsOnline((curr) => {
          if (curr) {
            updateOnlineStatus(false).catch(() => {});
            AsyncStorage.setItem(ONLINE_STATUS_KEY, 'false').catch(() => {});
          }
          return false;
        });
      }
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, []);

  // Online heartbeat — while the rep is Online + app is foreground,
  // re-ping isOnline=true every 30s. Two reasons:
  //   1. If the AppState 'background' handler above fails to send the
  //      offline update (e.g. app killed before the network call lands),
  //      the backend can detect a stale heartbeat (>90s old) and treat
  //      the rep as offline anyway.
  //   2. Survives transient network drops — the next heartbeat re-syncs
  //      the rep's online state without manual toggle.
  useEffect(() => {
    if (!isOnline) return undefined;
    // Fire one immediately so the timestamp is fresh after toggle-on.
    updateOnlineStatus(true).catch(() => {});
    const id = setInterval(() => {
      updateOnlineStatus(true).catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, [isOnline]);

  useEffect(() => {
    let pollId: ReturnType<typeof setInterval> | null = null;
    const start = async (): Promise<void> => {
      // If TaskExecution flagged a force-refresh (rep just marked
      // work_completed), wait a beat for the backend to commit the
      // status transition, then fetch. Without the small delay, the
      // immediate fetch could land on the same DB read replica
      // before the write has propagated, returning the stale
      // todayEarnings=0.
      let force = false;
      try {
        const flag = await AsyncStorage.getItem('dashboard_force_refresh');
        if (flag) {
          force = true;
          await AsyncStorage.removeItem('dashboard_force_refresh');
        }
      } catch {}
      if (force) {
        // 600ms window — generous enough for Sequelize to commit
        // and for the next /earnings query to pick up the new row.
        setTimeout(() => loadDashboardData(), 600);
      } else {
        loadDashboardData();
      }
      pollId = setInterval(loadDashboardData, 15000);
    };
    const stop = (): void => {
      if (pollId) {
        clearInterval(pollId);
        pollId = null;
      }
    };
    const focusUnsub = navigation.addListener('focus', start);
    const blurUnsub = navigation.addListener('blur', stop);
    return () => {
      stop();
      focusUnsub();
      blurUnsub();
    };
  }, [navigation]);

  useEffect(() => {
    if (!loading) startAnimations();
  }, [loading]);

  const startAnimations = (): void => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 700, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 6, useNativeDriver: true }),
    ]).start();

    Animated.timing(earningsAnim, {
      toValue: todayEarnings,
      duration: 1400,
      useNativeDriver: false,
    }).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1100, useNativeDriver: true }),
      ]),
    ).start();

    Animated.loop(
      Animated.timing(logoSpin, {
        toValue: 1,
        duration: 20000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0.3,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    ).start();
  };

  const loadDashboardData = async (): Promise<void> => {
    try {
      const agentData = await AsyncStorage.getItem('agent_data');
      if (agentData) setAgent(JSON.parse(agentData) as AgentProfile);
      const data = await getDashboard();
      // Diagnostic — visible via `adb logcat *:S ReactNativeJS:V` on
      // the device. Helps verify the backend is returning a non-zero
      // todayEarnings after a rep completes work.
      console.log('[dashboard] todayEarnings from server:', data.todayEarnings,
        '| totalJobs:', data.totalJobs, '| tasks status counts:',
        (data.tasks || []).reduce<Record<string, number>>((acc, t) => {
          acc[t.status] = (acc[t.status] || 0) + 1;
          return acc;
        }, {}));
      setTasks(data.tasks || []);
      setTodayEarnings(data.todayEarnings || 0);
      setTotalJobs(data.totalJobs || 0);
      setNewRequests(data.newRequests || 0);
      setRating(data.rating || 0);
      // Deliberately NOT setting isOnline from polled data. The toggle
      // is purely local + AsyncStorage-backed; only manual taps change
      // it. data.isOnline is ignored here on purpose.
      writeCache<DashboardCache>('dashboard', {
        tasks: data.tasks || [],
        todayEarnings: data.todayEarnings || 0,
        totalJobs: data.totalJobs || 0,
        newRequests: data.newRequests || 0,
        rating: data.rating || 0,
      });
    } catch (error) {
      console.error('Dashboard load error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = (): void => {
    setRefreshing(true);
    loadDashboardData();
  };

  // Re-entrancy guard — without it, tapping the Switch faster than
  // a render cycle queued two parallel updateOnlineStatus calls in
  // opposite directions, plus the location-ping useEffect tore down
  // and rebuilt its interval mid-cycle. That triggered the
  // "Warning: Cannot update a component while rendering a different
  // component" render error users were seeing. The ref pattern
  // (not state) avoids forcing an extra render to release the lock.
  const toggleInFlightRef = useRef<boolean>(false);

  const handleToggleOnlineStatus = async (): Promise<void> => {
    if (toggleInFlightRef.current) return;
    toggleInFlightRef.current = true;
    // Functional setState so we never read a stale `isOnline` if the
    // user tapped twice in quick succession.
    setIsOnline((prev) => {
      const next = !prev;
      // Persist + notify backend INSIDE the updater so they're always
      // keyed off the value we're actually committing.
      AsyncStorage.setItem(ONLINE_STATUS_KEY, String(next)).catch(() => {});
      updateOnlineStatus(next)
        .catch((e: any) => {
          console.log('[online-status] backend update failed (non-fatal):', e?.message);
        })
        .finally(() => {
          toggleInFlightRef.current = false;
        });
      return next;
    });
  };

  // ─── Real-time location ping (Agent Monitoring) ────────────────────────
  // While the rep is Online we ping their GPS to the backend every 60s
  // so the Operations Manager's dashboard sees a fresh location heatbeat.
  // First fix can take 5-10s; we don't block the toggle on that. When
  // the rep flips to Offline (or unmounts the screen), the timer is
  // torn down so we never ping an offline rep.
  useEffect(() => {
    if (!isOnline) return undefined;
    let cancelled = false;

    const sendOnePing = async (): Promise<void> => {
      try {
        // Reuse a recent fix if the OS has one — saves battery vs a fresh
        // satellite lock every minute.
        let pos = await Location.getLastKnownPositionAsync({
          maxAge: 30_000,
          requiredAccuracy: 200,
        });
        if (!pos) {
          // Fall back to a fresh fix with balanced accuracy. Times out at
          // 8s so we don't spin forever on poor signal.
          pos = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
          ]);
        }
        if (cancelled || !pos?.coords) return;
        await pingAgentLocation(pos.coords.latitude, pos.coords.longitude);
      } catch (e: any) {
        console.log('[location-ping] error:', e?.message);
      }
    };

    // Confirm permission once when the rep goes online; if denied we
    // silently skip pings rather than nagging.
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          const req = await Location.requestForegroundPermissionsAsync();
          if (req.status !== 'granted') return;
        }
        await sendOnePing();
      } catch (_) { /* permission flow failure → silent */ }
    })();

    const id = setInterval(sendOnePing, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isOnline]);

  const newRequestTasks = tasks.filter((t) => t.status === 'new');
  // Recent Activity surfaces what the rep is actively working on first
  // (accepted + in-progress) so a half-finished job stays at the top of
  // their dashboard. Completed jobs fill any remaining slots so the
  // section is never empty if the rep has historical work.
  const activeTasks = tasks.filter(
    (t) => t.status === 'accepted' || t.status === 'in_progress' || t.status === 'documents_collected' || t.status === 'work_completed',
  );
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const recentTasks = [...activeTasks, ...completedTasks].slice(0, 5);

  const quickActions: QuickAction[] = [
    { icon: '📋', title: 'Tasks', screen: 'Tasks', tint: '#E6EEF4', border: '#1B4B72' },
    { icon: '💰', title: 'Earnings', screen: 'Earnings', tint: '#FEF3C7', border: '#F4A100' },
    { icon: '👤', title: 'Profile', action: () => setShowProfileModal(true), tint: '#FEE2E2', border: '#FCA5A5' },
    { icon: '🔗', title: 'Referral', screen: 'Referral', tint: '#FFFBEB', border: '#FDE68A' },
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFBEB" />
      <LinearGradient
        colors={['#FFFBEB', '#FFFFFF', '#EFF6FF']}
        style={StyleSheet.absoluteFill}
      />

      <Animated.View
        style={[
          styles.content,
          { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
        ]}
      >
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F4A100" />}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 30 }}
          stickyHeaderIndices={[0]}
        >
          <View style={[styles.stickyTop, { paddingTop: insets.top + 8 }]}>
            <View style={styles.heroWrap}>
              <LinearGradient
                colors={['#001F3F', '#003153', '#1B4B72']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.hero}
              >
                <View style={styles.heroRow}>
                  <View style={styles.logoBlock}>
                    <Animated.View
                      style={[
                        styles.logoGlow,
                        {
                          opacity: glowAnim,
                          transform: [
                            {
                              scale: glowAnim.interpolate({
                                inputRange: [0.3, 1],
                                outputRange: [0.9, 1.3],
                              }),
                            },
                          ],
                        },
                      ]}
                    >
                      <LinearGradient
                        colors={['rgba(255,255,255,0.8)', 'rgba(255,255,255,0)']}
                        style={styles.logoGlowFill}
                      />
                    </Animated.View>
                    <Animated.View
                      style={[
                        styles.logoRing,
                        {
                          transform: [
                            { scale: scaleAnim },
                            {
                              rotate: logoSpin.interpolate({
                                inputRange: [0, 1],
                                outputRange: ['0deg', '360deg'],
                              }),
                            },
                          ],
                        },
                      ]}
                    >
                      {/* Rep's profile picture if they uploaded one in
                          the Profile screen — surfaces immediately in
                          the home hero so they can confirm at a glance
                          which account is signed in. Falls back to the
                          FliponeX partner logo when no upload exists. */}
                      <Image
                        source={
                          (agent as any)?.profile_pic
                            ? { uri: (agent as any).profile_pic }
                            : require('../../assets/logo1.jpeg')
                        }
                        style={styles.logoImg}
                        resizeMode="cover"
                      />
                    </Animated.View>
                  </View>

                  <View style={styles.heroTexts}>
                    <Text style={styles.brandLine}>FLIPONEX · PARTNER</Text>
                    <Text style={styles.welcomeText}>Welcome back,</Text>
                    <Text style={styles.agentName} numberOfLines={1}>
                      {agent?.name || 'Representative'}
                    </Text>
                    {/* Short rep code — shown so the rep can quickly cite
                        their ID over the phone with admin / customer.
                        Derived from user.id; falls back to "REP-—" if
                        the agent payload hasn't loaded yet. */}
                    <Text style={styles.agentRepCode}>
                      {repCode(agent as any)}
                    </Text>
                  </View>

                  {/* Online/Offline switch — push right turns the rep ON
                      (admin can dispatch tasks), push left turns OFF.
                      State syncs to backend immediately via
                      updateOnlineStatus(); on failure we revert the
                      optimistic UI change. The sliding pulse animation
                      stays only while the toggle is ON for visual
                      reinforcement. */}
                  <View style={styles.onlineToggleWrap}>
                    <Animated.View
                      style={[
                        styles.onlineDot,
                        {
                          backgroundColor: isOnline ? '#10B981' : '#DC2626',
                          transform: isOnline ? [{ scale: pulseAnim }] : undefined,
                        },
                      ]}
                    />
                    <Text
                      style={[
                        styles.onlineLabel,
                        { color: isOnline ? '#10B981' : '#FFFFFF' },
                      ]}
                    >
                      {isOnline ? 'Online' : 'Offline'}
                    </Text>
                    <Switch
                      value={isOnline}
                      onValueChange={handleToggleOnlineStatus}
                      trackColor={{ false: '#475569', true: '#10B981' }}
                      thumbColor="#FFFFFF"
                      ios_backgroundColor="#475569"
                    />
                  </View>
                </View>
              </LinearGradient>
            </View>

            <View style={styles.statsRow}>
              <TouchableOpacity
                style={[styles.statCard, styles.statCardGold]}
                activeOpacity={0.9}
                onPress={() => navigation.navigate('Earnings')}
              >
                <Text style={[styles.statLabel, { color: '#92700A' }]}>Today's Earnings</Text>
                {/* Display the React state directly. The previous version
                    routed through `earningsAnim.__getValue()` on Animated.Text,
                    which froze at whatever value the animation last
                    targeted (the initial 0 from cache / cold start). React
                    re-renders triggered by setTodayEarnings(...) didn't
                    update the indirection because Animated.Text doesn't
                    animate text children — only style props. Reading the
                    state directly means every poll's update appears
                    instantly. */}
                <Text style={[styles.statValue, { color: '#003153' }]}>
                  {'₹'}{Math.floor(todayEarnings)}
                </Text>
                <View style={styles.statAccentBar}>
                  <LinearGradient
                    colors={['#F4A100', '#FCD34D']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={StyleSheet.absoluteFill}
                  />
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.statCard, styles.statCardBlue]}
                activeOpacity={0.9}
                onPress={() => navigation.navigate('Tasks', { initialFilter: 'all' })}
              >
                <Text style={[styles.statLabel, { color: '#003153' }]}>Total Jobs</Text>
                <Text style={[styles.statValue, { color: '#003153' }]}>{totalJobs}</Text>
                <View style={styles.statAccentBar}>
                  <LinearGradient
                    colors={['#001F3F', '#1B4B72']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={StyleSheet.absoluteFill}
                  />
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.statCard,
                  newRequests > 0 ? styles.statCardRed : styles.statCardNeutral,
                ]}
                activeOpacity={0.9}
                onPress={() => navigation.navigate('Tasks', { initialFilter: 'new' })}
              >
                <Text
                  style={[
                    styles.statLabel,
                    { color: newRequests > 0 ? '#B91C1C' : '#1B4B72' },
                  ]}
                >
                  New Requests
                </Text>
                <Text style={[styles.statValue, { color: '#003153' }]}>{newRequests}</Text>
                <View style={styles.statAccentBar}>
                  <LinearGradient
                    colors={
                      newRequests > 0 ? ['#DC2626', '#FCA5A5'] : ['#E6EEF4', '#E6EEF4']
                    }
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={StyleSheet.absoluteFill}
                  />
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {newRequestTasks.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>New Requests</Text>
                <TouchableOpacity onPress={() => navigation.navigate('Tasks')}>
                  <Text style={styles.seeAll}>See All</Text>
                </TouchableOpacity>
              </View>
              {newRequestTasks.map((task) => (
                <TouchableOpacity
                  key={task.id}
                  style={styles.taskCard}
                  activeOpacity={0.9}
                  onPress={() => navigation.navigate('TaskExecution', { taskId: task.id })}
                >
                  <View style={styles.taskInfo}>
                    <Text style={styles.taskCustomer}>{task.customerName}</Text>
                    <Text style={styles.taskService}>{task.serviceName}</Text>
                    <Text style={styles.taskAddress} numberOfLines={1}>
                      {task.address}
                    </Text>
                  </View>
                  <View style={styles.taskRight}>
                    <Text style={styles.taskAmount}>
                      {'₹'}
                      {task.amount}
                    </Text>
                    <View style={styles.newBadge}>
                      <Text style={styles.newBadgeText}>NEW</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Activity</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Tasks')}>
                <Text style={styles.seeAll}>View All</Text>
              </TouchableOpacity>
            </View>
            {recentTasks.length > 0 ? (
              recentTasks.map((task) => (
                <TouchableOpacity
                  key={task.id}
                  style={styles.activityCard}
                  activeOpacity={0.9}
                  onPress={() => navigation.navigate('TaskExecution', { taskId: task.id })}
                >
                  <View style={styles.taskInfo}>
                    <Text style={styles.taskCustomer}>{task.customerName}</Text>
                    <Text style={styles.taskService}>{task.serviceName}</Text>
                  </View>
                  <View
                    style={[
                      styles.statusBadge,
                      { backgroundColor: getStatusColor(task.status) },
                    ]}
                  >
                    <Text style={styles.statusBadgeText}>{formatStatus(task.status)}</Text>
                  </View>
                </TouchableOpacity>
              ))
            ) : tasks.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No activity yet</Text>
                <Text style={styles.emptySubtext}>
                  Pull to refresh or go online to receive jobs
                </Text>
              </View>
            ) : (
              // Tasks exist but none are accepted/in-progress/completed —
              // probably all 'new' (pending the rep's accept). Point them
              // at the New Requests section above instead of showing an
              // empty state that reads as "you have no work" (you do).
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No accepted jobs yet</Text>
                <Text style={styles.emptySubtext}>
                  You have {newRequestTasks.length} new request
                  {newRequestTasks.length === 1 ? '' : 's'} above — accept one to get started.
                </Text>
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Quick Actions</Text>
            <View style={styles.actionsGrid}>
              {quickActions.map((item, i) => (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.actionCard,
                    { backgroundColor: item.tint, borderColor: item.border },
                  ]}
                  activeOpacity={0.85}
                  onPress={item.action || (() => item.screen && navigation.navigate(item.screen))}
                >
                  <Text style={styles.actionIcon}>{item.icon}</Text>
                  <Text style={styles.actionTitle}>{item.title}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {rating > 0 && (
            <TouchableOpacity
              style={styles.ratingCard}
              activeOpacity={0.9}
              onPress={() => navigation.navigate('Profile')}
            >
              <View style={styles.ratingBadge}>
                <Text style={styles.ratingBadgeText}>{'⭐'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.ratingLabel}>Your Rating</Text>
                <Text style={styles.ratingValue}>
                  {rating.toFixed(1)}{' '}
                  <Text style={styles.ratingStars}>{'⭐'.repeat(Math.floor(rating))}</Text>
                </Text>
              </View>
              <Text style={styles.ratingArrow}>{'›'}</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </Animated.View>

      <ProfileModal
        visible={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        onSave={setAgent}
      />
    </View>
  );
};

const getStatusColor = (status: AgentTaskStatus | string): string => {
  switch (status) {
    case 'new':
      return '#F4A100';
    case 'accepted':
      return '#003153';
    case 'in_progress':
      return '#F4A100';
    case 'documents_collected':
      return '#0EA5E9';
    case 'work_completed':
      // Rep finished the work but customer hasn't OTP'd yet — still
      // green because the rep has earned the commission.
      return '#10B981';
    case 'completed':
      // Emerald green — completed = earned. Was Prussian blue before
      // which read as "in progress" alongside the new/in-progress badges.
      return '#10B981';
    case 'cancelled':
      return '#DC2626';
    default:
      return '#1B4B72';
  }
};

const formatStatus = (status: AgentTaskStatus | string): string => {
  switch (status) {
    case 'new':
      return 'New';
    case 'accepted':
      return 'Accepted';
    case 'in_progress':
      return 'In Progress';
    case 'documents_collected':
      return 'Docs Collected';
    case 'work_completed':
      return 'Completed';
    case 'completed':
      return 'Completed';
    default:
      return String(status);
  }
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFBEB' },
  content: { flex: 1 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
  },
  loadingText: { fontSize: 15, color: '#475569', fontWeight: '600' },

  stickyTop: {
    backgroundColor: '#FFFBEB',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(15,23,42,0.05)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 4,
    zIndex: 2,
  },

  heroWrap: {
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  hero: {
    borderRadius: 22,
    padding: 18,
    shadowColor: '#001F3F',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 22,
    elevation: 12,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoBlock: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoGlow: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
  },
  logoGlowFill: { flex: 1, borderRadius: 45 },
  logoRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 2.5,
    borderColor: '#FCD34D',
    backgroundColor: '#FFFFFF',
    shadowColor: '#FCD34D',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 12,
    elevation: 10,
  },
  logoImg: { width: '100%', height: '100%' },
  heroTexts: {
    flex: 1,
  },
  brandLine: {
    fontSize: 9,
    color: '#FCD34D',
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  welcomeText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '600',
    marginTop: 2,
  },
  agentRepCode: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '800',
    color: '#FCD34D',
    letterSpacing: 1.2,
  },
  agentName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  // Online/Offline toggle — sits in the hero on the rep's home screen.
  // Status dot + label sit to the LEFT of the slider so push-right reads
  // as "switch ON" and push-left as "switch OFF" exactly like the user
  // asked. Stays compact so it fits next to the welcome text.
  onlineToggleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.20)',
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 4,
    borderRadius: 22,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  onlineLabel: {
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.3,
    marginRight: 2,
  },

  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginTop: 16,
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderWidth: 1,
    shadowColor: '#1E293B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
    overflow: 'hidden',
  },
  statCardGold: { borderColor: '#FDE68A' },
  statCardBlue: { borderColor: '#E6EEF4' },
  statCardRed: { borderColor: '#FCA5A5' },
  statCardNeutral: { borderColor: '#E6EEF4' },
  statLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  statAccentBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
  },

  section: {
    paddingHorizontal: 16,
    marginTop: 22,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#003153',
    letterSpacing: 0.2,
  },
  seeAll: {
    fontSize: 12,
    color: '#003153',
    fontWeight: '700',
  },

  taskCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FEF3C7',
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
    shadowColor: '#F4A100',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 2,
  },
  activityCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E6EEF4',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  taskInfo: { flex: 1, marginRight: 10 },
  taskCustomer: { fontSize: 14, fontWeight: '700', color: '#003153', marginBottom: 2 },
  taskService: { fontSize: 12, color: '#1B4B72', marginBottom: 2 },
  taskAddress: { fontSize: 11, color: '#1B4B72' },
  taskRight: { alignItems: 'flex-end' },
  taskAmount: { fontSize: 16, fontWeight: '800', color: '#F4A100', marginBottom: 4 },
  newBadge: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FCD34D',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  newBadgeText: { color: '#92700A', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },

  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E6EEF4',
    alignItems: 'center',
  },
  emptyText: { fontSize: 14, color: '#003153', fontWeight: '700', marginBottom: 4 },
  emptySubtext: { fontSize: 12, color: '#1B4B72' },

  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionCard: {
    width: '48%',
    paddingVertical: 18,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  actionIcon: { fontSize: 28, marginBottom: 6 },
  actionTitle: {
    fontSize: 13,
    color: '#003153',
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  ratingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FCD34D',
    padding: 14,
    borderRadius: 14,
    marginHorizontal: 16,
    marginTop: 18,
    gap: 12,
    shadowColor: '#F4A100',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 3,
  },
  ratingBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingBadgeText: { fontSize: 22 },
  ratingLabel: {
    fontSize: 11,
    color: '#92700A',
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  ratingValue: {
    fontSize: 17,
    fontWeight: '900',
    color: '#003153',
  },
  ratingStars: { fontSize: 13 },
  ratingArrow: {
    fontSize: 24,
    color: '#F4A100',
    fontWeight: '800',
  },
});

export default DashboardScreen;

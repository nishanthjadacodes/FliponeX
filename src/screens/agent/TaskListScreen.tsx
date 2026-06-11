import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from '@react-navigation/native';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  RefreshControl,
  Modal,
  ScrollView,
  Animated,
  StatusBar,
} from 'react-native';
import { getTasks, acceptTask, rejectTask, type AgentTask, type AgentTaskStatus } from '../../services/agent/api';
import { readCache, writeCache } from '../../utils/agent/cache';
import { COLORS } from '../../constants/agent/colors';
import { LinearGradient } from 'expo-linear-gradient';
import { computeDistanceToAddress, formatDistance } from '../../utils/agent/distance';
import { formatBookingAddress } from '../../utils/addressFormat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Status helpers (module-scope, no hooks) ────────────────────────────────
// Explicit emerald green for completed/work_completed — COLORS.success
// in the agent palette resolves to Prussian blue (#003153), which made
// "Completed" look identical to "Accepted" and confused reps. Using
// the same #10B981 green the dashboard's Recent Activity uses, for
// consistency across screens.
const COMPLETED_GREEN = '#10B981';

const getStatusColor = (status?: string): string => {
  switch (status) {
    case 'new':
    case 'pending':
      return COLORS.warning;
    case 'accepted':
      return COLORS.accentBlue;
    case 'in_progress':
      return COLORS.primary;
    case 'documents_collected':
      return '#0EA5E9';
    case 'work_completed':
    case 'completed':
      return COMPLETED_GREEN;
    default:
      return COLORS.gray;
  }
};

const getStatusText = (status?: string): string => {
  switch (status) {
    case 'new':
    case 'pending':
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
      return status || '';
  }
};

interface TaskCardProps {
  item: AgentTask;
  index: number;
  distance?: string;
  onOpen: (item: AgentTask) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onView: (id: string) => void;
}

// ─── TaskCard — a real component so hooks (entrance animation) are legal ────
const TaskCard: React.FC<TaskCardProps> = ({ item, index, distance, onOpen, onAccept, onReject, onView }) => {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 450,
      delay: Math.min(index, 8) * 80,
      useNativeDriver: true,
    }).start();
  }, []);

  const isNew = item.status === 'new' || (item.status as string) === 'pending';

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [
          {
            translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
          },
        ],
      }}
    >
      <TouchableOpacity style={styles.taskCard} activeOpacity={0.92} onPress={() => onOpen(item)}>
        <View style={styles.taskHeader}>
          <View style={styles.taskInfo}>
            <Text style={styles.customerName}>{item.customerName}</Text>
            <Text style={styles.serviceType}>{item.serviceName || item.serviceType}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
            <Text style={styles.statusText}>{getStatusText(item.status)}</Text>
          </View>
        </View>

        <View style={styles.taskDetails}>
          <Text style={styles.address} numberOfLines={2}>
            {formatBookingAddress(item.address)}
          </Text>
          <View style={styles.taskMeta}>
            <Text style={styles.amount}>
              {'₹'}
              {item.amount}
            </Text>
            <Text style={styles.distance}>{distance || 'Calculating…'}</Text>
          </View>
        </View>

        {isNew ? (
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.actionButton, styles.acceptButton]}
              activeOpacity={0.88}
              onPress={() => onAccept(item.id)}
            >
              <LinearGradient colors={COLORS.successGradient} style={styles.buttonGradient}>
                <Text style={styles.acceptButtonText}>Accept</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.rejectButton]}
              activeOpacity={0.88}
              onPress={() => onReject(item.id)}
            >
              <LinearGradient colors={COLORS.dangerGradient} style={styles.buttonGradient}>
                <Text style={styles.rejectButtonText}>Reject</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.actionButton, styles.viewButton]}
            activeOpacity={0.88}
            onPress={() => onView(item.id)}
          >
            <LinearGradient colors={COLORS.blueGradient} style={styles.buttonGradient}>
              <Text style={styles.viewButtonText}>View Details</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

type FilterId = 'all' | AgentTaskStatus | string;

interface FilterSpec {
  id: FilterId;
  label: string;
}

const FILTERS: FilterSpec[] = [
  { id: 'all', label: 'All' },
  { id: 'new', label: 'Assigned to me' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'completed', label: 'Completed' },
];

interface TasksCacheValue {
  tasks: AgentTask[];
}

interface NavigationLike {
  navigate: (route: string, params?: Record<string, unknown>) => void;
  addListener: (event: string, cb: () => void) => () => void;
}

interface TaskListScreenProps {
  navigation: NavigationLike;
  route?: { params?: { initialFilter?: FilterId } };
}

const TaskListScreen: React.FC<TaskListScreenProps> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const [filter, setFilter] = useState<FilterId>(route?.params?.initialFilter || 'all');

  // Task list via TanStack Query, keyed on the active filter so each
  // filter caches independently. refetchInterval (gated on focus)
  // surfaces new customer bookings automatically every 15s.
  const {
    data: tasks = [],
    isLoading: loading,
    refetch: refetchTasks,
  } = useQuery({
    queryKey: ['agentTasks', filter],
    queryFn: async () => {
      const response = await getTasks(filter as string);
      const list = response?.tasks || [];
      writeCache<TasksCacheValue>(`tasks:${filter}`, { tasks: list });
      return list;
    },
    refetchInterval: isFocused ? 15_000 : false,
  });
  // Pull-to-refresh spinner — kept as local state so the background
  // 15s poll doesn't flash the RefreshControl.
  const [refreshing, setRefreshing] = useState<boolean>(false);
  // Thin wrapper so the existing loadTasks({ silent }) call sites
  // (after accept / reject) keep working — the arg is now ignored.
  const loadTasks = (_opts?: { silent?: boolean }): void => {
    // Invalidate the whole agentTasks family — refetches the current
    // filter AND the ['agentTasks','new'] query the Tasks-tab badge
    // shares, so the badge count drops the instant a task is accepted
    // or rejected, not a poll-interval later.
    queryClient.invalidateQueries({ queryKey: ['agentTasks'] });
  };
  const [selectedTask, setSelectedTask] = useState<AgentTask | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState<boolean>(false);
  const [distances, setDistances] = useState<Record<string, string>>({});

  // Accept deep-link filter changes (from Dashboard → Tasks)
  useEffect(() => {
    const incoming = route?.params?.initialFilter;
    if (incoming && incoming !== filter) setFilter(incoming);
  }, [route?.params?.initialFilter]);

  // Seed the query cache from the persisted per-filter snapshot so a
  // cold start shows last-known tasks instantly while the live fetch
  // runs.
  useEffect(() => {
    (async () => {
      if (queryClient.getQueryData(['agentTasks', filter])) return;
      const cached = await readCache<TasksCacheValue>(`tasks:${filter}`);
      if (cached?.value?.tasks) {
        queryClient.setQueryData(['agentTasks', filter], cached.value.tasks);
      }
    })();
  }, [filter, queryClient]);

  // Compute real agent→service distance for every task that appears in the list.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const task of tasks) {
        if (cancelled) return;
        if (!task?.id || !task?.address) continue;
        if (distances[task.id]) continue;
        const km = await computeDistanceToAddress(task.address);
        if (cancelled) return;
        setDistances((prev) => ({
          ...prev,
          [task.id]: km != null ? formatDistance(km) : 'N/A',
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tasks]);

  // The 15s poll is now the query's refetchInterval — no manual
  // interval / focus-blur wiring needed.

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    await refetchTasks();
    setRefreshing(false);
  };

  const handleAccept = async (taskId: string): Promise<void> => {
    try {
      await acceptTask(taskId);
      Alert.alert('Accepted', 'Task accepted. Open it to start work.');
      loadTasks({ silent: true });
    } catch (error: any) {
      Alert.alert('Cannot accept', error?.message || 'Failed to accept task');
    }
  };

  const handleReject = (taskId: string): void => {
    Alert.alert(
      'Reject Task',
      'Rejecting returns this booking to the admin for reassignment. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            try {
              await rejectTask(taskId);
              Alert.alert('Returned to admin', 'The admin will reassign this task.');
              loadTasks({ silent: true });
            } catch (error: any) {
              Alert.alert('Cannot reject', error?.message || 'Failed to reject task');
            }
          },
        },
      ],
    );
  };

  const showTaskDetails = (task: AgentTask | null): void => {
    if (!task) return;
    setSelectedTask(task);
    setDetailModalVisible(true);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFBEB" />
      <LinearGradient colors={['#FFFBEB', '#FFFFFF', '#EFF6FF']} style={StyleSheet.absoluteFill} />

      {/* Sticky branded header + filter chips */}
      <View style={styles.stickyTop}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Text style={styles.headerTitle}>Tasks</Text>
          <Text style={styles.headerSubtitle}>
            {tasks.length} {tasks.length === 1 ? 'job' : 'jobs'} in{' '}
            <Text style={styles.headerAccent}>
              {FILTERS.find((f) => f.id === filter)?.label || filter}
            </Text>
          </Text>
        </View>

        <View style={styles.filterContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 16 }}>
            {FILTERS.map((f) => (
              <TouchableOpacity
                key={f.id}
                style={styles.filterChipWrap}
                activeOpacity={0.85}
                onPress={() => setFilter(f.id)}
              >
                {filter === f.id ? (
                  <LinearGradient
                    colors={['#FCD34D', '#F4A100']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.filterChip, styles.activeFilterChip]}
                  >
                    <Text style={[styles.filterText, styles.activeFilterText]}>{f.label}</Text>
                  </LinearGradient>
                ) : (
                  <View style={styles.filterChip}>
                    <Text style={styles.filterText}>{f.label}</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>

      <FlatList
        data={tasks}
        renderItem={({ item, index }) => (
          <TaskCard
            item={item}
            index={index}
            distance={distances[item.id]}
            onOpen={showTaskDetails}
            onAccept={handleAccept}
            onReject={handleReject}
            onView={(id) => navigation.navigate('TaskExecution', { taskId: id })}
          />
        )}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F4A100" />}
        contentContainerStyle={styles.taskList}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>{'📋'}</Text>
            <Text style={styles.emptyText}>No bookings assigned to you yet</Text>
            <Text style={styles.emptySubtext}>
              When admin assigns a new customer booking to you, it will appear
              here automatically. Pull down to refresh, or check back in a
              moment.
            </Text>
          </View>
        }
      />

      {/* Task detail modal */}
      <Modal
        animationType="slide"
        transparent
        visible={detailModalVisible}
        onRequestClose={() => setDetailModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedTask && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Task Details</Text>
                  <TouchableOpacity
                    style={styles.closeButton}
                    onPress={() => setDetailModalVisible(false)}
                  >
                    <Text style={styles.closeButtonText}>×</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.modalBody}>
                  <DetailRow label="Customer" value={selectedTask.customerName} />
                  <DetailRow
                    label="Service"
                    value={selectedTask.serviceName || selectedTask.serviceType}
                  />
                  <DetailRow label="Address" value={formatBookingAddress(selectedTask.address)} />
                  <DetailRow label="Amount" value={`₹${selectedTask.amount}`} />
                  <DetailRow
                    label="Distance"
                    value={distances[selectedTask.id] || 'Calculating…'}
                  />
                  <View style={styles.detailSection}>
                    <Text style={styles.detailLabel}>Status</Text>
                    <View
                      style={[
                        styles.statusBadge,
                        {
                          backgroundColor: getStatusColor(selectedTask.status),
                          alignSelf: 'flex-start',
                          marginTop: 4,
                        },
                      ]}
                    >
                      <Text style={styles.statusText}>{getStatusText(selectedTask.status)}</Text>
                    </View>
                  </View>
                  <DetailRow
                    label="Created"
                    value={
                      selectedTask.createdAt
                        ? new Date(selectedTask.createdAt).toLocaleString()
                        : 'N/A'
                    }
                  />
                </ScrollView>

                <View style={styles.modalActions}>
                  {selectedTask.status === 'new' || (selectedTask.status as string) === 'pending' ? (
                    <>
                      <TouchableOpacity
                        style={[styles.modalButton, styles.rejectModalButton]}
                        onPress={() => {
                          setDetailModalVisible(false);
                          handleReject(selectedTask.id);
                        }}
                      >
                        <Text style={styles.rejectModalButtonText}>Reject</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.modalButton, styles.acceptModalButton]}
                        onPress={() => {
                          setDetailModalVisible(false);
                          handleAccept(selectedTask.id);
                        }}
                      >
                        <Text style={styles.acceptModalButtonText}>Accept Task</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity
                      style={[styles.modalButton, styles.viewModalButton]}
                      onPress={() => {
                        setDetailModalVisible(false);
                        navigation.navigate('TaskExecution', { taskId: selectedTask.id });
                      }}
                    >
                      <Text style={styles.viewModalButtonText}>View Details</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const DetailRow: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
  <View style={styles.detailSection}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFBEB' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFBEB' },
  loadingText: { fontSize: 15, color: '#475569', fontWeight: '600' },

  stickyTop: {
    backgroundColor: 'rgba(255,251,235,0.96)',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(15,23,42,0.05)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 3,
    zIndex: 2,
  },

  // paddingTop applied inline as insets.top + 12 so the header clears
  // the status bar / notch on every device (was a hardcoded 56).
  header: { paddingHorizontal: 16, paddingBottom: 10 },
  headerTitle: { fontSize: 26, fontWeight: '900', color: '#0F172A', letterSpacing: 0.3 },
  headerSubtitle: { fontSize: 12, color: '#64748B', marginTop: 2, fontWeight: '600' },
  headerAccent: { color: '#F4A100', fontWeight: '800' },

  filterContainer: { paddingHorizontal: 16 },
  filterChipWrap: { marginRight: 8 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB',
  },
  activeFilterChip: {
    borderWidth: 0,
    shadowColor: '#F4A100',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  filterText: { fontSize: 12, fontWeight: '700', color: '#475569', letterSpacing: 0.3 },
  activeFilterText: { color: '#0F172A' },

  taskList: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
  taskCard: {
    marginBottom: 12,
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FEF3C7',
    shadowColor: '#1E293B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 4,
  },
  taskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  taskInfo: { flex: 1, marginRight: 10 },
  customerName: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginBottom: 2 },
  serviceType: { fontSize: 13, color: '#475569' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 },
  taskDetails: { marginBottom: 12 },
  address: { fontSize: 13, color: '#475569', marginBottom: 6 },
  taskMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  amount: { fontSize: 17, fontWeight: '900', color: '#F4A100' },
  distance: { fontSize: 12, color: '#64748B', fontWeight: '700' },
  actionButtons: { flexDirection: 'row', gap: 10 },
  actionButton: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  acceptButton: {
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  rejectButton: {
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  viewButton: {
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  buttonGradient: { paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  acceptButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13, letterSpacing: 0.5 },
  rejectButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13, letterSpacing: 0.5 },
  viewButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13, letterSpacing: 0.5 },

  emptyContainer: { flex: 1, alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 42, marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#0F172A', fontWeight: '800', marginBottom: 4 },
  emptySubtext: {
    fontSize: 12, color: '#64748B', textAlign: 'center', paddingHorizontal: 40, lineHeight: 18,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A', letterSpacing: 0.2 },
  closeButton: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center', justifyContent: 'center',
  },
  closeButtonText: { fontSize: 20, color: '#475569', fontWeight: '700', lineHeight: 22 },
  modalBody: { maxHeight: 400 },
  detailSection: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  detailLabel: {
    fontSize: 11, fontWeight: '800', color: '#94A3B8',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4,
  },
  detailValue: { fontSize: 14, color: '#0F172A', fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  modalButton: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  acceptModalButton: {
    backgroundColor: '#10B981',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  rejectModalButton: { backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#DC2626' },
  viewModalButton: {
    backgroundColor: '#2563EB',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  acceptModalButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14, letterSpacing: 0.3 },
  rejectModalButtonText: { color: '#DC2626', fontWeight: '800', fontSize: 14, letterSpacing: 0.3 },
  viewModalButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14, letterSpacing: 0.3 },
});

export default TaskListScreen;

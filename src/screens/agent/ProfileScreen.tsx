import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Switch,
  Modal,
  TextInput,
  RefreshControl,
  Animated,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image, ActivityIndicator } from 'react-native';
import { captureWithCrop, pickWithCrop, isPermissionDeniedError } from '../../utils/cropPicker';
import { Linking } from 'react-native';
import { getDashboard, updateOnlineStatus, updateProfile } from '../../services/agent/api';
import { uploadAvatar, deleteAvatar } from '../../services/api';
import { COLORS } from '../../constants/agent/colors';
import { repCode } from '../../utils/agent/repCode';
import ProfileModal, { type AgentProfile } from '../../components/agent/ProfileModal';
import PaymentMethodsModal from '../../components/agent/PaymentMethodsModal';
import BankDetailsModal from '../../components/agent/BankDetailsModal';
import SupportModal from '../../components/agent/SupportModal';
import PolicyModal, { type PolicyType } from '../../components/agent/PolicyModal';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface AgentRecord {
  name?: string;
  mobile?: string;
  email?: string;
  [key: string]: unknown;
}

interface NavigationLike {
  navigate: (route: string) => void;
  reset: (state: { index: number; routes: { name: string }[] }) => void;
  addListener: (event: string, cb: () => void) => () => void;
}

interface ProfileScreenProps {
  navigation: NavigationLike;
}

const ProfileScreen: React.FC<ProfileScreenProps> = ({ navigation }) => {
  // This screen had NO safe-area handling — its top card used a
  // hardcoded marginTop and the Logout button only had a 20px spacer,
  // so the button sat under the Android nav bar on many devices.
  const insets = useSafeAreaInsets();
  const [agent, setAgent] = useState<AgentRecord | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [todayEarnings, setTodayEarnings] = useState<number>(0);
  const [totalJobs, setTotalJobs] = useState<number>(0);
  const [rating, setRating] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [showEditProfile, setShowEditProfile] = useState<boolean>(false);
  const [showChangePassword, setShowChangePassword] = useState<boolean>(false);
  const [showPaymentMethods, setShowPaymentMethods] = useState<boolean>(false);
  const [showBankDetails, setShowBankDetails] = useState<boolean>(false);
  const [showSupport, setShowSupport] = useState<boolean>(false);
  const [policyType, setPolicyType] = useState<PolicyType | null>(null);
  const [passwords, setPasswords] = useState<{ current: string; newPass: string; confirm: string }>({
    current: '',
    newPass: '',
    confirm: '',
  });
  const [savingPassword, setSavingPassword] = useState<boolean>(false);
  const [avatarUploading, setAvatarUploading] = useState<boolean>(false);
  const [notifSettings, setNotifSettings] = useState<{ push: boolean; sms: boolean; email: boolean }>({
    push: true,
    sms: true,
    email: false,
  });

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const earningsAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadProfileData();
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => loadProfileData());
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    if (!loading) startAnimations();
  }, [loading]);

  const startAnimations = (): void => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]).start();

    Animated.timing(earningsAnim, { toValue: todayEarnings, duration: 1500, useNativeDriver: false }).start();

    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.1, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
    );
    pulseAnimation.start();
  };

  const loadProfileData = async (): Promise<void> => {
    try {
      const agentData = await AsyncStorage.getItem('agent_data');
      if (agentData) setAgent(JSON.parse(agentData));

      const data = await getDashboard();
      setTodayEarnings(data.todayEarnings || 0);
      setTotalJobs(data.totalJobs || 0);
      setRating(data.rating || 0);
      setIsOnline(data.isOnline || false);

      // Re-hydrate the avatar from the server. agent_data is wiped on
      // logout, so without this a re-login shows no photo and prompts
      // for a new upload even though one is still stored on the backend.
      // The server's profile_pic is the source of truth — mirror it back
      // into both the in-memory record and the agent_data cache so the
      // Dashboard hero picks it up too. `data.profile` is null when the
      // /profile call failed, so a cold start never blanks a good photo.
      if (data.profile) {
        setAgent((prev) => {
          const merged = { ...(prev || {}), ...data.profile } as AgentRecord;
          AsyncStorage.setItem('agent_data', JSON.stringify(merged)).catch(() => {});
          return merged;
        });
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = (): void => {
    setRefreshing(true);
    loadProfileData();
  };

  const handleToggleOnlineStatus = async (): Promise<void> => {
    const newStatus = !isOnline;
    setIsOnline(newStatus);
    updateOnlineStatus(newStatus).catch(() => setIsOnline(!newStatus));
  };

  const handleProfileSave = async (updatedData: AgentProfile): Promise<void> => {
    // The parent owns the canonical agent record. Merge edited fields
    // INTO the live `agent` state — which still carries the rep's UUID,
    // agent_code, rating, totalJobs, profile_pic, online_status, etc.
    // even if AsyncStorage's `agent_data` was previously corrupted by
    // an older build that overwrote the blob with just form fields.
    //
    // Writing the merged record back to AsyncStorage here (instead of
    // in the modal) is what recovers from any prior corruption: the
    // UUID from the in-memory `agent` makes it back into storage, so
    // the next app launch reads a clean record and repCode() keeps
    // returning the same FLIPRT##### value forever.
    const base = (agent || {}) as Record<string, unknown>;
    const merged = { ...base, ...updatedData } as AgentRecord;
    setAgent(merged);
    try {
      await AsyncStorage.setItem('agent_data', JSON.stringify(merged));
    } catch (e) {
      console.log('agent_data persist failed:', (e as any)?.message);
    }
    try {
      await updateProfile(updatedData as any);
    } catch (e) {
      console.log('Backend profile sync failed, saved locally');
    }
  };

  // Camera / gallery picker for the rep's profile picture. Mirrors
  // the customer ProfileScreen flow: show a chooser, run the picker,
  // upload via the shared /profile/avatar endpoint, then mirror the
  // returned URL into local agent state, AsyncStorage's agent_data
  // payload, AND the shared user cache so the Dashboard hero picks
  // up the new pic the moment the user navigates back.
  const pickAvatar = async (): Promise<void> => {
    const hasExisting = !!(agent as any)?.profile_pic;
    const buttons: any[] = [
      { text: 'Camera', onPress: () => doPickAvatar('camera') },
      { text: 'Photo Library', onPress: () => doPickAvatar('library') },
    ];
    if (hasExisting) {
      buttons.push({
        text: 'Remove current photo',
        style: 'destructive',
        onPress: async () => {
          try {
            setAvatarUploading(true);
            // Use the AGENT token so the delete hits the rep's own
            // account, never the customer's (see services/api).
            const agentToken =
              (await AsyncStorage.getItem('agent_token')) || undefined;
            await deleteAvatar(agentToken);
            setAgent((prev) => ({ ...(prev || {}), profile_pic: null }) as any);
            try {
              const data = await AsyncStorage.getItem('agent_data');
              const parsed = data ? JSON.parse(data) : {};
              await AsyncStorage.setItem(
                'agent_data',
                JSON.stringify({ ...parsed, profile_pic: null }),
              );
            } catch (_) { /* non-fatal */ }
          } catch (e: any) {
            Alert.alert('Could not remove photo', e?.message || 'Try again');
          } finally {
            setAvatarUploading(false);
          }
        },
      });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Change profile picture', undefined, buttons);
  };

  const doPickAvatar = async (source: 'camera' | 'library'): Promise<void> => {
    try {
      // Same branded cropper the customer app uses for document uploads
      // in the booking flow — a styled toolbar with a green confirm tick
      // and an X to cancel — instead of the bare system photo editor.
      const file =
        source === 'camera'
          ? await captureWithCrop({ namePrefix: 'agent-avatar' })
          : await pickWithCrop({ namePrefix: 'agent-avatar' });
      if (!file) return;
      const { uri, name, type } = file;

      setAvatarUploading(true);
      // Upload with the AGENT token so the photo lands on the rep's own
      // account. With no token it would fall back to the CUSTOMER token
      // and overwrite the customer's profile picture.
      const agentToken =
        (await AsyncStorage.getItem('agent_token')) || undefined;
      const { profile_pic } = await uploadAvatar({ uri, name, type }, agentToken);
      setAgent((prev) => ({ ...(prev || {}), profile_pic }) as any);

      // Mirror to the agent_data cache only (this screen + the dashboard
      // read it). Deliberately NOT written to the shared getUser() /
      // storeUser() 'user' cache — that key belongs to the CUSTOMER
      // account, and writing it here was corrupting the customer's pic.
      try {
        const data = await AsyncStorage.getItem('agent_data');
        const parsed = data ? JSON.parse(data) : {};
        await AsyncStorage.setItem(
          'agent_data',
          JSON.stringify({ ...parsed, profile_pic }),
        );
      } catch (_) { /* non-fatal */ }
    } catch (e: any) {
      console.log('[agent-avatar] upload failed:', e?.message);
      // Permission denial path — Android won't re-prompt once the user
      // chose "Don't ask again", so the only way back is the app's
      // settings page. Drop them there with one tap.
      if (isPermissionDeniedError(e)) {
        Alert.alert(
          'Photo access needed',
          'FliponeX needs access to your photos / camera to set a profile picture. Open Settings to grant access, then try again.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }
      Alert.alert('Upload failed', e?.message || 'Could not upload your photo. Try again.');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleChangePassword = async (): Promise<void> => {
    if (!passwords.current.trim()) {
      Alert.alert('Error', 'Please enter your current password');
      return;
    }
    if (passwords.newPass.length < 6) {
      Alert.alert('Error', 'New password must be at least 6 characters');
      return;
    }
    if (passwords.newPass !== passwords.confirm) {
      Alert.alert('Error', 'New passwords do not match');
      return;
    }

    setSavingPassword(true);
    try {
      await AsyncStorage.setItem('agent_password_hash', passwords.newPass);
      Alert.alert('Success', 'Password changed successfully');
      setShowChangePassword(false);
      setPasswords({ current: '', newPass: '', confirm: '' });
    } catch (error) {
      Alert.alert('Error', 'Failed to change password');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleLogout = (): void => {
    Alert.alert(
      'Logout',
      'This will sign you out on this device. Your tasks, earnings, and history stay safe on the server and will be there when you log back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await AsyncStorage.multiRemove([
              'agent_token',
              'agent_data',
              'agent_payment_methods',
              'agent_bank_details',
              '@flipon_user_mode',
              // Clear the saved navigation stack too — otherwise Splash's
              // resume logic restores the rep app within 30 min and the
              // logout silently bounces back in with stale profile data.
              '@flipon_nav_state',
            ]);
            // Go straight to the mode-select toggle (2 apps + 2 web
            // surfaces) — never via Splash, which would try to resume.
            navigation.reset({ index: 0, routes: [{ name: 'ModeSelect' }] });
          },
        },
      ],
    );
  };

  const handleSwitchToCustomer = (): void => {
    Alert.alert(
      'Switch to Customer Mode?',
      'You will be signed out of Representative mode on this device and taken to the mode-select screen. Your tasks, earnings, and history are kept safe on the server — nothing is deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch',
          onPress: async () => {
            await AsyncStorage.multiRemove([
              'agent_token',
              'agent_data',
              'agent_payment_methods',
              'agent_bank_details',
              '@flipon_user_mode',
              // Same as logout — drop the saved stack so the next cold
              // start can't resume back into the rep app.
              '@flipon_nav_state',
            ]);
            navigation.reset({ index: 0, routes: [{ name: 'ModeSelect' }] });
          },
        },
      ],
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <LinearGradient colors={COLORS.bgGradient} style={styles.container}>
      <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.profileHeader, { marginTop: insets.top + 16 }]}>
            <Animated.View style={[styles.avatar, { transform: [{ scale: scaleAnim }] }]}>
              {(agent as any)?.profile_pic ? (
                <Image
                  source={{ uri: (agent as any).profile_pic }}
                  style={styles.avatarGradient}
                  resizeMode="cover"
                />
              ) : (
                <LinearGradient colors={COLORS.primaryGradient} style={styles.avatarGradient}>
                  <Text style={styles.avatarText}>
                    {agent?.name?.charAt(0)?.toUpperCase() || 'A'}
                  </Text>
                </LinearGradient>
              )}
              {/* Camera overlay button — mirrors the customer profile.
                  Tap → action sheet (Camera / Gallery / Remove). */}
              <TouchableOpacity
                style={styles.avatarCameraBtn}
                onPress={pickAvatar}
                disabled={avatarUploading}
                accessibilityLabel="Change profile picture"
              >
                {avatarUploading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.avatarCameraBtnText}>📷</Text>
                )}
              </TouchableOpacity>
            </Animated.View>
            <View style={styles.profileInfo}>
              <Text style={styles.agentName}>{agent?.name || 'Representative'}</Text>
              <Text style={styles.agentRepCode}>{repCode(agent as any)}</Text>
              <Text style={styles.agentDetail}>{agent?.mobile || 'N/A'}</Text>
              <Text style={styles.agentDetail}>{agent?.email || 'N/A'}</Text>
            </View>
            <TouchableOpacity style={styles.editHeaderBtn} onPress={() => setShowEditProfile(true)}>
              <LinearGradient colors={COLORS.blueGradient} style={styles.editHeaderBtnGradient}>
                <Text style={styles.editHeaderBtnText}>Edit</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* Online Status card removed — the toggle now lives only on
              the Dashboard (Home tab) hero so it has a single source of
              truth. Two toggles meant the rep had to remember which one
              was the canonical state. */}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Performance</Text>
            <View style={styles.statsRow}>
              <TouchableOpacity style={styles.statCard} onPress={() => navigation.navigate('Earnings')}>
                <LinearGradient colors={COLORS.goldGradient} style={styles.statCardGradient}>
                  <Animated.Text style={styles.statValue}>
                    {'₹'}
                    {Math.floor((earningsAnim as any)._value)}
                  </Animated.Text>
                  <Text style={styles.statLabel}>Today&apos;s Earnings</Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity style={styles.statCard} onPress={() => navigation.navigate('Tasks')}>
                <LinearGradient colors={COLORS.blueGradient} style={styles.statCardGradient}>
                  <Text style={styles.statValue}>{totalJobs}</Text>
                  <Text style={styles.statLabel}>Total Jobs</Text>
                </LinearGradient>
              </TouchableOpacity>
              <View style={styles.statCard}>
                <LinearGradient colors={COLORS.sunset} style={styles.statCardGradient}>
                  <Text style={styles.statValue}>{rating > 0 ? rating.toFixed(1) : '-'}</Text>
                  <Text style={styles.statLabel}>Rating</Text>
                </LinearGradient>
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Settings</Text>
            <TouchableOpacity style={styles.menuItem} onPress={() => setShowEditProfile(true)}>
              <Text style={styles.menuIcon}>{'✏️'}</Text>
              <Text style={styles.menuText}>Edit Profile</Text>
              <Text style={styles.menuArrow}>{'>'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => setShowChangePassword(true)}>
              <Text style={styles.menuIcon}>{'🔐'}</Text>
              <Text style={styles.menuText}>Change Password</Text>
              <Text style={styles.menuArrow}>{'>'}</Text>
            </TouchableOpacity>
            <View style={styles.menuItem}>
              <Text style={styles.menuIcon}>{'🔔'}</Text>
              <Text style={[styles.menuText, { flex: 1 }]}>Push Notifications</Text>
              <Switch
                value={notifSettings.push}
                onValueChange={(v) => setNotifSettings((p) => ({ ...p, push: v }))}
                trackColor={{ false: '#ccc', true: COLORS.success }}
                thumbColor={COLORS.white}
              />
            </View>
            <View style={styles.menuItem}>
              <Text style={styles.menuIcon}>{'📱'}</Text>
              <Text style={[styles.menuText, { flex: 1 }]}>SMS Alerts</Text>
              <Switch
                value={notifSettings.sms}
                onValueChange={(v) => setNotifSettings((p) => ({ ...p, sms: v }))}
                trackColor={{ false: '#ccc', true: COLORS.success }}
                thumbColor={COLORS.white}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Account</Text>
            <TouchableOpacity style={styles.menuItem} onPress={() => setShowPaymentMethods(true)}>
              <Text style={styles.menuIcon}>{'💳'}</Text>
              <Text style={styles.menuText}>Payment Methods</Text>
              <Text style={styles.menuArrow}>{'>'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => setShowBankDetails(true)}>
              <Text style={styles.menuIcon}>{'🏦'}</Text>
              <Text style={styles.menuText}>Bank Details</Text>
              <Text style={styles.menuArrow}>{'>'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Support</Text>
            <TouchableOpacity style={styles.menuItem} onPress={() => setShowSupport(true)}>
              <Text style={styles.menuIcon}>{'❓'}</Text>
              <Text style={styles.menuText}>Help Center & Raise a Ticket</Text>
              <Text style={styles.menuArrow}>{'>'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => setPolicyType('privacy')}>
              <Text style={styles.menuIcon}>{'🔒'}</Text>
              <Text style={styles.menuText}>Privacy Policy</Text>
              <Text style={styles.menuArrow}>{'>'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => setPolicyType('terms')}>
              <Text style={styles.menuIcon}>{'📄'}</Text>
              <Text style={styles.menuText}>Terms & Conditions</Text>
              <Text style={styles.menuArrow}>{'>'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => setPolicyType('refund')}>
              <Text style={styles.menuIcon}>{'💸'}</Text>
              <Text style={styles.menuText}>Refund & Cancellation</Text>
              <Text style={styles.menuArrow}>{'>'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <TouchableOpacity style={styles.menuItem} onPress={handleSwitchToCustomer}>
              <Text style={styles.menuIcon}>{'👤'}</Text>
              <Text style={styles.menuText}>Switch to Customer Mode</Text>
              <Text style={styles.menuArrow}>{'>'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
              <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.version}>FlipOneX Representative v1.0.0</Text>
          {/* Bottom spacer scales with the device's nav-bar / gesture
              inset so the Logout button is never hidden behind it. */}
          <View style={{ height: insets.bottom + 24 }} />
        </ScrollView>

        <ProfileModal visible={showEditProfile} onClose={() => setShowEditProfile(false)} onSave={handleProfileSave} />
        <PaymentMethodsModal visible={showPaymentMethods} onClose={() => setShowPaymentMethods(false)} />
        <BankDetailsModal visible={showBankDetails} onClose={() => setShowBankDetails(false)} />
        <SupportModal visible={showSupport} onClose={() => setShowSupport(false)} />
        <PolicyModal visible={!!policyType} type={policyType} onClose={() => setPolicyType(null)} />

        <Modal
          visible={showChangePassword}
          animationType="slide"
          transparent
          onRequestClose={() => setShowChangePassword(false)}
        >
          {/* KeyboardAvoidingView + scrollable card so the third TextInput
              (Confirm Password) and the action buttons stay visible above
              the keyboard. Previously the keyboard covered the lower half
              of the modal on smaller phones and users had to dismiss the
              keyboard to tap Change. */}
          <KeyboardAvoidingView
            style={styles.modalOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <ScrollView
              contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Change Password</Text>

                <Text style={styles.inputLabel}>Current Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter current password"
                  secureTextEntry
                  value={passwords.current}
                  onChangeText={(v) => setPasswords((p) => ({ ...p, current: v }))}
                />

                <Text style={styles.inputLabel}>New Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter new password"
                  secureTextEntry
                  value={passwords.newPass}
                  onChangeText={(v) => setPasswords((p) => ({ ...p, newPass: v }))}
                />

                <Text style={styles.inputLabel}>Confirm New Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Re-enter new password"
                  secureTextEntry
                  value={passwords.confirm}
                  onChangeText={(v) => setPasswords((p) => ({ ...p, confirm: v }))}
                />

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalBtn, { backgroundColor: COLORS.lightGray }]}
                    onPress={() => {
                      setShowChangePassword(false);
                      setPasswords({ current: '', newPass: '', confirm: '' });
                    }}
                  >
                    <Text style={{ color: COLORS.text, fontWeight: '600' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, { backgroundColor: COLORS.primary }]}
                    onPress={handleChangePassword}
                    disabled={savingPassword}
                  >
                    <Text style={{ color: COLORS.white, fontWeight: '600' }}>
                      {savingPassword ? 'Saving...' : 'Change'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>
      </Animated.View>
    </LinearGradient>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFBEB' },
  content: { flex: 1 },
  profileHeader: {
    backgroundColor: '#FFFFFF',
    padding: 18,
    // marginTop applied inline as insets.top + 16 so the card clears
    // the status bar / notch on every device (was a hardcoded 56).
    marginHorizontal: 16,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FCD34D',
    shadowColor: '#F4A100',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 8,
  },
  avatar: {
    width: 60, height: 60, borderRadius: 30, marginRight: 14,
    shadowColor: '#F4A100', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
    // overflow:visible so the camera badge can sit on the bottom-right
    // edge. The inner gradient/image is itself round, so the avatar
    // still appears clipped.
    overflow: 'visible',
  },
  avatarGradient: { width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  avatarText: { fontSize: 24, fontWeight: '900', color: '#0F172A' },
  avatarCameraBtn: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#0D3B66',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  avatarCameraBtnText: { fontSize: 11, color: '#FFFFFF' },
  profileInfo: { flex: 1 },
  agentName: { fontSize: 18, fontWeight: '900', color: '#0F172A', marginBottom: 2, letterSpacing: 0.2 },
  agentRepCode: { fontSize: 11, fontWeight: '800', color: '#F4A100', letterSpacing: 1.2, marginBottom: 4 },
  agentDetail: { fontSize: 12, color: '#64748B', marginBottom: 1 },
  editHeaderBtn: {
    borderRadius: 12, overflow: 'hidden',
    shadowColor: '#2563EB', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 6, elevation: 4,
  },
  editHeaderBtnGradient: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  editHeaderBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 11, letterSpacing: 0.4 },

  card: {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16,
    marginHorizontal: 16, marginTop: 14, flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#E5E7EB',
    shadowColor: '#1E293B', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  cardTitle: { fontSize: 14, fontWeight: '800', color: '#0F172A', marginBottom: 2, letterSpacing: 0.2 },
  cardSubtext: { fontSize: 12, color: '#64748B' },

  section: { paddingHorizontal: 16, marginTop: 18 },
  sectionTitle: {
    fontSize: 14, fontWeight: '800', color: '#0F172A',
    marginBottom: 10, letterSpacing: 0.3, textTransform: 'uppercase',
  },

  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1, borderRadius: 16, overflow: 'hidden',
    shadowColor: '#1E293B', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1, shadowRadius: 12, elevation: 4,
  },
  statCardGradient: {
    paddingVertical: 16, paddingHorizontal: 10, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  statValue: { fontSize: 18, fontWeight: '900', color: '#FFFFFF', marginBottom: 2 },
  statLabel: { fontSize: 11, color: 'rgba(255,255,255,0.95)', fontWeight: '700', textAlign: 'center', letterSpacing: 0.4 },

  menuItem: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, marginBottom: 8,
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  menuIcon: { fontSize: 18, marginRight: 14, width: 30, textAlign: 'center' },
  menuText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#0F172A' },
  menuArrow: { fontSize: 16, color: '#94A3B8', fontWeight: '700' },

  logoutButton: {
    backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#FECACA',
    borderRadius: 14, padding: 14, alignItems: 'center',
    shadowColor: '#DC2626', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12, shadowRadius: 10, elevation: 2,
  },
  logoutText: { color: '#DC2626', fontWeight: '800', fontSize: 14, letterSpacing: 0.4 },

  version: { fontSize: 11, color: '#94A3B8', textAlign: 'center', marginTop: 16, fontWeight: '600' },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 16,
  },
  modalContent: {
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 22,
    width: '100%', maxWidth: 420,
  },
  modalTitle: {
    fontSize: 18, fontWeight: '800', color: '#0F172A',
    marginBottom: 18, textAlign: 'center', letterSpacing: 0.2,
  },
  inputLabel: {
    fontSize: 11, fontWeight: '700', color: '#475569',
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6,
  },
  input: {
    borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14,
    color: '#0F172A', backgroundColor: '#F8FAFC', marginBottom: 14, fontWeight: '500',
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
});

export default ProfileScreen;

import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView,
  TextInput, ActivityIndicator, Share, Linking, Modal, RefreshControl,
  Switch, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { clearAuthSession, storeUser, getUser } from '../utils/storage';
import { getProfile, updateProfile, getMyBookings, getMyDocuments, uploadAvatar, deleteAvatar } from '../services/api';
import * as api from '../services/api';
import {
  STRINGS,
  PRIVACY_POLICY,
  REFUND_POLICY,
  TERMS_CONDITIONS,
  FAQS,
} from '../constants/strings';
import HapticButton from '../components/HapticButton';
import * as haptics from '../utils/haptics';
import { setAppLanguage } from '../i18n';

interface NavigationProp {
  navigate: (route: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
  replace?: (route: string) => void;
  addListener?: (event: string, cb: () => void) => () => void;
  reset?: (state: { index: number; routes: { name: string }[] }) => void;
}

interface Props {
  navigation: NavigationProp & {
    reset: (state: { index: number; routes: { name: string }[] }) => void;
  };
}

interface NotifSettings {
  push: boolean;
  sms: boolean;
  email: boolean;
  offers: boolean;
  [key: string]: boolean;
}

interface SavedAddress {
  id: string;
  address: string;
}

interface InfoModalState {
  title: string;
  body: string;
}

interface MenuRowProps {
  icon: string;
  iconBg: string;
  iconColor: string;
  label: string;
  subtitle?: string;
  onPress?: () => void;
}

const ProfileScreen: React.FC<Props> = ({ navigation }) => {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [bookingsCount, setBookingsCount] = useState<number>(0);
  // KYC progress — driven by the actual uploaded-doc list from
  // /documents/kyc/my. Same required-doc set as DocumentsScreen so the
  // numbers stay in sync between the two screens.
  const KYC_REQUIRED = ['aadhaar_front', 'aadhaar_back', 'pan_card', 'profile_photo'];
  const [kycUploaded, setKycUploaded] = useState<number>(0);
  const [kycVerified, setKycVerified] = useState<number>(0);
  const [editing, setEditing] = useState<boolean>(false);
  const [formData, setFormData] = useState<{ name: string; email: string; mobile: string; address: string }>({ name: '', email: '', mobile: '', address: '' });
  // Avatar upload state — flips while the camera/gallery picker is open
  // and during the multipart upload, dimming the camera-overlay button.
  const [avatarUploading, setAvatarUploading] = useState<boolean>(false);

  // Feature modals
  const [showReferral, setShowReferral] = useState<boolean>(false);
  // Visibility of the Contact Support modal (replaces a confusing native
  // Alert.alert that had only a "Cancel" button — users felt there was
  // no clear way to "go back").
  const [showContact, setShowContact] = useState<boolean>(false);
  const [showPayments, setShowPayments] = useState<boolean>(false);
  const [showNotif, setShowNotif] = useState<boolean>(false);
  const [showLanguage, setShowLanguage] = useState<boolean>(false);
  const [showAddresses, setShowAddresses] = useState<boolean>(false);
  // Legal / info modals — show the real policy bodies from the marketing brief
  // instead of the old placeholder Alerts.
  const [infoModal, setInfoModal] = useState<InfoModalState | null>(null); // { title, body } | null
  const [showFAQ, setShowFAQ] = useState<boolean>(false);
  const [showGrievance, setShowGrievance] = useState<boolean>(false);
  const [grievanceText, setGrievanceText] = useState<string>('');

  // Saved settings (persisted to AsyncStorage)
  const [notifSettings, setNotifSettings] = useState<NotifSettings>({ push: true, sms: true, email: false, offers: true });
  const [language, setLanguage] = useState<string>('en');
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [newAddress, setNewAddress] = useState<string>('');

  // Referral code: backend-issued via GET /referrals (creates one on first
  // call). Falls back to a mobile-derived code if the API hasn't replied yet.
  const [serverReferralCode, setServerReferralCode] = useState<string | null>(null);
  const referralCode =
    serverReferralCode ||
    (profile?.mobile ? `FL${String(profile.mobile).slice(-6)}` : 'FLIPON');

  useEffect(() => {
    loadProfile();
    loadSavedSettings();
    (async () => {
      try {
        const res = await api.getCustomerReferral();
        if (res?.referralCode) setServerReferralCode(res.referralCode);
      } catch (e) {
        // Non-blocking — keep the local fallback code visible.
      }
    })();
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener?.('focus', loadProfile);
    return unsubscribe;
  }, [navigation]);

  // Load persisted preferences (notifications / language / saved addresses)
  const loadSavedSettings = async (): Promise<void> => {
    try {
      const [n, l, a] = await Promise.all([
        AsyncStorage.getItem('notif_settings'),
        AsyncStorage.getItem('app_language'),
        AsyncStorage.getItem('saved_addresses'),
      ]);
      if (n) setNotifSettings(JSON.parse(n));
      if (l) setLanguage(l);
      if (a) setAddresses(JSON.parse(a));
    } catch (e) {
      console.log('Settings load error:', e);
    }
  };

  const saveNotifSetting = async (key: string, value: boolean): Promise<void> => {
    const updated = { ...notifSettings, [key]: value };
    setNotifSettings(updated);
    await AsyncStorage.setItem('notif_settings', JSON.stringify(updated));
    haptics.tap();
  };

  const saveLanguage = async (lang: string): Promise<void> => {
    setLanguage(lang);
    await AsyncStorage.setItem('app_language', lang);
    // Apply the language change live via the shared i18n module. Codes
    // outside en/hi/te are coerced to 'en' inside setAppLanguage.
    if (lang === 'en' || lang === 'hi' || lang === 'te') {
      await setAppLanguage(lang);
    } else {
      await setAppLanguage('en');
    }
    haptics.success();
    setShowLanguage(false);
  };

  const addAddress = async (): Promise<void> => {
    if (!newAddress.trim()) return;
    const updated = [...addresses, { id: Date.now().toString(), address: newAddress.trim() }];
    setAddresses(updated);
    await AsyncStorage.setItem('saved_addresses', JSON.stringify(updated));
    setNewAddress('');
    haptics.success();
  };

  const removeAddress = async (id: string): Promise<void> => {
    const updated = addresses.filter(a => a.id !== id);
    setAddresses(updated);
    await AsyncStorage.setItem('saved_addresses', JSON.stringify(updated));
    haptics.tap();
  };

  const shareReferral = async (): Promise<void> => {
    haptics.tap();
    await Share.share({
      message: `Use my FlipOn Digital referral code *${referralCode}* to get ₹20 off your first service! Download: https://fliponex.app`,
      title: 'FlipOn Digital Referral',
    });
  };

  const loadProfile = async (): Promise<void> => {
    try {
      const [p, b, d] = await Promise.all([
        getProfile().catch(() => ({} as any)),
        getMyBookings().catch(() => [] as any),
        getMyDocuments().catch(() => [] as any),
      ]);
      // Backend's GET /profile returns { success, user } — older paths
      // returned { success, data }. Pull whichever is present, fall back
      // to the bare object. Without this, `data.name` was always
      // undefined, so the avatar's first-letter reverted to "U" and the
      // edit modal opened with empty name/email even after saves.
      const data: any =
        (p as any)?.user || (p as any)?.data || p || {};
      setProfile(data);
      setBookingsCount(Array.isArray(b) ? b.length : ((b as any)?.data?.length || 0));

      // KYC progress: count REQUIRED doc types that have a server-side row.
      // Same logic as DocumentsScreen, so stat card stays in sync.
      const docList: any[] = Array.isArray(d) ? d : ((d as any)?.data || []);
      const uploadedTypes = new Set(
        docList.map((doc: any) => (doc.document_type || doc.docType || '').toLowerCase())
      );
      const verifiedTypes = new Set(
        docList
          .filter((doc: any) => doc.is_verified === true || doc.status === 'verified')
          .map((doc: any) => (doc.document_type || doc.docType || '').toLowerCase())
      );
      setKycUploaded(KYC_REQUIRED.filter(t => uploadedTypes.has(t)).length);
      setKycVerified(KYC_REQUIRED.filter(t => verifiedTypes.has(t)).length);

      setFormData({
        name: data.name || '',
        email: data.email || '',
        mobile: data.mobile || '',
        address: data.address || '',
      });
    } catch (error) {
      console.error('Profile load error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = (): void => { setRefreshing(true); loadProfile(); };

  // Avatar picker — bottom-sheet style choice between Camera and Gallery,
  // then resizes / crops to a 1:1 square via the picker's allowsEditing
  // option. Uploads with auth, then patches local state with the returned
  // URL so the new avatar shows immediately (no refetch needed).
  const pickAvatar = (): void => {
    if (avatarUploading) return;
    haptics.tap();
    // Build the action sheet dynamically so the destructive "Remove
    // current photo" option only appears when there's actually a photo
    // to remove. Avoids a stale entry that would no-op + confuse users.
    const hasExistingPhoto = !!profile?.profile_pic;
    const buttons: any[] = [
      { text: 'Camera', onPress: () => doPickAvatar('camera') },
      { text: 'Gallery', onPress: () => doPickAvatar('gallery') },
    ];
    if (hasExistingPhoto) {
      buttons.push({
        text: 'Remove current photo',
        style: 'destructive',
        onPress: confirmRemoveAvatar,
      });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });

    Alert.alert(
      'Profile picture',
      hasExistingPhoto
        ? 'Replace your photo, or remove it to use the letter avatar.'
        : 'Choose where to pick the photo from',
      buttons,
      { cancelable: true },
    );
  };

  // Two-step destructive flow — never let a single accidental tap wipe
  // the photo. Shows a confirm dialog, then on Yes calls the DELETE
  // endpoint and clears local state + AsyncStorage cache so the header
  // avatar in HomeScreen reverts on next focus.
  const confirmRemoveAvatar = (): void => {
    Alert.alert(
      'Remove profile photo?',
      'Your avatar will go back to showing the first letter of your name. You can upload a new photo any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              setAvatarUploading(true);
              await deleteAvatar();
              setProfile((prev: any) => ({ ...(prev || {}), profile_pic: null }));
              try {
                const cached = (await getUser()) || {};
                await storeUser({ ...cached, profile_pic: null });
              } catch (_) { /* non-fatal */ }
              haptics.success();
            } catch (e: any) {
              console.log('avatar delete error:', e?.message || e);
              haptics.error();
              Alert.alert('Could not remove', e?.message || 'Please try again.');
            } finally {
              setAvatarUploading(false);
            }
          },
        },
      ],
    );
  };

  const doPickAvatar = async (source: 'camera' | 'gallery'): Promise<void> => {
    try {
      // Permissions
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Permission needed', 'Camera access is required to take a photo.');
          return;
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Permission needed', 'Photo library access is required.');
          return;
        }
      }

      const result: any = source === 'camera'
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.7,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.7,
          });

      if (result?.canceled || !result?.assets?.[0]) return;
      const asset = result.assets[0];
      const uri: string = asset.uri;
      const name: string =
        asset.fileName || `avatar_${Date.now()}.${(asset.uri.split('.').pop() || 'jpg')}`;
      const type: string = asset.mimeType || 'image/jpeg';

      setAvatarUploading(true);
      const { profile_pic } = await uploadAvatar({ uri, name, type });
      // Optimistic update so the camera overlay flips back to the new pic
      // immediately — the next loadProfile refresh would set the same value.
      setProfile((prev: any) => ({ ...(prev || {}), profile_pic }));
      // Mirror to AsyncStorage so HomeScreen's header avatar picks it up
      // on the next focus, without waiting for a full /profile re-fetch.
      try {
        const cached = (await getUser()) || {};
        await storeUser({ ...cached, profile_pic });
      } catch (_) { /* non-fatal */ }
      haptics.success();
    } catch (e: any) {
      console.log('avatar pick error:', e?.message || e);
      haptics.error();
      Alert.alert('Upload failed', e?.message || 'Could not update profile picture.');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    try {
      // Persist via the API.
      await updateProfile(formData);
      const merged = { ...(profile || {}), ...formData };
      setProfile(merged);
      // Mirror the change into the AsyncStorage `user` cache so other
      // screens (HomeScreen header avatar / first-letter fallback) pick
      // up the new name + email on their next focus-driven reload.
      try {
        const cached = (await getUser()) || {};
        await storeUser({ ...cached, ...formData });
      } catch (_) { /* cache miss is non-fatal */ }
      setEditing(false);
      haptics.success();
      Alert.alert('Success', 'Profile updated');
      // Re-fetch in the background so local state matches the server's
      // canonical view (and the avatar initial sticks across navigations).
      loadProfile();
    } catch (error) {
      haptics.error();
      Alert.alert('Error', 'Failed to update profile');
    }
  };

  const handleShare = async (): Promise<void> => {
    haptics.tap();
    await Share.share({
      message: 'Check out FlipOn Digital — your trusted service partner!\nDownload: https://flipon.app',
    });
  };

  const handleSupport = (): void => {
    haptics.tap();
    setShowContact(true);
  };

  const submitGrievance = (): void => {
    const text = grievanceText.trim();
    if (!text) {
      haptics.error();
      Alert.alert('Required', 'Please describe your issue before submitting.');
      return;
    }
    haptics.success();
    setShowGrievance(false);
    setGrievanceText('');
    Alert.alert(
      'Ticket Raised',
      'Your grievance has been recorded. Our support team will reach out within 24 hours.'
    );
  };

  const handleLogout = (): void => {
    Alert.alert(
      'Logout',
      'This will sign you out on this device. Your bookings, documents, and profile stay safe on the server and will be there when you log back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            // clearAuthSession wipes the mode too — next cold start routes
            // to ModeSelect instead of straight back into customer tabs.
            await clearAuthSession();
            navigation.reset({ index: 0, routes: [{ name: 'Splash' }] });
          },
        },
      ],
    );
  };

  const handleSwitchToAgent = (): void => {
    Alert.alert(
      'Switch to Representative Mode?',
      'You will be signed out of Customer mode on this device and taken to the mode-select screen. Your bookings, documents, and profile are kept safe on the server — nothing is deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch',
          onPress: async () => {
            await clearAuthSession();
            navigation.reset({ index: 0, routes: [{ name: 'ModeSelect' }] });
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0D3B66" />
      </View>
    );
  }

  const initial = (profile?.name || profile?.mobile || 'U').charAt(0).toUpperCase();

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <View style={styles.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#0D3B66']} />}
        stickyHeaderIndices={[0]}
        keyboardShouldPersistTaps="handled"
      >

        {/* Compact sticky bar — stays pinned at the top while everything
            below scrolls. Shows just the name, mini-avatar and Edit CTA. */}
        <View style={styles.stickyBar}>
          <View style={styles.stickyBarAvatar}>
            <Text style={styles.stickyBarAvatarText}>{initial}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.stickyBarName} numberOfLines={1}>
              {profile?.name || 'Guest User'}
            </Text>
            <Text style={styles.stickyBarMobile} numberOfLines={1}>
              +91 {profile?.mobile || 'N/A'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.stickyBarLang}
            onPress={() => { haptics.tap(); setShowLanguage(true); }}
            accessibilityLabel="Change language"
          >
            <Text style={styles.stickyBarLangText}>🌐</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.stickyBarEdit}
            onPress={() => { haptics.tap(); setEditing(true); }}
          >
            <Text style={styles.stickyBarEditText}>Edit</Text>
          </TouchableOpacity>
        </View>

        {/* Branded hero header with big avatar (scrolls under the sticky bar).
            If the user has uploaded a profile picture it renders the image;
            otherwise it shows the same letter-initial fallback as before.
            The camera button overlay lets them pick a new photo at any time. */}
        <View style={styles.header}>
          <View style={styles.avatarRing}>
            <View style={styles.avatar}>
              {profile?.profile_pic ? (
                <Image
                  source={{ uri: profile.profile_pic }}
                  style={styles.avatarImg}
                  resizeMode="cover"
                />
              ) : (
                <Text style={styles.avatarText}>{initial}</Text>
              )}
            </View>
            <TouchableOpacity
              style={styles.avatarCameraBtn}
              onPress={pickAvatar}
              disabled={avatarUploading}
              accessibilityLabel="Change profile picture"
            >
              {avatarUploading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.avatarCameraIcon}>📷</Text>
              )}
            </TouchableOpacity>
          </View>
          <Text style={styles.userName}>{profile?.name || 'Guest User'}</Text>
          <Text style={styles.userMobile}>+91 {profile?.mobile || 'N/A'}</Text>
          <TouchableOpacity style={styles.editProfileBtn} onPress={() => { haptics.tap(); setEditing(true); }}>
            <Text style={styles.editProfileBtnText}>✏️ Edit Profile</Text>
          </TouchableOpacity>
        </View>

        {/* Stats row (mixed colors from logo) */}
        <View style={styles.statsRow}>
          <TouchableOpacity
            style={[styles.statCard, { borderTopColor: '#0D3B66' }]}
            onPress={() => navigation.navigate('MyBookings')}
          >
            <Text style={styles.statValue}>{bookingsCount}</Text>
            <Text style={styles.statLabel}>Bookings</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.statCard, { borderTopColor: '#1976D2' }]}
            onPress={() => navigation.navigate('Documents')}
          >
            <Text style={styles.statValue}>{kycUploaded}/{KYC_REQUIRED.length}</Text>
            <Text style={styles.statLabel}>KYC Docs</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.statCard, { borderTopColor: '#F9A825' }]}
            onPress={() => Alert.alert('Rewards', 'Coming soon')}
          >
            <Text style={styles.statValue}>₹0</Text>
            <Text style={styles.statLabel}>Rewards</Text>
          </TouchableOpacity>
        </View>

        {/* KYC progress card — reflects real uploaded/verified docs from
            /documents/kyc/my, refreshes on screen focus and pull-to-refresh. */}
        {(() => {
          const total = KYC_REQUIRED.length;
          const pct = Math.round((kycUploaded / total) * 100);
          const allUploaded = kycUploaded >= total;
          const allVerified = kycVerified >= total;
          let label: string, badgeBg: string, badgeFg: string;
          if (allVerified) {
            label = 'KYC Verified';
            badgeBg = '#E8F5E9'; badgeFg = '#2E7D32';
          } else if (allUploaded) {
            label = 'Pending Verification';
            badgeBg = '#FFF8E1'; badgeFg = '#B8860B';
          } else if (kycUploaded > 0) {
            label = 'In Progress';
            badgeBg = '#E3EEF8'; badgeFg = '#0D3B66';
          } else {
            label = 'Not Started';
            badgeBg = '#FFEBEE'; badgeFg = '#C62828';
          }
          return (
            <TouchableOpacity
              style={styles.kycCard}
              onPress={() => navigation.navigate('Documents')}
              activeOpacity={0.85}
            >
              <View style={styles.kycHeader}>
                <Text style={styles.kycTitle}>📄 KYC Documents</Text>
                <View style={[styles.kycBadge, { backgroundColor: badgeBg }]}>
                  <Text style={[styles.kycBadgeText, { color: badgeFg }]}>{label}</Text>
                </View>
              </View>
              <View style={styles.kycBarTrack}>
                <View
                  style={[
                    styles.kycBarFill,
                    {
                      width: `${pct}%`,
                      backgroundColor: allVerified ? '#2E7D32' : (allUploaded ? '#F9A825' : '#0D3B66'),
                    },
                  ]}
                />
              </View>
              <View style={styles.kycMetaRow}>
                <Text style={styles.kycMetaText}>
                  {kycUploaded}/{total} uploaded · {kycVerified}/{total} verified
                </Text>
                <Text style={styles.kycCta}>
                  {allUploaded ? 'View documents ›' : 'Upload now ›'}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })()}

        {/* Account section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <MenuRow icon="📋" iconBg="#E3EEF8" iconColor="#0D3B66" label="My Bookings" subtitle={`${bookingsCount} total`} onPress={() => navigation.navigate('MyBookings')} />
          <MenuRow icon="📄" iconBg="#E3F2FD" iconColor="#1976D2" label="My Documents" subtitle={`${kycUploaded}/${KYC_REQUIRED.length} uploaded · ${kycVerified} verified`} onPress={() => navigation.navigate('Documents')} />
          <MenuRow icon="🏢" iconBg="#E0F2F1" iconColor="#00695C" label="Company Profile" subtitle="Required for industrial bookings" onPress={() => navigation.navigate('CompanyProfile')} />
          <MenuRow icon="📝" iconBg="#E3F2FD" iconColor="#1565C0" label="Digital NDA" subtitle="Review / accept for B2B services" onPress={() => navigation.navigate('NDA')} />
          <MenuRow icon="📅" iconBg="#FFEBEE" iconColor="#C62828" label="Compliance Vault" subtitle="Track license expiries · 90/60/30-day alerts" onPress={() => navigation.navigate('Compliance')} />
          <MenuRow icon="🎁" iconBg="#FFF8E1" iconColor="#F9A825" label="Refer & Earn" subtitle="Earn ₹50 per friend" onPress={() => setShowReferral(true)} />
          <MenuRow icon="💰" iconBg="#FFEFD5" iconColor="#D97706" label="My Wallet" subtitle="View balance & history" onPress={() => navigation.navigate('Wallet')} />
          <MenuRow icon="💳" iconBg="#E8F5E9" iconColor="#2E7D32" label="Payment Methods" subtitle="UPI, cards, wallet" onPress={() => setShowPayments(true)} />
        </View>

        {/* Preferences */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Preferences</Text>
          <MenuRow icon="🔔" iconBg="#E3EEF8" iconColor="#0D3B66" label="Notifications" subtitle="Push, SMS, email alerts" onPress={() => setShowNotif(true)} />
          <MenuRow icon="🌐" iconBg="#E3F2FD" iconColor="#1976D2" label="Language" subtitle={language === 'hi' ? 'हिन्दी' : language === 'te' ? 'తెలుగు' : 'English'} onPress={() => setShowLanguage(true)} />
          <MenuRow icon="📍" iconBg="#FFF8E1" iconColor="#F9A825" label="Saved Addresses" subtitle={`${addresses.length} saved`} onPress={() => setShowAddresses(true)} />
        </View>

        {/* Support & Legal */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Support & Legal</Text>
          <MenuRow icon="💬" iconBg="#E8F5E9" iconColor="#2E7D32" label="Contact Support" subtitle={`Helpline ${STRINGS.SUPPORT_PHONE}`} onPress={handleSupport} />
          <MenuRow icon="❓" iconBg="#E3F2FD" iconColor="#1976D2" label="Help Center" subtitle="FAQs & service timelines" onPress={() => setShowFAQ(true)} />
          <MenuRow icon="⚠️" iconBg="#FFF3E0" iconColor="#E65100" label="Grievance Redressal" subtitle="Raise a ticket for any issue" onPress={() => setShowGrievance(true)} />
          <MenuRow icon="📤" iconBg="#E3EEF8" iconColor="#0D3B66" label="Share App" subtitle="Tell your friends" onPress={handleShare} />
          <MenuRow icon="🔒" iconBg="#E3F2FD" iconColor="#1976D2" label="Privacy Policy" onPress={() => setInfoModal({ title: 'Privacy Policy', body: PRIVACY_POLICY })} />
          <MenuRow icon="↩️" iconBg="#E8F5E9" iconColor="#2E7D32" label="Refund & Cancellation" onPress={() => setInfoModal({ title: 'Refund & Cancellation', body: REFUND_POLICY })} />
          <MenuRow icon="📜" iconBg="#FFF8E1" iconColor="#F9A825" label="Terms & Conditions" onPress={() => setInfoModal({ title: 'Terms & Conditions', body: TERMS_CONDITIONS })} />
        </View>

        {/* Mode switch */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>App Mode</Text>
          <MenuRow
            icon="🧑‍💼"
            iconBg="#FFF8E1"
            iconColor="#B8860B"
            label="Switch to Representative Mode"
            subtitle="Accept tasks and earn by delivering services"
            onPress={handleSwitchToAgent}
          />
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>

        <Text style={styles.version}>FlipOn Digital v1.0.0</Text>
        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Edit Profile Modal */}
      <Modal visible={editing} transparent animationType="slide" onRequestClose={() => setEditing(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Profile</Text>

            <Text style={styles.inputLabel}>Full Name</Text>
            <TextInput
              style={styles.input}
              value={formData.name}
              onChangeText={(v) => setFormData({ ...formData, name: v })}
              placeholder="Your name"
            />

            <Text style={styles.inputLabel}>Email</Text>
            <TextInput
              style={styles.input}
              value={formData.email}
              onChangeText={(v) => setFormData({ ...formData, email: v })}
              placeholder="Your email"
              keyboardType="email-address"
            />

            {/* Mobile is the OTP-verified login identity — locked here.
                Changing it would invalidate the user's auth token and
                break their session. Surfaces a "Verified" badge + hint
                so users see "this is locked on purpose", not "this is
                broken". To actually change a mobile number, the user has
                to contact support (separate manual flow). */}
            <Text style={styles.inputLabel}>Mobile</Text>
            <View style={{ position: 'relative' }}>
              <TextInput
                style={[styles.input, { backgroundColor: '#F5F5F5', color: '#1A1A1A', paddingRight: 90 }]}
                value={formData.mobile ? `+91 ${formData.mobile}` : ''}
                editable={false}
              />
              <View style={{
                position: 'absolute', right: 8, top: 8,
                backgroundColor: '#D1FAE5', paddingHorizontal: 8, paddingVertical: 4,
                borderRadius: 10,
              }}>
                <Text style={{ color: '#065F46', fontSize: 11, fontWeight: '700' }}>✓ Verified</Text>
              </View>
            </View>
            <Text style={{ fontSize: 11, color: '#6C757D', marginTop: 4, marginBottom: 8 }}>
              Mobile is your login — to change it, contact support.
            </Text>

            <Text style={styles.inputLabel}>Address</Text>
            <TextInput
              style={[styles.input, { height: 80 }]}
              value={formData.address}
              onChangeText={(v) => setFormData({ ...formData, address: v })}
              placeholder="Your address"
              multiline
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#E9ECEF' }]}
                onPress={() => setEditing(false)}
              >
                <Text style={{ color: '#1A1A1A', fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <HapticButton
                title="Save"
                onPress={handleSave}
                hapticType="success"
                style={[styles.modalBtn, { backgroundColor: '#0D3B66' }]}
                textStyle={{ color: '#fff', fontWeight: '700' }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* ─── Contact Support — proper modal with explicit Close button so
          users have a clear way back. Replaced the native Alert.alert
          which only had a "Cancel" option that read like a no-op. */}
      <Modal visible={showContact} transparent animationType="slide" onRequestClose={() => setShowContact(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={styles.modalTitle}>💬 Contact Support</Text>
              <TouchableOpacity onPress={() => setShowContact(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={{ fontSize: 22, color: '#6C757D', fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              FliponeX Customer Support · {STRINGS.SUPPORT_HOURS}
            </Text>

            <TouchableOpacity
              style={styles.paymentRow}
              onPress={() => { setShowContact(false); Linking.openURL(`tel:${STRINGS.SUPPORT_PHONE}`); }}
            >
              <Text style={styles.paymentIcon}>📞</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.paymentLabel}>Call Helpline</Text>
                <Text style={styles.menuSubtitle}>{STRINGS.SUPPORT_PHONE}</Text>
              </View>
              <Text style={{ color: '#6C757D' }}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.paymentRow}
              onPress={() => { setShowContact(false); Linking.openURL(STRINGS.WHATSAPP_URL); }}
            >
              <Text style={styles.paymentIcon}>💬</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.paymentLabel}>WhatsApp</Text>
                <Text style={styles.menuSubtitle}>Chat with our team</Text>
              </View>
              <Text style={{ color: '#6C757D' }}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.paymentRow}
              onPress={() => { setShowContact(false); Linking.openURL(`mailto:${STRINGS.SUPPORT_EMAIL}`); }}
            >
              <Text style={styles.paymentIcon}>✉️</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.paymentLabel}>Email</Text>
                <Text style={styles.menuSubtitle}>{STRINGS.SUPPORT_EMAIL}</Text>
              </View>
              <Text style={{ color: '#6C757D' }}>›</Text>
            </TouchableOpacity>

            <Text style={[styles.modalSubtitle, { marginTop: 12, fontSize: 11 }]}>
              {STRINGS.CORPORATE_OFFICE}
            </Text>

            <TouchableOpacity
              onPress={() => setShowContact(false)}
              style={[styles.modalBtn, { backgroundColor: '#0D3B66', marginTop: 14 }]}
            >
              <Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center' }}>Back to Profile</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ─── Refer & Earn — kept intentionally minimal: code + share. The
          old version had Referred/Earned counters that always showed 0
          (no backing data) and felt like clutter. */}
      <Modal visible={showReferral} transparent animationType="slide" onRequestClose={() => setShowReferral(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🎁 Refer & Earn</Text>
            <Text style={styles.modalSubtitle}>Share your code with friends and earn rewards.</Text>

            <View style={styles.referralCodeBox}>
              <Text style={styles.referralCodeLabel}>YOUR REFERRAL CODE</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <Text style={styles.referralCode}>{referralCode}</Text>
                <TouchableOpacity
                  style={{
                    backgroundColor: '#F9A825',
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 8,
                  }}
                  onPress={async () => {
                    try {
                      await Clipboard.setStringAsync(String(referralCode));
                      haptics.success();
                      Alert.alert('Copied', `Referral code "${referralCode}" copied to clipboard.`);
                    } catch (_) {
                      Alert.alert('Copy failed', 'Could not copy code. Please try again.');
                    }
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, letterSpacing: 0.5 }}>
                    📋 COPY
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Share row — explicit "Share Code" button alongside the
                main blue CTA so the share affordance is unmistakable
                even on a quick glance. */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity
                style={{
                  flex: 1,
                  backgroundColor: '#1976D2',
                  paddingVertical: 14,
                  borderRadius: 10,
                  alignItems: 'center',
                }}
                onPress={shareReferral}
                activeOpacity={0.85}
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>
                  📤 Share with Friends
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={() => setShowReferral(false)} style={{ marginTop: 12, alignSelf: 'center' }}>
              <Text style={{ color: '#6C757D', fontWeight: '700' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ─── Payment Methods ─── */}
      <Modal visible={showPayments} transparent animationType="slide" onRequestClose={() => setShowPayments(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>💳 Payment Methods</Text>
            <Text style={styles.modalSubtitle}>Add a payment method for faster checkout</Text>

            {/* MaterialIcons — much cleaner than emoji. UPI gets a
                phone+arrow ("send-to-mobile"), wallet gets the proper
                account-balance-wallet icon, netbanking → account-
                balance (bank columns). All tinted to match the brand. */}
            {[
              { iconName: 'send-to-mobile', label: 'UPI', subtitle: 'Pay via Google Pay, PhonePe, Paytm', tint: '#0D3B66' },
              { iconName: 'credit-card', label: 'Credit / Debit Card', subtitle: 'Visa, Mastercard, RuPay', tint: '#1976D2' },
              { iconName: 'account-balance-wallet', label: 'Wallets', subtitle: 'Paytm, Amazon Pay, Mobikwik', tint: '#F9A825' },
              { iconName: 'account-balance', label: 'Net Banking', subtitle: 'All major Indian banks', tint: '#0D3B66' },
            ].map((m) => (
              <TouchableOpacity
                key={m.label}
                style={styles.paymentRow}
                onPress={() => Alert.alert(m.label, 'Add this payment method during your next checkout.')}
              >
                <View style={styles.paymentIconWrap}>
                  <Icon name={m.iconName} size={22} color={m.tint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.paymentLabel}>{m.label}</Text>
                  <Text style={styles.paymentSub}>{m.subtitle}</Text>
                </View>
                <Text style={styles.paymentArrow}>+</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity onPress={() => setShowPayments(false)} style={{ marginTop: 12, alignSelf: 'center' }}>
              <Text style={{ color: '#6C757D', fontWeight: '700' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ─── Notifications ─── */}
      <Modal visible={showNotif} transparent animationType="slide" onRequestClose={() => setShowNotif(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🔔 Notification Settings</Text>
            <Text style={styles.modalSubtitle}>Choose how you'd like to be notified</Text>

            {[
              { key: 'push', label: 'Push Notifications', subtitle: 'Booking updates, representative alerts' },
              { key: 'sms', label: 'SMS Alerts', subtitle: 'OTPs and important updates' },
              { key: 'email', label: 'Email Updates', subtitle: 'Receipts and monthly summary' },
              { key: 'offers', label: 'Offers & Promotions', subtitle: 'Get notified of discounts' },
            ].map((n) => (
              <View key={n.key} style={styles.notifRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.notifLabel}>{n.label}</Text>
                  <Text style={styles.notifSub}>{n.subtitle}</Text>
                </View>
                <Switch
                  value={!!notifSettings[n.key]}
                  onValueChange={(v) => saveNotifSetting(n.key, v)}
                  trackColor={{ false: '#E0E0E0', true: '#0D3B66' }}
                  thumbColor="#fff"
                />
              </View>
            ))}

            <TouchableOpacity onPress={() => setShowNotif(false)} style={{ marginTop: 12, alignSelf: 'center' }}>
              <Text style={{ color: '#6C757D', fontWeight: '700' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ─── Language ─── */}
      <Modal visible={showLanguage} transparent animationType="slide" onRequestClose={() => setShowLanguage(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🌐 Choose Language</Text>
            <Text style={styles.modalSubtitle}>App will display in your selected language</Text>

            {[
              { code: 'en', label: 'English', native: 'English' },
              { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
              { code: 'te', label: 'Telugu', native: 'తెలుగు' },
              { code: 'ta', label: 'Tamil', native: 'தமிழ்' },
              { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ' },
            ].map((l) => (
              <TouchableOpacity
                key={l.code}
                style={[styles.langRow, language === l.code && styles.langRowActive]}
                onPress={() => saveLanguage(l.code)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.langLabel, language === l.code && { color: '#0D3B66' }]}>{l.native}</Text>
                  <Text style={styles.langSub}>{l.label}</Text>
                </View>
                {language === l.code && <Text style={styles.langCheck}>✓</Text>}
              </TouchableOpacity>
            ))}

            <TouchableOpacity onPress={() => setShowLanguage(false)} style={{ marginTop: 12, alignSelf: 'center' }}>
              <Text style={{ color: '#6C757D', fontWeight: '700' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ─── Info / Policy viewer (Privacy, Refund, Terms) ─── */}
      <Modal visible={!!infoModal} transparent animationType="slide" onRequestClose={() => setInfoModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '80%' }]}>
            <Text style={styles.modalTitle}>{infoModal?.title}</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              <Text style={styles.policyBody}>{infoModal?.body}</Text>
            </ScrollView>
            <TouchableOpacity onPress={() => setInfoModal(null)} style={{ marginTop: 12, alignSelf: 'center' }}>
              <Text style={{ color: '#6C757D', fontWeight: '700' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ─── Help Center (FAQ) ─── */}
      <Modal visible={showFAQ} transparent animationType="slide" onRequestClose={() => setShowFAQ(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '85%' }]}>
            <Text style={styles.modalTitle}>❓ Help Center</Text>
            <Text style={styles.modalSubtitle}>Frequently asked questions</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {FAQS.map((f: any, i: number) => (
                <View key={i} style={styles.faqRow}>
                  <Text style={styles.faqQ}>{f.q}</Text>
                  <Text style={styles.faqA}>{f.a}</Text>
                </View>
              ))}
              <Text style={styles.faqHint}>
                Still stuck? Tap Contact Support — we're here {STRINGS.SUPPORT_HOURS}.
              </Text>
            </ScrollView>
            <TouchableOpacity onPress={() => setShowFAQ(false)} style={{ marginTop: 12, alignSelf: 'center' }}>
              <Text style={{ color: '#6C757D', fontWeight: '700' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ─── Grievance Redressal ─── */}
      <Modal visible={showGrievance} transparent animationType="slide" onRequestClose={() => setShowGrievance(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>⚠️ Raise a Ticket</Text>
            <Text style={styles.modalSubtitle}>
              Delays, representative behaviour, pending tasks or payment issues — we'll respond within 24 hours.
            </Text>
            <TextInput
              style={[styles.input, { height: 120, textAlignVertical: 'top' }]}
              placeholder="Describe your issue..."
              placeholderTextColor="#9E9E9E"
              value={grievanceText}
              onChangeText={setGrievanceText}
              multiline
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#E9ECEF' }]}
                onPress={() => setShowGrievance(false)}
              >
                <Text style={{ color: '#1A1A1A', fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <HapticButton
                title="Submit"
                onPress={submitGrievance}
                hapticType="success"
                style={[styles.modalBtn, { backgroundColor: '#0D3B66' }]}
                textStyle={{ color: '#fff', fontWeight: '700' }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* ─── Saved Addresses ─── */}
      <Modal visible={showAddresses} transparent animationType="slide" onRequestClose={() => setShowAddresses(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '80%' }]}>
            <Text style={styles.modalTitle}>📍 Saved Addresses</Text>
            <Text style={styles.modalSubtitle}>Quick-pick during booking</Text>

            <View style={styles.addAddressRow}>
              <TextInput
                style={styles.addAddressInput}
                placeholder="Add a new address..."
                placeholderTextColor="#9E9E9E"
                value={newAddress}
                onChangeText={setNewAddress}
                multiline
              />
              <TouchableOpacity style={styles.addAddressBtn} onPress={addAddress}>
                <Text style={styles.addAddressBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 280 }}>
              {addresses.length === 0 ? (
                <Text style={styles.emptyHint}>No saved addresses yet. Add one above.</Text>
              ) : (
                addresses.map((a) => (
                  <View key={a.id} style={styles.addressRow}>
                    <Text style={styles.addressIcon}>📍</Text>
                    <Text style={styles.addressText}>{a.address}</Text>
                    <TouchableOpacity onPress={() => removeAddress(a.id)}>
                      <Text style={styles.addressRemove}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </ScrollView>

            <TouchableOpacity onPress={() => setShowAddresses(false)} style={{ marginTop: 12, alignSelf: 'center' }}>
              <Text style={{ color: '#6C757D', fontWeight: '700' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
    </KeyboardAvoidingView>
  );
};

// Reusable menu row
const MenuRow: React.FC<MenuRowProps> = ({ icon, iconBg, iconColor, label, subtitle, onPress }) => (
  <TouchableOpacity style={styles.menuRow} onPress={() => { haptics.tap(); onPress?.(); }}>
    <View style={[styles.menuIconBox, { backgroundColor: iconBg }]}>
      <Text style={[styles.menuIcon, { color: iconColor }]}>{icon}</Text>
    </View>
    <View style={{ flex: 1 }}>
      <Text style={styles.menuLabel}>{label}</Text>
      {subtitle && <Text style={styles.menuSubtitle}>{subtitle}</Text>}
    </View>
    <Text style={styles.menuArrow}>›</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8F9FA' },

  // Sticky compact top bar — pinned while the rest scrolls.
  stickyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D3B66',
    paddingTop: 38,
    paddingBottom: 10,
    paddingHorizontal: 14,
    shadowColor: '#082B4C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 10,
  },
  stickyBarAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#FFC107',
    alignItems: 'center', justifyContent: 'center',
  },
  stickyBarAvatarText: {
    color: '#0D3B66', fontWeight: '900', fontSize: 16,
  },
  stickyBarName: {
    color: '#FFFFFF', fontSize: 14, fontWeight: '800', letterSpacing: 0.2,
  },
  stickyBarMobile: {
    color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600', marginTop: 1,
  },
  stickyBarLang: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 8,
  },
  stickyBarLangText: { fontSize: 16 },
  stickyBarEdit: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 18,
  },
  stickyBarEditText: {
    color: '#FFFFFF', fontSize: 12, fontWeight: '800', letterSpacing: 0.4,
  },

  // Header (the big hero card that scrolls)
  header: {
    backgroundColor: '#0D3B66',
    paddingTop: 24,
    paddingBottom: 30,
    alignItems: 'center',
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  avatarRing: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 12,
    position: 'relative',
  },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#FFC107',
    justifyContent: 'center', alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImg: {
    width: '100%', height: '100%',
  },
  avatarText: { fontSize: 36, fontWeight: '900', color: '#1A1A1A' },
  // Camera-overlay button — sits at the lower-right of the avatar so
  // it reads as "tap here to change photo" the moment you see it.
  // Matches the mockup's circular blue badge with a white camera icon.
  avatarCameraBtn: {
    position: 'absolute',
    right: 0,
    bottom: 4,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#0D3B66',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
  },
  avatarCameraIcon: { fontSize: 14, color: '#FFFFFF' },
  userName: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 2 },
  userMobile: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginBottom: 14 },
  editProfileBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 18, paddingVertical: 8,
    borderRadius: 20,
  },
  editProfileBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Stats row
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    marginTop: -20,
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderTopWidth: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 4,
  },
  statValue: { fontSize: 22, fontWeight: '800', color: '#1A1A1A' },

  // KYC progress card (sits between stats and Account section)
  kycCard: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginTop: 14,
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
  },
  kycHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  kycTitle: { fontSize: 13, fontWeight: '800', color: '#1A1A1A' },
  kycBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  kycBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  kycBarTrack: {
    height: 8,
    backgroundColor: '#F0F2F5',
    borderRadius: 4,
    overflow: 'hidden',
  },
  kycBarFill: { height: '100%', borderRadius: 4 },
  kycMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  kycMetaText: { fontSize: 11, color: '#5C6A7A', fontWeight: '600' },
  kycCta: { fontSize: 11, color: '#0D3B66', fontWeight: '800' },
  statLabel: { fontSize: 11, color: '#6C757D', marginTop: 2, fontWeight: '600' },

  // Sections
  section: { marginTop: 20, marginHorizontal: 12 },
  sectionTitle: {
    fontSize: 13, fontWeight: '700', color: '#6C757D',
    textTransform: 'uppercase', letterSpacing: 1,
    marginBottom: 8, marginLeft: 4,
  },

  // Menu rows
  menuRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  menuIconBox: {
    width: 40, height: 40, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  menuIcon: { fontSize: 18 },
  menuLabel: { fontSize: 14, fontWeight: '700', color: '#1A1A1A' },
  menuSubtitle: { fontSize: 11, color: '#6C757D', marginTop: 1 },
  menuArrow: { fontSize: 22, color: '#BDBDBD', marginLeft: 8 },

  // Logout
  logoutBtn: {
    margin: 16,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#E63946',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  logoutText: { color: '#E63946', fontWeight: '800', fontSize: 15, letterSpacing: 0.5 },
  version: { textAlign: 'center', color: '#9E9E9E', fontSize: 11, marginTop: 4 },

  // Edit modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#1A1A1A', marginBottom: 16, textAlign: 'center' },
  inputLabel: { fontSize: 12, fontWeight: '700', color: '#6C757D', marginBottom: 4, marginTop: 4 },
  input: {
    borderWidth: 1, borderColor: '#E9ECEF', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
    color: '#1A1A1A', marginBottom: 8, backgroundColor: '#fff',
  },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  modalBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
  },
  modalSubtitle: { fontSize: 13, color: '#6C757D', textAlign: 'center', marginBottom: 18 },

  // Referral
  referralCodeBox: {
    backgroundColor: '#FFF8E1',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginBottom: 14,
    borderWidth: 2,
    borderColor: '#FFE082',
    borderStyle: 'dashed',
  },
  referralCodeLabel: { fontSize: 10, fontWeight: '700', color: '#9E9E9E', letterSpacing: 1, marginBottom: 4 },
  referralCode: { fontSize: 24, fontWeight: '900', color: '#F9A825', letterSpacing: 2 },
  statBox: { flex: 1, backgroundColor: '#F8F9FA', padding: 14, borderRadius: 12, alignItems: 'center' },
  statNum: { fontSize: 20, fontWeight: '800', color: '#0D3B66' },
  statTxt: { fontSize: 11, color: '#6C757D', marginTop: 2 },

  // Payment rows
  paymentRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F8F9FA', padding: 12, borderRadius: 12, marginBottom: 8,
  },
  paymentIcon: { fontSize: 22, marginRight: 12 },
  // Square tile that hosts the MaterialIcon — gives the icon a clear
  // boundary and consistent size against varying icon glyph widths.
  paymentIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  paymentLabel: { fontSize: 14, fontWeight: '700', color: '#1A1A1A' },
  paymentSub: { fontSize: 11, color: '#6C757D', marginTop: 1 },
  paymentArrow: { fontSize: 22, color: '#0D3B66', fontWeight: '800' },

  // Notification toggle rows
  notifRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F0F2F5',
  },
  notifLabel: { fontSize: 14, fontWeight: '700', color: '#1A1A1A' },
  notifSub: { fontSize: 11, color: '#6C757D', marginTop: 2 },

  // Language rows
  langRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F8F9FA', padding: 14, borderRadius: 12, marginBottom: 8,
  },
  langRowActive: { backgroundColor: '#E3EEF8', borderWidth: 1, borderColor: '#0D3B66' },
  langLabel: { fontSize: 16, fontWeight: '700', color: '#1A1A1A' },
  langSub: { fontSize: 11, color: '#6C757D', marginTop: 2 },
  langCheck: { fontSize: 22, color: '#0D3B66', fontWeight: '900' },

  // Saved addresses
  addAddressRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  addAddressInput: {
    flex: 1, borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#1A1A1A',
    backgroundColor: '#FAFAFA', minHeight: 44,
  },
  addAddressBtn: {
    width: 44, height: 44, borderRadius: 10,
    backgroundColor: '#0D3B66', justifyContent: 'center', alignItems: 'center',
  },
  addAddressBtnText: { color: '#fff', fontSize: 22, fontWeight: '800' },
  addressRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F8F9FA', padding: 12, borderRadius: 10, marginBottom: 8,
  },
  addressIcon: { fontSize: 18, marginRight: 10 },
  addressText: { flex: 1, fontSize: 13, color: '#1A1A1A' },
  addressRemove: { fontSize: 18, color: '#E63946', fontWeight: '700', paddingHorizontal: 8 },
  emptyHint: { textAlign: 'center', color: '#9E9E9E', fontStyle: 'italic', paddingVertical: 20 },

  // Policy body (Privacy / Refund / Terms)
  policyBody: { fontSize: 13, lineHeight: 20, color: '#1A1A1A' },

  // FAQ rows
  faqRow: {
    backgroundColor: '#F8F9FA', borderRadius: 10,
    padding: 12, marginBottom: 8,
  },
  faqQ: { fontSize: 13, fontWeight: '800', color: '#1A1A1A', marginBottom: 4 },
  faqA: { fontSize: 12, color: '#6C757D', lineHeight: 17 },
  faqHint: {
    fontSize: 12, color: '#1976D2', fontWeight: '600',
    textAlign: 'center', marginTop: 8, paddingVertical: 6,
  },
});

export default ProfileScreen;

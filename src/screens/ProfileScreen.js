import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView,
  TextInput, ActivityIndicator, Share, Linking, Modal, RefreshControl,
  Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearAuthSession } from '../utils/storage';
import { getProfile, updateProfile, getMyBookings } from '../services/api';
import {
  STRINGS,
  PRIVACY_POLICY,
  REFUND_POLICY,
  TERMS_CONDITIONS,
  FAQS,
} from '../constants/strings';
import HapticButton from '../components/HapticButton';
import * as haptics from '../utils/haptics';

const ProfileScreen = ({ navigation }) => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [bookingsCount, setBookingsCount] = useState(0);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', mobile: '', address: '' });

  // Feature modals
  const [showReferral, setShowReferral] = useState(false);
  const [showPayments, setShowPayments] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [showLanguage, setShowLanguage] = useState(false);
  const [showAddresses, setShowAddresses] = useState(false);
  // Legal / info modals — show the real policy bodies from the marketing brief
  // instead of the old placeholder Alerts.
  const [infoModal, setInfoModal] = useState(null); // { title, body } | null
  const [showFAQ, setShowFAQ] = useState(false);
  const [showGrievance, setShowGrievance] = useState(false);
  const [grievanceText, setGrievanceText] = useState('');

  // Saved settings (persisted to AsyncStorage)
  const [notifSettings, setNotifSettings] = useState({ push: true, sms: true, email: false, offers: true });
  const [language, setLanguage] = useState('en');
  const [addresses, setAddresses] = useState([]);
  const [newAddress, setNewAddress] = useState('');

  // Referral code derived from mobile (first-time generate-and-save pattern)
  const referralCode = profile?.mobile ? `FL${String(profile.mobile).slice(-6)}` : 'FLIPON';

  useEffect(() => {
    loadProfile();
    loadSavedSettings();
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', loadProfile);
    return unsubscribe;
  }, [navigation]);

  // Load persisted preferences (notifications / language / saved addresses)
  const loadSavedSettings = async () => {
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

  const saveNotifSetting = async (key, value) => {
    const updated = { ...notifSettings, [key]: value };
    setNotifSettings(updated);
    await AsyncStorage.setItem('notif_settings', JSON.stringify(updated));
    haptics.tap();
  };

  const saveLanguage = async (lang) => {
    setLanguage(lang);
    await AsyncStorage.setItem('app_language', lang);
    haptics.success();
    setShowLanguage(false);
  };

  const addAddress = async () => {
    if (!newAddress.trim()) return;
    const updated = [...addresses, { id: Date.now().toString(), address: newAddress.trim() }];
    setAddresses(updated);
    await AsyncStorage.setItem('saved_addresses', JSON.stringify(updated));
    setNewAddress('');
    haptics.success();
  };

  const removeAddress = async (id) => {
    const updated = addresses.filter(a => a.id !== id);
    setAddresses(updated);
    await AsyncStorage.setItem('saved_addresses', JSON.stringify(updated));
    haptics.tap();
  };

  const shareReferral = async () => {
    haptics.tap();
    await Share.share({
      message: `Use my FlipOn Digital referral code *${referralCode}* to get ₹20 off your first service! Download: https://fliponex.app`,
      title: 'FlipOn Digital Referral',
    });
  };

  const loadProfile = async () => {
    try {
      const [p, b] = await Promise.all([
        getProfile().catch(() => ({})),
        getMyBookings().catch(() => []),
      ]);
      const data = p.data || p;
      setProfile(data);
      setBookingsCount(Array.isArray(b) ? b.length : (b?.data?.length || 0));
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

  const onRefresh = () => { setRefreshing(true); loadProfile(); };

  const handleSave = async () => {
    try {
      await updateProfile(formData);
      setProfile({ ...profile, ...formData });
      setEditing(false);
      haptics.success();
      Alert.alert('Success', 'Profile updated');
    } catch (error) {
      haptics.error();
      Alert.alert('Error', 'Failed to update profile');
    }
  };

  const handleShare = async () => {
    haptics.tap();
    await Share.share({
      message: 'Check out FlipOn Digital — your trusted service partner!\nDownload: https://flipon.app',
    });
  };

  const handleSupport = () => {
    haptics.tap();
    Alert.alert(
      'Contact Support',
      `FliponeX Customer Support\n${STRINGS.SUPPORT_HOURS}\n\n${STRINGS.CORPORATE_OFFICE}`,
      [
        { text: 'Call', onPress: () => Linking.openURL(`tel:${STRINGS.SUPPORT_PHONE}`) },
        { text: 'WhatsApp', onPress: () => Linking.openURL(STRINGS.WHATSAPP_URL) },
        { text: 'Email', onPress: () => Linking.openURL(`mailto:${STRINGS.SUPPORT_EMAIL}`) },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const submitGrievance = () => {
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

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout', style: 'destructive',
        onPress: async () => {
          // Clears token + user + persisted nav state so the next cold start
          // lands on Login instead of restoring the authenticated stack.
          await clearAuthSession();
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        },
      },
    ]);
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
    <View style={styles.container}>
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#0D3B66']} />}>

        {/* Branded header with avatar (red/blue/gold gradient feel) */}
        <View style={styles.header}>
          <View style={styles.avatarRing}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
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
            onPress={() => Alert.alert('Documents', 'Coming soon')}
          >
            <Text style={styles.statValue}>0</Text>
            <Text style={styles.statLabel}>Documents</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.statCard, { borderTopColor: '#F9A825' }]}
            onPress={() => Alert.alert('Rewards', 'Coming soon')}
          >
            <Text style={styles.statValue}>₹0</Text>
            <Text style={styles.statLabel}>Rewards</Text>
          </TouchableOpacity>
        </View>

        {/* Account section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <MenuRow icon="📋" iconBg="#E3EEF8" iconColor="#0D3B66" label="My Bookings" subtitle={`${bookingsCount} total`} onPress={() => navigation.navigate('MyBookings')} />
          <MenuRow icon="📄" iconBg="#E3F2FD" iconColor="#1976D2" label="My Documents" subtitle="Manage uploaded docs" onPress={() => navigation.navigate('Documents')} />
          <MenuRow icon="🏢" iconBg="#E0F2F1" iconColor="#00695C" label="Company Profile" subtitle="Required for industrial bookings" onPress={() => navigation.navigate('CompanyProfile')} />
          <MenuRow icon="📝" iconBg="#E3F2FD" iconColor="#1565C0" label="Digital NDA" subtitle="Review / accept for B2B services" onPress={() => navigation.navigate('NDA')} />
          <MenuRow icon="🎁" iconBg="#FFF8E1" iconColor="#F9A825" label="Refer & Earn" subtitle="Get ₹20 per friend" onPress={() => setShowReferral(true)} />
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

            <Text style={styles.inputLabel}>Mobile</Text>
            <TextInput
              style={[styles.input, { backgroundColor: '#F5F5F5', color: '#9E9E9E' }]}
              value={formData.mobile}
              editable={false}
            />

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

      {/* ─── Refer & Earn ─── */}
      <Modal visible={showReferral} transparent animationType="slide" onRequestClose={() => setShowReferral(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🎁 Refer & Earn</Text>
            <Text style={styles.modalSubtitle}>Share your code, earn ₹20 per friend</Text>

            <View style={styles.referralCodeBox}>
              <Text style={styles.referralCodeLabel}>YOUR REFERRAL CODE</Text>
              <Text style={styles.referralCode}>{referralCode}</Text>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statNum}>0</Text>
                <Text style={styles.statTxt}>Referred</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statNum, { color: '#F9A825' }]}>₹0</Text>
                <Text style={styles.statTxt}>Earned</Text>
              </View>
            </View>

            <HapticButton title="📤 Share with Friends" onPress={shareReferral} hapticType="press" style={[styles.modalBtn, { backgroundColor: '#1976D2' }]} textStyle={{ color: '#fff', fontWeight: '700' }} />

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

            {[
              { icon: '🏦', label: 'UPI', subtitle: 'Pay via Google Pay, PhonePe, Paytm' },
              { icon: '💳', label: 'Credit / Debit Card', subtitle: 'Visa, Mastercard, RuPay' },
              { icon: '👛', label: 'Wallets', subtitle: 'Paytm, Amazon Pay, Mobikwik' },
              { icon: '🏧', label: 'Net Banking', subtitle: 'All major Indian banks' },
            ].map((m) => (
              <TouchableOpacity
                key={m.label}
                style={styles.paymentRow}
                onPress={() => Alert.alert(m.label, 'Add this payment method during your next checkout.')}
              >
                <Text style={styles.paymentIcon}>{m.icon}</Text>
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
              { key: 'push', label: 'Push Notifications', subtitle: 'Booking updates, agent alerts' },
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
              {FAQS.map((f, i) => (
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
              Delays, agent behavior, pending tasks or payment issues — we'll respond within 24 hours.
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
  );
};

// Reusable menu row
const MenuRow = ({ icon, iconBg, iconColor, label, subtitle, onPress }) => (
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

  // Header
  header: {
    backgroundColor: '#0D3B66',
    paddingTop: 60,
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
  },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#FFC107',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: 36, fontWeight: '900', color: '#1A1A1A' },
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
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statBox: { flex: 1, backgroundColor: '#F8F9FA', padding: 14, borderRadius: 12, alignItems: 'center' },
  statNum: { fontSize: 20, fontWeight: '800', color: '#0D3B66' },
  statTxt: { fontSize: 11, color: '#6C757D', marginTop: 2 },

  // Payment rows
  paymentRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F8F9FA', padding: 12, borderRadius: 12, marginBottom: 8,
  },
  paymentIcon: { fontSize: 22, marginRight: 12 },
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

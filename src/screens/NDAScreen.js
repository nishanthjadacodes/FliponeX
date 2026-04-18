import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert,
} from 'react-native';
import { acceptNDA } from '../services/api';
import * as haptics from '../utils/haptics';

// Clause text is static (not editable in app) — changing it requires app update.
const CLAUSES = [
  {
    title: '1. Confidential Information',
    body:
      'All documents, filings, financial records and identifying numbers (GSTIN, PAN, TAN, CIN, bank details, etc.) you share with FliponeX in the course of availing a service are treated as Confidential Information.',
  },
  {
    title: '2. Permitted Use',
    body:
      'Confidential Information will be used solely to execute the service you have booked, interact with relevant government portals, and maintain statutory records mandated by law.',
  },
  {
    title: '3. Restricted Access',
    body:
      'Industrial / B2B records are accessible only to designated Senior Experts and B2B Admins. General field agents do not have visibility into your corporate vault.',
  },
  {
    title: '4. Storage & Encryption',
    body:
      'Documents are stored with 256-bit encryption. Access events are logged — every read or download of a corporate document is timestamped against the admin user.',
  },
  {
    title: '5. Retention',
    body:
      'Once a service is concluded, we retain the minimum data required by law (e.g., GST invoice records). Other sensitive uploads are purged from active systems per our Privacy Policy.',
  },
  {
    title: '6. No Third-Party Sharing',
    body:
      'FliponeX will not sell, rent or share your Confidential Information with any third party except where compelled by law or explicitly authorised by you in writing.',
  },
  {
    title: '7. Term',
    body:
      'This NDA stays in force for as long as FliponeX holds any Confidential Information of yours, and survives termination of your account for a further 3 years to cover statutory audits.',
  },
];

const NDAScreen = ({ navigation }) => {
  const [accepting, setAccepting] = useState(false);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);

  const handleAccept = async () => {
    if (!scrolledToEnd) {
      Alert.alert('Please review', 'Scroll through all clauses before accepting.');
      return;
    }
    setAccepting(true);
    try {
      await acceptNDA();
      haptics.success();
      Alert.alert(
        'NDA Accepted',
        'You can now book industrial services. A copy of this NDA is available in your profile anytime.',
        [{ text: 'Continue', onPress: () => navigation.goBack() }]
      );
    } catch (e) {
      haptics.error();
      Alert.alert('Error', e.message || 'Could not record acceptance.');
    } finally {
      setAccepting(false);
    }
  };

  const handleScroll = ({ nativeEvent }) => {
    const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
    // ~40 px tolerance so user doesn't need to reach the exact bottom pixel
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 40) {
      if (!scrolledToEnd) setScrolledToEnd(true);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        onScroll={handleScroll}
        scrollEventThrottle={120}
      >
        <View style={styles.badge}><Text style={styles.badgeText}>DIGITAL NDA · REQUIRED FOR B2B</Text></View>
        <Text style={styles.title}>Non-Disclosure Agreement</Text>
        <Text style={styles.lede}>
          Industrial bookings involve sensitive corporate documents. Please review the clauses below before you proceed.
        </Text>

        {CLAUSES.map((c) => (
          <View key={c.title} style={styles.clause}>
            <Text style={styles.clauseTitle}>{c.title}</Text>
            <Text style={styles.clauseBody}>{c.body}</Text>
          </View>
        ))}

        <View style={styles.footerNote}>
          <Text style={styles.footerNoteText}>
            Tapping "I Agree" records your acceptance against your account with a timestamp. You can view the NDA or
            contact support to revoke at any time.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary]}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.btnSecondaryText}>Decline</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, (!scrolledToEnd || accepting) && { opacity: 0.5 }]}
          onPress={handleAccept}
          disabled={!scrolledToEnd || accepting}
          activeOpacity={0.85}
        >
          {accepting
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnPrimaryText}>{scrolledToEnd ? 'I Agree' : 'Scroll to end first'}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  scroll: { padding: 14, paddingBottom: 20 },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#E3F2FD', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 5, marginBottom: 10,
  },
  badgeText: { fontSize: 10, fontWeight: '800', color: '#1565C0', letterSpacing: 0.5 },
  title: { fontSize: 20, fontWeight: '800', color: '#1A1A1A', marginBottom: 6 },
  lede: { fontSize: 13, color: '#6C757D', lineHeight: 18, marginBottom: 14 },
  clause: {
    backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 10,
    borderLeftWidth: 3, borderLeftColor: '#1976D2',
  },
  clauseTitle: { fontSize: 13, fontWeight: '800', color: '#1A1A1A', marginBottom: 4 },
  clauseBody: { fontSize: 12, color: '#333', lineHeight: 17 },
  footerNote: {
    backgroundColor: '#FFF8E1', padding: 12, borderRadius: 10, marginTop: 6,
  },
  footerNoteText: { fontSize: 11, color: '#8D6E63', lineHeight: 16, fontStyle: 'italic' },

  footer: {
    flexDirection: 'row', gap: 8, padding: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1, borderTopColor: '#F0F2F5',
  },
  btn: { flex: 1, paddingVertical: 13, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  btnSecondary: { backgroundColor: '#E9ECEF' },
  btnSecondaryText: { color: '#1A1A1A', fontWeight: '700', fontSize: 13 },
  btnPrimary: {
    backgroundColor: '#1976D2',
    shadowColor: '#1976D2', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 4,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});

export default NDAScreen;

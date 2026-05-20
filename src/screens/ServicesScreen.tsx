// Services tab — full catalog screen reachable from the bottom nav.
//
// Mirrors the home-screen service grid but is purpose-built around
// browsing the entire catalog instead of being a slice next to the
// hero / banners. Categories live as filter chips along the top so
// users can drill down into "Aadhaar / PAN / GST / Travel / etc."
// without scrolling. Tap any card → navigates to ServiceDetails →
// the existing booking flow takes over.
import { useEffect, useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/colors';
import { getServices, type Service } from '../services/api';
import { useRefetchOnFocus } from '../lib/useRefetchOnFocus';

// Fetches BOTH consumer + industrial catalogues in parallel and merges
// them (de-duped by id, since a `service_type: 'both'` row appears in
// each). Resilient — a failed bucket just contributes nothing.
const fetchAllServices = async (): Promise<Service[]> => {
  const [consumerRes, industrialRes] = await Promise.all([
    getServices('consumer').catch(() => null),
    getServices('industrial').catch(() => null),
  ]);
  const pickList = (res: any): Service[] =>
    Array.isArray(res?.data) ? res.data
    : Array.isArray(res) ? res
    : Array.isArray(res?.services) ? res.services
    : [];
  const merged = new Map<string, Service>();
  pickList(consumerRes).forEach((s: any) => merged.set(String(s.id), s));
  pickList(industrialRes).forEach((s: any) => merged.set(String(s.id), s));
  return Array.from(merged.values());
};
import ServiceCard, { iconForCategory } from '../components/ServiceCard';
import * as haptics from '../utils/haptics';

interface NavigationProp {
  navigate: (route: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
}
interface RouteProp {
  params?: { category?: string };
}
interface Props {
  navigation: NavigationProp;
  route?: RouteProp;
}

const ServicesScreen: React.FC<Props> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const {
    data: services = [],
    isLoading: loading,
    isFetching: refreshing,
    refetch,
  } = useQuery({ queryKey: ['services'], queryFn: fetchAllServices });
  const [search, setSearch] = useState<string>('');
  // If the user arrived here via Home → "View All →", the category
  // they tapped on is in route.params.category. Pre-select it so the
  // chip row + result list filter to that category immediately.
  const [activeCategory, setActiveCategory] = useState<string>(
    route?.params?.category || 'All',
  );

  // When the param changes (e.g. user taps another View All from Home
  // without navigating away first), re-sync the active chip.
  useEffect(() => {
    if (route?.params?.category) {
      setActiveCategory(route.params.category);
    }
  }, [route?.params?.category]);

  // Service catalogue is fetched + cached by TanStack Query (see
  // fetchAllServices above). useRefetchOnFocus keeps it fresh when
  // the user returns to the tab.
  const onRefresh = useCallback((): void => {
    refetch();
  }, [refetch]);
  useRefetchOnFocus(onRefresh);

  // Build the category chip list dynamically from whatever services the
  // backend returned. "All" sits first; everything else is alphabetised
  // so the chip order is predictable across reloads.
  const categories = useMemo<string[]>(() => {
    const set = new Set<string>();
    services.forEach((s: any) => {
      const c = (s.category && String(s.category).trim()) || 'Other';
      set.add(c);
    });
    return ['All', ...Array.from(set).sort()];
  }, [services]);

  // Filter pipeline — category chip first, then free-text search across
  // name + category + description so a user typing "PAN" matches even
  // services miscategorised under "Identity".
  const visible = useMemo<Service[]>(() => {
    const q = search.trim().toLowerCase();
    return services.filter((s: any) => {
      if (activeCategory !== 'All') {
        const c = (s.category && String(s.category).trim()) || 'Other';
        if (c !== activeCategory) return false;
      }
      if (!q) return true;
      const hay = `${s.name || ''} ${s.category || ''} ${s.description || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [services, search, activeCategory]);

  const handlePress = (service: any): void => {
    haptics.tap();
    navigation.navigate('ServiceDetails', { serviceId: service.id });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor="#0D3B66" />

      {/* Branded hero header — Prussian-blue background with rounded
          bottom edges and a friendly subtitle. The search bar overlaps
          the bottom curve so the header acts as a "card hat". */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>All Services</Text>
            <Text style={styles.subtitle}>
              {services.length > 0
                ? `${services.length} services · ${categories.length - 1} categories`
                : 'Every service we offer in one place'}
            </Text>
          </View>
          <View style={styles.headerEmoji}>
            <Text style={styles.headerEmojiIcon}>🗂️</Text>
          </View>
        </View>

        {/* Search bar — sits half-overlapping the header bottom edge */}
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search any service…"
            placeholderTextColor="#94A3B8"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearch('')}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.searchClear}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Category chip row — sits below the header, scrolls horizontally */}
      <View style={styles.chipsWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {categories.map((cat) => {
            const active = activeCategory === cat;
            return (
              <TouchableOpacity
                key={cat}
                onPress={() => {
                  haptics.tap();
                  setActiveCategory(cat);
                }}
                style={[styles.chip, active && styles.chipActive]}
                activeOpacity={0.85}
              >
                <Text style={styles.chipIcon}>{cat === 'All' ? '🗂️' : iconForCategory(cat)}</Text>
                <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                  {cat}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Result count strip */}
      {!loading && services.length > 0 && (
        <View style={styles.resultStrip}>
          <Text style={styles.resultCount}>
            {visible.length} {visible.length === 1 ? 'result' : 'results'}
            {activeCategory !== 'All' ? ` in ${activeCategory}` : ''}
            {search ? ` for "${search}"` : ''}
          </Text>
          {(search || activeCategory !== 'All') && (
            <TouchableOpacity
              onPress={() => {
                setSearch('');
                setActiveCategory('All');
              }}
            >
              <Text style={styles.resultClear}>Clear filters</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Body */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.PRIMARY} />
          <Text style={styles.centerText}>Loading services…</Text>
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>🔎</Text>
          <Text style={styles.emptyTitle}>No matches</Text>
          <Text style={styles.emptyBody}>
            {search
              ? `Nothing matches "${search}". Try a different keyword or category.`
              : 'No services in this category yet.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item: any) => String(item.id)}
          numColumns={2}
          contentContainerStyle={styles.gridContent}
          columnWrapperStyle={styles.gridRow}
          renderItem={({ item, index }) => (
            <ServiceCard service={item} onPress={handlePress} index={index} />
          )}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.PRIMARY]} />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F7FA' },

  // Header — Prussian blue with rounded bottom corners and an extra
  // 28px of bottom padding so the floating search bar can overlap by
  // half without clipping into the chips row.
  header: {
    backgroundColor: '#0D3B66',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 38,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 0.2,
    marginTop: 2,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    marginTop: 4,
    fontWeight: '600',
  },
  headerEmoji: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(252,211,77,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(252,211,77,0.40)',
  },
  headerEmojiIcon: { fontSize: 28 },

  // Search bar — overlaps the header bottom edge so it visually anchors
  // the body to the hero (matches modern fintech app patterns).
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    elevation: 4,
    shadowColor: '#082B4C',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    gap: 10,
    marginTop: 16,
    marginBottom: -22,
  },
  searchIcon: { fontSize: 16, color: '#0D3B66' },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    paddingVertical: 0,
  },
  searchClear: { fontSize: 16, color: '#5C6A7A', fontWeight: '700', paddingHorizontal: 6 },

  chipsWrap: {
    paddingTop: 32,
    paddingBottom: 8,
    backgroundColor: '#F5F7FA',
  },
  chipsRow: { paddingHorizontal: 12, gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chipActive: {
    backgroundColor: '#0D3B66',
    borderColor: '#0D3B66',
    elevation: 2,
    shadowColor: '#082B4C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
  },
  chipIcon: { fontSize: 14 },
  chipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  chipTextActive: { color: '#FCD34D', fontWeight: '800' },

  // Result count strip below the chips so the user knows how many
  // matches their filter produced.
  resultStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 4,
  },
  resultCount: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
  },
  resultClear: {
    fontSize: 12,
    color: '#0D3B66',
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  gridContent: { padding: 12, paddingTop: 8, paddingBottom: 32 },
  gridRow: { justifyContent: 'space-between' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  centerText: { marginTop: 12, color: '#64748B', fontSize: 13 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A', marginBottom: 6 },
  emptyBody: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: 16,
  },
});

export default ServicesScreen;

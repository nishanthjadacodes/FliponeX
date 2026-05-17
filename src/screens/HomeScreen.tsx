import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  ScrollView,
  Image,
  Dimensions,
  Share,
  Linking,
  TextInput,
  Pressable,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SIZES, BORDER_RADIUS } from '../constants/colors';
import { STRINGS, VALUE_PROPS, HERO_BANNERS } from '../constants/strings';
import {
  getServices,
  getTrendingServices,
  getOffers,
  getInboxNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/api';
import type { Service, OfferItem, InboxItem } from '../services/api';
import { getUser, storeUser, clearAuthSession } from '../utils/storage';
import { getProfile } from '../services/api';
import B2BToggle from '../components/B2BToggle';
import ServiceCard, { iconForCategory } from '../components/ServiceCard';
import * as haptics from '../utils/haptics';
import WhatsAppButton from '../components/WhatsAppButton';
import EngagingContentSection from '../components/EngagingContentSection';
import ComplianceRedAlertBanner from '../components/ComplianceRedAlertBanner';
import AutoCarousel from '../components/AutoCarousel';
import { LinearGradient } from 'expo-linear-gradient';

interface Props {
  navigation: {
    navigate: (route: string, params?: Record<string, unknown>) => void;
    goBack: () => void;
    replace?: (route: string) => void;
    addListener?: (event: string, cb: () => void) => () => void;
    reset?: (state: any) => void;
  };
  route?: { params?: { [key: string]: any } };
}

const HomeScreen: React.FC<Props> = ({ navigation }) => {
  // Bottom system inset (Android 3-button / gesture bar, iPhone home
  // indicator). Used to pad the scroll content so the last visible
  // section / CTA isn't covered by the device's navigation chrome.
  const insets = useSafeAreaInsets();
  const [services, setServices] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>(STRINGS.ALL_CATEGORIES);
  const [serviceType, setServiceType] = useState<'consumer' | 'industrial'>('consumer');
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  // Global home-page services-grid expansion. By default we show only
  // TOTAL_INITIAL_SERVICES (across ALL categories combined, in the
  // service list's natural order — typically the first few Aadhaar
  // services since Aadhaar comes first in the rate chart). The "View
  // All Services" button at the bottom of the visible slice expands
  // to the full categorised view. Resets on B2B toggle so each mode
  // (consumer / industrial) starts collapsed again.
  const [showAllServices, setShowAllServices] = useState<boolean>(false);
  const TOTAL_INITIAL_SERVICES = 7;
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [showSearchModal, setShowSearchModal] = useState<boolean>(false);
  const [searchInputFocused, setSearchInputFocused] = useState<boolean>(false);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState<string>('');
  const [searchTimeoutId, setSearchTimeoutId] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [trendingServices, setTrendingServices] = useState<Service[]>([]);
  const [offers, setOffers] = useState<OfferItem[]>([]);
  // ─── Notifications inbox (drives the Alerts chip + modal) ────────────
  // The badge on the chip shows `inboxUnread`. Opening the chip lists
  // ALL recent notifications in `inboxItems` and clears the badge.
  // New B2B quote replies, booking-status changes, etc. all land here.
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [inboxUnread, setInboxUnread] = useState<number>(0);
  const [showAlertsModal, setShowAlertsModal] = useState<boolean>(false);
  const [inboxLoading, setInboxLoading] = useState<boolean>(false);
  const searchInputRef = useRef<any>(null);
  // Hero / Offers carousels now live in <AutoCarousel /> which animates on
  // the native UI thread via react-native-reanimated. No JS refs/state
  // needed for those rotations.
  // Refs for the "Book Now, Pay Later" CTA — scroll the outer ScrollView down
  // to the services list so the user lands right on the bookable items.
  const scrollRef = useRef<any>(null);
  const servicesYRef = useRef<number>(0);
  // Y offset of the inline search bar — scroll-to-here on focus so the
  // keyboard doesn't cover it.
  const searchYRef = useRef<number>(0);

  const scrollToServices = useCallback(() => {
    // Fallback: if layout hasn't measured yet, scroll to a reasonable offset.
    const y = servicesYRef.current || 600;
    scrollRef.current?.scrollTo({ y, animated: true });
  }, []);

  // Diversified Trending row. The backend's /services/trending tends to
  // return whatever has the highest book-count, which clusters around a
  // single category (early on, only Aadhaar / PAN had real bookings, so
  // the row read as "Aadhaar Aadhaar Aadhaar"). We layer the backend
  // list with one representative service per major category so the
  // strip showcases the full catalogue — Aadhaar, PAN, GST, Ayushman,
  // Voter ID, PF Withdrawal, Driving Licence, Ration Card, Passport.
  // Backend's order wins; cross-category fills slot in only where the
  // category isn't already represented.
  const displayedTrending = useMemo<Service[]>(() => {
    const TRENDING_KEYWORDS: { label: string; rx: RegExp }[] = [
      { label: 'aadhaar',   rx: /aadhaar|aadhar|uidai/i },
      { label: 'pan',       rx: /\bpan\b|pan.?card/i },
      { label: 'gst',       rx: /\bgst\b|goods.?and.?services.?tax/i },
      { label: 'ayushman',  rx: /ayushman|abha|pmjay/i },
      { label: 'voterid',   rx: /voter|epic|electoral/i },
      { label: 'pf',        rx: /\bpf\b|provident.?fund|epfo|withdraw/i },
      { label: 'driving',   rx: /driving.?licen[cs]e|\bdl\b/i },
      { label: 'ration',    rx: /ration.?card|fps\b/i },
      { label: 'passport',  rx: /passport/i },
      { label: 'birth',     rx: /birth.?certificate/i },
      { label: 'income',    rx: /income.?certificate/i },
    ];
    const bucketOf = (s: any): string => {
      const hay = `${s?.name || ''} ${s?.category || ''} ${s?.description || ''}`;
      for (const k of TRENDING_KEYWORDS) if (k.rx.test(hay)) return k.label;
      return s?.category ? `cat:${String(s.category).toLowerCase()}` : 'misc';
    };

    const seenIds = new Set<string>();
    const seenBuckets = new Set<string>();
    const out: Service[] = [];

    // 1. Backend's trending list keeps its priority, but only one per
    //    bucket so the row doesn't collapse onto one category.
    for (const s of trendingServices as any[]) {
      if (!s?.id) continue;
      const b = bucketOf(s);
      if (seenIds.has(String(s.id))) continue;
      if (seenBuckets.has(b)) continue;
      seenIds.add(String(s.id));
      seenBuckets.add(b);
      out.push(s as Service);
    }

    // 2. Fill the row with the first service from each missing keyword
    //    bucket — gives the user a taste of every major category.
    for (const k of TRENDING_KEYWORDS) {
      if (seenBuckets.has(k.label)) continue;
      const match = (services as any[]).find((s) => {
        if (!s?.id || seenIds.has(String(s.id))) return false;
        const hay = `${s?.name || ''} ${s?.category || ''} ${s?.description || ''}`;
        return k.rx.test(hay);
      });
      if (match) {
        seenIds.add(String(match.id));
        seenBuckets.add(k.label);
        out.push(match as Service);
      }
    }

    // 3. Top up with anything else so the strip is never empty even on
    //    a fresh install with no trending data yet.
    if (out.length < 6) {
      for (const s of services as any[]) {
        if (out.length >= 8) break;
        if (!s?.id || seenIds.has(String(s.id))) continue;
        seenIds.add(String(s.id));
        out.push(s as Service);
      }
    }

    return out;
  }, [trendingServices, services]);

  // "Why FliponeX?" — 4 core value propositions shown as horizontal cards.
  // Pulled from the marketing brief so the app echoes the same promise as the website.
  const engagingContent = VALUE_PROPS;

  useEffect(() => {
    loadServices();
    loadUserData();
    loadTrendingAndOffers();
  }, [serviceType]);

  // Re-pull cached user on focus so the header avatar / first-letter
  // picks up name / profile_pic changes the user just saved on the
  // Profile screen. Without this, the avatar stays as 👤 until the
  // app is fully restarted.
  useEffect(() => {
    const unsub = navigation.addListener?.('focus', () => {
      loadUserData();
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  // Cleanup timeout on component unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutId) {
        clearTimeout(searchTimeoutId);
      }
    };
  }, [searchTimeoutId]);

  // ─── Inbox poll (drives the Alerts chip badge + modal list) ──────────
  // Pulls /notifications/inbox every 60s while the home screen is
  // mounted. Also re-fetches on every screen focus so a user who's
  // been deep in the booking flow / chatting with admin sees the
  // freshest count when they return. Failures are silent — the chip
  // just stays at its last-known value rather than throwing.
  const refreshInbox = useCallback(async (): Promise<void> => {
    try {
      const res = await getInboxNotifications(false, 50);
      const list = Array.isArray(res?.notifications) ? res.notifications : [];
      setInboxItems(list);
      const unread = list.filter((n) => !n.seen_at).length;
      setInboxUnread(Number(res?.unread_count) || unread);
    } catch (e: any) {
      // 401 (not logged in) / network — silent. Banner pulls the same
      // endpoint and logs its own failures.
    }
  }, []);

  useEffect(() => {
    refreshInbox();
    const t = setInterval(refreshInbox, 60_000);
    const unsub = navigation.addListener?.('focus', refreshInbox);
    return () => {
      clearInterval(t);
      if (typeof unsub === 'function') unsub();
    };
  }, [refreshInbox, navigation]);

  // Open the Alerts modal → mark every visible row as seen so the
  // badge clears immediately. Backend-side flips seen_at; next poll
  // returns the same list with seen_at populated and unread_count=0.
  const openAlerts = useCallback(async (): Promise<void> => {
    haptics.tap();
    setShowAlertsModal(true);
    setInboxLoading(true);
    try {
      await refreshInbox();
      if (inboxUnread > 0) {
        await markAllNotificationsRead().catch(() => {});
        setInboxUnread(0);
        // Optimistically stamp seen_at locally so the row badges flip
        // even before the next poll returns.
        setInboxItems((prev) =>
          prev.map((n) => (n.seen_at ? n : { ...n, seen_at: new Date().toISOString() })),
        );
      }
    } finally {
      setInboxLoading(false);
    }
  }, [inboxUnread, refreshInbox]);

  // Tap on a single row — mark that one as read and follow deep_link
  // if present. Quote-reply notifications carry deep_link pointing at
  // the EnquiryDetails screen, so this routes the user straight there.
  const handleNotificationTap = useCallback(
    (n: InboxItem): void => {
      markNotificationRead(n.id).catch(() => {});
      setInboxItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, seen_at: new Date().toISOString() } : x)),
      );
      setShowAlertsModal(false);
      const route = n.deep_link?.route;
      const params = n.deep_link?.params;
      if (route && typeof navigation.navigate === 'function') {
        try {
          navigation.navigate(String(route), params || {});
        } catch (_) {
          /* unknown route — silent */
        }
      }
    },
    [navigation],
  );

  // (Hero + Offers carousels now self-animate via <AutoCarousel /> — see
  // src/components/AutoCarousel.tsx for the Reanimated implementation.)

  // Search functionality with debouncing - ref-based to prevent keyboard dismissal
  // ─── Debounced search ───
  // Typing feels instant; actual filter runs once the user pauses for 500ms.
  // No API calls are made per keystroke — we filter the already-loaded `services`
  // array locally, so results are O(n) over the in-memory list.
  const handleSearchInputChange = useCallback((query: string) => {
    setSearchQuery(query);

    // Cancel pending filter run
    if (searchTimeoutId) clearTimeout(searchTimeoutId);

    // Empty input → clear results immediately
    if (!query || query.trim().length === 0) {
      setSearchResults([]);
      setIsSearching(false);
      setShowSearchModal(false);
      setSearchTimeoutId(null);
      return;
    }

    // Show loading state right away; actual filter debounced 500ms
    setIsSearching(true);
    const timeoutId = setTimeout(() => {
      const q = query.trim().toLowerCase();
      const filtered = services.filter((svc: any) =>
        (svc.name || '').toLowerCase().includes(q) ||
        (svc.category || '').toLowerCase().includes(q) ||
        (svc.description || '').toLowerCase().includes(q)
      );
      setSearchResults(filtered);
      setIsSearching(false);
    }, 500); // 500 ms debounce — feels snappy, prevents flicker per keystroke

    setSearchTimeoutId(timeoutId);
  }, [searchTimeoutId, services]);


  const handleSearchInputFocus = useCallback(() => {
    setSearchInputFocused(true);
  }, []);

  const handleSearchInputBlur = useCallback(() => {
    setSearchInputFocused(false);
    // Don't hide modal immediately to allow clicking on results
    setTimeout(() => {
      if (!searchInputFocused) {
        setShowSearchModal(false);
      }
    }, 200);
  }, [searchInputFocused]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setIsSearching(false);
    setShowSearchModal(false);
    if (searchTimeoutId) {
      clearTimeout(searchTimeoutId);
      setSearchTimeoutId(null);
    }
    // Don't force focus back - let user control keyboard
  }, [searchTimeoutId]);

  // Voice search — defensive load of @react-native-voice/voice. If the
  // native module is built into the APK (you've installed the package
  // and rebuilt with gradlew assembleRelease), real STT runs and
  // whatever the user says lands in the search input → fires the
  // existing debounced search → suggestions appear → tap routes to
  // booking flow. If the module isn't available (e.g. dev-client APK
  // built before the package was installed), we fall back to focusing
  // the input + nudging the user to use the keyboard's built-in mic
  // — that path always works.
  let VoiceMod: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    VoiceMod = require('@react-native-voice/voice')?.default || null;
  } catch (_) {
    VoiceMod = null;
  }

  const [voiceListening, setVoiceListening] = useState<boolean>(false);

  // Wire Voice events on mount so we can stream interim results into
  // the search input (mimics Google's voice-search UI — text appears
  // as you speak).
  useEffect(() => {
    if (!VoiceMod) return;
    const onResult = (e: any) => {
      const text = (e?.value && e.value[0]) || '';
      if (text) {
        setSearchQuery(text);
        handleSearchInputChange(text);
      }
    };
    const onPartial = (e: any) => {
      const text = (e?.value && e.value[0]) || '';
      if (text) setSearchQuery(text);
    };
    const onEnd = () => setVoiceListening(false);
    const onError = () => setVoiceListening(false);
    VoiceMod.onSpeechResults = onResult;
    VoiceMod.onSpeechPartialResults = onPartial;
    VoiceMod.onSpeechEnd = onEnd;
    VoiceMod.onSpeechError = onError;
    return () => {
      try { VoiceMod.destroy?.().then?.(VoiceMod.removeAllListeners); } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVoiceSearch = useCallback(async () => {
    haptics.tap();

    if (VoiceMod) {
      // Real STT path. Toggle: tap once to start listening, tap again
      // to stop. Errors fall through to the keyboard-fallback path.
      try {
        if (voiceListening) {
          await VoiceMod.stop();
          setVoiceListening(false);
          return;
        }
        // Empty the search box so the spoken phrase replaces (not
        // appends to) any previous query.
        setSearchQuery('');
        await VoiceMod.start('en-IN');
        setVoiceListening(true);
        return;
      } catch (err: any) {
        console.log('Voice.start failed, falling back:', err?.message);
        setVoiceListening(false);
        // fall through to the keyboard-mic fallback below
      }
    }

    // Fallback path — runs when @react-native-voice/voice native code
    // isn't compiled into the APK. Focus the input + show the keyboard
    // so the user can fall back to Gboard's mic key. Once the package
    // has been npm-installed AND prebuild + assembleRelease have run,
    // this branch stops firing and real in-app STT takes over.
    searchInputRef.current?.focus?.();
    setTimeout(() => {
      const y = Math.max(0, (searchYRef.current || 0) - 12);
      scrollRef.current?.scrollTo({ y, animated: true });
    }, 60);
    Alert.alert(
      'Voice not enabled yet',
      "In-app voice search needs the @react-native-voice/voice native module — your current APK was built before it was installed.\n\n" +
        "For now, tap the 🎤 mic on your keyboard and say the service name. Your build needs to be re-prebuilt + reinstalled before the in-app mic starts capturing speech.",
      [{ text: 'Got it' }],
      { cancelable: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceListening, VoiceMod]);


  const handleModalServicePress = useCallback((service: any) => {
    setShowSearchModal(false);
    handleServicePress(service);
  }, []);

  // Two-pass user load:
  //   1. Read the AsyncStorage cache and render immediately (fast,
  //      offline-safe).
  //   2. In the background, hit GET /profile and merge the freshest
  //      profile_pic / name back into the cache. This stops the header
  //      avatar from "going missing" after an app restart — the cache
  //      can get overwritten by guest-login fallback or older payloads
  //      that don't include profile_pic, while the backend always has
  //      the truth. Re-syncing here keeps AsyncStorage authoritative.
  const loadUserData = async (): Promise<void> => {
    try {
      const cached = await getUser();
      if (cached) setUser(cached);
    } catch (error) {
      console.error('Error loading cached user data:', error);
    }

    try {
      const resp: any = await getProfile();
      const fresh: any = resp?.user || resp?.data || resp || null;
      if (fresh && typeof fresh === 'object') {
        const cached: any = (await getUser()) || {};
        // Merge so any local-only fields stay; backend wins for any
        // canonical fields (profile_pic, name, mobile, email, etc.).
        const merged = { ...cached, ...fresh };
        await storeUser(merged);
        setUser(merged);
      }
    } catch (error) {
      // Backend unreachable — keep the cached value we already set above.
      // Don't surface this to the user; the home screen still renders.
      console.log('[home] background profile refresh failed:', (error as any)?.message);
    }
  };

  // Fetch trending services + active offers in parallel.
  // Failure here is non-fatal — the home screen still works without these
  // optional sections, so we just swallow + log the error.
  const loadTrendingAndOffers = async (): Promise<void> => {
    try {
      const [trendingRes, offersRes] = await Promise.all([
        getTrendingServices(),
        getOffers(),
      ]);
      setTrendingServices((trendingRes?.data as Service[]) || []);
      setOffers((offersRes?.data as OfferItem[]) || []);
    } catch (err) {
      console.warn('loadTrendingAndOffers failed (non-fatal):', err);
    }
  };

  const loadServices = async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      console.log('=== LOADING SERVICES ===');

      // Add retry mechanism for service loading
      let response: any;
      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries) {
        try {
          response = await getServices(serviceType);
          console.log('Services received:', response);
          break; // Success, exit retry loop
        } catch (error: any) {
          retryCount++;
          console.log(`Service load attempt ${retryCount} failed:`, error.message);

          if (retryCount >= maxRetries) {
            throw error; // Re-throw after max retries
          }
        }
      }

      // Process successful response
      console.log('=== HOMESCREEN CATEGORY BREAKDOWN ===');

      // Extract categories from services
      const aadhaarServices = response.data.filter((s: any) =>
        s.name && s.name.toLowerCase().includes('aadhaar')
      );
      const panServices = response.data.filter((s: any) =>
        s.name && s.name.toLowerCase().includes('pan')
      );
      const voterIdServices = response.data.filter((s: any) =>
        s.name && (s.name.toLowerCase().includes('voter') || s.name.toLowerCase().includes('voter id'))
      );
      const rationCardServices = response.data.filter((s: any) =>
        s.name && (s.name.toLowerCase().includes('ration') || s.name.toLowerCase().includes('ration card'))
      );
      const drivingLicenseServices = response.data.filter((s: any) =>
        s.name && (s.name.toLowerCase().includes('driving') || s.name.toLowerCase().includes('license') || s.name.toLowerCase().includes('driving license'))
      );

      console.log('Aadhaar services found in raw data:', aadhaarServices.length);
      console.log('Aadhaar service names:', aadhaarServices.map((s: any) => s.name));
      console.log('PAN services found in raw data:', panServices.length);
      console.log('PAN service names:', panServices.map((s: any) => s.name));
      console.log('Voter ID services found in raw data:', voterIdServices.length);
      console.log('Voter ID service names:', voterIdServices.map((s: any) => s.name));
      console.log('Ration Card services found in raw data:', rationCardServices.length);
      console.log('Ration Card service names:', rationCardServices.map((s: any) => s.name));
      console.log('Driving License services found in raw data:', drivingLicenseServices.length);
      console.log('Driving License service names:', drivingLicenseServices.map((s: any) => s.name));

      const totalKnownServices = aadhaarServices.length + panServices.length + voterIdServices.length + rationCardServices.length + drivingLicenseServices.length;
      console.log('Total known services:', totalKnownServices);
      console.log('Total services from API:', response.data.length);
      console.log('===================================');

      // Extract unique categories
      const uniqueCategories = [
        STRINGS.ALL_CATEGORIES,
        ...new Set(response.data.map((service: any) => service.category).filter(Boolean))
      ];

      setServices(response.data);
      setCategories(uniqueCategories);
    } catch (error) {
      console.error('Error loading services:', error);
      setError('Failed to load services. Please check your connection.');
      setServices([]);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    await loadServices();
    setRefreshing(false);
  }, [serviceType]);

  const handleB2BToggle = (type: 'consumer' | 'industrial') => {
    setServiceType(type);
    setSelectedCategory(STRINGS.ALL_CATEGORIES);
  };

  function handleServicePress(service: any) {
    if (!service?.id) return;
    // Drop the keyboard first; without this Android sometimes swallows the
    // navigation while the IME is animating away.
    Keyboard.dismiss();
    clearSearch();
    // Defer navigate by one frame so the dropdown unmount + setState calls
    // settle before navigation begins. Without this, on some Android builds
    // the tap is consumed by the unmounting Touchable and navigate never
    // fires.
    requestAnimationFrame(() => {
      navigation.navigate('ServiceDetails', { serviceId: service.id });
    });
  }

  const handleCategoryPress = (category: string) => {
    setSelectedCategory(category);
  };

  const handleShareApp = async (): Promise<void> => {
    try {
      const message = `Check out FlipOn Digital! Your trusted service partner for all document needs.\n\nDownload now: https://play.google.com/store/apps/details?id=com.flipon.digital`;
      await Share.share({
        message,
        title: 'FlipOn Digital App',
      });
    } catch (error) {
      console.error('Error sharing app:', error);
    }
  };

  const handleContactSupport = () => {
    Alert.alert(
      'Contact Support',
      `FliponeX Customer Support\n${STRINGS.SUPPORT_HOURS}`,
      [
        { text: 'Call', onPress: () => Linking.openURL(`tel:${STRINGS.SUPPORT_PHONE}`) },
        { text: 'Email', onPress: () => Linking.openURL(`mailto:${STRINGS.SUPPORT_EMAIL}`) },
        { text: 'WhatsApp', onPress: () => Linking.openURL(STRINGS.WHATSAPP_URL) },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  };

  const handleExploreServices = () => {
    Alert.alert(
      'Explore Services',
      'Discover our amazing services!',
      [
        { text: 'Document Services', onPress: () => setSelectedCategory('Document Services') },
        { text: 'Government Services', onPress: () => setSelectedCategory('Government Services') },
        { text: 'Business Services', onPress: () => setSelectedCategory('Business Services') },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  };

  const handleQuickAction = (action: string) => {
    switch(action) {
      case 'track':
        navigation.navigate('MyBookings');
        break;
      case 'documents':
        navigation.navigate('Documents');
        break;
      case 'notifications':
        Alert.alert('Notifications', 'You have no new notifications! 🎉');
        break;
      case 'rewards':
        Alert.alert('Rewards', 'Earn points with every booking! 🏆');
        break;
      default:
        break;
    }
  };

  const handleLogout = async (): Promise<void> => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              // No login screen any more — clear the session and restart at
              // Splash, which re-issues a fresh guest JWT and lands on Home.
              await clearAuthSession();
              (navigation as any).reset({ index: 0, routes: [{ name: 'Splash' }] });
            } catch (error) {
              console.error('Error during logout:', error);
              Alert.alert('Error', 'Failed to logout');
            }
          },
        },
      ]
    );
  };

  // Priority order for the "All Categories" view: surface the high-demand
  // ID/document services first, then everything else in original order.
  const PRIORITY_KEYWORDS = ['aadhaar', 'pan', 'voter', 'ration', 'driving', 'license'];
  const priorityRank = (svc: any) => {
    const n = (svc?.name || '').toLowerCase();
    const idx = PRIORITY_KEYWORDS.findIndex((k) => n.includes(k));
    return idx === -1 ? PRIORITY_KEYWORDS.length : idx;
  };

  const baseFiltered = selectedCategory === STRINGS.ALL_CATEGORIES
    ? services
    : services.filter((service: any) => service.category === selectedCategory);

  const filteredServices = [...baseFiltered].sort(
    (a, b) => priorityRank(a) - priorityRank(b)
  );

  // Debug filtering
  console.log('=== SERVICE FILTERING DEBUG ===');
  console.log('Selected category:', selectedCategory);
  console.log('Total services before filtering:', services.length);
  console.log('Services after filtering:', filteredServices.length);
  console.log('Filtered service names:', filteredServices.map((s: any) => s.name));

  const aadhaarInFiltered = filteredServices.filter((s: any) =>
    s.name && s.name.toLowerCase().includes('aadhaar')
  );
  const panInFiltered = filteredServices.filter((s: any) =>
    s.name && s.name.toLowerCase().includes('pan')
  );
  const voterIdInFiltered = filteredServices.filter((s: any) =>
    s.name && (s.name.toLowerCase().includes('voter') || s.name.toLowerCase().includes('voter id'))
  );
  const rationCardInFiltered = filteredServices.filter((s: any) =>
    s.name && (s.name.toLowerCase().includes('ration') || s.name.toLowerCase().includes('ration card'))
  );
  const drivingLicenseInFiltered = filteredServices.filter((s: any) =>
    s.name && (s.name.toLowerCase().includes('driving') || s.name.toLowerCase().includes('license') || s.name.toLowerCase().includes('driving license'))
  );

  console.log('=== FILTERING CATEGORY BREAKDOWN ===');
  console.log('Aadhaar services in filtered list:', aadhaarInFiltered.length);
  console.log('Aadhaar names in filtered:', aadhaarInFiltered.map((s: any) => s.name));
  console.log('PAN services in filtered list:', panInFiltered.length);
  console.log('PAN names in filtered:', panInFiltered.map((s: any) => s.name));
  console.log('Voter ID services in filtered list:', voterIdInFiltered.length);
  console.log('Voter ID names in filtered:', voterIdInFiltered.map((s: any) => s.name));
  console.log('Ration Card services in filtered list:', rationCardInFiltered.length);
  console.log('Ration Card names in filtered:', rationCardInFiltered.map((s: any) => s.name));
  console.log('Driving License services in filtered list:', drivingLicenseInFiltered.length);
  console.log('Driving License names in filtered:', drivingLicenseInFiltered.map((s: any) => s.name));

  const totalKnownInFiltered = aadhaarInFiltered.length + panInFiltered.length + voterIdInFiltered.length + rationCardInFiltered.length + drivingLicenseInFiltered.length;
  console.log('Total known services in filtered:', totalKnownInFiltered);
  console.log('Total services in filtered:', filteredServices.length);
  console.log('================================');
  console.log('=============================');

  // useCallback so the FlatList's renderItem reference stays stable
  // across the View All ↔ Show Less toggle. Combined with React.memo
  // on ServiceCard, this means existing cards skip their re-render
  // when only `showAllServices` flipped — the toggle now feels
  // instant even at 156 services.
  const renderServiceCard = useCallback(
    ({ item, index }: { item: any; index: number }) => (
      <ServiceCard service={item} onPress={handleServicePress} index={index} />
    ),
    [handleServicePress],
  );

  const renderCategoryChip = (category: string) => (
    <TouchableOpacity
      key={category}
      style={[
        styles.categoryChip,
        selectedCategory === category && styles.selectedCategoryChip,
      ]}
      onPress={() => handleCategoryPress(category)}
    >
      <Text style={[
        styles.categoryChipText,
        selectedCategory === category && styles.selectedCategoryChipText,
      ]}>
        {category}
      </Text>
    </TouchableOpacity>
  );

  // Combined sticky brand block — greeting + buttons + search all stick together
  const renderStickyBrand = () => (
    <View style={styles.stickyBrand} collapsable={false}>
      <View style={styles.headerTop}>
        {/* App logo — small circular image to reinforce branding */}
        <View style={styles.brandLogoWrap}>
          <Image source={require('../assets/logo.jpeg')} style={styles.brandLogo} resizeMode="contain" />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>Hello {(user?.name || 'there').split(' ')[0]} 👋</Text>
          {/* Brand title — "FlipOne" white, "X" gold accent (matches the
              marketing logo treatment), then a small "Doorstep Digital
              Service" pill on its own line directly below. */}
          <Text style={styles.brandName}>
            Flipone<Text style={styles.brandNameAccent}>X</Text> Digital
          </Text>
          <View style={styles.brandTagline}>
            <Text style={styles.brandTaglineText}>Doorstep Digital Services</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          {/* Alerts bell — left of the profile icon. Replaces the
              in-body "Alerts" chip that used to sit between the quad
              cards and the Common/Industrial toggle. Badge appears
              when there are unread inbox items. Wrapped in a separate
              container so the unread-count badge can poke outside the
              circle without disabling the profile-pic clip. */}
          <View style={styles.bellWrap}>
            <TouchableOpacity
              style={styles.bellInner}
              onPress={openAlerts}
              accessibilityLabel="Open alerts"
            >
              <Text style={styles.iconButtonText}>🔔</Text>
            </TouchableOpacity>
            {inboxUnread > 0 && (
              <View style={styles.headerBellBadge} pointerEvents="none">
                <Text style={styles.headerBellBadgeText}>
                  {inboxUnread > 99 ? '99+' : inboxUnread}
                </Text>
              </View>
            )}
          </View>

          {/* Single avatar button — opens Profile. Surfaces, in order:
                1. profile_pic if uploaded (real photo)
                2. first letter of user.name if set
                3. generic 👤 emoji as the very last fallback
              The standalone door / logout icon was removed — Logout
              already lives inside the Profile screen, so the duplicate
              top-right button just confused users. */}
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => navigation.navigate('Profile')}
            accessibilityLabel="Open profile"
          >
            {user?.profile_pic ? (
              <Image
                source={{ uri: user.profile_pic }}
                style={styles.iconAvatarImg}
                resizeMode="cover"
              />
            ) : user?.name && user.name.trim().length > 0 ? (
              <Text style={[styles.iconButtonText, { fontWeight: '900' }]}>
                {user.name.trim().charAt(0).toUpperCase()}
              </Text>
            ) : (
              <Text style={styles.iconButtonText}>👤</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

    </View>
  );

  const renderRestOfHeader = () => (
    <View>
      {/* ─── Trust strip — 5 mini-cards that auto-rotate horizontally
          via the same native-thread AutoCarousel used for "FliponeX at
          a Glance" hero banners below. Each item slides every 2.8s with
          a cubic-ease curve so the user always sees the full set even
          if they don't manually swipe. */}
      <View style={styles.trustStrip}>
        <AutoCarousel
          items={[
            { image: require('../../assets/location.png'), iconBg: '#EDE7F6', label: 'Real-time Tracking', sub: 'Track your service in real-time' },
            { icon: '🛡️', iconBg: '#E3F2FD', label: '100% Secure', sub: 'Your data is fully protected' },
            { icon: '✅', iconBg: '#E8F5E9', label: 'Verified Agent', sub: 'Experts at your doorstep' },
            { icon: '💼', iconBg: '#E3EEF8', label: 'Pay After Service', sub: 'Pay only once task is completed' },
            { icon: '🎧', iconBg: '#FCE4EC', label: '24x7 Support', sub: 'We are always here to help' },
          ]}
          cardWidth={200}
          intervalMs={2800}
          slideDurationMs={650}
          renderItem={(item: any) => (
            <View style={styles.trustItem}>
              <View style={[styles.trustItemIcon, { backgroundColor: item.iconBg }]}>
                {item.image ? (
                  <Image source={item.image} style={styles.trustItemImg} resizeMode="contain" />
                ) : (
                  <Text style={styles.trustItemIconEmoji}>{item.icon}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.trustItemLabel} numberOfLines={1}>{item.label}</Text>
                <Text style={styles.trustItemSub} numberOfLines={2}>{item.sub}</Text>
              </View>
            </View>
          )}
          style={{ paddingHorizontal: 6 }}
        />
      </View>

      {/* ─── Hero card — the marketing centerpiece. Navy gradient with
          headline, 5 service pills (Aadhaar/PAN/GST/Loans/100+), the
          "Fast · Secure · Reliable" tagline, and the gold CTA. The
          delivery-rep illustration sits on the right; if you've added
          src/assets/delivery-rep.png it gets used, otherwise the
          fallback composition shows. */}
      <View style={styles.heroCard}>
        <View style={styles.heroCardRow}>
          <View style={styles.heroCardLeft}>
            {/* Single-line headline — was previously split across two
                lines ("Get Any Common and" / "Industrial Services"),
                which made the hero card eat too much vertical space
                AND wrapped awkwardly on narrow screens. adjustsFontSizeToFit
                ensures the text shrinks if it would otherwise wrap on
                very small devices. */}
            <Text
              style={styles.heroCardTitle}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              Get Any Common & Industrial Services
            </Text>
            <Text style={styles.heroCardTitleAccent}>At Your Doorstep</Text>

            <View style={styles.heroPills}>
              {/* GST removed — service is not live yet. Will restore
                  once the GST registration flow ships. */}
              {['Aadhaar', 'PAN', 'Loans', '100+ Services'].map((label) => (
                <View key={label} style={styles.heroPill}>
                  <Text style={styles.heroPillTick}>✓</Text>
                  <Text style={styles.heroPillText}>{label}</Text>
                </View>
              ))}
            </View>

            <View style={styles.heroTaglineRow}>
              <View style={styles.heroTaglineLine} />
              <Text style={styles.heroTaglineText}>Fast · Secure · Reliable</Text>
              <View style={styles.heroTaglineLine} />
            </View>

            <TouchableOpacity
              style={styles.heroCardCta}
              activeOpacity={0.85}
              onPress={scrollToServices}
            >
              <Text style={styles.heroCardCtaText}>Book Service Now  →</Text>
            </TouchableOpacity>
          </View>

          {/* Delivery-rep illustration with a stylized scene behind it
              that mirrors the marketing reference: a navy door panel
              with brass handle, faint city-skyline silhouettes (lighter
              navy rectangles in varying heights), a small grid of dots
              in the upper-right corner, and a green plant tucked next
              to the door. All scene elements are absolute-positioned
              behind the agent image so the figure stays anchored in
              the foreground. */}
          <View style={styles.heroCardRight}>
            {/* Top-right grid dots */}
            <View style={styles.heroSceneDots} pointerEvents="none">
              {Array.from({ length: 9 }).map((_, i) => (
                <View key={i} style={styles.heroSceneDot} />
              ))}
            </View>

            {/* City skyline silhouette — lighter navy rectangles. */}
            <View style={styles.heroSceneSkyline} pointerEvents="none">
              <View style={[styles.skyBldg, { height: 40, marginRight: 2 }]} />
              <View style={[styles.skyBldg, { height: 28, marginRight: 2 }]} />
              <View style={[styles.skyBldg, { height: 56, marginRight: 2 }]} />
              <View style={[styles.skyBldg, { height: 36, marginRight: 2 }]} />
              <View style={[styles.skyBldg, { height: 48 }]} />
            </View>

            {/* Door panel — taller than the rep, sits flush right behind */}
            <View style={styles.heroSceneDoorFrame} pointerEvents="none">
              <View style={styles.heroSceneDoor}>
                <View style={styles.heroSceneDoorHandle} />
              </View>
            </View>

            {/* Plant block was removed — the floating leaf emoji over a
                small terracotta tile read as awkward clip-art rather
                than scenery. The agent PNG already has its own subtle
                background details; keeping the scene clean (just
                door + skyline + dots + halo) makes the figure pop. */}

            {/* Soft halo behind the rep for the "spotlight" effect */}
            <View style={styles.heroRepHalo} pointerEvents="none" />

            {/* Foreground: the rep PNG */}
            <Image
              source={require('../../assets/agent.png')}
              style={styles.heroRepImage}
              resizeMode="contain"
            />
          </View>
        </View>
      </View>

      {/* ─── 4-card action grid in a SINGLE ROW: Book New Service /
          My Bookings / My Documents / Refer & Earn. Each card is now
          ~23% width so all 4 fit horizontally on a phone screen. */}
      <View style={styles.quadCards}>
        <TouchableOpacity
          style={[styles.quadCard, { backgroundColor: '#1976D2' }]}
          onPress={scrollToServices}
          activeOpacity={0.85}
        >
          <View style={styles.quadCardIcon}>
            <Text style={styles.quadCardIconText}>+</Text>
          </View>
          <Text style={styles.quadCardTitle}>Book{'\n'}New</Text>
          <Text style={styles.quadCardCtaText}>BOOK NOW →</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.quadCard, { backgroundColor: '#2E7D32' }]}
          onPress={() => navigation.navigate('MyBookings')}
          activeOpacity={0.85}
        >
          <View style={styles.quadCardIcon}>
            <Text style={styles.quadCardIconText}>📋</Text>
          </View>
          <Text style={styles.quadCardTitle}>My{'\n'}Bookings</Text>
          <Text style={styles.quadCardCtaText}>VIEW →</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.quadCard, { backgroundColor: '#7B1FA2' }]}
          onPress={() => handleQuickAction('documents')}
          activeOpacity={0.85}
        >
          <View style={styles.quadCardIcon}>
            <Text style={styles.quadCardIconText}>📁</Text>
          </View>
          <Text style={styles.quadCardTitle}>KYC{'\n'}Documents</Text>
          <Text style={styles.quadCardCtaText}>VIEW →</Text>
        </TouchableOpacity>

        {/* Refer & Earn — gold↘amber linear gradient (not pure yellow) so
            it reads as a premium "rewards" tile next to the solid colored
            siblings. Dark navy text + dark CTA pill keep contrast high. */}
        <TouchableOpacity onPress={handleShareApp} activeOpacity={0.85} style={styles.quadCardWrap}>
          <LinearGradient
            colors={['#FCD34D', '#F59E0B', '#D97706']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.quadCard}
          >
            <Text style={styles.quadCardGiftEmoji}>🎁</Text>
            <Text style={styles.quadCardTitleGold}>Refer{'\n'}& Earn</Text>
            <Text style={styles.quadCardCtaTextGold}>₹20 →</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* 30-day Critical Compliance Alert — only renders when the user
          has at least one document expiring in <30 days. Sits directly
          below the quad cards (Book New / My Bookings / KYC Documents /
          Refer & Earn) so the "Action Required Immediately" prompt is
          the first thing the user sees after the primary actions. Spec
          wording exactly: "Action Required Immediately to avoid
          penalties!". The previous Rewards + Alerts chip strip that
          used to live between the cards and the toggle was removed —
          Alerts moved to the header bell (top-right, left of avatar)
          and Rewards became a Profile-screen entry. */}
      <ComplianceRedAlertBanner
        onPress={() => navigation.navigate('Compliance')}
      />

      <B2BToggle onToggle={handleB2BToggle} currentMode={serviceType} />

      {/* Search bar — moved up so it sits directly under the Common /
          Industrial toggle. Lets the user filter the services grid
          without scrolling past promo strips and other secondary
          content. Dropdown of matches renders directly under the
          input. */}
      <View
        style={styles.inlineSearchWrap}
        onLayout={(e: any) => {
          searchYRef.current = e.nativeEvent.layout.y;
        }}
      >
        <View style={styles.inlineSearchBar}>
          <Text style={styles.inlineSearchIcon}>🔍</Text>
          <TextInput
            ref={searchInputRef}
            style={styles.inlineSearchInput}
            placeholder="Search for any service (e.g. Aadhaar, PAN, Voter ID...)"
            placeholderTextColor="#9AA5B1"
            value={searchQuery}
            onChangeText={handleSearchInputChange}
            onFocus={() => {
              handleSearchInputFocus();
              setTimeout(() => {
                const y = Math.max(0, (searchYRef.current || 0) - 12);
                scrollRef.current?.scrollTo({ y, animated: true });
              }, 60);
            }}
            onBlur={handleSearchInputBlur}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={clearSearch}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.inlineSearchClear}>✕</Text>
            </TouchableOpacity>
          )}
          {/* In-app mic button removed per request. If users need voice
              entry, the device keyboard's own mic key still works since
              the TextInput honors standard IME voice input. */}
        </View>

        {searchQuery.length > 0 && (
          <View style={styles.searchDropdown}>
            {isSearching ? (
              <View style={styles.searchDropdownEmpty}>
                <ActivityIndicator size="small" color="#0D3B66" />
                <Text style={styles.searchDropdownHint}>Searching...</Text>
              </View>
            ) : searchResults.length === 0 ? (
              <View style={styles.searchDropdownEmpty}>
                <Text style={styles.searchDropdownEmptyIcon}>🔎</Text>
                <Text style={styles.searchDropdownEmptyTitle}>
                  No matches for "{searchQuery}"
                </Text>
                <Text style={styles.searchDropdownHint}>Try a different keyword</Text>
              </View>
            ) : (
              <View>
                <Text style={styles.searchDropdownLabel}>
                  {searchResults.length} result{searchResults.length > 1 ? 's' : ''}
                </Text>
                {searchResults.slice(0, 8).map((item: any) => (
                  <Pressable
                    key={item.id}
                    style={({ pressed }) => [
                      styles.searchResultItem,
                      pressed && { backgroundColor: '#F5F8FB' },
                    ]}
                    onPress={() => handleServicePress(item)}
                    android_ripple={{ color: '#E3EEF8' }}
                  >
                    <View style={styles.searchResultIconBox}>
                      <Text style={styles.searchResultIcon}>📄</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.searchResultName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.searchResultCategory} numberOfLines={1}>
                        {item.category || 'Service'}
                      </Text>
                    </View>
                    <Text style={styles.searchResultPrice}>
                      ₹{item.user_cost || item.total_expense || '0'}
                    </Text>
                  </Pressable>
                ))}
                {searchResults.length > 8 && (
                  <Text style={styles.searchDropdownHint}>
                    + {searchResults.length - 8} more · refine your search
                  </Text>
                )}
              </View>
            )}
          </View>
        )}
      </View>

      {/* ─── Trending Services section REMOVED — was here, taking too
          much vertical real estate. Customers now search via the bar
          above or browse the categories strip + popular grid below. */}
      {false && displayedTrending.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📈 Trending Services</Text>
          <AutoCarousel
            items={displayedTrending}
            cardWidth={150}
            intervalMs={3000}
            slideDurationMs={650}
            renderItem={(item: any) => (
              <TouchableOpacity
                key={item.id}
                style={styles.trendingCard}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('ServiceDetails', { serviceId: item.id })}
              >
                <Text style={styles.trendingName} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.trendingPrice}>
                  ₹{item.user_cost ?? item.total_expense ?? 0}
                </Text>
                <View style={styles.trendingCta}>
                  <Text style={styles.trendingCtaText}>Book Now</Text>
                </View>
              </TouchableOpacity>
            )}
            style={{ paddingHorizontal: 6 }}
          />
        </View>
      )}

      {/* Why-FliponeX promo strip was here — now lives at the very
          bottom of the home screen (right above the WhatsApp button)
          so it appears AFTER the user has scrolled past the services
          listing, matching the requested layout. */}

      <View style={styles.categoriesContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.categoriesRow}>
            {categories.map(renderCategoryChip)}
          </View>
        </ScrollView>
      </View>

    </View>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateTitle}>{STRINGS.EMPTY_SERVICES_TITLE}</Text>
      <Text style={styles.emptyStateSubtitle}>{STRINGS.EMPTY_SERVICES_SUBTITLE}</Text>
    </View>
  );

  // ─── Services grid (memoised so View All ↔ Show Less is instant) ────
  // Without these useMemos, toggling either way ran the full group
  // reduce + Object.entries on 156 services every render. Now the
  // expensive groupedServices step runs only when the source list
  // changes; visibleSections recomputes only when the toggle flips.
  const sourceList = isSearching ? searchResults : filteredServices;

  const groupedServices = useMemo(() => {
    if (!sourceList || sourceList.length === 0) {
      return { entries: [] as [string, any[]][], total: 0 };
    }
    const groups: Record<string, any[]> = {};
    for (const svc of sourceList) {
      const cat = (svc.category && String(svc.category).trim()) || 'Other Services';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(svc);
    }
    const entries = Object.entries(groups) as [string, any[]][];
    const total = entries.reduce((sum, [, arr]) => sum + arr.length, 0);
    return { entries, total };
  }, [sourceList]);

  const visibleSections = useMemo(() => {
    const { entries, total } = groupedServices;
    const hasMore = total > TOTAL_INITIAL_SERVICES;
    if (showAllServices || !hasMore) {
      return { sections: entries, hasMore, total };
    }
    const sections: [string, any[]][] = [];
    let remaining = TOTAL_INITIAL_SERVICES;
    for (const [cat, arr] of entries) {
      if (remaining <= 0) break;
      const slice = arr.slice(0, remaining);
      sections.push([cat, slice]);
      remaining -= slice.length;
    }
    return { sections, hasMore, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedServices, showAllServices]);

  const renderServicesGrid = () => {
    if (!sourceList || sourceList.length === 0) {
      return isSearching ? renderSearchEmptyState() : renderEmptyState();
    }
    const { sections, hasMore, total } = visibleSections;
    return (
      <>
        {hasMore && (
          <TouchableOpacity
            style={styles.globalViewAllBtn}
            onPress={() => {
              haptics.tap();
              setShowAllServices((v) => !v);
            }}
          >
            <Text style={styles.globalViewAllBtnText}>
              {showAllServices
                ? 'Show Less ↑'
                : `View All Services (${total}) →`}
            </Text>
          </TouchableOpacity>
        )}

        {sections.map(([category, items]: [string, any[]]) => {
          const fullCount = groupedServices.entries.find(
            ([c]) => c === category,
          )?.[1].length ?? items.length;
          return (
            <View key={category} style={styles.catSection}>
              <View style={styles.catHeader}>
                <Text style={styles.catIcon}>{iconForCategory(category)}</Text>
                <Text style={styles.catTitle}>{category}</Text>
                <Text style={styles.catCount}>
                  {showAllServices
                    ? items.length
                    : `${items.length}${
                        fullCount > items.length ? ` of ${fullCount}` : ''
                      }`}
                </Text>
              </View>
              {/* Original 2-column FlatList preserved exactly so the
                  visual layout is unchanged. Speed gains come from
                  the useMemo on groupedServices + visibleSections
                  above and the React.memo on ServiceCard. */}
              <FlatList
                data={items}
                renderItem={renderServiceCard}
                keyExtractor={(item: any) =>
                  item.id?.toString?.() ?? Math.random().toString()
                }
                numColumns={2}
                contentContainerStyle={styles.servicesGrid}
                columnWrapperStyle={styles.servicesRow}
                scrollEnabled={false}
              />
            </View>
          );
        })}
      </>
    );
  };

  const renderLoadingState = () => (
    <View style={styles.loadingState}>
      <ActivityIndicator size="large" color={COLORS.PRIMARY} />
      <Text style={styles.loadingText}>{STRINGS.LOADING_SERVICES}</Text>
    </View>
  );

  const renderSearchEmptyState = () => (
    <View style={styles.searchEmptyState}>
      <Text style={styles.searchEmptyTitle}>No Services Found</Text>
      <Text style={styles.searchEmptyMessage}>Try searching with different keywords</Text>
    </View>
  );

  if (loading && !refreshing) {
    return (
      <View style={styles.container}>
        {renderStickyBrand()}
        {renderLoadingState()}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      // On Android, `softwareKeyboardLayoutMode: "resize"` works once we
      // wrap with KeyboardAvoidingView (edge-to-edge mode otherwise lets
      // the keyboard cover focused inputs). 'padding' for iOS,
      // 'height' for Android — that combination keeps the search bar +
      // its result dropdown visible above the keyboard.
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <View style={styles.container}>
      {/* Brand block rendered OUTSIDE the ScrollView. Earlier we used
          ScrollView's `stickyHeaderIndices` which has a known Android
          bug — the sticky element's TOUCH hit-test stays at its
          original (scrolled-off) position even though it's visually
          pinned at the top, so the user-icon button became
          unclickable after any scroll. Lifting it outside avoids the
          bug entirely: the brand is a regular fixed View, the
          ScrollView sits below it, and taps land where they should. */}
      {renderStickyBrand()}
      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        // Reserve space at the bottom for the device's gesture bar /
        // home indicator AND the bottom-tab nav (~72px). Without this,
        // the last CTA on the home page was hidden behind the Android
        // 3-button bar on phones like the Pixel 6 / OnePlus.
        contentContainerStyle={[
          styles.scrollViewContent,
          // Just enough room for the system gesture bar — the FAB now
          // floats outside the ScrollView so we no longer need 96px
          // of reserved space that was causing a white gap below the
          // "Why FliponeX" section.
          { paddingBottom: insets.bottom + 16 },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[COLORS.PRIMARY]}
          />
        }
      >
        {renderRestOfHeader()}

        {/* onLayout captures Y offset so the hook's "Book Now, Pay Later"
            button can scroll the user straight to the services grid. */}
        <View onLayout={(e: any) => { servicesYRef.current = e.nativeEvent.layout.y; }}>
        {/* Categorized service sections (Swiggy/Zomato style).
            Render is split into three layers so toggling View All ↔
            Show Less doesn't re-do expensive work:
              1. groupedServices — memoised grouping by category. Only
                 recomputes when the source list (filteredServices or
                 searchResults) actually changes, not on every toggle.
              2. visibleSections — memoised slice. Recomputes only when
                 showAllServices flips or groupedServices changes.
              3. Plain View+map rendering. FlatList was overkill here
                 (scrollEnabled=false, no virtualisation benefit) and
                 added measurable lag on the 156-service expansion. */}
        {renderServicesGrid()}
        </View>

        {/* Why FliponeX — moved to the very bottom of the home scroll,
            right above the WhatsApp button, so it surfaces AFTER the
            user has seen the services listing rather than competing
            for vertical real estate above it. Same 4 hero banners
            (Consumer / Industrial / Fast Track / Referral), same
            auto-rotating carousel — only the position changed. */}
        <View style={{ marginTop: 14, marginBottom: 6 }}>
          <Text style={styles.bannerSectionTitle}>✨ Why FliponeX</Text>
          <AutoCarousel
            items={HERO_BANNERS}
            cardWidth={240}
            intervalMs={3200}
            slideDurationMs={650}
            renderItem={(banner: any) => (
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => {
                  haptics.tap();
                  const t = String(banner?.bannerType || '').toLowerCase();
                  if (t.includes('industrial')) {
                    handleB2BToggle('industrial');
                    scrollToServices();
                  } else if (t.includes('referral')) {
                    handleShareApp();
                  } else {
                    handleB2BToggle('consumer');
                    scrollToServices();
                  }
                }}
                style={[
                  styles.heroBannerCard,
                  { backgroundColor: banner.tint, marginHorizontal: 5 },
                ]}
              >
                <View style={styles.heroBannerLeft}>
                  <View
                    style={[styles.heroBannerBadge, { backgroundColor: banner.badgeBg }]}
                  >
                    <Text
                      style={[styles.heroBannerBadgeText, { color: banner.badgeFg }]}
                    >
                      {String(banner.bannerType || '').toUpperCase()}
                    </Text>
                  </View>
                  <Text
                    style={[styles.heroBannerTitle, { color: banner.fg }]}
                    numberOfLines={3}
                  >
                    {banner.mainText}
                  </Text>
                </View>
                <Text style={styles.heroBannerEmoji}>{banner.emoji}</Text>
              </TouchableOpacity>
            )}
            style={{ paddingHorizontal: 6 }}
          />
        </View>

        {/* WhatsApp FAB moved OUT of the ScrollView (rendered as a
            sibling below) so it's a true floating button overlaid on
            the whole screen. Keeping it inside the ScrollView meant
            we had to reserve a ~96px paddingBottom which left a
            white gap between "Why FliponeX" and the bottom-tab nav. */}
      </ScrollView>

      <WhatsAppButton />

      {/* Alerts modal — bottom sheet showing the user's notification
          inbox (booking status changes, quote replies for industrial
          enquiries, compliance reminders, etc.). Tapping a row marks
          it as seen and routes via deep_link.route when present. */}
      <Modal
        visible={showAlertsModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAlertsModal(false)}
      >
        <View style={styles.alertsModalOverlay}>
          <View style={styles.alertsModalSheet}>
            <View style={styles.alertsModalHeader}>
              <Text style={styles.alertsModalTitle}>🔔 Alerts</Text>
              <TouchableOpacity onPress={() => setShowAlertsModal(false)} hitSlop={8}>
                <Text style={styles.alertsModalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            {inboxLoading && inboxItems.length === 0 ? (
              <ActivityIndicator style={{ marginTop: 30 }} color={COLORS.PRIMARY} />
            ) : inboxItems.length === 0 ? (
              <Text style={styles.alertsEmpty}>
                🎉 You're all caught up — no alerts yet.
              </Text>
            ) : (
              <FlatList
                data={inboxItems}
                keyExtractor={(n: InboxItem) => String(n.id)}
                renderItem={({ item }: { item: InboxItem }) => {
                  const isUnread = !item.seen_at;
                  const stamp = item.created_at
                    ? new Date(item.created_at).toLocaleString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit',
                      })
                    : '';
                  return (
                    <TouchableOpacity
                      style={styles.alertsRow}
                      onPress={() => handleNotificationTap(item)}
                      activeOpacity={0.7}
                    >
                      <View style={isUnread ? styles.alertsRowUnreadDot : styles.alertsRowReadDot} />
                      <View style={styles.alertsRowBody}>
                        <Text style={styles.alertsRowTitle} numberOfLines={2}>
                          {item.title}
                        </Text>
                        {!!item.body && (
                          <Text style={styles.alertsRowSubtitle} numberOfLines={3}>
                            {item.body}
                          </Text>
                        )}
                        {!!stamp && <Text style={styles.alertsRowTimestamp}>{stamp}</Text>}
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
  },
  scrollView: { flex: 1 },
  scrollViewContent: { flexGrow: 1 },

  // ─── Combined sticky brand block (greeting + buttons + search all stick together) ───
  // Sticky header for the scrolled-list view. The user-icon button on
  // the right was unclickable after scrolling on Android because the
  // scroll content beneath had elevation 6+ and the sticky header had
  // matching elevation — Android's touch dispatcher routed the tap
  // through to the underlying scrolled card. Raising the sticky's
  // zIndex + elevation well above any descendant fixes it. Also setting
  // `collapsable: false` on the View (in JSX) prevents Android from
  // flattening it into a touch-aggregating wrapper.
  stickyBrand: {
    backgroundColor: COLORS.PRIMARY,
    paddingTop: 40,
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 20,
    zIndex: 20,
  },
  // Legacy styles kept for any leftover references
  brandHeader: {
    backgroundColor: COLORS.PRIMARY,
    paddingTop: 40,
    paddingHorizontal: 14,
    paddingBottom: 20,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandLogoWrap: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
    marginRight: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 3,
  },
  brandLogo: { width: 38, height: 38, borderRadius: 19 },
  greeting: { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '500' },
  brandName: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: 0.5, marginTop: 2 },
  brandNameAccent: { color: '#FCD34D' },
  brandTagline: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    marginTop: 4,
  },
  brandTaglineText: {
    color: '#0D3B66',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.3,
  },
  iconButton: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
    marginLeft: 8,
    overflow: 'hidden',
  },
  iconButtonText: { fontSize: 18, color: '#fff' },
  // Wrapper that lets the bell badge poke OUTSIDE the round button
  // without disabling overflow:hidden on the button itself (which is
  // needed to clip the profile-pic image into the circle).
  bellWrap: {
    position: 'relative',
    // Extra right margin so the bell and the profile icon have visible
    // breathing room between them (was visually crammed together at
    // the default 8px). Profile icon's own marginLeft of 8 still
    // applies, giving ~16px total gap.
    marginLeft: 8,
    marginRight: 8,
  },
  bellInner: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  headerBellBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#E63946',
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  headerBellBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  iconAvatarImg: {
    width: '100%',
    height: '100%',
  },

  // Search pill that overlaps into the white area below
  searchWrap: { position: 'absolute', left: 16, right: 16, bottom: -22 },
  brandSearchPill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    marginTop: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 6,
  },
  brandSearchIcon: { fontSize: 16, marginRight: 8 },
  brandSearchInput: { flex: 1, fontSize: 14, color: '#212121', padding: 0 },
  brandClearButton: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#0D3B66', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#082B4C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 3,
  },
  brandClearButtonText: {
    fontSize: 20,
    color: '#FFFFFF',
    fontWeight: '900',
    lineHeight: 22,
    textAlign: 'center',
  },

  // Info strip below header
  infoStrip: {
    flexDirection: 'row', backgroundColor: '#fff',
    marginHorizontal: 16, marginTop: 36, marginBottom: 8,
    borderRadius: 12, paddingVertical: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  infoStripItem: { flex: 1, alignItems: 'center' },
  infoStripIcon: { fontSize: 18, marginBottom: 2 },
  infoStripText: { fontSize: 11, color: '#6C757D', fontWeight: '600' },
  infoStripDivider: { width: 1, backgroundColor: '#E9ECEF' },

  // Promo banner (uses logo blue + gold)
  promoBanner: {
    flexDirection: 'row',
    backgroundColor: '#1976D2',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#1976D2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  promoLeft: { flex: 1 },
  promoBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFC107',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: 6,
  },
  promoBadgeText: { color: '#1A1A1A', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  promoTitle: { color: '#fff', fontSize: 17, fontWeight: '800', marginBottom: 4 },
  promoSubtitle: { color: 'rgba(255,255,255,0.85)', fontSize: 12, lineHeight: 16 },
  promoRight: { marginLeft: 12 },
  promoEmoji: { fontSize: 48 },

  // ─── Hero hook banner (compact — all brief text still shown) ───
  // ─── Trust strip ────────────────────────────────────────────────────
  trustStrip: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 12,
    paddingVertical: 10,
    elevation: 2,
    shadowColor: '#082B4C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  trustStripContent: {
    paddingHorizontal: 10,
    gap: 12,
  },
  trustItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: 160,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  trustItemIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustItemIconEmoji: { fontSize: 18 },
  trustItemImg: { width: 22, height: 22 },
  trustItemLabel: { fontSize: 11, fontWeight: '800', color: '#0F172A' },
  trustItemSub: { fontSize: 9, color: '#64748B', marginTop: 1, lineHeight: 12 },

  // ─── Hero card (matches the marketing reference) ────────────────────
  heroCard: {
    backgroundColor: '#0D3B66',
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 16,
    paddingVertical: 18,
    paddingLeft: 16,
    paddingRight: 8,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#082B4C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },
  heroCardRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  heroCardLeft: { flex: 1 },
  heroCardTitle: {
    color: '#FFFFFF',
    // Slightly smaller so the single-line headline
    // "Get Any Common & Industrial Services" fits comfortably on a
    // standard phone width (360-420dp) without needing aggressive
    // font scaling. adjustsFontSizeToFit on the Text element acts
    // as a safety net for very narrow devices.
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 18,
    letterSpacing: 0.1,
  },
  heroCardTitleAccent: {
    color: '#FCD34D',
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 22,
    letterSpacing: 0.2,
    marginTop: 2,
  },
  heroPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#FCD34D',
    backgroundColor: 'rgba(252,211,77,0.08)',
  },
  heroPillTick: {
    color: '#FCD34D',
    fontSize: 10,
    fontWeight: '900',
  },
  heroPillText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  heroTaglineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  heroTaglineLine: {
    width: 18,
    height: 2,
    backgroundColor: '#FCD34D',
    borderRadius: 1,
  },
  heroTaglineText: {
    color: '#FCD34D',
    fontSize: 10,
    fontWeight: '700',
    fontStyle: 'italic',
    letterSpacing: 0.2,
  },
  heroCardCta: {
    backgroundColor: '#FCD34D',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 999,
    alignSelf: 'flex-start',
    marginTop: 12,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
  },
  heroCardCtaText: {
    color: '#0D3B66',
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  heroCardRight: {
    width: 138,
    height: 200,
    alignItems: 'center',
    justifyContent: 'flex-end',
    position: 'relative',
    overflow: 'hidden',
  },
  // Soft glow circle behind the rep — bigger, lighter, more diffuse so
  // it reads as ambient lighting on the figure rather than a hard
  // "framed" disc. The agent should look like they're standing in
  // front of the scene, not pasted onto a square.
  heroRepHalo: {
    position: 'absolute',
    bottom: 0,
    alignSelf: 'center',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(252,211,77,0.16)',
  },
  // Larger figure that overlaps the hero card edges so it doesn't read
  // as a boxed-in sticker. Slight scale-up + lower bottom anchor makes
  // the rep feel "standing in the scene".
  heroRepImage: {
    width: 130,
    height: 200,
    zIndex: 2,
    marginBottom: -8,
  },

  // ─── Background scene around the rep ────────────────────────────────
  // Top-right grid of soft dots — purely decorative, hints at "digital
  // services" without competing with the rep visually.
  heroSceneDots: {
    position: 'absolute',
    top: 4,
    right: 4,
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 30,
    gap: 3,
  },
  heroSceneDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.30)',
  },
  // City skyline silhouettes — lighter navy rectangles peeking from
  // behind the rep to suggest "doorstep at home/office in the city".
  heroSceneSkyline: {
    position: 'absolute',
    bottom: 30,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  skyBldg: {
    width: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  // Door panel sits behind the rep on the right side. A thinner brass
  // handle disc on the right edge of the door reads as a doorknob.
  heroSceneDoorFrame: {
    position: 'absolute',
    top: 6,
    right: -2,
    width: 50,
    height: 150,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 6,
    padding: 3,
  },
  heroSceneDoor: {
    flex: 1,
    backgroundColor: '#082B4C',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 4,
  },
  heroSceneDoorHandle: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FCD34D',
  },
  // (heroScenePlant / heroScenePot / heroScenePlantTop styles
  // removed — the floating leaf clip-art was replaced with a cleaner
  // scene of just door + skyline + dots + halo.)

  // ─── 4-card action row — single horizontal line, 4 equal slots ─────
  // Each card is `flex: 1` inside a row container with small gaps so
  // the layout adapts cleanly to any phone width.
  quadCards: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 8,
  },
  quadCardWrap: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#082B4C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 4,
  },
  quadCard: {
    flex: 1,
    minHeight: 122,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 3,
    shadowColor: '#082B4C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 4,
  },
  quadCardIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quadCardIconText: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', lineHeight: 20 },
  quadCardTitle: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 14,
    textAlign: 'center',
  },
  quadCardTitleGold: {
    color: '#7B4D00',
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 14,
    textAlign: 'center',
  },
  quadCardGiftEmoji: { fontSize: 22 },
  quadCardCtaText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  quadCardCtaTextGold: {
    color: '#5C2E00',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.4,
  },

  heroHook: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 12,
    shadowColor: '#082B4C', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 5, elevation: 2,
    borderLeftWidth: 3, borderLeftColor: '#0D3B66',
  },
  // Two-column wrapper: text on the left flexes to fill space, phone
  // illustration on the right is fixed-width.
  heroHookRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroHookLeft: { flex: 1 },
  heroHookRight: {
    width: 130,
    height: 190,
    alignItems: 'center',
    justifyContent: 'flex-end',
    position: 'relative',
  },
  // ─── FliponeX rep illustration ─────────────────────────────────────
  // Simple, clean fallback used when no real PNG/SVG illustration has
  // been added yet. Layers: halo glow → navy circle background → big
  // person emoji → "FliponeX Rep" gold pill → floor shadow. Each layer
  // is absolutely positioned so the figure anchors to the right column
  // regardless of how the surrounding text reflows.
  repImage: {
    width: 130,
    height: 180,
  },
  repHaloGlow: {
    position: 'absolute',
    top: 4,
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: 'rgba(252,211,77,0.30)',
  },
  repCircle: {
    position: 'absolute',
    top: 14,
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#0D3B66',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FCD34D',
    elevation: 4,
    shadowColor: '#082B4C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  repBigEmoji: {
    fontSize: 64,
    lineHeight: 72,
  },
  repBrandPill: {
    position: 'absolute',
    bottom: 18,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#FCD34D',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  repBrandPillText: {
    color: '#0D3B66',
    fontWeight: '900',
    fontSize: 10,
    letterSpacing: 0.4,
  },
  repFloorShadow: {
    position: 'absolute',
    bottom: 4,
    width: 90,
    height: 6,
    borderRadius: 50,
    backgroundColor: 'rgba(13,59,102,0.18)',
  },
  heroHookBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF7D6',
    paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 5, marginBottom: 6,
  },
  heroHookBadgeText: { fontSize: 9, fontWeight: '800', color: '#C99100', letterSpacing: 0.5 },
  heroHookTitle: { fontSize: 13, fontWeight: '800', color: '#1A1A1A', lineHeight: 17 },
  heroHookSubtitle: { fontSize: 11, color: '#5C6A7A', marginTop: 3, lineHeight: 15 },
  // Trust-factor chips row — sits between subtitle and CTA line
  trustRow: { flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 4 },
  trustChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  trustChipIcon: { fontSize: 12 },
  trustChipLabel: { fontSize: 11, color: '#1A1A1A', fontWeight: '700' },
  heroHookCtaLine: {
    fontSize: 11, fontWeight: '800', color: '#0D3B66',
    marginTop: 8, lineHeight: 15, letterSpacing: 0.1,
  },
  heroHookCtaTagline: {
    fontSize: 10, color: '#6C757D', marginTop: 2, fontStyle: 'italic', lineHeight: 13,
  },
  heroHookButton: {
    marginTop: 9,
    alignSelf: 'flex-start',
    backgroundColor: '#0D3B66',
    paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 8, alignItems: 'center',
    shadowColor: '#082B4C', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 3,
  },
  heroHookButtonText: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },

  // ─── High-priority action row ────────────────────────────────────────
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 12,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 12,
    shadowColor: '#082B4C', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 5, elevation: 4,
  },
  actionBtnPrimary: { backgroundColor: '#E63946' },       // Book New Service — red (urgency)
  actionBtnSecondary: { backgroundColor: '#0D3B66' },     // My Bookings — Prussian blue (trust)
  actionBtnIcon: { fontSize: 22 },
  actionBtnTitle: { color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  actionBtnSubtitle: { color: 'rgba(255,255,255,0.82)', fontSize: 10, marginTop: 1, fontWeight: '600' },

  // ─── Gold Refer & Earn card (rewards highlight) ──────────────────────
  goldCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 12,
    backgroundColor: '#FFF7D6',
    borderWidth: 2, borderColor: '#F5B301',
    borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 14,
    shadowColor: '#C99100', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.22, shadowRadius: 5, elevation: 3,
  },
  goldCardIconWrap: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#F5B301',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  goldCardIcon: { fontSize: 20 },
  goldCardTitle: { fontSize: 14, fontWeight: '800', color: '#7A5200', letterSpacing: 0.2 },
  goldCardSubtitle: { fontSize: 11, color: '#8D6E2F', marginTop: 2, lineHeight: 15 },
  goldCardArrow: { fontSize: 24, color: '#C99100', fontWeight: '800', marginLeft: 6 },

  // Promo-carousel heading
  bannerSectionTitle: {
    fontSize: 13, fontWeight: '800', color: '#1A1A1A',
    marginHorizontal: 12, marginTop: 10, marginBottom: 2,
    letterSpacing: 0.2,
  },

  // ─── Hero promo carousel (compact cards, auto-height so text always fits) ───
  heroCarousel: { paddingHorizontal: 10, paddingVertical: 8, gap: 8 },
  heroBannerCard: {
    flexDirection: 'row',
    // Width comes from the AutoCarousel slot — no fixed width here so the
    // card fills its slot edge-to-edge. No marginRight either: consecutive
    // cards must butt up against each other so the slide reads as one
    // continuous strip.
    flex: 1,
    minHeight: 78,
    backgroundColor: '#0D3B66',
    borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 12,
    alignItems: 'center',
    // Neutral navy shadow — works under every tint in the brand palette.
    shadowColor: '#082B4C', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 4, elevation: 3,
  },
  heroBannerLeft: { flex: 1, paddingRight: 6 },
  // bg & color come from per-banner overrides so the chip matches the tint.
  heroBannerBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4, marginBottom: 4,
  },
  heroBannerBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
  heroBannerTitle: { fontSize: 12, fontWeight: '700', lineHeight: 16 },
  heroBannerEmoji: { fontSize: 32, marginLeft: 4 },

  // "Why FliponeX" section title — give it the same breathing room as the
  // Trending / Offers section titles so the visual rhythm reads cleanly.
  whyTitle: {
    fontSize: 15, fontWeight: '800', color: '#1A1A1A',
    marginHorizontal: 14, marginTop: 22, marginBottom: 10,
  },

  // Quick action strip — full-width 2-up row.
  quickStrip: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  quickChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F0F2F5',
  },
  quickChipIcon: { fontSize: 16, marginRight: 8 },
  quickChipText: { fontSize: 13, fontWeight: '700', color: '#1A1A1A' },
  // Red unread pill anchored to the top-right of the Alerts chip.
  alertsBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#E63946',
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  alertsBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  // ─── Alerts modal ──────────────────────────────────────────────────────
  alertsModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  alertsModalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
    maxHeight: '85%',
  },
  alertsModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F2F5',
    marginBottom: 4,
  },
  alertsModalTitle: { fontSize: 17, fontWeight: '800', color: '#1A1A1A' },
  alertsModalClose: {
    fontSize: 22,
    color: '#64748B',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  alertsEmpty: {
    paddingVertical: 36,
    textAlign: 'center',
    color: '#94A3B8',
    fontSize: 13,
  },
  alertsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  alertsRowUnreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E63946',
    marginTop: 7,
    marginRight: 10,
  },
  alertsRowReadDot: {
    width: 8,
    height: 8,
    marginTop: 7,
    marginRight: 10,
  },
  alertsRowBody: { flex: 1 },
  alertsRowTitle: { fontSize: 14, fontWeight: '700', color: '#1F2937' },
  alertsRowSubtitle: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
    lineHeight: 16,
  },
  alertsRowTimestamp: { fontSize: 10, color: '#94A3B8', marginTop: 4 },

  // Services grid (tighter spacing so more cards visible above the fold)
  servicesSectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1A1A1A',
    marginHorizontal: 14,
    marginTop: 4,
    marginBottom: 6,
  },
  servicesGrid: { paddingHorizontal: 8, paddingBottom: 8 },
  servicesRow: { justifyContent: 'space-between' },

  // Category sections (Swiggy/Zomato style grouped lists)
  catSection: { marginTop: 12, marginBottom: 4 },
  // "View All →" link on each section header — opens ServicesScreen
  // with the matching category preselected.
  catViewAll: {
    color: '#1976D2',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  // Right-aligned "View All Services / Show Less" link — sits below
  // the visible categories, only as wide as the text + chip padding.
  // Tucked to the right edge so it reads as a quiet secondary action
  // (like Gmail/Inbox's "More" link) rather than a full-width primary
  // CTA that would compete with the actual Book Now buttons inside
  // the service cards above.
  globalViewAllBtn: {
    marginTop: 10,
    marginRight: 16,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#E3F2FD',
    alignSelf: 'flex-end',
  },
  globalViewAllBtnText: {
    color: '#1976D2',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  // Each card slot in the vertical 2-column grid. The wrapping View
  // groups the ServiceCard with its dedicated "Book Now" CTA pill below.
  serviceCardWrap: {
    width: '48%',
    marginBottom: 10,
  },
  serviceBookNow: {
    backgroundColor: '#1976D2',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  serviceBookNowText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.4,
  },
  catHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    marginBottom: 6,
  },
  catIcon: { fontSize: 18, marginRight: 8 },
  catTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: '#1A1A1A',
    letterSpacing: 0.2,
  },
  catCount: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6C757D',
    backgroundColor: '#F0F2F5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
  },

  // ─── Old header styles (kept for any legacy refs) ───
  header: {
    backgroundColor: COLORS.WHITE,
    paddingTop: SIZES.BASE * 2,
    paddingBottom: SIZES.BASE * 1.5,
    borderBottomLeftRadius: BORDER_RADIUS.LARGE,
    borderBottomRightRadius: BORDER_RADIUS.LARGE,
    shadowColor: COLORS.CARD_SHADOW,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  oldHeaderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SIZES.BASE,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8, // Move down slightly
  },
  flipOnText: {
    fontSize: SIZES.XXLARGE,
    fontWeight: 'bold',
    color: COLORS.PRIMARY,
    letterSpacing: 1,
  },
  digitalText: {
    fontSize: SIZES.XXLARGE,
    fontWeight: 'bold',
    color: COLORS.BLACK,
    letterSpacing: 1,
  },
  headerButton: {
    backgroundColor: COLORS.LIGHT_GRAY,
    borderRadius: BORDER_RADIUS.ROUND,
    width: SIZES.BASE * 4,
    height: SIZES.BASE * 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: SIZES.BASE / 2,
    shadowColor: COLORS.CARD_SHADOW,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  headerButtonText: {
    fontSize: SIZES.LARGE,
  },
  taglineSection: {
    alignItems: 'center',
    marginBottom: SIZES.BASE,
  },
  searchSection: {
    paddingHorizontal: SIZES.BASE,
    marginBottom: SIZES.BASE,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.WHITE,
    borderRadius: BORDER_RADIUS.MEDIUM,
    paddingHorizontal: SIZES.BASE,
    paddingVertical: SIZES.BASE * 0.75,
    shadowColor: COLORS.CARD_SHADOW,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  searchInput: {
    flex: 1,
    fontSize: SIZES.FONT_MEDIUM,
    color: COLORS.TEXT_PRIMARY,
    paddingVertical: 0,
  },
  clearButton: {
    marginLeft: SIZES.BASE * 0.5,
    padding: SIZES.BASE * 0.25,
    borderRadius: BORDER_RADIUS.SMALL,
    backgroundColor: COLORS.GRAY_LIGHT,
  },
  clearButtonText: {
    fontSize: SIZES.FONT_LARGE,
    color: COLORS.GRAY_DARK,
    fontWeight: 'bold',
  },
  searchEmptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SIZES.BASE * 4,
  },
  searchEmptyTitle: {
    fontSize: SIZES.FONT_LARGE,
    fontWeight: 'bold',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: SIZES.BASE * 0.5,
  },
  searchEmptyMessage: {
    fontSize: SIZES.FONT_MEDIUM,
    color: COLORS.TEXT_SECONDARY,
    textAlign: 'center',
  },
  searchModalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  searchModal: {
    backgroundColor: COLORS.WHITE,
    borderRadius: BORDER_RADIUS.LARGE,
    width: '90%',
    maxHeight: '80%',
    shadowColor: COLORS.CARD_SHADOW,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  searchModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SIZES.BASE,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.GRAY_LIGHT,
  },
  searchModalTitle: {
    fontSize: SIZES.FONT_LARGE,
    fontWeight: 'bold',
    color: COLORS.TEXT_PRIMARY,
  },
  searchModalCloseButton: {
    padding: SIZES.BASE * 0.5,
    borderRadius: BORDER_RADIUS.SMALL,
    backgroundColor: COLORS.GRAY_LIGHT,
  },
  searchModalCloseText: {
    fontSize: SIZES.FONT_LARGE,
    color: COLORS.GRAY_DARK,
    fontWeight: 'bold',
  },
  searchModalContent: {
    maxHeight: 300,
  },
  searchModalLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SIZES.BASE * 2,
  },
  searchModalLoadingText: {
    marginLeft: SIZES.BASE * 0.5,
    fontSize: SIZES.FONT_MEDIUM,
    color: COLORS.TEXT_SECONDARY,
  },
  searchResultsList: {
    maxHeight: 300,
  },
  // ─── Inline search dropdown styles ───
  searchDropdown: {
    backgroundColor: '#fff',
    marginTop: 8,
    borderRadius: 14,
    maxHeight: 320,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  searchDropdownLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9E9E9E',
    letterSpacing: 1,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
    textTransform: 'uppercase',
  },
  searchDropdownList: { maxHeight: 320 },
  searchDropdownEmpty: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  searchDropdownEmptyIcon: { fontSize: 32, marginBottom: 6 },
  searchDropdownEmptyTitle: { fontSize: 13, fontWeight: '700', color: '#1A1A1A', marginBottom: 2 },
  searchDropdownHint: { fontSize: 11, color: '#6C757D', marginTop: 2, textAlign: 'center', padding: 8 },

  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F2F5',
  },
  searchResultIconBox: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: '#E3EEF8',
    justifyContent: 'center', alignItems: 'center',
    marginRight: 10,
  },
  searchResultIcon: { fontSize: 16 },
  searchResultName: { fontSize: 13, fontWeight: '700', color: '#1A1A1A' },
  searchResultCategory: { fontSize: 11, color: '#5C6A7A', marginTop: 1 },
  searchResultPrice: { fontSize: 13, fontWeight: '800', color: '#0D3B66' },
  searchModalEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: SIZES.BASE * 3,
  },
  searchModalEmptyTitle: {
    fontSize: SIZES.FONT_MEDIUM,
    fontWeight: 'bold',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: SIZES.BASE * 0.5,
  },
  searchModalEmptyMessage: {
    fontSize: SIZES.FONT_SMALL,
    color: COLORS.TEXT_SECONDARY,
    textAlign: 'center',
  },
  tagline: {
    fontSize: SIZES.FONT,
    color: COLORS.GRAY,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: SIZES.BASE / 2,
  },
  quickActionButton: {
    backgroundColor: COLORS.PRIMARY,
    borderRadius: BORDER_RADIUS.SMALL,
    paddingHorizontal: SIZES.BASE,
    paddingVertical: SIZES.BASE / 2,
    marginHorizontal: SIZES.BASE / 4,
    shadowColor: COLORS.CARD_SHADOW,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  quickActionText: {
    color: COLORS.WHITE,
    fontSize: SIZES.SMALL,
    fontWeight: '600',
  },
  grandFeaturesSection: {
    backgroundColor: COLORS.WHITE,
    marginHorizontal: SIZES.BASE,
    marginBottom: SIZES.BASE / 2,
    borderRadius: BORDER_RADIUS.MEDIUM,
    padding: SIZES.BASE * 0.75,
    shadowColor: COLORS.CARD_SHADOW,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  featuresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  featureCard: {
    backgroundColor: COLORS.LIGHT_GRAY,
    borderRadius: BORDER_RADIUS.SMALL,
    padding: SIZES.BASE * 0.75,
    marginBottom: SIZES.BASE / 3,
    width: '48%',
    alignItems: 'center',
    shadowColor: COLORS.CARD_SHADOW,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 3,
  },
  featureIcon: {
    fontSize: SIZES.XLARGE,
    marginBottom: SIZES.BASE / 4,
  },
  featureTitle: {
    fontSize: SIZES.SMALL,
    fontWeight: 'bold',
    color: COLORS.BLACK,
    marginBottom: SIZES.BASE / 8,
  },
  featureSubtitle: {
    fontSize: SIZES.SMALL - 2,
    color: COLORS.GRAY,
    textAlign: 'center',
  },
  categoriesContainer: {
    marginTop: SIZES.BASE,
  },
  categoriesRow: {
    flexDirection: 'row',
    paddingHorizontal: SIZES.BASE / 2,
  },
  categoryChip: {
    backgroundColor: COLORS.LIGHT_GRAY,
    borderRadius: BORDER_RADIUS.LARGE,
    paddingHorizontal: SIZES.BASE * 1.2,
    paddingVertical: SIZES.BASE * 0.8,
    marginRight: SIZES.BASE / 2,
    minWidth: 80,
  },
  selectedCategoryChip: {
    backgroundColor: COLORS.PRIMARY,
  },
  categoryChipText: {
    fontSize: SIZES.SMALL,
    color: COLORS.GRAY,
    fontWeight: '600',
  },
  selectedCategoryChipText: {
    color: COLORS.WHITE,
  },
  servicesContainer: {
    padding: SIZES.BASE,
    paddingBottom: SIZES.BASE * 2,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SIZES.BASE * 4,
  },
  emptyStateTitle: {
    fontSize: SIZES.LARGE,
    fontWeight: 'bold',
    color: COLORS.BLACK,
    marginBottom: SIZES.BASE,
  },
  emptyStateSubtitle: {
    fontSize: SIZES.FONT,
    color: COLORS.GRAY,
    textAlign: 'center',
  },
  loadingState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SIZES.BASE * 4,
  },
  loadingText: {
    fontSize: SIZES.FONT,
    color: COLORS.GRAY,
    marginTop: SIZES.BASE,
  },
  debugLogout: {
    position: 'absolute',
    bottom: SIZES.BASE * 10,
    left: SIZES.BASE * 2,
    backgroundColor: COLORS.STATUS_CANCELLED,
    borderRadius: BORDER_RADIUS.SMALL,
    paddingHorizontal: SIZES.BASE,
    paddingVertical: SIZES.BASE / 2,
  },
  debugLogoutText: {
    color: COLORS.WHITE,
    fontSize: SIZES.SMALL,
    fontWeight: 'bold',
  },
  whatsappContainer: {
    position: 'absolute',
    bottom: SIZES.BASE * 2,
    right: SIZES.BASE,
    backgroundColor: 'transparent',
    alignItems: 'center',
    shadowColor: COLORS.CARD_SHADOW,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },

  // ─── Inline search bar — rendered just above the services list ──────────
  inlineSearchWrap: {
    paddingHorizontal: 14,
    marginTop: 14,
    marginBottom: 6,
  },
  inlineSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E3EEF8',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 46,
    shadowColor: '#082B4C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  inlineSearchIcon: {
    fontSize: 16,
    marginRight: 8,
    color: '#0D3B66',
  },
  inlineSearchInput: {
    flex: 1,
    fontSize: 14,
    color: '#1A1A1A',
    paddingVertical: 0,
  },
  inlineSearchClear: {
    fontSize: 18,
    color: '#5C6A7A',
    fontWeight: '700',
    paddingHorizontal: 6,
  },
  // Voice mic chip on the right edge of the search bar. Inactive
  // state = subtle gray pill matching the search bar tone; active
  // state = red pulse so the user has clear feedback that the
  // mic is listening.
  inlineSearchMicBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  inlineSearchMicBtnActive: {
    backgroundColor: '#E63946',
  },
  // PNG mic icon (assets/voice.png). The asset is white-on-transparent,
  // so we tint it with `tintColor` to blend into the gray chip. When
  // listening the chip flips red and we drop the tint so the icon's
  // native white shows through, mirroring Google's voice-search UI.
  inlineSearchMicImg: {
    width: 18,
    height: 18,
    tintColor: '#0D3B66',
  },
  inlineSearchMicImgActive: {
    tintColor: '#FFFFFF',
  },
  // (Voice mic image style removed — the inline button was dropped
  // from the search bar. Use the keyboard's built-in mic key for
  // dictation. The handleVoiceSearch handler stays defined in case
  // we wire a different voice-entry UI later.)

  // ─── Trending Services + Special Offers (horizontal sections) ──────────
  // Bigger top margin to clearly separate each from "Why FliponeX" above and
  // from each other.
  section: {
    marginTop: 22,
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1A1A1A',
    marginHorizontal: 14,
    marginBottom: 10,
    letterSpacing: 0.2,
  },
  hScrollContent: {
    // Match the 14px horizontal anchor used by titles + section content so
    // every block lines up vertically.
    paddingHorizontal: 14,
    paddingBottom: 6,
    gap: 10,
  },
  trendingCard: {
    flex: 1,
    marginHorizontal: 5,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  trendingName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 6,
    minHeight: 34,
  },
  trendingPrice: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0D3B66',
    marginBottom: 8,
  },
  trendingCta: {
    backgroundColor: '#0D3B66',
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  trendingCtaText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  // ─── Fast Track gradient banner (replaces image-based version) ─────
  fastTrackTouch: {
    marginHorizontal: 12,
    marginTop: 16,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 5,
    shadowColor: '#7F1D1D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.30,
    shadowRadius: 10,
  },
  fastTrackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    minHeight: 140,
  },
  fastTrackLeft: { flex: 1, paddingRight: 8 },
  fastTrackBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FCD34D',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  fastTrackBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#7F1D1D',
    letterSpacing: 0.6,
  },
  fastTrackTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 8,
    lineHeight: 24,
  },
  fastTrackSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.92)',
    marginTop: 3,
    lineHeight: 16,
  },
  fastTrackCta: {
    alignSelf: 'flex-start',
    backgroundColor: '#FCD34D',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    marginTop: 10,
    elevation: 2,
  },
  fastTrackCtaText: {
    color: '#7F1D1D',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.3,
  },

  // ─── Stopwatch illustration ─────────────────────────────────────────
  fastTrackStopwatch: {
    width: 100,
    height: 110,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  swCrown: {
    position: 'absolute',
    top: 8,
    width: 16,
    height: 8,
    backgroundColor: '#0F172A',
    borderRadius: 2,
    zIndex: 1,
  },
  swOuter: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#FCD34D',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  swFace: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  swTick: {
    position: 'absolute',
    width: 4,
    height: 8,
    backgroundColor: '#0D3B66',
    borderRadius: 2,
  },
  // Tick marks at 12/3/6/9. Top and bottom were missing `left`, so they
  // defaulted to left:0 and sat at the corner instead of being centred
  // horizontally on the clock face.
  swTickTop: { top: 4, left: 34 },     // 36 − 4/2
  swTickRight: { right: 4, top: 32, transform: [{ rotate: '90deg' }] },
  swTickBottom: { bottom: 4, left: 34 },
  swTickLeft: { left: 4, top: 32, transform: [{ rotate: '90deg' }] },
  swCenter: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0D3B66',
    zIndex: 3,
  },
  // Clock hands. Two-step trick to make rotation pivot at the clock
  // face centre (36,36) on a 72-px face:
  //   1. Position the hand so its bounding-box centre sits on the
  //      clock centre — `top: 36 - height/2`, `left: 36 - width/2`.
  //      Without an explicit `left`, RN's absolute positioning
  //      defaults to left:0 and the hand sat at the FACE's LEFT EDGE.
  //   2. After rotate, push the hand outward by half its length using
  //      `translateY: -height/2`. Because RN applies transforms in
  //      sequence, this happens in the rotated frame, so the BASE of
  //      the hand stays pinned at the clock centre while the tip
  //      points along the rotation angle.
  // Hands are now angled to a "10:10" pose — the universal "clock"
  // pose where the hands form a wide V around the brand text. Reads
  // immediately as a clock and doesn't obscure the centre dot.
  swHand: {
    position: 'absolute',
    backgroundColor: '#0D3B66',
    borderRadius: 2,
    zIndex: 2,
  },
  // Minute hand — long, points to "2" (10:10 minute position = +60°).
  swHandMin: {
    width: 2.5,
    height: 22,
    top: 25,    // 36 − 22/2
    left: 34.75, // 36 − 2.5/2
    transform: [{ rotate: '60deg' }, { translateY: -11 }],
  },
  // Hour hand — short, points to "10" (10:10 hour position = −60°).
  // Reusing the swHandSec class name from before to avoid touching
  // the JSX (this is the second of the two <View> hands rendered).
  swHandSec: {
    width: 3,
    height: 14,
    top: 29,    // 36 − 14/2
    left: 34.5, // 36 − 3/2
    transform: [{ rotate: '-60deg' }, { translateY: -7 }],
  },
  swZap: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    fontSize: 22,
  },

  offerCard: {
    width: 220,
    borderRadius: 12,
    padding: 14,
    marginRight: 10,
    minHeight: 100,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 5,
    elevation: 4,
  },
  offerTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
    letterSpacing: 0.2,
  },
  offerDescription: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 12,
    lineHeight: 16,
  },
} as any);

export default HomeScreen;

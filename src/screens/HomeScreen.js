import React, { useState, useEffect, useCallback, useRef } from 'react';
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
} from 'react-native';
import { COLORS, SIZES, BORDER_RADIUS } from '../constants/colors';
import { STRINGS, VALUE_PROPS, HERO_BANNERS } from '../constants/strings';
import { getServices } from '../services/api';
import { getUser, clearAuthSession } from '../utils/storage';
import B2BToggle from '../components/B2BToggle';
import ServiceCard from '../components/ServiceCard';
import WhatsAppButton from '../components/WhatsAppButton';
import EngagingContentSection from '../components/EngagingContentSection';

const HomeScreen = ({ navigation }) => {
  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(STRINGS.ALL_CATEGORIES);
  const [serviceType, setServiceType] = useState('consumer');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [user, setUser] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchInputFocused, setSearchInputFocused] = useState(false);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [searchTimeoutId, setSearchTimeoutId] = useState(null);
  const searchInputRef = useRef(null);
  // Refs for the "Book Now, Pay Later" CTA — scroll the outer ScrollView down
  // to the services list so the user lands right on the bookable items.
  const scrollRef = useRef(null);
  const servicesYRef = useRef(0);

  const scrollToServices = useCallback(() => {
    // Fallback: if layout hasn't measured yet, scroll to a reasonable offset.
    const y = servicesYRef.current || 600;
    scrollRef.current?.scrollTo({ y, animated: true });
  }, []);

  // "Why FliponeX?" — 4 core value propositions shown as horizontal cards.
  // Pulled from the marketing brief so the app echoes the same promise as the website.
  const engagingContent = VALUE_PROPS;

  useEffect(() => {
    loadServices();
    loadUserData();
  }, [serviceType]);

  // Cleanup timeout on component unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutId) {
        clearTimeout(searchTimeoutId);
      }
    };
  }, [searchTimeoutId]);

  // Search functionality with debouncing - ref-based to prevent keyboard dismissal
  // ─── Debounced search ───
  // Typing feels instant; actual filter runs once the user pauses for 500ms.
  // No API calls are made per keystroke — we filter the already-loaded `services`
  // array locally, so results are O(n) over the in-memory list.
  const handleSearchInputChange = useCallback((query) => {
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
      const filtered = services.filter(svc =>
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

  
  const handleModalServicePress = useCallback((service) => {
    setShowSearchModal(false);
    handleServicePress(service);
  }, [handleServicePress]);

  const loadUserData = async () => {
    try {
      const userData = await getUser();
      setUser(userData);
    } catch (error) {
      console.error('Error loading user data:', error);
    }
  };

  const loadServices = async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('=== LOADING SERVICES ===');
      
      // Add retry mechanism for service loading
      let response;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          response = await getServices(serviceType);
          console.log('Services received:', response);
          break; // Success, exit retry loop
        } catch (error) {
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
      const aadhaarServices = response.data.filter(s => 
        s.name && s.name.toLowerCase().includes('aadhaar')
      );
      const panServices = response.data.filter(s => 
        s.name && s.name.toLowerCase().includes('pan')
      );
      const voterIdServices = response.data.filter(s => 
        s.name && (s.name.toLowerCase().includes('voter') || s.name.toLowerCase().includes('voter id'))
      );
      const rationCardServices = response.data.filter(s => 
        s.name && (s.name.toLowerCase().includes('ration') || s.name.toLowerCase().includes('ration card'))
      );
      const drivingLicenseServices = response.data.filter(s => 
        s.name && (s.name.toLowerCase().includes('driving') || s.name.toLowerCase().includes('license') || s.name.toLowerCase().includes('driving license'))
      );
      
      console.log('Aadhaar services found in raw data:', aadhaarServices.length);
      console.log('Aadhaar service names:', aadhaarServices.map(s => s.name));
      console.log('PAN services found in raw data:', panServices.length);
      console.log('PAN service names:', panServices.map(s => s.name));
      console.log('Voter ID services found in raw data:', voterIdServices.length);
      console.log('Voter ID service names:', voterIdServices.map(s => s.name));
      console.log('Ration Card services found in raw data:', rationCardServices.length);
      console.log('Ration Card service names:', rationCardServices.map(s => s.name));
      console.log('Driving License services found in raw data:', drivingLicenseServices.length);
      console.log('Driving License service names:', drivingLicenseServices.map(s => s.name));
      
      const totalKnownServices = aadhaarServices.length + panServices.length + voterIdServices.length + rationCardServices.length + drivingLicenseServices.length;
      console.log('Total known services:', totalKnownServices);
      console.log('Total services from API:', response.data.length);
      console.log('===================================');
      
      // Extract unique categories
      const uniqueCategories = [
        STRINGS.ALL_CATEGORIES,
        ...new Set(response.data.map(service => service.category).filter(Boolean))
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadServices();
    setRefreshing(false);
  }, [serviceType]);

  const handleB2BToggle = (type) => {
    setServiceType(type);
    setSelectedCategory(STRINGS.ALL_CATEGORIES);
  };

  const handleServicePress = (service) => {
    navigation.navigate('ServiceDetails', { serviceId: service.id });
    clearSearch();
  };

  const handleCategoryPress = (category) => {
    setSelectedCategory(category);
  };

  const handleShareApp = async () => {
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

  const handleQuickAction = (action) => {
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

  const handleLogout = async () => {
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
              // Clears token + user + persisted nav state so the next cold
              // start lands on Login instead of restoring Home.
              await clearAuthSession();
              navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
            } catch (error) {
              console.error('Error during logout:', error);
              Alert.alert('Error', 'Failed to logout');
            }
          },
        },
      ]
    );
  };

  const filteredServices = selectedCategory === STRINGS.ALL_CATEGORIES 
    ? services 
    : services.filter(service => service.category === selectedCategory);

  // Debug filtering
  console.log('=== SERVICE FILTERING DEBUG ===');
  console.log('Selected category:', selectedCategory);
  console.log('Total services before filtering:', services.length);
  console.log('Services after filtering:', filteredServices.length);
  console.log('Filtered service names:', filteredServices.map(s => s.name));
  
  const aadhaarInFiltered = filteredServices.filter(s => 
    s.name && s.name.toLowerCase().includes('aadhaar')
  );
  const panInFiltered = filteredServices.filter(s => 
    s.name && s.name.toLowerCase().includes('pan')
  );
  const voterIdInFiltered = filteredServices.filter(s => 
    s.name && (s.name.toLowerCase().includes('voter') || s.name.toLowerCase().includes('voter id'))
  );
  const rationCardInFiltered = filteredServices.filter(s => 
    s.name && (s.name.toLowerCase().includes('ration') || s.name.toLowerCase().includes('ration card'))
  );
  const drivingLicenseInFiltered = filteredServices.filter(s => 
    s.name && (s.name.toLowerCase().includes('driving') || s.name.toLowerCase().includes('license') || s.name.toLowerCase().includes('driving license'))
  );
  
  console.log('=== FILTERING CATEGORY BREAKDOWN ===');
  console.log('Aadhaar services in filtered list:', aadhaarInFiltered.length);
  console.log('Aadhaar names in filtered:', aadhaarInFiltered.map(s => s.name));
  console.log('PAN services in filtered list:', panInFiltered.length);
  console.log('PAN names in filtered:', panInFiltered.map(s => s.name));
  console.log('Voter ID services in filtered list:', voterIdInFiltered.length);
  console.log('Voter ID names in filtered:', voterIdInFiltered.map(s => s.name));
  console.log('Ration Card services in filtered list:', rationCardInFiltered.length);
  console.log('Ration Card names in filtered:', rationCardInFiltered.map(s => s.name));
  console.log('Driving License services in filtered list:', drivingLicenseInFiltered.length);
  console.log('Driving License names in filtered:', drivingLicenseInFiltered.map(s => s.name));
  
  const totalKnownInFiltered = aadhaarInFiltered.length + panInFiltered.length + voterIdInFiltered.length + rationCardInFiltered.length + drivingLicenseInFiltered.length;
  console.log('Total known services in filtered:', totalKnownInFiltered);
  console.log('Total services in filtered:', filteredServices.length);
  console.log('================================');
  console.log('=============================');

  const renderServiceCard = ({ item, index }) => (
    <ServiceCard service={item} onPress={handleServicePress} index={index} />
  );

  const renderCategoryChip = (category) => (
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
    <View style={styles.stickyBrand}>
      <View style={styles.headerTop}>
        {/* App logo — small circular image to reinforce branding */}
        <View style={styles.brandLogoWrap}>
          <Image source={require('../assets/logo.jpeg')} style={styles.brandLogo} resizeMode="contain" />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>Hello {(user?.name || 'there').split(' ')[0]} 👋</Text>
          <Text style={styles.brandName}>FliponeX Digital</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconButton} onPress={() => navigation.navigate('Profile')}>
            <Text style={styles.iconButtonText}>👤</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton} onPress={handleLogout}>
            <Text style={styles.iconButtonText}>🚪</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.brandSearchPill}>
        <Text style={styles.brandSearchIcon}>🔍</Text>
        <TextInput
          ref={searchInputRef}
          style={styles.brandSearchInput}
          placeholder="Search for any service..."
          value={searchQuery}
          onChangeText={handleSearchInputChange}
          placeholderTextColor="#9E9E9E"
          returnKeyType="search"
          enablesReturnKeyAutomatically={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity style={styles.brandClearButton} onPress={clearSearch}>
            <Text style={styles.brandClearButtonText}>×</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Inline dropdown — appears right under the search bar */}
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
              <Text style={styles.searchDropdownEmptyTitle}>No matches for "{searchQuery}"</Text>
              <Text style={styles.searchDropdownHint}>Try a different keyword</Text>
            </View>
          ) : (
            <ScrollView style={styles.searchDropdownList} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              <Text style={styles.searchDropdownLabel}>{searchResults.length} result{searchResults.length > 1 ? 's' : ''}</Text>
              {searchResults.slice(0, 8).map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.searchResultItem}
                  onPress={() => {
                    clearSearch();
                    handleServicePress(item);
                  }}
                >
                  <View style={styles.searchResultIconBox}>
                    <Text style={styles.searchResultIcon}>📄</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.searchResultName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.searchResultCategory} numberOfLines={1}>{item.category || 'Service'}</Text>
                  </View>
                  <Text style={styles.searchResultPrice}>₹{item.total_expense || item.user_cost || '0'}</Text>
                </TouchableOpacity>
              ))}
              {searchResults.length > 8 && (
                <Text style={styles.searchDropdownHint}>+ {searchResults.length - 8} more · scroll above to see all</Text>
              )}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );

  const renderRestOfHeader = () => (
    <View>
      {/* ─── Hero hook banner — verbatim copy from marketing brief ───
          Headline, sub-headline, trust-factor CTA line, and tappable CTA button
          that scrolls the page down to the services list so the user lands on
          the normal Service → Booking flow. */}
      <View style={styles.heroHook}>
        <View style={styles.heroHookBadge}>
          <Text style={styles.heroHookBadgeText}>#1 DOORSTEP DIGITAL SERVICE</Text>
        </View>
        <Text style={styles.heroHookTitle}>{STRINGS.HERO_HEADLINE}</Text>
        <Text style={styles.heroHookSubtitle}>{STRINGS.HERO_SUBHEADLINE}</Text>

        <Text style={styles.heroHookCtaLine}>{STRINGS.HERO_CTA_LINE}</Text>
        <Text style={styles.heroHookCtaTagline}>{STRINGS.HERO_CTA_TAGLINE}</Text>

        <TouchableOpacity
          style={styles.heroHookButton}
          activeOpacity={0.85}
          onPress={scrollToServices}
        >
          <Text style={styles.heroHookButtonText}>{STRINGS.HERO_CTA_BUTTON} →</Text>
        </TouchableOpacity>
      </View>

      {/* ─── High-priority action row: Book New Service (red) + My Bookings (blue) ─── */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnPrimary]}
          onPress={scrollToServices}
          activeOpacity={0.85}
        >
          <Text style={styles.actionBtnIcon}>➕</Text>
          <View>
            <Text style={styles.actionBtnTitle}>Book New Service</Text>
            <Text style={styles.actionBtnSubtitle}>Start a fresh request</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnSecondary]}
          onPress={() => navigation.navigate('MyBookings')}
          activeOpacity={0.85}
        >
          <Text style={styles.actionBtnIcon}>📋</Text>
          <View>
            <Text style={styles.actionBtnTitle}>My Bookings</Text>
            <Text style={styles.actionBtnSubtitle}>Track & manage</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* ─── Gold Refer & Earn card (earnings/rewards highlight) ─── */}
      <TouchableOpacity
        style={styles.goldCard}
        activeOpacity={0.9}
        onPress={handleShareApp}
      >
        <View style={styles.goldCardIconWrap}>
          <Text style={styles.goldCardIcon}>🎁</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.goldCardTitle}>Refer & Earn ₹20</Text>
          <Text style={styles.goldCardSubtitle}>
            Share FliponeX with friends — earn rewards on every successful signup.
          </Text>
        </View>
        <Text style={styles.goldCardArrow}>›</Text>
      </TouchableOpacity>

      {/* ─── Promo carousel — compact cards, type + message + emoji visual ─── */}
      <Text style={styles.bannerSectionTitle}>FliponeX at a Glance</Text>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.heroCarousel}
      >
        {HERO_BANNERS.map((b, i) => (
          <View key={i} style={[styles.heroBannerCard, { backgroundColor: b.tint }]}>
            <View style={styles.heroBannerLeft}>
              <View style={[styles.heroBannerBadge, { backgroundColor: b.badgeBg }]}>
                <Text style={[styles.heroBannerBadgeText, { color: b.badgeFg }]}>{b.bannerType}</Text>
              </View>
              <Text style={[styles.heroBannerTitle, { color: b.fg }]}>{b.mainText}</Text>
            </View>
            <Text style={styles.heroBannerEmoji}>{b.emoji}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Compact horizontal-scroll quick actions */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quickStrip}
      >
        <TouchableOpacity style={styles.quickChip} onPress={() => navigation.navigate('MyBookings')}>
          <Text style={styles.quickChipIcon}>📋</Text>
          <Text style={styles.quickChipText}>My Orders</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickChip} onPress={() => handleQuickAction('documents')}>
          <Text style={styles.quickChipIcon}>📄</Text>
          <Text style={styles.quickChipText}>Documents</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickChip} onPress={() => handleQuickAction('rewards')}>
          <Text style={styles.quickChipIcon}>🏆</Text>
          <Text style={styles.quickChipText}>Rewards</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickChip} onPress={() => handleQuickAction('notifications')}>
          <Text style={styles.quickChipIcon}>🔔</Text>
          <Text style={styles.quickChipText}>Alerts</Text>
        </TouchableOpacity>
      </ScrollView>

      <B2BToggle onToggle={handleB2BToggle} currentMode={serviceType} />

      {/* Section heading for the 4 value propositions below */}
      <Text style={styles.whyTitle}>Why FliponeX?</Text>
      <EngagingContentSection content={engagingContent} />

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
    <View style={styles.container}>
      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollViewContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[0]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[COLORS.PRIMARY]}
          />
        }
      >
        {renderStickyBrand()}
        {renderRestOfHeader()}

        {/* onLayout captures Y offset so the hook's "Book Now, Pay Later"
            button can scroll the user straight to the services grid. */}
        <View onLayout={(e) => { servicesYRef.current = e.nativeEvent.layout.y; }}>
        {/* Categorized service sections (Swiggy/Zomato style) */}
        {(() => {
          const list = isSearching ? searchResults : filteredServices;
          if (!list || list.length === 0) {
            return isSearching ? renderSearchEmptyState() : renderEmptyState();
          }

          // Group services by category — fallback to "Other Services" if missing
          const groups = list.reduce((acc, svc) => {
            const cat = (svc.category && svc.category.trim()) || 'Other Services';
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(svc);
            return acc;
          }, {});

          // Map of category icon emojis (visual cue per group)
          const catIcon = (name) => {
            const n = name.toLowerCase();
            if (n.includes('aadhaar')) return '🆔';
            if (n.includes('pan')) return '💳';
            if (n.includes('voter')) return '🗳️';
            if (n.includes('ration')) return '🍱';
            if (n.includes('driving') || n.includes('license')) return '🚗';
            if (n.includes('passport')) return '🛂';
            if (n.includes('income')) return '💼';
            if (n.includes('birth')) return '👶';
            if (n.includes('marriage')) return '💍';
            return '📄';
          };

          return Object.entries(groups).map(([category, items]) => (
            <View key={category} style={styles.catSection}>
              <View style={styles.catHeader}>
                <Text style={styles.catIcon}>{catIcon(category)}</Text>
                <Text style={styles.catTitle}>{category}</Text>
                <Text style={styles.catCount}>{items.length}</Text>
              </View>
              <FlatList
                data={items}
                renderItem={renderServiceCard}
                keyExtractor={(item) => item.id.toString()}
                numColumns={2}
                contentContainerStyle={styles.servicesGrid}
                columnWrapperStyle={styles.servicesRow}
                scrollEnabled={false}
              />
            </View>
          ));
        })()}
        </View>

        {/* Enhanced WhatsApp Button */}
        <View style={styles.whatsappContainer}>
          <WhatsAppButton />
        </View>
      </ScrollView>
    </View>
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
    elevation: 6,
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
  iconButton: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
    marginLeft: 8,
  },
  iconButtonText: { fontSize: 18 },

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
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#E0E0E0', justifyContent: 'center', alignItems: 'center',
  },
  brandClearButtonText: { fontSize: 14, color: '#616161', fontWeight: '700' },

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
  heroHook: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 12,
    shadowColor: '#082B4C', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 5, elevation: 2,
    borderLeftWidth: 3, borderLeftColor: '#0D3B66',
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
    width: 260,
    minHeight: 78,
    backgroundColor: '#0D3B66',
    borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 12,
    marginRight: 8,
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

  // "Why FliponeX" section title
  whyTitle: {
    fontSize: 15, fontWeight: '800', color: '#1A1A1A',
    marginHorizontal: 14, marginTop: 10, marginBottom: 4,
  },

  // Compact horizontal quick action strip
  quickStrip: { paddingHorizontal: 12, paddingVertical: 12, gap: 8 },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F0F2F5',
    marginRight: 8,
  },
  quickChipIcon: { fontSize: 14, marginRight: 6 },
  quickChipText: { fontSize: 12, fontWeight: '700', color: '#1A1A1A' },

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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
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
});

export default HomeScreen;

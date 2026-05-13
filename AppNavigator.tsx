import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import type { RootStackParamList, HomeTabParamList, AgentTabParamList } from './src/types';

// Reusable Home button rendered in the stack header's headerRight.
// Lets users on a deep-pushed screen (Booking, ServiceDetails,
// Compliance, etc.) jump back to the tab navigator in one tap
// without having to back out step by step. Hardware back / swipe
// back continue to walk the stack in reverse — this is just a
// shortcut for "I'm done, take me home".
//
// `target` is either 'HomeTabs' (customer surface) or 'AgentTabs'
// (rep surface). We use navigate() rather than reset() so the back
// stack is preserved — if the user taps Home then changes their
// mind, the system back button still walks them back to where they
// were. They're not trapped on the home screen.
const HomeHeaderButton: React.FC<{
  navigation: any;
  target: 'HomeTabs' | 'AgentTabs';
}> = ({ navigation, target }) => (
  <TouchableOpacity
    onPress={() => navigation.navigate(target)}
    style={{ paddingHorizontal: 14, paddingVertical: 6 }}
    accessibilityLabel="Go to Home"
    accessibilityRole="button"
  >
    <Icon name="home" size={24} color="#FFFFFF" />
  </TouchableOpacity>
);

// ─── Customer screens ───────────────────────────────────────────────────
import SplashScreen from './src/screens/SplashScreen';
import LanguageSelectScreen from './src/screens/LanguageSelectScreen';
import ModeSelectScreen from './src/screens/ModeSelectScreen';
import HomeScreen from './src/screens/HomeScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import ServicesScreen from './src/screens/ServicesScreen';
import ServiceDetailsScreen from './src/screens/ServiceDetailsScreen';
import BookingScreen from './src/screens/BookingScreen';
import MyBookingsScreen from './src/screens/MyBookingsScreen';
import BookingDetailsScreen from './src/screens/BookingDetailsScreen';
import TrackingScreen from './src/screens/TrackingScreen';
import DocumentsScreen from './src/screens/DocumentsScreen';
import CompanyProfileScreen from './src/screens/CompanyProfileScreen';
import NDAScreen from './src/screens/NDAScreen';
import EnquiryScreen from './src/screens/EnquiryScreen';
import EnquiryDetailsScreen from './src/screens/EnquiryDetailsScreen';
import WebViewScreen from './src/screens/WebViewScreen';
import WalletScreen from './src/screens/WalletScreen';
import ComplianceScreen from './src/screens/ComplianceScreen';
import LoginScreen from './src/screens/LoginScreen';
import AgentLoginScreen from './src/screens/agent/LoginScreen';

// ─── Agent screens (merged from Agentapp) ───────────────────────────────
import AgentDashboardScreen from './src/screens/agent/DashboardScreen';
import AgentTaskListScreen from './src/screens/agent/TaskListScreen';
import AgentEarningsScreen from './src/screens/agent/EarningsScreen';
import AgentReferralScreen from './src/screens/agent/ReferralScreen';
import AgentProfileScreen from './src/screens/agent/ProfileScreen';
import AgentTaskExecutionScreen from './src/screens/agent/TaskExecutionScreen';
import AgentTeamTreeIncomeScreen from './src/screens/agent/TeamTreeIncomeScreen';

const Stack = createStackNavigator<RootStackParamList>();
const HomeTab = createBottomTabNavigator<HomeTabParamList>();
const AgentTab = createBottomTabNavigator<AgentTabParamList>();

// ─── Customer bottom tabs ───────────────────────────────────────────────
//
// Light-themed bar matching the reference mock: white background, blue
// active icon + label, subtle slate inactive state. MaterialIcons gives
// clean SVG-style glyphs (no emoji rendering quirks across devices).
const HomeTabs = () => {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 8);

  // Map each route to the MaterialIcons glyph that best matches the
  // reference design. `apps` is a 2x2 grid that perfectly mirrors the
  // 4-dot Services pictogram in the screenshot.
  const iconForTab = (
    routeName: string,
    focused: boolean,
  ): { name: string } => {
    switch (routeName) {
      case 'Home':
        return { name: focused ? 'home' : 'home' };
      case 'MyBookings':
        return { name: focused ? 'assignment' : 'assignment' };
      case 'Services':
        return { name: focused ? 'apps' : 'apps' };
      case 'Profile':
        return { name: focused ? 'person' : 'person-outline' };
      default:
        return { name: 'circle' };
    }
  };

  return (
    <HomeTab.Navigator
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: '#0D3B66',
        tabBarInactiveTintColor: '#94A3B8',
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: '#E5E7EB',
          height: 60 + bottomInset,
          paddingBottom: bottomInset,
          paddingTop: 8,
          shadowColor: '#082B4C',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.06,
          shadowRadius: 6,
          elevation: 8,
        },
        // marginTop on the label pushes the Home/Bookings/Services/
        // Profile text down below the active-tab underline so the two
        // never visually merge. Previously the underline sat at
        // `bottom: -8` and the label rendered right on top of it.
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2, marginTop: 6 },
        tabBarIcon: ({ focused, color, size }) => {
          const { name } = iconForTab(route.name, focused);
          return (
            // Reserve 6px of bottom padding so the underline (positioned
            // `bottom: -2`) sits inside this container, NOT on top of
            // the label that the navigator renders below this View.
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 6 }}>
              <Icon name={name} size={size + (focused ? 2 : 0)} color={color} />
              {focused && (
                // Underline accent on the active tab — sits in the
                // reserved padding zone so the label below has a clear
                // gap from the indicator.
                <View
                  style={{
                    width: 18,
                    height: 3,
                    borderRadius: 2,
                    backgroundColor: '#0D3B66',
                    position: 'absolute',
                    bottom: -2,
                  }}
                />
              )}
            </View>
          );
        },
      })}
    >
      <HomeTab.Screen name="Home" component={HomeScreen} options={{ title: 'Home' }} />
      <HomeTab.Screen name="MyBookings" component={MyBookingsScreen} options={{ title: 'Bookings' }} />
      <HomeTab.Screen name="Services" component={ServicesScreen} options={{ title: 'Services' }} />
      <HomeTab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
    </HomeTab.Navigator>
  );
};

// ─── Agent bottom tabs — styled per the original Agentapp design ────────
interface AgentTabIconProps {
  name: string;
  color: string;
  focused: boolean;
}

const AgentTabIcon = ({ name, color, focused }: AgentTabIconProps) => (
  <View style={[agentStyles.iconWrap, focused && agentStyles.iconWrapFocused]}>
    <Icon name={name} size={focused ? 24 : 22} color={color} />
  </View>
);

const AgentTabs = () => {
  // Honour the system gesture-bar inset (Android edge-to-edge mode +
  // iPhone home indicator). Without this, the tab bar's hardcoded
  // height: 70 / paddingBottom: 10 left the labels — most visibly
  // "Earnings" — clipped behind the gesture pill at the bottom of the
  // screen. Same pattern as the customer-side HomeTabs above.
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 10);
  return (
    <AgentTab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color }) => {
          let iconName = 'dashboard';
          if (route.name === 'Dashboard') iconName = 'dashboard';
          else if (route.name === 'Tasks') iconName = 'work-outline';
          else if (route.name === 'Earnings') iconName = 'payments';
          else if (route.name === 'Referral') iconName = 'card-giftcard';
          else if (route.name === 'Profile') iconName = 'person-outline';
          return <AgentTabIcon name={iconName} color={color} focused={focused} />;
        },
        lazy: true,
        freezeOnBlur: true,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: '#FCD34D',
        tabBarInactiveTintColor: 'rgba(255,255,255,0.6)',
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3, marginTop: 2 },
        tabBarStyle: {
          backgroundColor: '#003153',
          borderTopWidth: 0,
          height: 70 + bottomInset,
          paddingTop: 8,
          paddingBottom: bottomInset,
          paddingHorizontal: 8,
          shadowColor: '#001F3F',
          shadowOffset: { width: 0, height: -8 },
          shadowOpacity: 0.35,
          shadowRadius: 18,
          elevation: 22,
        },
        tabBarItemStyle: { paddingTop: 2 },
        headerShown: false,
      })}
    >
      <AgentTab.Screen name="Dashboard" component={AgentDashboardScreen} />
      <AgentTab.Screen name="Tasks" component={AgentTaskListScreen} />
      <AgentTab.Screen name="Earnings" component={AgentEarningsScreen} />
      <AgentTab.Screen name="Referral" component={AgentReferralScreen} />
      <AgentTab.Screen name="Profile" component={AgentProfileScreen} />
    </AgentTab.Navigator>
  );
};

// ─── Root stack ─────────────────────────────────────────────────────────
// Splash is always first; it decides where to route next based on the
// stored mode via AsyncStorage (see SplashScreen's effect logic — if a
// mode is already set, it replace()s into that tab. Otherwise it sends
// the user to ModeSelect).
const AppNavigator = () => {
  const stackHeader = {
    headerShown: true,
    headerStyle: { backgroundColor: '#0D3B66' },
    headerTintColor: '#FFFFFF',
    headerTitleStyle: { fontWeight: '700' as const },
  };
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Splash">
      <Stack.Screen name="Splash" component={SplashScreen} />
      <Stack.Screen name="LanguageSelect" component={LanguageSelectScreen} />
      <Stack.Screen name="ModeSelect" component={ModeSelectScreen} />

      {/* Customer surface */}
      <Stack.Screen name="HomeTabs" component={HomeTabs} />
      <Stack.Screen
        name="ServiceDetails"
        component={ServiceDetailsScreen}
        options={({ navigation }) => ({
          ...stackHeader,
          title: 'Service Details',
          headerRight: () => <HomeHeaderButton navigation={navigation} target="HomeTabs" />,
        })}
      />
      <Stack.Screen
        name="Booking"
        component={BookingScreen}
        options={({ navigation }) => ({
          ...stackHeader,
          title: 'Book Service',
          headerRight: () => <HomeHeaderButton navigation={navigation} target="HomeTabs" />,
        })}
      />
      {/* BookingDetailsScreen renders its own header with a back button —
          hiding the RN stack header here avoids two stacked headers. */}
      <Stack.Screen name="BookingDetails" component={BookingDetailsScreen} options={{ headerShown: false }} />
      {/* TrackingScreen renders its own header with back arrow — hiding
          the RN stack header avoids two visually competing headers. */}
      <Stack.Screen name="Tracking" component={TrackingScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="Documents"
        component={DocumentsScreen}
        options={({ navigation }) => ({
          ...stackHeader,
          title: 'My Documents',
          headerRight: () => <HomeHeaderButton navigation={navigation} target="HomeTabs" />,
        })}
      />
      <Stack.Screen
        name="CompanyProfile"
        component={CompanyProfileScreen}
        options={({ navigation }) => ({
          ...stackHeader,
          title: 'Company Profile',
          headerRight: () => <HomeHeaderButton navigation={navigation} target="HomeTabs" />,
        })}
      />
      <Stack.Screen
        name="NDA"
        component={NDAScreen}
        options={({ navigation }) => ({
          ...stackHeader,
          title: 'Digital NDA',
          headerRight: () => <HomeHeaderButton navigation={navigation} target="HomeTabs" />,
        })}
      />
      <Stack.Screen
        name="Enquiry"
        component={EnquiryScreen}
        options={({ navigation }) => ({
          ...stackHeader,
          title: 'Request Quote',
          headerRight: () => <HomeHeaderButton navigation={navigation} target="HomeTabs" />,
        })}
      />
      <Stack.Screen
        name="EnquiryDetails"
        component={EnquiryDetailsScreen}
        options={({ navigation }) => ({
          ...stackHeader,
          title: 'Enquiry Details',
          headerRight: () => <HomeHeaderButton navigation={navigation} target="HomeTabs" />,
        })}
      />
      <Stack.Screen name="Wallet" component={WalletScreen} options={{ headerShown: false }} />
      {/* ComplianceScreen renders its own header — hide RN stack header to avoid stacking. */}
      <Stack.Screen name="Compliance" component={ComplianceScreen} options={{ headerShown: false }} />

      {/* Agent surface */}
      <Stack.Screen name="AgentTabs" component={AgentTabs} />
      <Stack.Screen name="TaskExecution" component={AgentTaskExecutionScreen} />
      <Stack.Screen name="TeamTreeIncome" component={AgentTeamTreeIncomeScreen} options={{ headerShown: false }} />

      {/* Embedded web surfaces (reached from ModeSelect) — renders a WebView
          inside the same APK so testers see everything in one install.
          The Home button is set up inside WebViewScreen itself so it can
          access the WebView ref and reset the embedded URL to root,
          rather than navigating out to the customer app's HomeTabs. */}
      <Stack.Screen
        name="WebView"
        component={WebViewScreen}
        options={({ route }) => ({
          ...stackHeader,
          title: route.params?.title || 'Web',
        })}
      />

      {/* Authentication entry points — splash routes here when no token
          is stored for the chosen mode. The two screens are visually
          distinct so testers can't confuse a customer login with a
          rep login. */}
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="AgentLogin" component={AgentLoginScreen} />
    </Stack.Navigator>
  );
};

const agentStyles = StyleSheet.create({
  iconWrap: {
    width: 42,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  iconWrapFocused: {
    backgroundColor: 'rgba(252,211,77,0.18)',
    shadowColor: '#FCD34D',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    elevation: 3,
  },
});

export default AppNavigator;

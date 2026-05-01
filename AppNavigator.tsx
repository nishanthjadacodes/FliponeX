import { View, StyleSheet, Text } from 'react-native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import type { RootStackParamList, HomeTabParamList, AgentTabParamList } from './src/types';

// ─── Customer screens ───────────────────────────────────────────────────
import SplashScreen from './src/screens/SplashScreen';
import LanguageSelectScreen from './src/screens/LanguageSelectScreen';
import ModeSelectScreen from './src/screens/ModeSelectScreen';
import HomeScreen from './src/screens/HomeScreen';
import ProfileScreen from './src/screens/ProfileScreen';
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

const Stack = createStackNavigator<RootStackParamList>();
const HomeTab = createBottomTabNavigator<HomeTabParamList>();
const AgentTab = createBottomTabNavigator<AgentTabParamList>();

// ─── Customer bottom tabs ───────────────────────────────────────────────
const HomeTabs = () => {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 8);

  return (
    <HomeTab.Navigator
      screenOptions={{
        tabBarActiveTintColor: '#F5B301',
        tabBarInactiveTintColor: 'rgba(255,255,255,0.6)',
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0D3B66',
          borderTopWidth: 0,
          height: 56 + bottomInset,
          paddingBottom: bottomInset,
          paddingTop: 8,
          shadowColor: '#082B4C',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.15,
          shadowRadius: 4,
          elevation: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
      }}
    >
      <HomeTab.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: 'Home', tabBarIcon: () => <Text>🏠</Text> }}
      />
      <HomeTab.Screen
        name="MyBookings"
        component={MyBookingsScreen}
        options={{ title: 'Bookings', tabBarIcon: () => <Text>📋</Text> }}
      />
      <HomeTab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: 'Profile', tabBarIcon: () => <Text>👤</Text> }}
      />
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

const AgentTabs = () => (
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
        height: 70,
        paddingTop: 8,
        paddingBottom: 10,
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
      <Stack.Screen name="ServiceDetails" component={ServiceDetailsScreen} options={{ ...stackHeader, title: 'Service Details' }} />
      <Stack.Screen name="Booking" component={BookingScreen} options={{ ...stackHeader, title: 'Book Service' }} />
      {/* BookingDetailsScreen renders its own header with a back button —
          hiding the RN stack header here avoids two stacked headers. */}
      <Stack.Screen name="BookingDetails" component={BookingDetailsScreen} options={{ headerShown: false }} />
      {/* TrackingScreen renders its own header with back arrow — hiding
          the RN stack header avoids two visually competing headers. */}
      <Stack.Screen name="Tracking" component={TrackingScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Documents" component={DocumentsScreen} options={{ ...stackHeader, title: 'My Documents' }} />
      <Stack.Screen name="CompanyProfile" component={CompanyProfileScreen} options={{ ...stackHeader, title: 'Company Profile' }} />
      <Stack.Screen name="NDA" component={NDAScreen} options={{ ...stackHeader, title: 'Digital NDA' }} />
      <Stack.Screen name="Enquiry" component={EnquiryScreen} options={{ ...stackHeader, title: 'Request Quote' }} />
      <Stack.Screen name="EnquiryDetails" component={EnquiryDetailsScreen} options={{ ...stackHeader, title: 'Enquiry Details' }} />
      <Stack.Screen name="Wallet" component={WalletScreen} options={{ headerShown: false }} />
      {/* ComplianceScreen renders its own header — hide RN stack header to avoid stacking. */}
      <Stack.Screen name="Compliance" component={ComplianceScreen} options={{ headerShown: false }} />

      {/* Agent surface */}
      <Stack.Screen name="AgentTabs" component={AgentTabs} />
      <Stack.Screen name="TaskExecution" component={AgentTaskExecutionScreen} />

      {/* Embedded web surfaces (reached from ModeSelect) — renders a WebView
          inside the same APK so testers see everything in one install. */}
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

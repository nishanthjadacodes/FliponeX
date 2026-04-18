import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import SplashScreen from './src/screens/SplashScreen';
import LoginScreen from './src/screens/LoginScreen';
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

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

const HomeTabs = () => {
  const insets = useSafeAreaInsets();
  // Compute bottom padding so tab bar sits above the device's nav buttons
  const bottomInset = Math.max(insets.bottom, 8);

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: '#0D3B66',
        tabBarInactiveTintColor: '#9AA7B5',
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopWidth: 1,
          borderTopColor: '#EEF2F7',
          height: 56 + bottomInset,
          paddingBottom: bottomInset,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: 'Home', tabBarIcon: () => <Text>🏠</Text> }}
      />
      <Tab.Screen
        name="MyBookings"
        component={MyBookingsScreen}
        options={{ title: 'Bookings', tabBarIcon: () => <Text>📋</Text> }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: 'Profile', tabBarIcon: () => <Text>👤</Text> }}
      />
    </Tab.Navigator>
  );
};

const AppNavigator = () => {
  const stackHeader = {
    headerShown: true,
    headerStyle: { backgroundColor: '#0D3B66' },
    headerTintColor: '#FFFFFF',
    headerTitleStyle: { fontWeight: '700' },
  };
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Splash">
      <Stack.Screen name="Splash" component={SplashScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="HomeTabs" component={HomeTabs} />
      <Stack.Screen name="ServiceDetails" component={ServiceDetailsScreen} options={{ ...stackHeader, title: 'Service Details' }} />
      <Stack.Screen name="Booking" component={BookingScreen} options={{ ...stackHeader, title: 'Book Service' }} />
      <Stack.Screen name="BookingDetails" component={BookingDetailsScreen} options={{ ...stackHeader, title: 'Booking Details' }} />
      <Stack.Screen name="Tracking" component={TrackingScreen} options={{ ...stackHeader, title: 'Track Order' }} />
      <Stack.Screen name="Documents" component={DocumentsScreen} options={{ ...stackHeader, title: 'My Documents' }} />
      <Stack.Screen name="CompanyProfile" component={CompanyProfileScreen} options={{ ...stackHeader, title: 'Company Profile' }} />
      <Stack.Screen name="NDA" component={NDAScreen} options={{ ...stackHeader, title: 'Digital NDA' }} />
      <Stack.Screen name="Enquiry" component={EnquiryScreen} options={{ ...stackHeader, title: 'Request Quote' }} />
    </Stack.Navigator>
  );
};

export default AppNavigator;

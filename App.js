import React, { useEffect, useState, useCallback } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AppNavigator from './AppNavigator';
import { NAV_STATE_KEY } from './src/utils/storage';

// Persist the react-navigation state tree so that after a full process kill
// (OS memory pressure, Force Stop, swipe-away) the app re-opens to exactly
// the screen the user was last on — not the splash/login.

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [initialState, setInitialState] = useState();

  // Restore saved navigation state at cold start.
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(NAV_STATE_KEY);
        if (saved) setInitialState(JSON.parse(saved));
      } catch (_e) {
        // corrupt/missing state → fall through to splash default
      } finally {
        setIsReady(true);
      }
    })();
  }, []);

  // Snapshot the nav state on every change so the next launch can resume.
  // Cheap — AsyncStorage write of a small JSON blob.
  const handleStateChange = useCallback((state) => {
    AsyncStorage.setItem(NAV_STATE_KEY, JSON.stringify(state)).catch(() => {});
  }, []);

  if (!isReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0D3B66' }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer
        initialState={initialState}
        onStateChange={handleStateChange}
      >
        <AppNavigator />
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { getToken } from '../utils/storage';

const SplashScreen = ({ navigation }) => {
  useEffect(() => {
    const checkAuthStatus = async () => {
      setTimeout(async () => {
        try {
          const token = await getToken();
          if (token) {
            navigation.replace('HomeTabs');
          } else {
            navigation.replace('Login');
          }
        } catch (error) {
          console.error('Error checking auth status:', error);
          navigation.replace('Login');
        }
      }, 2000);
    };

    checkAuthStatus();
  }, [navigation]);

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <View style={styles.logoPlaceholder}>
          <Text style={styles.logoText}>🔧</Text>
        </View>
        <Text style={styles.appName}>FlipOn Digital</Text>
      </View>
      <Text style={styles.tagline}>Your trusted service partner</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FF5722',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logoPlaceholder: {
    alignItems: 'center',
  },
  logoText: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#fff',
  },
  appName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 10,
  },
  tagline: {
    fontSize: 16,
    color: '#fff',
    fontStyle: 'italic',
  },
});

export default SplashScreen;

import { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  BackHandler,
  Platform,
} from 'react-native';

// Defensive load — react-native-webview is a native module. If the dev-client
// APK was built before it was installed, `require` throws at runtime. Fall
// back to a friendly screen instead of crashing.
let WebView: any = null;
let webViewReady = false;
try {
  // eslint-disable-next-line global-require
  WebView = require('react-native-webview').WebView;
  webViewReady = typeof WebView === 'function' || typeof WebView === 'object';
} catch (_) {
  webViewReady = false;
}

interface WebViewScreenProps {
  navigation: {
    navigate: (route: string, params?: Record<string, unknown>) => void;
    goBack: () => void;
    replace?: (route: string) => void;
    addListener: (event: string, cb: (e: any) => void) => () => void;
  };
  route: {
    params?: {
      url?: string;
      title?: string;
    };
  };
}

/**
 * Generic WebView wrapper used for both the Admin Dashboard and the
 * Customer Website. The actual URL to load is passed in via route params
 * so we have a single reusable screen.
 *
 * Features:
 *   • Loading spinner while the page is fetching
 *   • Error state with retry button (for network failures)
 *   • Hardware-back button goes back in browsing history before exiting
 *   • Falls back gracefully if react-native-webview native code isn't
 *     linked yet (tells the user to rebuild the dev-client APK)
 */
const WebViewScreen: React.FC<WebViewScreenProps> = ({ route, navigation }) => {
  const { url, title } = route.params || {};
  const webViewRef = useRef<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errored, setErrored] = useState<boolean>(false);
  const [canGoBack, setCanGoBack] = useState<boolean>(false);

  // Android hardware back button — walk back through the WebView's own
  // history first, then fall through to React Navigation exit.
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const onBack = (): boolean => {
      if (canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [canGoBack]);

  // ALSO intercept header-back-arrow + swipe-back gestures. React Navigation
  // fires `beforeRemove` before unmounting the screen — if the WebView still
  // has history, consume the event and go back within the page instead.
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e: any) => {
      if (!canGoBack || !webViewRef.current) return; // allow normal nav exit
      e.preventDefault();
      webViewRef.current.goBack();
    });
    return unsub;
  }, [navigation, canGoBack]);

  // Native-module missing guard
  if (!webViewReady) {
    return (
      <View style={styles.missingWrap}>
        <Text style={styles.missingIcon}>🧩</Text>
        <Text style={styles.missingTitle}>WebView not available</Text>
        <Text style={styles.missingBody}>
          This APK was built before the WebView native module was added. Rebuild the app
          (eas build --profile preview --platform android) and install the new APK — the
          web pages will load automatically after that.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.primaryBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // No URL configured yet (placeholder left in src/config/index.js)
  if (!url) {
    return (
      <View style={styles.missingWrap}>
        <Text style={styles.missingIcon}>🌐</Text>
        <Text style={styles.missingTitle}>{title || 'Website'} not configured</Text>
        <Text style={styles.missingBody}>
          The URL for this site hasn't been set in src/config/index.js yet. Deploy the
          Next.js site (e.g. to Vercel) and paste the URL into the config file.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.primaryBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: url }}
        style={styles.webview}
        onLoadStart={() => { setLoading(true); setErrored(false); }}
        onLoadEnd={() => setLoading(false)}
        onError={() => { setLoading(false); setErrored(true); }}
        onHttpError={({ nativeEvent }: any) => {
          // 5xx / 4xx from the server. Not a network failure — let it render
          // but log for debugging.
          console.log('[webview] HTTP', nativeEvent?.statusCode, nativeEvent?.url);
        }}
        onNavigationStateChange={(s: any) => setCanGoBack(!!s?.canGoBack)}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        allowsBackForwardNavigationGestures
        startInLoadingState
      />

      {loading && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#0D3B66" />
        </View>
      )}

      {errored && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Couldn't load the site</Text>
          <Text style={styles.errorBody}>Check your internet connection and try again.</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => { setErrored(false); webViewRef.current?.reload(); }}
          >
            <Text style={styles.primaryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  webview: { flex: 1 },

  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  errorOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#FFFFFF', padding: 24,
  },
  errorIcon: { fontSize: 56, marginBottom: 12 },
  errorTitle: { fontSize: 18, fontWeight: '800', color: '#0D3B66', marginBottom: 6 },
  errorBody: { fontSize: 14, color: '#546E7A', textAlign: 'center', marginBottom: 18 },

  missingWrap: {
    flex: 1, backgroundColor: '#F5F7FA',
    justifyContent: 'center', alignItems: 'center', padding: 28,
  },
  missingIcon: { fontSize: 54, marginBottom: 14 },
  missingTitle: { fontSize: 19, fontWeight: '800', color: '#0D3B66', marginBottom: 8, textAlign: 'center' },
  missingBody: { fontSize: 14, color: '#546E7A', textAlign: 'center', lineHeight: 20, marginBottom: 22 },

  primaryBtn: {
    backgroundColor: '#0D3B66', paddingHorizontal: 28, paddingVertical: 12, borderRadius: 10,
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
});

export default WebViewScreen;

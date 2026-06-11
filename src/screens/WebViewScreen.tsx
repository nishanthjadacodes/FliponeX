import { useRef, useState, useEffect, useLayoutEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  BackHandler,
  Platform,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

// Defensive load for expo-file-system + expo-sharing — used to save
// CSV exports the embedded admin dashboard sends over the bridge.
// Expo SDK 54 moved `writeAsStringAsync` / `cacheDirectory` to the
// `/legacy` sub-path; try that first, fall back to the main entry.
let FileSystem: any = null;
let Sharing: any = null;
try {
  try {
    // eslint-disable-next-line global-require
    FileSystem = require('expo-file-system/legacy');
  } catch (_) {
    // eslint-disable-next-line global-require
    FileSystem = require('expo-file-system');
  }
  // eslint-disable-next-line global-require
  Sharing = require('expo-sharing');
} catch (_) {
  FileSystem = null;
  Sharing = null;
}

interface WebViewScreenProps {
  navigation: {
    navigate: (route: string, params?: Record<string, unknown>) => void;
    goBack: () => void;
    replace?: (route: string) => void;
    addListener: (event: string, cb: (e: any) => void) => () => void;
    setOptions: (opts: Record<string, unknown>) => void;
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
  // Bottom inset → the embedded site (admin dashboard / customer
  // website) stops ABOVE the Android system navigation bar instead of
  // running its content — and its scroll bottom — underneath it.
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState<boolean>(true);
  const [errored, setErrored] = useState<boolean>(false);
  const [canGoBack, setCanGoBack] = useState<boolean>(false);
  // Set true the moment a LOGOUT message arrives. The `beforeRemove`
  // listener below normally swallows navigation-away events to step
  // back through WebView history instead — but a logout must ALWAYS
  // exit the WebView (back to ModeSelect), no matter how deep the
  // embedded page history is. This flag tells beforeRemove to stand
  // down for that one navigation.
  const loggingOutRef = useRef<boolean>(false);
  // Bumping this key remounts the <WebView>, forcing it to reload the
  // original `url` from scratch. Used by the in-header Home button to
  // jump back to the embedded site's root (admin dashboard's super
  // admin landing page, customer website's home, etc.) regardless of
  // how deep the user has navigated within the WebView's history.
  const [webViewKey, setWebViewKey] = useState<number>(0);

  // Custom Home button in the stack header — navigates the WebView to
  // its root URL instead of going out to the customer app's HomeTabs.
  // Without this override, the inherited Home button from
  // AppNavigator's stackHeader would dump the user out of the admin
  // dashboard entirely.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => {
            // Force a full reload of the WebView with the original URL.
            // Tries the WebView's own history-reset first (cheaper than
            // remount); falls back to remounting via the key bump.
            try {
              if (webViewRef.current?.injectJavaScript) {
                const safeUrl = JSON.stringify(url || '');
                webViewRef.current.injectJavaScript(
                  `window.location.href = ${safeUrl}; true;`,
                );
                return;
              }
            } catch (_) { /* fall through to remount */ }
            setWebViewKey((k) => k + 1);
          }}
          style={{ paddingHorizontal: 14, paddingVertical: 6 }}
          accessibilityLabel="Reset to home"
          accessibilityRole="button"
        >
          <Icon name="home" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      ),
    });
  }, [navigation, url]);

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
      // Logout must exit the WebView entirely — never intercept it,
      // even when the embedded site still has back-history.
      if (loggingOutRef.current) return;
      if (!canGoBack || !webViewRef.current) return; // allow normal nav exit
      e.preventDefault();
      webViewRef.current.goBack();
    });
    return unsub;
  }, [navigation, canGoBack]);

  // Saves a text payload (CSV export from the embedded admin
  // dashboard) to a temp file and opens the OS share sheet so the
  // user can store it in Downloads / send it via WhatsApp, email,
  // Drive, etc. Android WebView can't do `blob:` downloads itself —
  // the dashboard postMessages the content here instead.
  const handleFileDownload = async (
    filename: string,
    content: string,
  ): Promise<void> => {
    if (!FileSystem || !Sharing) {
      Alert.alert(
        'Export unavailable',
        'Saving files needs a fresh app build (expo-file-system native module).',
      );
      return;
    }
    try {
      const safeName = String(filename || 'export.csv').replace(/[^a-zA-Z0-9._-]/g, '_');
      const dir = FileSystem.cacheDirectory || '';
      const path = `${dir}${safeName}`;
      await FileSystem.writeAsStringAsync(path, content, {
        encoding: FileSystem.EncodingType?.UTF8 || 'utf8',
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, {
          mimeType: 'text/csv',
          dialogTitle: safeName,
          UTI: 'public.comma-separated-values-text',
        });
      } else {
        Alert.alert('Saved', `File saved to:\n${path}`);
      }
    } catch (e: any) {
      Alert.alert('Export failed', e?.message || 'Could not save the file.');
    }
  };

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
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <WebView
        key={webViewKey}
        ref={webViewRef}
        source={{ uri: url }}
        style={styles.webview}
        onLoadStart={() => { setLoading(true); setErrored(false); }}
        onLoadEnd={() => setLoading(false)}
        // Hide the loading overlay as soon as the page is mostly loaded
        // (>=70%). React hydration of large Next.js bundles tends to
        // delay onLoadEnd, leaving the overlay covering already-rendered
        // content — onLoadProgress lets us dismiss it earlier.
        onLoadProgress={({ nativeEvent }: any) => {
          if (typeof nativeEvent?.progress === 'number' && nativeEvent.progress >= 0.7) {
            setLoading(false);
          }
        }}
        onError={() => { setLoading(false); setErrored(true); }}
        onHttpError={({ nativeEvent }: any) => {
          // 5xx / 4xx from the server. Not a network failure — let it render
          // but log for debugging.
          console.log('[webview] HTTP', nativeEvent?.statusCode, nativeEvent?.url);
        }}
        onNavigationStateChange={(s: any) => setCanGoBack(!!s?.canGoBack)}
        // Channel for the embedded web app (admin dashboard, customer
        // website) to signal back to native. Used today for: the admin
        // dashboard's Logout button — it calls
        //   window.ReactNativeWebView.postMessage('LOGOUT')
        // which lands here, and we return to the previous screen
        // (ModeSelectScreen, since that's the only thing that opens
        // WebViewScreen). Same channel can carry future events without
        // adding more URL-intercept plumbing.
        onMessage={(event: any) => {
          const data = String(event?.nativeEvent?.data || '');
          if (data === 'LOGOUT' || data === 'BACK_TO_MODE_SELECT') {
            // Raise the flag FIRST so the beforeRemove listener lets
            // this navigation through instead of stepping back inside
            // the embedded site's history. Without this, logging out
            // from a deep nested admin page just went back one web
            // page and stayed inside the WebView.
            loggingOutRef.current = true;
            navigation.goBack();
            return;
          }
          // JSON-shaped messages — currently the CSV-export bridge.
          // The admin dashboard postMessages
          //   { type: 'DOWNLOAD_FILE', filename, content, mime }
          // because Android WebView can't do blob: downloads itself.
          try {
            const msg = JSON.parse(data);
            if (msg && msg.type === 'DOWNLOAD_FILE' && typeof msg.content === 'string') {
              handleFileDownload(msg.filename || 'export.csv', msg.content);
            }
          } catch (_) {
            /* not JSON — ignore (plain-string messages handled above) */
          }
        }}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        allowsBackForwardNavigationGestures
        startInLoadingState
      />

      {loading && (
        // Bottom-pinned thin loader instead of a fullscreen overlay —
        // the user sees the page render in real time and only a small
        // status pill at the bottom indicates network activity.
        <View style={styles.loadingPill} pointerEvents="none">
          <ActivityIndicator size="small" color="#FFFFFF" />
          <Text style={styles.loadingPillText}>Loading…</Text>
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
  loadingPill: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(13,59,102,0.92)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  loadingPillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
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

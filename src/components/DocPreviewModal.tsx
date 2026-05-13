import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Dimensions,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { API_BASE_URL } from '../config';

/**
 * Full-screen preview for an uploaded booking document.
 *
 * For images (jpg/png/webp/etc.) it renders the actual image inside a
 * pinch-to-zoom-friendly container. For PDFs and other binary files it
 * shows a "Open in browser" button — react-native can't render PDFs
 * inline without a native lib, so we delegate to the OS.
 */
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const isImageMime = (m: string | undefined): boolean =>
  typeof m === 'string' && m.startsWith('image/');

// Defensive URL fixer — backends sometimes return raw filenames or
// localhost-relative URLs. Convert anything that isn't a full https://
// URL into one we can actually load on a phone.
export const fixDocUrl = (raw: string | undefined, category?: string): string | undefined => {
  if (!raw) return raw;
  const url = String(raw).trim();
  const apiOrigin = API_BASE_URL.replace(/\/api\/?$/, '');

  // Local file URIs (e.g. file:///data/user/0/.../cache/compliance_xx.jpeg)
  // and content:// URIs (Android scoped storage / SAF) are already absolute
  // and resolve directly against the device's filesystem — `<Image
  // source={{uri}}>` handles them natively. Without this guard the helper
  // would fall through to the "bare filename" branch below and produce
  // a malformed URL like `https://api.example/uploads/booking/file:///...`,
  // which is exactly the 404 that shows up when previewing a downloaded
  // compliance doc from the cache.
  if (/^(file|content|data|asset|blob):/i.test(url)) {
    return url;
  }

  // Already a full http(s) URL → leave as-is, but rewrite localhost.
  if (/^https?:\/\//i.test(url)) {
    if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url)) {
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      return `${apiOrigin}${path}`;
    }
    return url;
  }

  // Looks like a path (e.g. "/uploads/documents/abc.jpg") — prepend API origin.
  if (url.startsWith('/')) {
    return `${apiOrigin}${url}`;
  }

  // Path-relative without leading slash (e.g. "uploads/booking/abc.jpg").
  if (/^uploads\//i.test(url)) {
    return `${apiOrigin}/${url}`;
  }

  // Bare filename (e.g. "abc.jpg") — use category if provided, else 'booking'
  // (the most common bucket; matches multer's default destination).
  const cat = (category || 'booking').toLowerCase();
  return `${apiOrigin}/uploads/${cat}/${url}`;
};

// Back-compat alias used by the modal itself.
const fixUrl = (raw: string | undefined): string | undefined => fixDocUrl(raw);

export interface DocPreviewItem {
  file_url?: string;
  fileUrl?: string;
  uri?: string;
  mime_type?: string;
  mimeType?: string;
  document_type?: string;
  type?: string;
  file_name?: string;
  category?: string;
}

export interface DocPreviewModalProps {
  visible: boolean;
  doc?: DocPreviewItem | null;
  onClose: () => void;
}

const DocPreviewModal: React.FC<DocPreviewModalProps> = ({ visible, doc, onClose }) => {
  const rawUrl = doc?.file_url || doc?.fileUrl || doc?.uri;
  const url = fixDocUrl(rawUrl, doc?.category);
  // Detect image vs other from MIME first, then fall back to file extension.
  // Some legacy rows omit mime_type entirely; we still want to render the
  // image inline rather than dumping the user into a PDF fallback.
  const looksLikeImage =
    !!url && /\.(jpe?g|png|webp|gif|bmp|heic|heif)(\?|$)/i.test(url);
  const mime =
    doc?.mime_type ||
    doc?.mimeType ||
    (looksLikeImage ? 'image/jpeg' : 'application/pdf');
  const label = (doc?.document_type || doc?.type || doc?.file_name || 'Document').replace(/_/g, ' ');
  const showImage = isImageMime(mime);

  // Track image load lifecycle so we can show a spinner while loading and a
  // helpful error message if the URL 404s (common on Render free tier where
  // the ephemeral filesystem wipes uploaded files between cold-starts).
  const [imgState, setImgState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState<string>('');

  useEffect(() => {
    if (visible) {
      setImgState('loading');
      setErrMsg('');
      if (url) console.log('[DocPreview] →', url);
    }
  }, [visible, url]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.headerRow}>
          <Text style={styles.title} numberOfLines={1}>
            {label}
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.close}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          {url && showImage ? (
            <>
              <Image
                source={{ uri: url }}
                style={styles.image}
                resizeMode="contain"
                onLoadStart={() => setImgState('loading')}
                onLoad={() => setImgState('loaded')}
                onError={(e) => {
                  const reason = (e?.nativeEvent as any)?.error || 'Could not load image';
                  console.log('[DocPreview] image error:', reason, '— url:', url);
                  setErrMsg(String(reason));
                  setImgState('error');
                }}
              />
              {imgState === 'loading' && (
                <View style={styles.statusOverlay}>
                  <ActivityIndicator color="#FCD34D" size="large" />
                  <Text style={styles.statusText}>Loading image…</Text>
                  <Text style={styles.statusHint} numberOfLines={2}>
                    {url}
                  </Text>
                </View>
              )}
              {imgState === 'error' && (
                <View style={styles.statusOverlay}>
                  <Text style={styles.fallbackIcon}>⚠️</Text>
                  <Text style={styles.statusText}>Could not load image</Text>
                  <Text style={styles.statusHint}>
                    {errMsg || 'The file may have been removed from the server.'}
                  </Text>
                  <Text style={styles.statusUrl} numberOfLines={2}>{url}</Text>
                  <TouchableOpacity
                    style={styles.openBtn}
                    onPress={() => Linking.openURL(url).catch(() => {})}
                  >
                    <Text style={styles.openBtnText}>Open in browser</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          ) : url ? (
            <View style={styles.fallbackWrap}>
              <Text style={styles.fallbackIcon}>📄</Text>
              <Text style={styles.fallbackLabel}>{label}</Text>
              <Text style={styles.fallbackHint}>Preview not available in-app for this file type.</Text>
              <TouchableOpacity
                style={styles.openBtn}
                onPress={() => Linking.openURL(url).catch(() => {})}
              >
                <Text style={styles.openBtnText}>Open in browser</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.fallbackWrap}>
              <Text style={styles.fallbackIcon}>⚠️</Text>
              <Text style={styles.fallbackHint}>This document has no file URL yet.</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.92)',
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 48, paddingBottom: 14,
  },
  title: { color: '#fff', fontSize: 16, fontWeight: '700', flex: 1, marginRight: 16 },
  close: { color: '#fff', fontSize: 22, fontWeight: '700', paddingHorizontal: 6 },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  image: { width: SCREEN_W, height: SCREEN_H * 0.8 },
  statusOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 24,
  },
  statusText: {
    color: '#fff', fontSize: 16, fontWeight: '700', marginTop: 14,
  },
  statusHint: {
    color: 'rgba(255,255,255,0.65)', fontSize: 12, textAlign: 'center',
    marginTop: 6, paddingHorizontal: 24,
  },
  statusUrl: {
    color: 'rgba(255,255,255,0.5)', fontSize: 10, textAlign: 'center',
    marginTop: 6, paddingHorizontal: 12,
  },
  fallbackWrap: {
    flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28,
  },
  fallbackIcon: { fontSize: 64, marginBottom: 16 },
  fallbackLabel: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  fallbackHint: { color: 'rgba(255,255,255,0.8)', fontSize: 14, textAlign: 'center', marginBottom: 22 },
  openBtn: {
    backgroundColor: '#fff', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10,
    marginTop: 18,
  },
  openBtnText: { color: '#0D3B66', fontWeight: '700', fontSize: 14 },
});

export default DocPreviewModal;

import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { usePermissionRationaleStore } from '../store/usePermissionRationaleStore';
import { PERMISSION_COPY } from '../utils/permissions';

// Root-mounted bottom-sheet modal that explains a runtime permission
// before the OS dialog fires. Driven entirely by
// usePermissionRationaleStore — no props, no per-screen wiring. Every
// call to requestPermissionWithRationale() flips it on, the user's
// choice resolves the awaiting Promise, and the modal flips off.
const PermissionRationaleModal: React.FC = () => {
  const visible = usePermissionRationaleStore((s) => s.visible);
  const kind = usePermissionRationaleStore((s) => s.kind);
  const allow = usePermissionRationaleStore((s) => s.allow);
  const deny = usePermissionRationaleStore((s) => s.deny);

  const copy = kind ? PERMISSION_COPY[kind] : null;

  return (
    <Modal
      visible={visible && !!copy}
      animationType="slide"
      transparent
      onRequestClose={deny}
    >
      {/* Backdrop — tap-to-dismiss treats it as "Not now". */}
      <Pressable style={styles.backdrop} onPress={deny} />

      <View style={styles.sheet} pointerEvents="box-none">
        <View style={styles.card}>
          <View style={styles.handle} />
          {copy && (
            <>
              <View style={styles.iconCircle}>
                <Icon name={copy.icon} size={28} color="#FFFFFF" />
              </View>
              <Text style={styles.title}>{copy.title}</Text>
              <View style={styles.bullets}>
                {copy.bullets.map((b, i) => (
                  <View key={i} style={styles.bulletRow}>
                    <Icon name="check-circle" size={18} color="#0D3B66" />
                    <Text style={styles.bulletText}>{b}</Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={allow}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={copy.continueLabel || 'Continue'}
              >
                <Text style={styles.primaryBtnText}>
                  {copy.continueLabel || 'Continue'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={deny}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={copy.declineLabel || 'Not now'}
              >
                <Text style={styles.secondaryBtnText}>
                  {copy.declineLabel || 'Not now'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 43, 76, 0.55)',
  },
  sheet: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 16,
  },
  handle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    marginBottom: 14,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#0D3B66',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 14,
    textAlign: 'center',
  },
  bullets: {
    alignSelf: 'stretch',
    marginBottom: 18,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 6,
  },
  bulletText: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
    lineHeight: 20,
    color: '#334155',
  },
  primaryBtn: {
    alignSelf: 'stretch',
    backgroundColor: '#0D3B66',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  secondaryBtn: {
    alignSelf: 'stretch',
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default PermissionRationaleModal;

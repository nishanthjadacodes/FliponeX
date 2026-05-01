import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS, SIZES, BORDER_RADIUS } from '../constants/colors';
import type { ValueProp } from '../constants/strings';
import AutoCarousel from './AutoCarousel';

export interface EngagingContentSectionProps {
  content: ValueProp[];
  /** Milliseconds between auto-advances. Default 3500. */
  autoSlideInterval?: number;
}

const CARD_W = 180;

const EngagingContentSection: React.FC<EngagingContentSectionProps> = ({
  content,
  autoSlideInterval = 3500,
}) => {
  return (
    <View style={styles.container}>
      <AutoCarousel
        items={content}
        cardWidth={CARD_W}
        intervalMs={autoSlideInterval}
        slideDurationMs={600}
        renderItem={(item: ValueProp) => (
          <TouchableOpacity style={styles.contentCard} activeOpacity={0.8}>
            <View style={styles.iconContainer}>
              <Text style={styles.icon}>{item.icon}</Text>
            </View>
            <View style={styles.textContent}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.subtitle}>{item.subtitle}</Text>
            </View>
          </TouchableOpacity>
        )}
        style={{ paddingHorizontal: SIZES.BASE / 2 }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: SIZES.BASE,
  },
  contentCard: {
    backgroundColor: COLORS.WHITE,
    borderRadius: BORDER_RADIUS.MEDIUM,
    padding: SIZES.BASE,
    marginRight: SIZES.BASE / 2,
    width: CARD_W - SIZES.BASE / 2, // shrink to leave a gap between cards
    shadowColor: COLORS.CARD_SHADOW,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.PRIMARY,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SIZES.BASE / 2,
  },
  icon: {
    fontSize: SIZES.LARGE,
  },
  textContent: {
    flex: 1,
  },
  title: {
    fontSize: SIZES.SMALL,
    fontWeight: 'bold',
    color: COLORS.BLACK,
    marginBottom: SIZES.BASE / 4,
  },
  subtitle: {
    fontSize: SIZES.SMALL - 2,
    color: COLORS.GRAY,
    textAlign: 'center',
  },
});

export default EngagingContentSection;

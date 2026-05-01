import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { COLORS, SIZES, BORDER_RADIUS } from '../constants/colors';

export interface BannerOffer {
  title: string;
  subtitle: string;
  offer: string;
}

export interface BannerSectionProps {
  offers: BannerOffer[];
}

const BannerSection: React.FC<BannerSectionProps> = ({ offers }) => {
  const renderBanner = (banner: BannerOffer, index: number) => (
    <TouchableOpacity key={index} style={styles.bannerCard}>
      <View style={styles.bannerContent}>
        <Text style={styles.bannerTitle}>{banner.title}</Text>
        <Text style={styles.bannerSubtitle}>{banner.subtitle}</Text>
        <Text style={styles.bannerOffer}>{banner.offer}</Text>
      </View>
      <View style={styles.bannerIcon}>
        <Text style={styles.bannerIconText}>?</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.bannerList}>{offers.map(renderBanner)}</View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: SIZES.BASE,
  },
  bannerList: {
    flexDirection: 'row',
    paddingHorizontal: SIZES.BASE,
  },
  bannerCard: {
    backgroundColor: COLORS.PRIMARY,
    borderRadius: BORDER_RADIUS.MEDIUM,
    padding: SIZES.BASE,
    marginRight: SIZES.BASE,
    minWidth: 200,
    maxWidth: 250,
    shadowColor: COLORS.CARD_SHADOW,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  bannerContent: { flex: 1 },
  bannerTitle: {
    fontSize: SIZES.FONT,
    fontWeight: 'bold',
    color: COLORS.WHITE,
    marginBottom: SIZES.BASE / 4,
  },
  bannerSubtitle: {
    fontSize: SIZES.SMALL,
    color: COLORS.WHITE,
    marginBottom: SIZES.BASE / 4,
    opacity: 0.9,
  },
  bannerOffer: {
    fontSize: SIZES.LARGE,
    fontWeight: 'bold',
    color: COLORS.WHITE,
  },
  bannerIcon: {
    position: 'absolute',
    right: SIZES.BASE,
    top: '50%',
    transform: [{ translateY: -SIZES.BASE }],
  },
  bannerIconText: {
    fontSize: SIZES.XXLARGE,
    color: COLORS.WHITE,
    opacity: 0.3,
  },
});

export default BannerSection;

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { COLORS, SIZES, BORDER_RADIUS } from '../constants/colors';

const EngagingContentSection = ({ content }) => {
  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.contentRow}>
          {content.map((item, index) => (
            <TouchableOpacity 
              key={index} 
              style={styles.contentCard}
              activeOpacity={0.8}
            >
              <View style={styles.iconContainer}>
                <Text style={styles.icon}>{item.icon}</Text>
              </View>
              <View style={styles.textContent}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.subtitle}>{item.subtitle}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: SIZES.BASE,
  },
  contentRow: {
    flexDirection: 'row',
    paddingHorizontal: SIZES.BASE / 2,
  },
  contentCard: {
    backgroundColor: COLORS.WHITE,
    borderRadius: BORDER_RADIUS.MEDIUM,
    padding: SIZES.BASE,
    marginRight: SIZES.BASE / 2,
    minWidth: 150,
    maxWidth: 180,
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

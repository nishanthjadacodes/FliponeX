// Brand palette — strictly Prussian blue + light red + light yellow +
// light gold + white. Prussian blue is the dominant brand tone (header,
// bottom tabs, primary actions); the others are accent / status tones.
export const COLORS = {
  // Prussian blue family (primary / brand)
  primary: '#003153',
  primaryDark: '#001F3F',
  primaryLight: '#1B4B72',
  primaryTint: '#E6EEF4',

  accent: '#003153',
  accentBlue: '#003153',
  accentSky: '#1B4B72',
  skyLight: '#E6EEF4',

  // Light red
  secondary: '#DC2626',
  danger: '#DC2626',
  dangerLight: '#FCA5A5',
  dangerBg: '#FEE2E2',
  error: '#DC2626',

  // Light gold + light yellow
  gold: '#F4A100',
  goldLight: '#FCD34D',
  yellow: '#FEF3C7',
  yellowStrong: '#FDE68A',

  // Status aliases (restricted to palette)
  success: '#003153',
  warning: '#F4A100',
  info: '#1B4B72',

  // Surfaces
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#FFFBEB',
  surfaceSoft: '#E6EEF4',
  white: '#FFFFFF',
  black: '#003153',

  // Neutrals — restricted to palette-derived tones
  gray: '#1B4B72',
  lightGray: '#E6EEF4',
  darkGray: '#001F3F',

  // Text (on white)
  text: '#003153',
  textSecondary: '#1B4B72',
  textMuted: '#94A3B8',
  border: '#E6EEF4',
  inputBorder: '#E6EEF4',
  shadow: '#003153',

  // Gradient presets (arrays for <LinearGradient colors={...}>)
  bgGradient: ['#FFFBEB', '#FFFFFF', '#E6EEF4'],
  primaryGradient: ['#001F3F', '#003153', '#1B4B72'],
  blueGradient: ['#003153', '#1B4B72'],
  goldGradient: ['#F4A100', '#FCD34D'],
  sunset: ['#F4A100', '#FCD34D'],
  successGradient: ['#003153', '#1B4B72'],
  dangerGradient: ['#DC2626', '#FCA5A5'],
  glassCard: ['rgba(255,255,255,0.95)', 'rgba(255,255,255,0.82)'],
  brandSweep: ['#003153', '#F4A100', '#FCD34D'],
} as const;

export const GRADIENTS = {
  prussian: ['#001F3F', '#003153', '#1B4B72'],
  prussianDeep: ['#001F3F', '#003153'],
  gold:       ['#F4A100', '#FCD34D'],
  yellow:     ['#FDE68A', '#FEF3C7'],
  danger:     ['#DC2626', '#FCA5A5'],
  cream:      ['#FFFBEB', '#FFFFFF'],
  card:       ['#FFFFFF', '#FFFBEB'],
  brand:      ['#003153', '#F4A100', '#FCD34D'],
} as const;

export const SIZES = {
  base: 8,
  padding: 16,
  radius: 16,
  font: 14,
  h1: 32,
  h2: 24,
  h3: 18,
  h4: 16,
  h5: 14,
  h6: 12,
} as const;

export const FONTS = {
  h1: { fontSize: SIZES.h1, fontWeight: '800' as const, color: COLORS.text },
  h2: { fontSize: SIZES.h2, fontWeight: '800' as const, color: COLORS.text },
  h3: { fontSize: SIZES.h3, fontWeight: '700' as const, color: COLORS.text },
  body: { fontSize: SIZES.font, color: COLORS.text },
  caption: { fontSize: SIZES.h6, color: COLORS.textSecondary },
} as const;

export interface ShadowStyle {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export const SHADOWS: Record<'card' | 'elevated' | 'gold' | 'blue', ShadowStyle> = {
  card: {
    shadowColor: '#003153',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  elevated: {
    shadowColor: '#003153',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 8,
  },
  gold: {
    shadowColor: '#F4A100',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 10,
  },
  blue: {
    shadowColor: '#003153',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 8,
  },
};

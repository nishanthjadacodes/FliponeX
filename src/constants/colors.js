// ─── FliponeX brand palette ──────────────────────────────────────────────────
// Primary = Prussian Blue (trust, authority — used for header, tab bar,
// default CTAs and brand surfaces).
// Red stays in the palette but only as the ACTION accent for high-priority
// buttons ("Book New Service", error states).
// Gold is for earnings / rewards / attention cards.
export const COLORS = {
  // Brand primary — Prussian Blue
  PRIMARY: '#0D3B66',          // Prussian blue — main brand surface
  PRIMARY_DARK: '#082B4C',     // pressed / elevated deep blue
  PRIMARY_LIGHT: '#E3EEF8',    // tinted background for blue surfaces
  PRIMARY_GRADIENT_END: '#14518C',

  // Action red (high-priority CTAs only — "Book New Service", destructive)
  ACTION: '#E63946',
  ACTION_DARK: '#C52836',
  ACTION_LIGHT: '#FCE4E6',

  // Back-compat aliases — existing screens reference SECONDARY/ACCENT freely
  SECONDARY: '#14518C',        // slightly lighter blue — secondary surfaces
  SECONDARY_DARK: '#082B4C',
  SECONDARY_LIGHT: '#E3EEF8',

  // Brand accent — Gold (rewards, badges, earnings)
  ACCENT: '#F5B301',
  ACCENT_DARK: '#C99100',
  ACCENT_LIGHT: '#FFF7D6',

  // Neutrals
  BACKGROUND: '#F4F6FA',       // soft bluish-gray app background
  SURFACE: '#FFFFFF',
  WHITE: '#FFFFFF',
  BLACK: '#1A1A1A',
  TEXT: '#1A1A1A',
  TEXT_SECONDARY: '#5C6A7A',
  GRAY: '#5C6A7A',
  LIGHT_GRAY: '#E7ECF2',
  BORDER: '#E7ECF2',
  DIVIDER: '#EEF2F7',

  // Status (semantic)
  SUCCESS: '#2E7D32',
  STATUS_PENDING: '#F5B301',
  STATUS_CONFIRMED: '#0D3B66',
  STATUS_COMPLETED: '#2E7D32',
  STATUS_CANCELLED: '#E63946',
  STATUS_IN_PROGRESS: '#F57F17',
  WARNING: '#F57F17',
  ERROR: '#E63946',
  INFO: '#0D3B66',

  // Cards / shadows
  CARD_SHADOW: '#082B4C',
  OVERLAY: 'rgba(13, 59, 102, 0.55)',
};

export const SIZES = {
  BASE: 8,
  FONT: 14,
  SMALL: 12,
  MEDIUM: 16,
  LARGE: 18,
  XLARGE: 24,
  XXLARGE: 32,

  // Back-compat granular sizes used by older screens
  FONT_SMALL: 12,
  FONT_MEDIUM: 14,
  FONT_LARGE: 18,
};

export const BORDER_RADIUS = {
  SMALL: 6,
  MEDIUM: 12,
  LARGE: 16,
  XLARGE: 24,
  ROUND: 999,
};

export const SHADOWS = {
  light: {
    shadowColor: '#082B4C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  medium: {
    shadowColor: '#082B4C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
  },
  heavy: {
    shadowColor: '#082B4C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
};

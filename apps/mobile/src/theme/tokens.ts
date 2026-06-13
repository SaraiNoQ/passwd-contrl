/**
 * Mobile theme tokens for Zero Vault.
 * Independent from Web CSS tokens — follows docs/ui-development.md
 * dark security console principles adapted for React Native.
 */

export const colors = {
  bgRoot: "#050B12",
  bgShell: "#07111D",
  bgPanel: "#0B1624",
  bgPanelSoft: "#101827",
  border: "#1F2937",
  borderStrong: "#334155",
  textPrimary: "#F8FAFC",
  textSecondary: "#CBD5E1",
  textMuted: "#94A3B8",
  primary: "#22D3EE",
  success: "#34D399",
  accent: "#F472B6",
  warning: "#F59E0B",
  danger: "#FB7185",
  white: "#FFFFFF",
  black: "#000000",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
} as const;

export const fontSize = {
  caption: 12,
  bodySm: 14,
  body: 16,
  subheading: 18,
  heading: 24,
  title: 28,
} as const;

export const lineHeight = {
  caption: 18,
  bodySm: 20,
  body: 24,
  subheading: 28,
  heading: 32,
  title: 36,
} as const;

export const fontWeight = {
  regular: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
};

export const minTouchTarget = 44;

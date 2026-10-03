/**
 * Zero Vault mobile visual language.
 *
 * The UI intentionally uses a four-pixel rhythm, square geometry and hard
 * offset shadows. Keep semantic colors here so screens never need to know
 * whether the active palette is the light "paper terminal" or dark terminal.
 */
export interface ThemeColors {
  readonly bgRoot: string;
  readonly bgShell: string;
  readonly bgPanel: string;
  readonly bgPanelSoft: string;
  readonly border: string;
  readonly borderStrong: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly primary: string;
  readonly success: string;
  readonly accent: string;
  readonly warning: string;
  readonly danger: string;
  readonly primarySoft: string;
  readonly primaryStrong: string;
  readonly primaryContrast: string;
  readonly dangerContrast: string;
  readonly successSoft: string;
  readonly accentSoft: string;
  readonly warningSoft: string;
  readonly dangerSoft: string;
  readonly grid: string;
  readonly shadow: string;
  readonly overlay: string;
}

export const lightColors: ThemeColors = {
  bgRoot: "#F3F7F4",
  bgShell: "#FFFDF2",
  bgPanel: "#FFFFFF",
  bgPanelSoft: "#E7F3F2",
  border: "#A8C3C4",
  borderStrong: "#17324D",
  textPrimary: "#102A43",
  textSecondary: "#334E68",
  textMuted: "#61758A",
  primary: "#087F7A",
  success: "#247A52",
  accent: "#D65A54",
  warning: "#A56200",
  danger: "#BD3748",
  primarySoft: "#D5F1EC",
  primaryStrong: "#075D5B",
  primaryContrast: "#FFFDF2",
  dangerContrast: "#FFFFFF",
  successSoft: "#DDF2E4",
  accentSoft: "#FFE3DD",
  warningSoft: "#FFF0C7",
  dangerSoft: "#FFE0E4",
  grid: "#DCE8E5",
  shadow: "#17324D",
  overlay: "rgba(5, 15, 25, 0.62)",
};

export const darkColors: ThemeColors = {
  bgRoot: "#06111C",
  bgShell: "#0A1725",
  bgPanel: "#0E1D2D",
  bgPanelSoft: "#122A3A",
  border: "#315166",
  borderStrong: "#6A8DA0",
  textPrimary: "#FFF9E8",
  textSecondary: "#C8D8DC",
  textMuted: "#8EA9B2",
  primary: "#22CDBD",
  success: "#43C482",
  accent: "#FF786B",
  warning: "#F3B743",
  danger: "#FF6678",
  primarySoft: "#103B3C",
  primaryStrong: "#73F0E0",
  primaryContrast: "#02070C",
  dangerContrast: "#02070C",
  successSoft: "#123A2B",
  accentSoft: "#412623",
  warningSoft: "#3E321D",
  dangerSoft: "#40222B",
  grid: "#13283A",
  shadow: "#02070C",
  overlay: "rgba(0, 4, 8, 0.76)",
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
} as const;

/**
 * Pixel UI corners stay deliberately close to square. A small radius is kept
 * for focus rings and platform anti-aliasing, not for pill-shaped surfaces.
 */
export const radius = {
  none: 0,
  sm: 0,
  md: 2,
  lg: 4,
  xl: 4,
} as const;

export const borderWidth = {
  hairline: 1,
  standard: 2,
  heavy: 3,
} as const;

export const pixelShadow = {
  sm: 2,
  md: 4,
  lg: 6,
} as const;

export const fontSize = {
  overline: 10,
  caption: 12,
  bodySm: 14,
  body: 16,
  subheading: 18,
  heading: 24,
  title: 28,
  display: 36,
} as const;

export const lineHeight = {
  overline: 14,
  caption: 18,
  bodySm: 20,
  body: 24,
  subheading: 28,
  heading: 32,
  title: 36,
  display: 44,
} as const;

export const fontFamily = {
  body: "LXGW WenKai",
  display: "LXGW WenKai",
  mono: "monospace",
} as const;

export const fontWeight = {
  regular: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
};

export const letterSpacing = {
  tight: -0.2,
  normal: 0,
  label: 0.6,
  terminal: 1.2,
} as const;

export const motion = {
  quick: 120,
  standard: 220,
  deliberate: 420,
} as const;

export const minTouchTarget = 48;

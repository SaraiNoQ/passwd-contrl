import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Text, TextInput } from "./Typography";
import { useTheme } from "../theme/theme";
import {
  borderWidth,
  fontSize,
  fontWeight,
  letterSpacing,
  minTouchTarget,
  pixelShadow,
  radius,
  spacing,
  type ThemeColors,
} from "../theme/tokens";

type SurfaceTone = "default" | "soft" | "brand" | "success" | "warning" | "danger";
type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger";
type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function PixelGridBackground({
  dense = false,
  opacity = 1,
}: {
  dense?: boolean;
  opacity?: number;
}) {
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const step = dense ? spacing.base : spacing.xl;
  const columns = Math.ceil(width / step) + 1;
  const rows = Math.ceil(height / step) + 1;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { opacity }]}
    >
      {Array.from({ length: columns }, (_, index) => (
        <View
          key={`column-${index}`}
          style={[
            styles.gridColumn,
            { left: index * step, backgroundColor: colors.grid },
          ]}
        />
      ))}
      {Array.from({ length: rows }, (_, index) => (
        <View
          key={`row-${index}`}
          style={[
            styles.gridRow,
            { top: index * step, backgroundColor: colors.grid },
          ]}
        />
      ))}
    </View>
  );
}

export function PixelScreen({
  children,
  style,
  showGrid = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  showGrid?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.screen, { backgroundColor: colors.bgRoot }, style]}>
      {showGrid ? <PixelGridBackground opacity={0.62} /> : null}
      {children}
    </View>
  );
}

export function PixelCard({
  children,
  tone = "default",
  shadow = "md",
  style,
  contentStyle,
}: {
  children: ReactNode;
  tone?: SurfaceTone;
  shadow?: "none" | "sm" | "md";
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const offset = shadow === "none" ? 0 : shadow === "sm" ? pixelShadow.sm : pixelShadow.md;
  const backgroundColor = getSurfaceColor(colors, tone);

  return (
    <View
      style={[
        style,
        offset > 0
          ? {
              paddingRight: offset,
              paddingBottom: offset,
              backgroundColor: colors.shadow,
            }
          : undefined,
      ]}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor,
            borderColor: tone === "default" || tone === "soft"
              ? colors.borderStrong
              : getToneColor(colors, tone),
          },
          contentStyle,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

interface PixelButtonProps
  extends Omit<ComponentProps<typeof Pressable>, "children" | "style"> {
  label: string;
  icon?: ReactNode;
  variant?: ButtonVariant;
  compact?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function PixelButton({
  label,
  icon,
  variant = "primary",
  compact = false,
  loading = false,
  disabled,
  style,
  ...props
}: PixelButtonProps) {
  const { colors } = useTheme();
  const palette = getButtonPalette(colors, variant);
  const offset = variant === "ghost" ? 0 : pixelShadow.sm;
  const isDisabled = disabled || loading;

  return (
    <View
      style={[
        style,
        offset > 0
          ? {
              paddingRight: offset,
              paddingBottom: offset,
              backgroundColor: colors.shadow,
            }
          : undefined,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        disabled={isDisabled}
        {...props}
        style={({ pressed }) => [
          styles.button,
          compact ? styles.buttonCompact : undefined,
          {
            backgroundColor: palette.background,
            borderColor: palette.border,
            opacity: isDisabled ? 0.48 : 1,
            transform: pressed && !isDisabled
              ? [{ translateX: offset }, { translateY: offset }]
              : undefined,
          },
        ]}
      >
        {loading ? <ActivityIndicator color={palette.foreground} size="small" /> : icon}
        <Text
          numberOfLines={1}
          style={[styles.buttonLabel, { color: palette.foreground }]}
          variant="label"
        >
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

interface PixelInputProps
  extends Omit<ComponentProps<typeof TextInput>, "style"> {
  label?: string;
  hint?: string;
  error?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

export function PixelInput({
  label,
  hint,
  error,
  prefix,
  suffix,
  containerStyle,
  inputStyle,
  multiline,
  onFocus,
  onBlur,
  ...props
}: PixelInputProps) {
  const { colors } = useTheme();
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={[styles.field, containerStyle]}>
      {label ? (
        <Text style={styles.fieldLabel} tone={isFocused ? "brand" : "secondary"} variant="label">
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.inputFrame,
          multiline ? styles.inputFrameMultiline : undefined,
          {
            backgroundColor: colors.bgPanel,
            borderColor: error
              ? colors.danger
              : isFocused
                ? colors.primary
                : colors.borderStrong,
          },
        ]}
      >
        {prefix}
        <TextInput
          {...props}
          multiline={multiline}
          onBlur={(event) => {
            setIsFocused(false);
            onBlur?.(event);
          }}
          onFocus={(event) => {
            setIsFocused(true);
            onFocus?.(event);
          }}
          style={[
            styles.input,
            multiline ? styles.inputMultiline : undefined,
            inputStyle,
          ]}
        />
        {suffix}
      </View>
      {error ? (
        <Text tone="danger" variant="caption">
          {`! ${error}`}
        </Text>
      ) : hint ? (
        <Text tone="muted" variant="caption">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function PixelBadge({
  label,
  tone = "neutral",
  style,
}: {
  label: string;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const palette = getBadgePalette(colors, tone);
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: palette.background, borderColor: palette.foreground },
        style,
      ]}
    >
      <View style={[styles.badgeDot, { backgroundColor: palette.foreground }]} />
      <Text
        numberOfLines={1}
        style={[styles.badgeLabel, { color: palette.foreground }]}
        variant="caption"
      >
        {label}
      </Text>
    </View>
  );
}

export function PixelSectionHeader({
  title,
  subtitle,
  index,
  action,
}: {
  title: string;
  subtitle?: string;
  index?: string;
  action?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionCopy}>
        <View style={styles.sectionTitleRow}>
          {index ? (
            <Text
              style={[
                styles.sectionIndex,
                { backgroundColor: colors.primary, color: colors.primaryContrast },
              ]}
              variant="terminal"
            >
              {index}
            </Text>
          ) : null}
          <Text variant="heading">{title}</Text>
        </View>
        {subtitle ? (
          <Text tone="secondary" variant="bodySmall">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

export function PixelDivider({ label }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.divider}>
      <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
      {label ? (
        <Text style={styles.dividerLabel} tone="muted" variant="terminal">
          {label}
        </Text>
      ) : null}
      <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
    </View>
  );
}

function getSurfaceColor(colors: ThemeColors, tone: SurfaceTone): string {
  if (tone === "soft") return colors.bgPanelSoft;
  if (tone === "brand") return colors.primarySoft;
  if (tone === "success") return colors.successSoft;
  if (tone === "warning") return colors.warningSoft;
  if (tone === "danger") return colors.dangerSoft;
  return colors.bgPanel;
}

function getToneColor(colors: ThemeColors, tone: SurfaceTone): string {
  if (tone === "brand") return colors.primary;
  if (tone === "success") return colors.success;
  if (tone === "warning") return colors.warning;
  if (tone === "danger") return colors.danger;
  return colors.borderStrong;
}

function getButtonPalette(colors: ThemeColors, variant: ButtonVariant) {
  if (variant === "secondary") {
    return {
      background: colors.bgPanel,
      border: colors.borderStrong,
      foreground: colors.textPrimary,
    };
  }
  if (variant === "danger") {
    return {
      background: colors.danger,
      border: colors.borderStrong,
      foreground: colors.dangerContrast,
    };
  }
  if (variant === "ghost") {
    return {
      background: "transparent",
      border: colors.border,
      foreground: colors.primary,
    };
  }
  return {
    background: colors.primary,
    border: colors.borderStrong,
    foreground: colors.primaryContrast,
  };
}

function getBadgePalette(colors: ThemeColors, tone: BadgeTone) {
  if (tone === "brand") return { background: colors.primarySoft, foreground: colors.primary };
  if (tone === "success") return { background: colors.successSoft, foreground: colors.success };
  if (tone === "warning") return { background: colors.warningSoft, foreground: colors.warning };
  if (tone === "danger") return { background: colors.dangerSoft, foreground: colors.danger };
  return { background: colors.bgPanelSoft, foreground: colors.textSecondary };
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  gridColumn: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
  },
  gridRow: {
    position: "absolute",
    right: 0,
    left: 0,
    height: StyleSheet.hairlineWidth,
  },
  card: {
    borderWidth: borderWidth.standard,
    borderRadius: radius.md,
    padding: spacing.base,
  },
  button: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderWidth: borderWidth.standard,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  buttonCompact: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  buttonLabel: {
    fontWeight: fontWeight.semibold,
    letterSpacing: letterSpacing.label,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    letterSpacing: letterSpacing.label,
  },
  inputFrame: {
    minHeight: minTouchTarget,
    borderWidth: borderWidth.standard,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  inputFrameMultiline: {
    minHeight: 112,
    alignItems: "flex-start",
    paddingVertical: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: minTouchTarget - borderWidth.standard * 2,
    paddingVertical: spacing.sm,
    fontSize: fontSize.body,
  },
  inputMultiline: {
    minHeight: 92,
    textAlignVertical: "top",
  },
  badge: {
    minHeight: 28,
    maxWidth: "100%",
    borderWidth: borderWidth.standard,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  badgeDot: {
    width: 6,
    height: 6,
  },
  badgeLabel: {
    flexShrink: 1,
    fontWeight: fontWeight.semibold,
    letterSpacing: letterSpacing.label,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  sectionCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  sectionIndex: {
    minWidth: 28,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    textAlign: "center",
    fontWeight: fontWeight.bold,
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: borderWidth.hairline,
  },
  dividerLabel: {
    letterSpacing: letterSpacing.terminal,
  },
});

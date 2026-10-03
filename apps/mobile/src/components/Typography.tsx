import { type ComponentProps } from "react";
import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextStyle,
} from "react-native";
import { useVaultState } from "../state/app-state";
import { useTheme } from "../theme/theme";
import {
  fontFamily,
  fontSize,
  fontWeight,
  letterSpacing,
  lineHeight,
} from "../theme/tokens";

type TextVariant =
  | "body"
  | "bodySmall"
  | "caption"
  | "label"
  | "heading"
  | "title"
  | "display"
  | "terminal";

type TextTone = "primary" | "secondary" | "muted" | "brand" | "success" | "warning" | "danger";

type AppTextProps = ComponentProps<typeof NativeText> & {
  variant?: TextVariant;
  tone?: TextTone;
};

export function Text({
  style,
  children,
  variant,
  tone = "primary",
  ...props
}: AppTextProps) {
  const { colors } = useTheme();
  const toneStyle: TextStyle = {
    color: tone === "brand"
      ? colors.primary
      : tone === "secondary"
        ? colors.textSecondary
        : tone === "muted"
          ? colors.textMuted
          : tone === "success"
            ? colors.success
            : tone === "warning"
              ? colors.warning
              : tone === "danger"
                ? colors.danger
                : colors.textPrimary,
  };
  return (
    <NativeText
      {...props}
      style={[styles.text, variant ? variantStyles[variant] : undefined, toneStyle, style]}
    >
      {children}
    </NativeText>
  );
}

export function TextInput({
  style,
  placeholder,
  placeholderTextColor,
  onChangeText,
  ...props
}: ComponentProps<typeof NativeTextInput>) {
  const { recordActivity } = useVaultState();
  const { colors } = useTheme();
  return (
    <NativeTextInput
      {...props}
      onChangeText={(value) => {
        recordActivity();
        onChangeText?.(value);
      }}
      placeholder={placeholder}
      placeholderTextColor={placeholderTextColor ?? colors.textMuted}
      selectionColor={colors.primary}
      style={[styles.text, { color: colors.textPrimary }, style]}
    />
  );
}

const styles = StyleSheet.create({
  text: { fontFamily: fontFamily.body },
});

const variantStyles = StyleSheet.create<Record<TextVariant, TextStyle>>({
  body: {
    fontSize: fontSize.body,
    lineHeight: lineHeight.body,
  },
  bodySmall: {
    fontSize: fontSize.bodySm,
    lineHeight: lineHeight.bodySm,
  },
  caption: {
    fontSize: fontSize.caption,
    lineHeight: lineHeight.caption,
  },
  label: {
    fontSize: fontSize.bodySm,
    lineHeight: lineHeight.bodySm,
    fontWeight: fontWeight.semibold,
    letterSpacing: letterSpacing.label,
  },
  heading: {
    fontSize: fontSize.heading,
    lineHeight: lineHeight.heading,
    fontWeight: fontWeight.semibold,
  },
  title: {
    fontSize: fontSize.title,
    lineHeight: lineHeight.title,
    fontWeight: fontWeight.bold,
    letterSpacing: letterSpacing.tight,
  },
  display: {
    fontSize: fontSize.display,
    lineHeight: lineHeight.display,
    fontWeight: fontWeight.bold,
    letterSpacing: letterSpacing.tight,
  },
  terminal: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.caption,
    lineHeight: lineHeight.caption,
    letterSpacing: letterSpacing.terminal,
  },
});

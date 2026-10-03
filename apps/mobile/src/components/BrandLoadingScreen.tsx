import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { PixelGridBackground } from "./PixelUI";
import { Text } from "./Typography";
import { useI18n } from "../i18n";
import {
  borderWidth,
  fontSize,
  fontWeight,
  letterSpacing,
  pixelShadow,
  spacing,
  type ThemeColors,
} from "../theme/tokens";
import { useTheme } from "../theme/theme";

const PROGRESS_WIDTH = 148;

export function BrandLoadingScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pulse = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 520,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 520,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    );
    const progressAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: 1_200,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.delay(180),
        Animated.timing(progress, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    pulseAnimation.start();
    progressAnimation.start();
    return () => {
      pulseAnimation.stop();
      progressAnimation.stop();
    };
  }, [progress, pulse]);

  return (
    <View accessibilityLabel={t("Zero Vault 正在启动")} style={styles.container}>
      <PixelGridBackground opacity={0.7} />
      <View style={styles.terminal}>
        <View style={styles.terminalRail}>
          <View style={styles.railBlock} />
          <View style={styles.railLine} />
          <Text style={styles.railLabel} variant="terminal">
            ZV/BOOT
          </Text>
        </View>

        <View style={styles.markShadow}>
          <Animated.View
            style={[
              styles.markFrame,
              {
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.76, 1] }),
                transform: [{
                  translateY: pulse.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }),
                }],
              },
            ]}
          >
            <Animated.Image
              accessibilityIgnoresInvertColors
              resizeMode="contain"
              source={require("../../assets/images/splash-icon.png")}
              style={styles.mark}
            />
            <View style={styles.markCursor} />
          </Animated.View>
        </View>

        <View style={styles.copy}>
          <Text style={styles.wordmark}>ZERO VAULT</Text>
          <Text style={styles.label}>{t("正在安全启动…")}</Text>
        </View>

        <View style={styles.progressShell}>
          <Animated.View
            style={[
              styles.progressFill,
              {
                transform: [
                  {
                    translateX: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-PROGRESS_WIDTH / 2, 0],
                    }),
                  },
                  {
                    scaleX: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.02, 1],
                    }),
                  },
                ],
              },
            ]}
          />
        </View>
        <View style={styles.pixelRow}>
          {Array.from({ length: 8 }, (_, index) => (
            <Animated.View
              key={index}
              style={[
                styles.pixel,
                {
                  opacity: progress.interpolate({
                    inputRange: [0, index / 10 + 0.05, index / 10 + 0.15, 1],
                    outputRange: [0.2, 0.2, 1, 1],
                  }),
                },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    backgroundColor: colors.bgRoot,
  },
  terminal: {
    width: "100%",
    maxWidth: 320,
    alignItems: "center",
    gap: spacing.base,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.base,
    paddingBottom: spacing.lg,
    borderWidth: borderWidth.standard,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bgShell,
  },
  terminalRail: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  railBlock: {
    width: 8,
    height: 8,
    backgroundColor: colors.accent,
  },
  railLine: {
    flex: 1,
    height: borderWidth.standard,
    backgroundColor: colors.border,
  },
  railLabel: {
    color: colors.textMuted,
    fontSize: fontSize.overline,
    lineHeight: 14,
  },
  markShadow: {
    paddingRight: pixelShadow.md,
    paddingBottom: pixelShadow.md,
    backgroundColor: colors.shadow,
  },
  markFrame: {
    width: 116,
    height: 116,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: borderWidth.standard,
    borderColor: colors.borderStrong,
    backgroundColor: colors.primarySoft,
  },
  mark: {
    width: 94,
    height: 94,
  },
  markCursor: {
    position: "absolute",
    right: 6,
    bottom: 6,
    width: 12,
    height: 5,
    backgroundColor: colors.primaryStrong,
  },
  copy: {
    alignItems: "center",
    gap: spacing.xs,
  },
  wordmark: {
    color: colors.textPrimary,
    fontFamily: "monospace",
    fontSize: fontSize.heading,
    fontWeight: fontWeight.bold,
    letterSpacing: letterSpacing.terminal,
  },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.bodySm,
  },
  progressShell: {
    width: PROGRESS_WIDTH,
    height: 12,
    overflow: "hidden",
    borderWidth: borderWidth.standard,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bgPanelSoft,
  },
  progressFill: {
    width: PROGRESS_WIDTH - borderWidth.standard * 2,
    height: "100%",
    backgroundColor: colors.primary,
  },
  pixelRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  pixel: {
    width: 4,
    height: 4,
    backgroundColor: colors.accent,
  },
});

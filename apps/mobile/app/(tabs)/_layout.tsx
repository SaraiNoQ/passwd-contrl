import { Tabs } from "expo-router";
import { SymbolView } from "expo-symbols";
import { StyleSheet, View } from "react-native";
import {
  borderWidth,
  fontFamily,
  fontSize,
  fontWeight,
  letterSpacing,
  spacing,
} from "../../src/theme/tokens";
import { useTheme } from "../../src/theme/theme";
import { useI18n } from "../../src/i18n";

export default function TabsLayout() {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bgRoot },
        tabBarStyle: {
          minHeight: 72,
          paddingTop: spacing.sm,
          paddingBottom: spacing.sm,
          backgroundColor: colors.bgShell,
          borderTopColor: colors.borderStrong,
          borderTopWidth: borderWidth.standard,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarItemStyle: {
          marginHorizontal: spacing.xs,
          borderRadius: 0,
        },
        tabBarIconStyle: {
          marginBottom: spacing.xs,
        },
        tabBarLabelStyle: {
          fontFamily: fontFamily.body,
          fontSize: fontSize.caption,
          fontWeight: fontWeight.semibold,
          letterSpacing: letterSpacing.label,
          lineHeight: 16,
        },
        tabBarActiveBackgroundColor: colors.primarySoft,
        tabBarActiveTintColor: colors.primaryStrong,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarHideOnKeyboard: true,
        tabBarBackground: () => (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bgShell }]}>
            <View style={[styles.tabRail, { backgroundColor: colors.grid }]} />
            <View style={[styles.tabRailAccent, { backgroundColor: colors.accent }]} />
          </View>
        ),
      }}
    >
      <Tabs.Screen
        name="vault"
        options={{
          title: t("密码库"),
          tabBarButtonTestID: "tab-vault",
          tabBarIcon: ({ color, focused }) => (
            <View
              style={[
                styles.iconFrame,
                {
                  backgroundColor: focused ? colors.bgPanel : "transparent",
                  borderColor: focused ? colors.primary : "transparent",
                },
              ]}
            >
              <SymbolView
                name={{ ios: "key.fill", android: "key", web: "key" }}
                tintColor={color}
                size={20}
              />
              {focused ? <View style={[styles.iconPixel, { backgroundColor: colors.accent }]} /> : null}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("设置"),
          tabBarButtonTestID: "tab-settings",
          tabBarIcon: ({ color, focused }) => (
            <View
              style={[
                styles.iconFrame,
                {
                  backgroundColor: focused ? colors.bgPanel : "transparent",
                  borderColor: focused ? colors.primary : "transparent",
                },
              ]}
            >
              <SymbolView
                name={{ ios: "gearshape.fill", android: "settings", web: "settings" }}
                tintColor={color}
                size={20}
              />
              {focused ? <View style={[styles.iconPixel, { backgroundColor: colors.accent }]} /> : null}
            </View>
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabRail: {
    position: "absolute",
    top: 5,
    right: spacing.base,
    left: spacing.base,
    height: borderWidth.hairline,
  },
  tabRailAccent: {
    position: "absolute",
    top: 4,
    left: spacing.base,
    width: 28,
    height: borderWidth.heavy,
  },
  iconFrame: {
    width: 34,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: borderWidth.standard,
  },
  iconPixel: {
    position: "absolute",
    right: -borderWidth.standard,
    bottom: -borderWidth.standard,
    width: 5,
    height: 5,
  },
});

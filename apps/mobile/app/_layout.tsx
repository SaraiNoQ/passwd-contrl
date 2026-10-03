import { useEffect, useState } from "react";
import { Stack, usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BrandLoadingScreen } from "../src/components/BrandLoadingScreen";
import {
  borderWidth,
  fontFamily,
  fontSize,
  fontWeight,
  letterSpacing,
} from "../src/theme/tokens";
import { ThemeProvider, useTheme } from "../src/theme/theme";
import { useI18n } from "../src/i18n";
import { restoreLanguagePreference } from "../src/i18n/persistence";
import { initializeApp } from "../src/lib/init";
import { getSessionGuardTarget } from "../src/lib/session-route-guard";
import { AppProvider, useAuthState, useVaultState } from "../src/state/app-state";

// Initialize app dependencies once at startup
initializeApp();
SplashScreen.setOptions({ duration: 550, fade: true });
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <AppProvider>
          <AppNavigation />
        </AppProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

function AppNavigation() {
  const { colorScheme, colors, isHydrated: isThemeHydrated } = useTheme();
  const { t } = useI18n();
  const [isLanguageHydrated, setIsLanguageHydrated] = useState(false);
  const auth = useAuthState();
  const vault = useVaultState();
  const pathname = usePathname();
  const router = useRouter();
  const guardTarget = getSessionGuardTarget(pathname, {
    isRestoring: auth.isRestoring,
    hasUser: auth.user !== null,
    hasRecoveryCode: auth.registrationRecoveryCode !== null,
    deviceStatus: auth.device?.status ?? null,
    vaultLocked: vault.isLocked,
  });

  useEffect(() => {
    let active = true;
    void restoreLanguagePreference().finally(() => {
      if (active) setIsLanguageHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isThemeHydrated || !isLanguageHydrated) return;
    void SplashScreen.hideAsync();
  }, [isLanguageHydrated, isThemeHydrated]);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.bgRoot).catch(() => undefined);
  }, [colors.bgRoot]);

  useEffect(() => {
    if (guardTarget) router.replace(guardTarget);
  }, [guardTarget, router]);

  if (!isThemeHydrated || !isLanguageHydrated) return null;

  return (
    <>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bgShell },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: {
            fontFamily: fontFamily.body,
            fontSize: fontSize.subheading,
            fontWeight: fontWeight.semibold,
            letterSpacing: letterSpacing.label,
          },
          headerTitleAlign: "left",
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
          headerBackground: () => (
            <View
              style={[
                styles.headerBackground,
                {
                  backgroundColor: colors.bgShell,
                  borderBottomColor: colors.borderStrong,
                },
              ]}
            >
              <View style={[styles.headerAccentLarge, { backgroundColor: colors.primary }]} />
              <View style={[styles.headerAccentSmall, { backgroundColor: colors.accent }]} />
            </View>
          ),
          contentStyle: { backgroundColor: colors.bgRoot },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: t("登录") }} />
        <Stack.Screen name="register" options={{ title: t("创建账户") }} />
        <Stack.Screen name="recovery-code" options={{ title: t("恢复码") }} />
        <Stack.Screen name="unlock" options={{ title: t("解锁密码库") }} />
        <Stack.Screen name="device-approval" options={{ title: t("设备批准") }} />
        <Stack.Screen name="sync-status" options={{ title: t("同步状态") }} />
        <Stack.Screen name="credential/[id]" options={{ title: t("凭据详情") }} />
        <Stack.Screen name="item/new" options={{ title: t("新增凭据") }} />
        <Stack.Screen name="item/[id]/edit" options={{ title: t("编辑凭据") }} />
        <Stack.Screen name="account" options={{ title: t("账户管理") }} />
        <Stack.Screen name="cloud-backup" options={{ title: t("加密云备份") }} />
        <Stack.Screen name="conflicts" options={{ title: t("同步冲突") }} />
        <Stack.Screen name="devices" options={{ title: t("可信设备") }} />
        <Stack.Screen name="local-backup" options={{ title: t("本地加密备份与导入") }} />
        <Stack.Screen name="password-health" options={{ title: t("密码健康") }} />
        <Stack.Screen name="recovery" options={{ title: t("密码库恢复") }} />
      </Stack>
      {auth.isRestoring || guardTarget ? (
        <View
          accessibilityViewIsModal
          importantForAccessibility="yes"
          style={styles.routeGuard}
        >
          <BrandLoadingScreen />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  headerBackground: {
    flex: 1,
    overflow: "hidden",
    borderBottomWidth: borderWidth.standard,
  },
  headerAccentLarge: {
    position: "absolute",
    right: 18,
    bottom: 0,
    width: 32,
    height: borderWidth.heavy,
  },
  headerAccentSmall: {
    position: "absolute",
    right: 8,
    bottom: 0,
    width: 6,
    height: borderWidth.heavy,
  },
  routeGuard: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 10,
    elevation: 10,
  },
});

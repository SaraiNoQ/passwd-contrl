import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors, fontWeight } from "../src/theme/tokens";
import { initializeApp } from "../src/lib/init";

// Initialize app dependencies once at startup
initializeApp();

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bgShell },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontWeight: fontWeight.semibold },
          contentStyle: { backgroundColor: colors.bgRoot },
        }}
      />
    </SafeAreaProvider>
  );
}

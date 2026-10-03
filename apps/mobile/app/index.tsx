import { Redirect } from "expo-router";
import { useAuthState } from "../src/state/app-state";
import { BrandLoadingScreen } from "../src/components/BrandLoadingScreen";

export default function Index() {
  const { user, device, registrationRecoveryCode, isRestoring } = useAuthState();
  if (isRestoring) return <BrandLoadingScreen />;
  if (!user) return <Redirect href="/login" />;
  if (registrationRecoveryCode) return <Redirect href="/recovery-code" />;
  return <Redirect href={device?.status === "approved" ? "/unlock" : "/device-approval"} />;
}

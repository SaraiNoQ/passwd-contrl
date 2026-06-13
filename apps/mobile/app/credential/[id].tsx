import { useLocalSearchParams } from "expo-router";
import { CredentialDetailScreen } from "../../src/screens/CredentialDetailScreen";

export default function CredentialDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CredentialDetailScreen itemId={id ?? ""} />;
}

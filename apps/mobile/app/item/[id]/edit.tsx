import { useLocalSearchParams } from "expo-router";
import { VaultItemEditorScreen } from "../../../src/screens/VaultItemEditorScreen";

export default function EditVaultItemRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <VaultItemEditorScreen itemId={id ?? ""} />;
}

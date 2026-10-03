import { Alert } from "react-native";
import { getLanguage, translateVisibleText } from ".";

let installed = false;

export function installLocalizedAlerts(): void {
  if (installed) return;
  installed = true;
  const showNativeAlert = Alert.alert.bind(Alert);

  Alert.alert = (title, message, buttons, options) => {
    const language = getLanguage();
    showNativeAlert(
      translateVisibleText(title, language),
      message === undefined ? undefined : translateVisibleText(message, language),
      buttons?.map((button) => ({
        ...button,
        text: button.text === undefined
          ? undefined
          : translateVisibleText(button.text, language),
      })),
      options,
    );
  };
}

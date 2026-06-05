import { detectForms } from "./form-detection";
import { fillFirstDetectedForm } from "./form-fill";
import type { FillCredentialMessage } from "./messages";

const dispatchCandidates = () => {
  const forms = detectForms();
  if (forms.length === 0) {
    return;
  }

  chrome.runtime.sendMessage({
    type: "FORM_CANDIDATES",
    origin: window.location.origin,
    forms
  });
};

chrome.runtime.onMessage.addListener((message: FillCredentialMessage) => {
  fillFirstDetectedForm(message);
});

dispatchCandidates();

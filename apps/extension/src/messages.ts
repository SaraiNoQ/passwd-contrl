export type FormCandidate = {
  usernameFieldId?: string;
  passwordFieldId: string;
};

export type VaultCredentialSessionItem = {
  type: "login";
  id: string;
  title: string;
  origin: string;
  username: string;
  password: string;
  totp?: string;
};

export type FormCandidatesMessage = {
  type: "FORM_CANDIDATES";
  origin: string;
  forms: FormCandidate[];
};

export type FillCredentialMessage = {
  type: "FILL_CREDENTIAL";
  username?: string;
  password: string;
};

export type VaultSessionMessage =
  | { type: "ZERO_VAULT_SESSION_UPDATE"; credentials: VaultCredentialSessionItem[] }
  | { type: "ZERO_VAULT_SESSION_CLEAR" };

export type PopupStateRequest = {
  type: "GET_POPUP_STATE";
};

export type FillMatchedCredentialRequest = {
  type: "FILL_MATCHED_CREDENTIAL";
  credentialId: string;
};

export type OriginMatchResult = "exact" | "similar" | "different" | "suspicious";

export type MatchedCredentialDisplay = Omit<VaultCredentialSessionItem, "password"> & {
  matchType: OriginMatchResult;
};

export type PopupStateResponse = {
  origin?: string;
  blockedReason?: string;
  credentials: MatchedCredentialDisplay[];
};

export type GetExtensionStatusRequest = {
  type: "GET_EXTENSION_STATUS";
};

export type ExtensionStatusResponse = {
  installed: true;
  version: string;
  credentialsLoaded: boolean;
  matchedCredentials: number;
};

export type AcknowledgeSimilarOriginRequest = {
  type: "ACKNOWLEDGE_SIMILAR_ORIGIN";
  credentialId: string;
};

export type AcknowledgeSimilarOriginResponse = {
  ok: boolean;
};

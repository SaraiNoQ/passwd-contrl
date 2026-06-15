/** Shared test constants for E2E tests. */

export const MASTER_PASSWORD = "TestPassword123!Secure";
export const UPDATED_MASTER_PASSWORD = "UpdatedPassword123!Secure";
export const RECOVERED_MASTER_PASSWORD = "RecoveredPassword123!Secure";
export const ACCOUNT_PASSWORD = "AccountPassword123!Secure";

export const CREDENTIALS = {
  login: {
    title: "Test GitHub",
    origin: "https://github.com",
    username: "testuser@example.com",
    password: "Str0ng!P@ssw0rd#2024",
  },
  secureNote: {
    title: "Test Note",
    noteBody: "This is a secure note content.",
  },
  creditCard: {
    title: "Test Visa",
    cardholderName: "Test User",
    cardNumber: "4111111111111111",
    expirationMonth: "12",
    expirationYear: "2030",
    cvv: "123",
    brand: "Visa",
  },
};

export const CSV_MIXED = [
  "name,url,username,password",
  "HTTPS Site,https://secure.example.com,user@example.com,SecurePass!123",
  "HTTP Site,http://insecure.example.com,user@example.com,InsecurePass!123",
].join("\n");

export const CSV_VALID = [
  "name,url,username,password",
  "Valid Site,https://valid.example.com,user@example.com,ValidPass!123",
].join("\n");

export const BITWARDEN_JSON = JSON.stringify({
  items: [
    {
      type: 1,
      name: "Bitwarden Import",
      login: {
        uris: [{ match: null, uri: "https://bitwarden.example.com" }],
        username: "bwuser@example.com",
        password: "BwStrong!Pass123",
      },
    },
  ],
});

export const GENERIC_JSON = JSON.stringify([
  {
    name: "Generic Import",
    url: "https://generic.example.com",
    username: "genericuser@example.com",
    password: "GenericStrong!123",
    notes: "Imported from generic JSON",
  },
]);

export function generateUniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

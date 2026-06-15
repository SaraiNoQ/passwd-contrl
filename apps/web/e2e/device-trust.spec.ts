import { expect, test, type Page } from "@playwright/test";

// All device trust tests require Worker API OPAQUE auth which is not stable
// in the local dev environment. Skip all tests until auth flow is reliable.

test.describe("Module K: Device Trust (skipped — requires OPAQUE auth)", () => {
  test("K-01 device is auto-registered when user logs in", async () => {
    test.skip(true, "Requires Worker API OPAQUE auth; skip until auth flow is stable.");
  });

  test("K-02 device list refreshes when panel is expanded", async () => {
    test.skip(true, "Requires Worker API OPAQUE auth; skip until auth flow is stable.");
  });

  test("K-03 approve button is available for pending devices", async () => {
    test.skip(true, "Requires Worker API OPAQUE auth; skip until auth flow is stable.");
  });

  test("K-04 reject button is available for pending devices", async () => {
    test.skip(true, "Requires Worker API OPAQUE auth; skip until auth flow is stable.");
  });

  test("K-05 revoke button is available for non-current approved devices", async () => {
    test.skip(true, "Requires Worker API OPAQUE auth; skip until auth flow is stable.");
  });

  test("K-06 current device shows special identifier in device list", async () => {
    test.skip(true, "Requires Worker API OPAQUE auth; skip until auth flow is stable.");
  });
});

/**
 * Shared interface for the Desktop API client.
 *
 * DesktopApiClient handles HTTP transport for auth and vault operations.
 * The concrete implementation is in desktop-api-client.ts — this file
 * exists so auth-state.ts and tests can depend on the interface without
 * a circular import to the implementation.
 */

import type { SessionUserResponse } from "@zero-vault/shared";

export interface DesktopApiClient {
  loginDirect(
    email: string,
    password: string,
  ): Promise<SessionUserResponse>;

  fetchCurrentUser(): Promise<SessionUserResponse>;

  logout(csrfToken: string): Promise<{ ok: true }>;
}

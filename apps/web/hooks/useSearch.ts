"use client";

import { useCallback } from "react";
import type { UnlockedVault, VaultCredential } from "../lib/local-vault";
import { generateQueryToken } from "../lib/search-tokens";
import { requestJson } from "../lib/crypto-utils";
import type { VaultSearchResponse } from "@zero-vault/shared";

/**
 * Hook for encrypted blind search against the server.
 *
 * Given an unlocked vault and a query string, the hook:
 * 1. Derives one or more HMAC search tokens from the query using the vault key.
 * 2. Sends the tokens to POST /vault/search.
 * 3. Returns the list of matching item IDs.
 *
 * The server learns which items match (linkability) but never sees the
 * plaintext query terms. The vault key never leaves the client.
 */
export function useSearch(vault: UnlockedVault | null) {
  const search = useCallback(
    async (query: string): Promise<string[]> => {
      if (!vault || !query.trim()) return [];

      // Split query into individual words and generate a token for each
      const rawTerms = query
        .split(/[\s\-_.,;:!?]+/)
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length >= 2);

      if (rawTerms.length === 0) return [];

      const tokens: string[] = [];
      for (const term of rawTerms) {
        const token = await generateQueryToken(vault, term);
        if (token) tokens.push(token);
      }

      if (tokens.length === 0) return [];

      const response = await requestJson<VaultSearchResponse>("/vault/search", {
        method: "POST",
        body: JSON.stringify({ tokens })
      });

      return response.itemIds;
    },
    [vault]
  );

  return { search };
}

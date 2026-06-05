import { describe, expect, it } from "vitest";
import { generateRecoveryCode, createRecoveryPacket, recoverVaultKey } from "./recovery";
import { randomBytes } from "./crypto-utils";

describe("recovery code", () => {
  it("generates a 256-bit base64url recovery code", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/u);
    // 32 bytes = 256 bits, base64url encoded
    expect(code.length).toBeGreaterThanOrEqual(40);
  });

  it("generates unique codes on each call", () => {
    const code1 = generateRecoveryCode();
    const code2 = generateRecoveryCode();
    expect(code1).not.toBe(code2);
  });

  it("creates a recovery packet and recovers the vault key", async () => {
    const code = generateRecoveryCode();
    const vaultKey = randomBytes(32);

    const packet = await createRecoveryPacket(code, vaultKey);
    expect(packet.alg).toBe("AES_256_GCM");
    expect(packet.nonce).toBeTruthy();
    expect(packet.ciphertext).toBeTruthy();
    expect(packet.kdfIterations).toBeGreaterThan(0);

    const recovered = await recoverVaultKey(code, packet);
    expect(recovered).toEqual(vaultKey);
  });

  it("rejects wrong recovery code", async () => {
    const code = generateRecoveryCode();
    const vaultKey = randomBytes(32);
    const packet = await createRecoveryPacket(code, vaultKey);

    const wrongCode = generateRecoveryCode();
    await expect(recoverVaultKey(wrongCode, packet)).rejects.toThrow();
  });

  it("rejects tampered ciphertext", async () => {
    const code = generateRecoveryCode();
    const vaultKey = randomBytes(32);
    const packet = await createRecoveryPacket(code, vaultKey);

    const tampered = { ...packet, ciphertext: `${packet.ciphertext.slice(1)}A` };
    await expect(recoverVaultKey(code, tampered)).rejects.toThrow();
  });
});

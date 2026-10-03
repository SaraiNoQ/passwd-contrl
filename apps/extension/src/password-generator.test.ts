import { expect, it, vi } from 'vitest';
import { generatePassword } from '@zero-vault/browser-vault/password-generator';
it('generates bounded passwords using only selected characters', () => {
  for (const length of [8, 20, 128]) expect(generatePassword({ length })).toHaveLength(length);
  expect(generatePassword({ includeUpper: false, includeLower: false, includeSymbols: false })).toMatch(/^\d{20}$/);
  expect(() => generatePassword({ length: 1 })).toThrow();
  expect(() => generatePassword({ includeUpper: false, includeLower: false, includeDigits: false, includeSymbols: false })).toThrow();
});
it('rejects biased bytes instead of applying modulo to every byte', () => {
  const random = vi.spyOn(crypto, 'getRandomValues').mockImplementation(array => { const bytes = array as Uint8Array; bytes.fill(255); bytes[0] = 9; return array; });
  try { expect(generatePassword({ length: 8, includeUpper: false, includeLower: false, includeSymbols: false })).toBe('99999999'); expect(random).toHaveBeenCalledTimes(8); }
  finally { random.mockRestore(); }
});

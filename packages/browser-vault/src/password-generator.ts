export type GeneratorOptions = { length: number; includeUpper: boolean; includeLower: boolean; includeDigits: boolean; includeSymbols: boolean; excludeSimilar: boolean; excludeAmbiguous: boolean };
export const DEFAULT_OPTIONS: GeneratorOptions = { length: 20, includeUpper: true, includeLower: true, includeDigits: true, includeSymbols: true, excludeSimilar: false, excludeAmbiguous: false };
export function buildCharset(opts: GeneratorOptions): string {
  let chars = (opts.includeUpper ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : '') + (opts.includeLower ? 'abcdefghijklmnopqrstuvwxyz' : '') + (opts.includeDigits ? '0123456789' : '') + (opts.includeSymbols ? '!@#$%^&*' : '');
  if (opts.excludeSimilar) chars = [...chars].filter(c => !'il1Lo0OI'.includes(c)).join('');
  if (opts.excludeAmbiguous) chars = [...chars].filter(c => !'{ }[ ]()/\\\'"`,;.<>~'.includes(c)).join('');
  return chars;
}
export function generatePassword(options: Partial<GeneratorOptions> = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const chars = buildCharset(opts);
  if (!Number.isInteger(opts.length) || opts.length < 8 || opts.length > 128 || !chars.length) throw new Error('invalid_generator_options');
  // Rejection sampling avoids modulo bias for character sets below 256 entries.
  const limit = 256 - (256 % chars.length);
  let result = '';
  const bytes = new Uint8Array(128);
  while (result.length < opts.length) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) if (byte < limit && result.length < opts.length) result += chars[byte % chars.length];
  }
  return result;
}

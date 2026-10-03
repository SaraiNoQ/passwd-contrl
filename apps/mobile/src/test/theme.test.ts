import { describe, expect, it } from "vitest";
import { isThemePreference } from "../theme/preference";
import { darkColors, lightColors } from "../theme/tokens";

function relativeLuminance(hex: string): number {
  const channels = hex
    .replace(/^#/u, "")
    .match(/.{2}/gu)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);
  if (!channels || channels.length !== 3) {
    throw new Error(`Expected a six-digit hex color, received ${hex}`);
  }
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("theme preference", () => {
  it("accepts only supported persisted values", () => {
    expect(["light", "dark", "system"].every(isThemePreference)).toBe(true);
    expect(["", "auto", null, 1].some(isThemePreference)).toBe(false);
  });

  it("provides complete, distinct palettes for runtime switching", () => {
    expect(Object.keys(darkColors)).toEqual(Object.keys(lightColors));
    expect(lightColors.bgRoot).toBe("#F3F7F4");
    expect(lightColors.primary).toBe("#087F7A");
    expect(darkColors.bgRoot).toBe("#06111C");
    expect(darkColors.primary).toBe("#22CDBD");
    expect(darkColors.textPrimary).not.toBe(lightColors.textPrimary);
    expect(darkColors.grid).not.toBe(lightColors.grid);
  });

  it.each([
    ["light primary button", lightColors.primary, lightColors.primaryContrast],
    ["dark primary button", darkColors.primary, darkColors.primaryContrast],
    ["light danger button", lightColors.danger, lightColors.dangerContrast],
    ["dark danger button", darkColors.danger, darkColors.dangerContrast],
    ["light panel text", lightColors.bgPanel, lightColors.textPrimary],
    ["dark panel text", darkColors.bgPanel, darkColors.textPrimary],
  ])("%s meets WCAG AA normal-text contrast", (_name, background, foreground) => {
    expect(contrastRatio(background, foreground)).toBeGreaterThanOrEqual(4.5);
  });
});

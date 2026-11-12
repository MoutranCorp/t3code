import { describe, expect, it } from "vite-plus/test";

import {
  generatedProjectIconComposition,
  generatedProjectIconSvg,
} from "./generatedProjectIcon.ts";

const names = Array.from({ length: 200 }, (_, index) => `project-${index}`);

describe("generatedProjectIconSvg", () => {
  it("draws the same glyph for the same name, ignoring case and spacing", () => {
    expect(generatedProjectIconSvg("  T3 Code ")).toBe(generatedProjectIconSvg("t3 code"));
  });

  it("gives different names visibly different glyphs", () => {
    const glyphs = new Set(names.map(generatedProjectIconSvg));
    expect(glyphs.size).toBeGreaterThan(names.length * 0.85);
    const firstShapes = new Set(
      names.map((name) => /<svg[^>]*>(<\w+)/.exec(generatedProjectIconSvg(name))?.[1]),
    );
    expect(firstShapes.size).toBeGreaterThanOrEqual(5);
  });

  it("spreads short, similar names across the compositions", () => {
    const shortNames = (
      "alpha beta gamma delta api app web docs test site blog cli core ui server client " +
      "mobile admin auth db data lab demo tools infra shop chat notes game bot ml sdk kit " +
      "proto home pay mail search sync"
    ).split(" ");
    const counts = new Map<number, number>();
    for (const name of shortNames) {
      const composition = generatedProjectIconComposition(name);
      counts.set(composition, (counts.get(composition) ?? 0) + 1);
    }
    expect(counts.size).toBeGreaterThanOrEqual(9);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(Math.ceil(shortNames.length * 0.2));
    expect(generatedProjectIconSvg("alpha")).not.toBe(generatedProjectIconSvg("beta"));
  });

  it("only emits finite coordinates", () => {
    for (const name of [...names, "", "🦄", "a".repeat(500)]) {
      expect(generatedProjectIconSvg(name)).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});

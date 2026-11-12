import { describe, expect, it } from "vite-plus/test";

import { generatedProjectIconSvg } from "./generatedProjectIcon.ts";

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

  it("only emits finite coordinates", () => {
    for (const name of [...names, "", "🦄", "a".repeat(500)]) {
      expect(generatedProjectIconSvg(name)).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});

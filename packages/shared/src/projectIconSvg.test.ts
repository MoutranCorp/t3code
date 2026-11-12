import { describe, expect, it } from "vite-plus/test";

import { generatedProjectIconSvg } from "./generatedProjectIcon.ts";
import { sanitizeProjectIconSvg } from "./projectIconSvg.ts";

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">';

describe("sanitizeProjectIconSvg", () => {
  it("keeps whitelisted shapes and attributes in a 64×64 viewBox", () => {
    expect(
      sanitizeProjectIconSvg(
        `<?xml version="1.0"?><!-- logo --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512">
          <title>Logo</title>
          <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#fff"/><stop offset="1" stop-color="#ffffff" stop-opacity=".6"/></linearGradient></defs>
          <circle cx="32" cy="32" r="12" fill="url(#g1)"/>
          <path d="M10 10 L54 54" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
        </svg>`,
      ),
    ).toBe(
      `${SVG_OPEN}<defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#fff"/><stop offset="1" stop-color="#ffffff" stop-opacity=".6"/></linearGradient></defs><circle cx="32" cy="32" r="12" fill="url(#g1)"/><path d="M10 10 L54 54" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>`,
    );
  });

  it("drops scripts, handlers, styles, external references and foreign content", () => {
    const sanitized = sanitizeProjectIconSvg(
      `<svg viewBox="0 0 64 64" onload="alert(1)">
        <script>alert(1)</script>
        <style>circle { fill: url(https://evil.test/x) }</style>
        <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>
        <image href="https://evil.test/x.png"/>
        <use href="#a"/>
        <a href="javascript:alert(1)"><rect width="10" height="10"/></a>
        <g onclick="alert(1)" style="fill: url(https://evil.test)" class="x">
          <circle id="a" cx="32" cy="32" r="8" fill="url(https://evil.test/#x)" stroke="javascript:alert(1)" xlink:href="#b" href="#c"/>
        </g>
        <linearGradient id="b" href="https://evil.test/g"><stop stop-color="url(#b)"/></linearGradient>
        <rect x="1" y="1" width="2" height="2" transform="rotate(4) url(x)"/>
      </svg>`,
    );
    expect(sanitized).toBe(
      `${SVG_OPEN}<g><circle cx="32" cy="32" r="8"/></g><linearGradient id="b"><stop/></linearGradient><rect x="1" y="1" width="2" height="2"/></svg>`,
    );
  });

  it("scales another viewBox into 64×64 and keeps root paint on a wrapper", () => {
    expect(
      sanitizeProjectIconSvg(
        '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="6"/></svg>',
      ),
    ).toBe(
      `${SVG_OPEN}<g fill="none" stroke="white" stroke-width="2" transform="matrix(2.667 0 0 2.667 0 0)"><circle cx="12" cy="12" r="6"/></g></svg>`,
    );
    expect(
      sanitizeProjectIconSvg('<svg width="32" height="16"><rect width="32" height="16"/></svg>'),
    ).toBe(
      `${SVG_OPEN}<g transform="matrix(2 0 0 2 0 16)"><rect width="32" height="16"/></g></svg>`,
    );
  });

  it("decodes entities before checking a value and escapes on output", () => {
    expect(
      sanitizeProjectIconSvg(
        '<svg viewBox="0 0 64 64"><circle r="&#49;0" fill="&#x23;fff"/><rect width="5" fill="&quot;&gt;&lt;script"/></svg>',
      ),
    ).toBe(`${SVG_OPEN}<circle r="10" fill="#fff"/><rect width="5"/></svg>`);
  });

  it.each([
    ["no root svg", '<g><circle r="4"/></g>'],
    ["an empty drawing", '<svg viewBox="0 0 64 64"><title>x</title></svg>'],
    ["a doctype", '<!DOCTYPE svg [<!ENTITY x "y">]><svg><circle r="4"/></svg>'],
    ["mismatched tags", '<svg><g><circle r="4"></g></circle></svg>'],
    ["an unclosed root", '<svg><circle r="4"/>'],
    ["content after the root", '<svg><circle r="4"/></svg><svg><circle r="4"/></svg>'],
    ["unquoted attributes", "<svg><circle r=4/></svg>"],
    ["a degenerate viewBox", '<svg viewBox="0 0 0 64"><circle r="4"/></svg>'],
    ["too many elements", `<svg>${'<circle r="1"/>'.repeat(201)}</svg>`],
  ])("rejects %s", (_, source) => {
    expect(sanitizeProjectIconSvg(source)).toBeNull();
  });

  it("caps the output size", () => {
    const path = `<path d="M0 0 ${"L1 1 ".repeat(700)}"/>`;
    expect(sanitizeProjectIconSvg(`<svg>${path}</svg>`)).not.toBeNull();
    expect(sanitizeProjectIconSvg(`<svg>${path.repeat(3)}</svg>`)).toBeNull();
  });

  it("leaves every generated glyph unchanged", () => {
    for (let index = 0; index < 300; index++) {
      const svg = generatedProjectIconSvg(`project-${index}`);
      expect(sanitizeProjectIconSvg(svg)).toBe(svg);
    }
  });
});

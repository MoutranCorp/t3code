import { PROJECT_ICON_SVG_MAX_LENGTH } from "@t3tools/contracts";

/**
 * Rebuilds an untrusted SVG drawing from a whitelist of shapes and plain
 * attribute values, scaled into a 64×64 viewBox. Anything else is dropped;
 * input that cannot be parsed safely yields null. Output is our own
 * serialization, never a pass-through of the source text.
 */

const MAX_INPUT_LENGTH = 64 * 1024;
const MAX_ELEMENTS = 200;
const MAX_DEPTH = 12;
const MAX_ATTRIBUTE_LENGTH = 4000;

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px|%)?$/i;
const NUMBER_LIST = /^[\d\s,.eE+-]*$/;
const PATH_DATA = /^[MmZzLlHhVvCcSsQqTtAa\d\s,.eE+-]*$/;
const TRANSFORM =
  /^\s*(?:(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([\d\s,.eE+-]*\)[\s,]*)+$/;
const ID = /^[A-Za-z][\w-]{0,63}$/;
const COLOR =
  /^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|[a-z]{3,24}|(?:rgba?|hsla?)\(\s*[\d.,%\s/+-]*\))$/i;
const PAINT_REFERENCE = /^url\(\s*#([A-Za-z][\w-]{0,63})\s*\)$/;

type Rule = (value: string) => boolean;

const keyword =
  (...values: string[]): Rule =>
  (value) =>
    values.includes(value);
const number: Rule = (value) => NUMBER.test(value);
const color: Rule = (value) => COLOR.test(value);
const paint: Rule = (value) => COLOR.test(value) || PAINT_REFERENCE.test(value);

const PRESENTATION: Record<string, Rule> = {
  fill: paint,
  stroke: paint,
  "stroke-width": number,
  "stroke-linecap": keyword("butt", "round", "square"),
  "stroke-linejoin": keyword("miter", "round", "bevel", "arcs", "miter-clip"),
  "stroke-miterlimit": number,
  "stroke-dasharray": (value) => value === "none" || NUMBER_LIST.test(value),
  "stroke-dashoffset": number,
  "stroke-opacity": number,
  "fill-opacity": number,
  "fill-rule": keyword("nonzero", "evenodd"),
  opacity: number,
  transform: (value) => TRANSFORM.test(value),
};

const GRADIENT: Record<string, Rule> = {
  id: (value) => ID.test(value),
  gradientUnits: keyword("userSpaceOnUse", "objectBoundingBox"),
  gradientTransform: (value) => TRANSFORM.test(value),
  spreadMethod: keyword("pad", "reflect", "repeat"),
};

const ELEMENTS: Record<string, Record<string, Rule>> = {
  g: PRESENTATION,
  defs: {},
  path: { ...PRESENTATION, d: (value) => PATH_DATA.test(value) },
  circle: { ...PRESENTATION, cx: number, cy: number, r: number },
  ellipse: { ...PRESENTATION, cx: number, cy: number, rx: number, ry: number },
  rect: {
    ...PRESENTATION,
    x: number,
    y: number,
    width: number,
    height: number,
    rx: number,
    ry: number,
  },
  line: { ...PRESENTATION, x1: number, y1: number, x2: number, y2: number },
  polyline: { ...PRESENTATION, points: (value) => NUMBER_LIST.test(value) },
  polygon: { ...PRESENTATION, points: (value) => NUMBER_LIST.test(value) },
  linearGradient: { ...GRADIENT, x1: number, y1: number, x2: number, y2: number },
  radialGradient: { ...GRADIENT, cx: number, cy: number, r: number, fx: number, fy: number },
  stop: { offset: number, "stop-color": color, "stop-opacity": number },
};

const CONTAINERS = new Set(["g", "defs"]);
const GRADIENTS = new Set(["linearGradient", "radialGradient"]);

interface SvgNode {
  readonly name: string;
  readonly attributes: ReadonlyArray<readonly [string, string]>;
  readonly children: SvgNode[];
}

const TOKEN =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/([A-Za-z][\w:.-]*)\s*>|<([A-Za-z][\w:.-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|[^<]+/y;
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;

function decodeEntities(value: string): string | null {
  let failed = false;
  const decoded = value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (_, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#")) {
      const code = lower.startsWith("#x")
        ? Number.parseInt(lower.slice(2), 16)
        : Number.parseInt(lower.slice(1), 10);
      if (code > 0 && code < 0x10ffff) return String.fromCodePoint(code);
    }
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (named[lower] !== undefined) return named[lower];
    failed = true;
    return "";
  });
  return failed ? null : decoded;
}

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE)) {
    const value = decodeEntities(match[2] ?? match[3] ?? "");
    if (value !== null && value.length <= MAX_ATTRIBUTE_LENGTH) {
      attributes.set(match[1]!, value.trim());
    }
  }
  return attributes;
}

function allowedAttributes(name: string, attributes: Map<string, string>) {
  const rules = ELEMENTS[name] ?? {};
  return [...attributes].filter(([key, value]) => Object.hasOwn(rules, key) && rules[key]!(value));
}

/** Whether a parent keeps a child; a refused child is dropped with its subtree. */
function acceptsChild(parent: string, child: string): boolean {
  if (child === "stop") return GRADIENTS.has(parent);
  if (GRADIENTS.has(parent)) return false;
  return parent === "svg" || CONTAINERS.has(parent);
}

function parse(source: string): { root: SvgNode; rootAttributes: Map<string, string> } | null {
  let root: SvgNode | null = null;
  let rootAttributes = new Map<string, string>();
  let closed = false;
  // A null entry is a dropped subtree: it is still tracked to match its end tag.
  const stack: Array<SvgNode | null> = [];
  let elements = 0;
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.length) {
    const match = TOKEN.exec(source);
    if (match === null) return null;
    const [, endName, startName, attributeSource, selfClosing] = match;
    if (endName !== undefined) {
      if (stack.length === 0) return null;
      const open = stack.pop()!;
      if (open !== null && open.name !== endName) return null;
      if (stack.length === 0) closed = true;
      continue;
    }
    if (startName === undefined) continue;
    if (closed || stack.length >= MAX_DEPTH || ++elements > MAX_ELEMENTS) return null;
    const attributes = parseAttributes(attributeSource ?? "");
    let node: SvgNode | null = null;
    if (root === null) {
      if (startName !== "svg") return null;
      root = { name: "svg", attributes: [], children: [] };
      rootAttributes = attributes;
      node = root;
    } else {
      const parent = stack.at(-1);
      if (parent && Object.hasOwn(ELEMENTS, startName) && acceptsChild(parent.name, startName)) {
        node = {
          name: startName,
          attributes: allowedAttributes(startName, attributes),
          children: [],
        };
        parent.children.push(node);
      }
    }
    if (selfClosing !== "/") stack.push(node);
    else if (node === root) closed = true;
  }
  return root !== null && closed && stack.length === 0 ? { root, rootAttributes } : null;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function serialize(node: SvgNode): string {
  const attributes = node.attributes
    .map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`)
    .join("");
  return node.children.length === 0
    ? `<${node.name}${attributes}/>`
    : `<${node.name}${attributes}>${node.children.map(serialize).join("")}</${node.name}>`;
}

function parseLength(value: string | undefined): number | null {
  if (value === undefined || !/^\d+(?:\.\d+)?(?:px)?$/.test(value)) return null;
  const length = Number.parseFloat(value);
  return length > 0 ? length : null;
}

/** The source's coordinate box, from viewBox, else width and height, else 64×64. */
function sourceBox(attributes: Map<string, string>): readonly number[] | null {
  const viewBox = attributes.get("viewBox");
  if (viewBox !== undefined) {
    const parts = viewBox
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
    return parts[2]! > 0 && parts[3]! > 0 ? parts : null;
  }
  const width = parseLength(attributes.get("width"));
  const height = parseLength(attributes.get("height"));
  return width !== null && height !== null ? [0, 0, width, height] : [0, 0, 64, 64];
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export function sanitizeProjectIconSvg(source: string): string | null {
  if (source.length > MAX_INPUT_LENGTH) return null;
  const parsed = parse(source.trim());
  if (parsed === null) return null;
  const box = sourceBox(parsed.rootAttributes);
  if (box === null) return null;
  const [minX, minY, width, height] = box as [number, number, number, number];
  const children = parsed.root.children;
  if (children.length === 0) return null;

  const scale = Math.min(64 / width, 64 / height);
  const dx = (64 - width * scale) / 2 - minX * scale;
  const dy = (64 - height * scale) / 2 - minY * scale;
  const identity = scale === 1 && dx === 0 && dy === 0;
  const presentation = allowedAttributes("g", parsed.rootAttributes).filter(
    ([key]) => key !== "transform",
  );
  const wrapper: SvgNode = {
    name: "g",
    attributes: [
      ...presentation,
      ...(identity
        ? []
        : [
            [
              "transform",
              `matrix(${round(scale)} 0 0 ${round(scale)} ${round(dx)} ${round(dy)})`,
            ] as const,
          ]),
    ],
    children,
  };
  const body =
    wrapper.attributes.length === 0 ? children.map(serialize).join("") : serialize(wrapper);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`;
  return svg.length <= PROJECT_ICON_SVG_MAX_LENGTH ? svg : null;
}

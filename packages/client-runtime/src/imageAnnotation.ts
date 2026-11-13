export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export type AnnotationTool = "pen" | "arrow" | "rect" | "text";
export type AnnotationSize = "small" | "medium" | "large";

export const ANNOTATION_COLORS = [
  { name: "Red", value: "#ff3b30" },
  { name: "Yellow", value: "#ffcc00" },
  { name: "Green", value: "#34c759" },
  { name: "Blue", value: "#0a84ff" },
  { name: "Black", value: "#000000" },
  { name: "White", value: "#ffffff" },
] as const;

export const ANNOTATION_SIZES: ReadonlyArray<{
  readonly value: AnnotationSize;
  readonly name: string;
}> = [
  { value: "small", name: "Thin" },
  { value: "medium", name: "Medium" },
  { value: "large", name: "Thick" },
];

export type AnnotationOp =
  | {
      readonly kind: "pen";
      readonly id: string;
      readonly color: string;
      readonly width: number;
      readonly points: ReadonlyArray<Point>;
    }
  | {
      readonly kind: "arrow" | "rect";
      readonly id: string;
      readonly color: string;
      readonly width: number;
      readonly from: Point;
      readonly to: Point;
    }
  | TextAnnotation;

export interface TextAnnotation {
  readonly kind: "text";
  readonly id: string;
  readonly color: string;
  readonly fontSize: number;
  /** Top-left corner of the text box. */
  readonly at: Point;
  readonly text: string;
  /** Measured once at commit, so hit-testing stays pure. */
  readonly textWidth: number;
}

export const ANNOTATION_TEXT_LINE_HEIGHT = 1.2;

/** A contrasting outline that keeps text legible on both light and dark screenshots. */
export function annotationHaloColor(color: string): string {
  const value = Number.parseInt(color.slice(1), 16);
  const luminance =
    (0.299 * ((value >> 16) & 0xff) + 0.587 * ((value >> 8) & 0xff) + 0.114 * (value & 0xff)) / 255;
  return luminance > 0.6 ? "rgba(0,0,0,0.8)" : "rgba(255,255,255,0.9)";
}

// Sizes scale with the image so a mark reads the same on screen at any resolution.
const STROKE_WIDTH: Record<AnnotationSize, { ratio: number; min: number }> = {
  small: { ratio: 0.003, min: 2 },
  medium: { ratio: 0.006, min: 4 },
  large: { ratio: 0.012, min: 8 },
};
const FONT_SIZE: Record<AnnotationSize, { ratio: number; min: number }> = {
  small: { ratio: 0.02, min: 14 },
  medium: { ratio: 0.032, min: 20 },
  large: { ratio: 0.05, min: 28 },
};

export function annotationStrokeWidth(size: AnnotationSize, natural: Size): number {
  const { ratio, min } = STROKE_WIDTH[size];
  return Math.max(min, Math.round(Math.max(natural.width, natural.height) * ratio));
}

export function annotationFontSize(size: AnnotationSize, natural: Size): number {
  const { ratio, min } = FONT_SIZE[size];
  return Math.max(min, Math.round(Math.max(natural.width, natural.height) * ratio));
}

/** Maps a client-space pointer position onto the image's natural pixel grid. */
export function toImagePoint(
  client: Point,
  bounds: { readonly left: number; readonly top: number } & Size,
  natural: Size,
): Point {
  return {
    x: ((client.x - bounds.left) * natural.width) / (bounds.width || 1),
    y: ((client.y - bounds.top) * natural.height) / (bounds.height || 1),
  };
}

export interface ArrowGeometry {
  /** The shaft stops at the head's base so a thick line never pokes past the tip. */
  readonly shaftEnd: Point;
  readonly tip: Point;
  readonly left: Point;
  readonly right: Point;
}

export function arrowGeometry(from: Point, to: Point, width: number): ArrowGeometry | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const headLength = Math.min(length, Math.max(width * 4, 12));
  const halfWidth = headLength * 0.55;
  const ux = dx / length;
  const uy = dy / length;
  const base = { x: to.x - ux * headLength, y: to.y - uy * headLength };
  return {
    shaftEnd: base,
    tip: to,
    left: { x: base.x - uy * halfWidth, y: base.y + ux * halfWidth },
    right: { x: base.x + uy * halfWidth, y: base.y - ux * halfWidth },
  };
}

export function normalizedRect(from: Point, to: Point) {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/** A click without a drag should not leave a dot-sized arrow or rectangle behind. */
export function isNegligibleShape(from: Point, to: Point, minimumLength: number): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) < minimumLength;
}

/** Topmost text whose box (grown by `slop`) contains the point. */
export function hitTestText(
  ops: ReadonlyArray<AnnotationOp>,
  point: Point,
  slop: number,
): TextAnnotation | null {
  for (let index = ops.length - 1; index >= 0; index--) {
    const op = ops[index]!;
    if (op.kind !== "text") continue;
    const height = op.fontSize * ANNOTATION_TEXT_LINE_HEIGHT;
    if (
      point.x >= op.at.x - slop &&
      point.x <= op.at.x + op.textWidth + slop &&
      point.y >= op.at.y - slop &&
      point.y <= op.at.y + height + slop
    ) {
      return op;
    }
  }
  return null;
}

export interface AnnotationHistory {
  readonly past: ReadonlyArray<ReadonlyArray<AnnotationOp>>;
  readonly present: ReadonlyArray<AnnotationOp>;
  readonly future: ReadonlyArray<ReadonlyArray<AnnotationOp>>;
}

export const EMPTY_ANNOTATION_HISTORY: AnnotationHistory = { past: [], present: [], future: [] };

function commit(history: AnnotationHistory, present: ReadonlyArray<AnnotationOp>) {
  return { past: [...history.past, history.present], present, future: [] };
}

export function addAnnotation(history: AnnotationHistory, op: AnnotationOp): AnnotationHistory {
  return commit(history, [...history.present, op]);
}

/** Replaces the op with the same id in place, keeping its stacking order. */
export function replaceAnnotation(history: AnnotationHistory, op: AnnotationOp): AnnotationHistory {
  if (!history.present.some((entry) => entry.id === op.id)) return history;
  return commit(
    history,
    history.present.map((entry) => (entry.id === op.id ? op : entry)),
  );
}

export function removeAnnotation(history: AnnotationHistory, id: string): AnnotationHistory {
  if (!history.present.some((entry) => entry.id === id)) return history;
  return commit(
    history,
    history.present.filter((entry) => entry.id !== id),
  );
}

export function clearAnnotations(history: AnnotationHistory): AnnotationHistory {
  return history.present.length === 0 ? history : commit(history, []);
}

export function undoAnnotation(history: AnnotationHistory): AnnotationHistory {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoAnnotation(history: AnnotationHistory): AnnotationHistory {
  const [next, ...future] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future };
}

export interface AnnotatedImageOutput {
  readonly mimeType: "image/png" | "image/jpeg";
  readonly name: string;
  readonly quality?: number;
}

/** PNG and JPEG keep their format; anything else (WebP, a GIF's first frame) becomes PNG. */
export function annotatedImageOutput(mimeType: string, name: string): AnnotatedImageOutput {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/jpg") {
    return { mimeType: "image/jpeg", name, quality: 0.92 };
  }
  if (normalized === "image/png") return { mimeType: "image/png", name };
  const dotIndex = name.lastIndexOf(".");
  return {
    mimeType: "image/png",
    name: `${dotIndex > 0 ? name.slice(0, dotIndex) : name || "image"}.png`,
  };
}

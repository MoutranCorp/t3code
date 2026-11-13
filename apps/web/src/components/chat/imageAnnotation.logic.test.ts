import { describe, expect, it } from "vite-plus/test";

import {
  addAnnotation,
  annotatedImageOutput,
  annotationFontSize,
  annotationStrokeWidth,
  type AnnotationOp,
  arrowGeometry,
  clearAnnotations,
  EMPTY_ANNOTATION_HISTORY,
  hitTestText,
  redoAnnotation,
  removeAnnotation,
  replaceAnnotation,
  type TextAnnotation,
  toImagePoint,
  undoAnnotation,
} from "./imageAnnotation.logic";

function rect(id: string): AnnotationOp {
  return { kind: "rect", id, color: "#ff3b30", width: 4, from: { x: 0, y: 0 }, to: { x: 9, y: 9 } };
}

function text(id: string, at: { x: number; y: number }, textWidth = 50): TextAnnotation {
  return { kind: "text", id, color: "#ff3b30", fontSize: 20, at, text: id, textWidth };
}

const ids = (ops: ReadonlyArray<AnnotationOp>) => ops.map((op) => op.id);

describe("annotation history", () => {
  it("undoes and redoes commits, and a new commit drops the redo branch", () => {
    let history = addAnnotation(EMPTY_ANNOTATION_HISTORY, rect("a"));
    history = addAnnotation(history, rect("b"));
    history = undoAnnotation(history);
    expect(ids(history.present)).toEqual(["a"]);
    history = redoAnnotation(history);
    expect(ids(history.present)).toEqual(["a", "b"]);
    history = undoAnnotation(undoAnnotation(history));
    expect(ids(history.present)).toEqual([]);
    expect(undoAnnotation(history)).toBe(history);
    history = addAnnotation(redoAnnotation(history), rect("c"));
    expect(ids(history.present)).toEqual(["a", "c"]);
    expect(redoAnnotation(history)).toBe(history);
  });

  it("makes clear undoable and ignores clearing nothing", () => {
    const drawn = addAnnotation(EMPTY_ANNOTATION_HISTORY, rect("a"));
    const cleared = clearAnnotations(drawn);
    expect(cleared.present).toEqual([]);
    expect(ids(undoAnnotation(cleared).present)).toEqual(["a"]);
    expect(clearAnnotations(EMPTY_ANNOTATION_HISTORY)).toBe(EMPTY_ANNOTATION_HISTORY);
  });

  it("replaces a moved text in its stacking slot, and removes by id", () => {
    let history = addAnnotation(EMPTY_ANNOTATION_HISTORY, text("t", { x: 0, y: 0 }));
    history = addAnnotation(history, rect("r"));
    const moved = text("t", { x: 40, y: 40 });
    history = replaceAnnotation(history, moved);
    expect(history.present).toEqual([moved, rect("r")]);
    expect(replaceAnnotation(history, text("missing", { x: 0, y: 0 }))).toBe(history);
    history = removeAnnotation(history, "t");
    expect(ids(history.present)).toEqual(["r"]);
    expect(ids(undoAnnotation(history).present)).toEqual(["t", "r"]);
  });
});

describe("toImagePoint", () => {
  it("maps displayed pixels onto the natural image grid", () => {
    const bounds = { left: 100, top: 50, width: 400, height: 300 };
    const natural = { width: 1600, height: 1200 };
    expect(toImagePoint({ x: 100, y: 50 }, bounds, natural)).toEqual({ x: 0, y: 0 });
    expect(toImagePoint({ x: 300, y: 200 }, bounds, natural)).toEqual({ x: 800, y: 600 });
    expect(toImagePoint({ x: 500, y: 350 }, bounds, natural)).toEqual({ x: 1600, y: 1200 });
  });
});

describe("annotation sizes", () => {
  it("scales with the image's long edge but never below a legible minimum", () => {
    expect(annotationStrokeWidth("medium", { width: 2000, height: 1000 })).toBe(12);
    expect(annotationStrokeWidth("medium", { width: 200, height: 100 })).toBe(4);
    expect(annotationFontSize("large", { width: 1000, height: 2000 })).toBe(100);
    expect(annotationFontSize("small", { width: 100, height: 100 })).toBe(14);
  });
});

describe("arrowGeometry", () => {
  it("puts a symmetric head at the tip and ends the shaft at its base", () => {
    const geometry = arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 5);
    expect(geometry?.tip).toEqual({ x: 100, y: 0 });
    expect(geometry?.shaftEnd).toEqual({ x: 80, y: 0 });
    expect(geometry?.left.x).toBeCloseTo(80);
    expect(geometry?.left.y).toBeCloseTo(11);
    expect(geometry?.right.y).toBeCloseTo(-11);
  });

  it("never makes the head longer than the arrow, and skips zero-length arrows", () => {
    expect(arrowGeometry({ x: 0, y: 0 }, { x: 0, y: 6 }, 10)?.shaftEnd).toEqual({ x: 0, y: 0 });
    expect(arrowGeometry({ x: 5, y: 5 }, { x: 5, y: 5 }, 4)).toBeNull();
  });
});

describe("hitTestText", () => {
  it("returns the topmost text under the point within the slop", () => {
    const below = text("below", { x: 0, y: 0 }, 100);
    const above = text("above", { x: 50, y: 0 }, 100);
    const ops = [below, rect("r"), above];
    expect(hitTestText(ops, { x: 60, y: 10 }, 0)).toBe(above);
    expect(hitTestText(ops, { x: 10, y: 10 }, 0)).toBe(below);
    expect(hitTestText(ops, { x: 10, y: 27 }, 0)).toBeNull();
    expect(hitTestText(ops, { x: 10, y: 27 }, 4)).toBe(below);
  });
});

describe("annotatedImageOutput", () => {
  it.each([
    ["image/png", "shot.png", { mimeType: "image/png", name: "shot.png" }],
    ["image/jpeg", "photo.jpg", { mimeType: "image/jpeg", name: "photo.jpg", quality: 0.92 }],
    ["image/webp", "clip.webp", { mimeType: "image/png", name: "clip.png" }],
    ["image/gif", "anim.gif", { mimeType: "image/png", name: "anim.png" }],
    ["image/webp", "noextension", { mimeType: "image/png", name: "noextension.png" }],
  ])("encodes %s %s as %o", (mimeType, name, expected) => {
    expect(annotatedImageOutput(mimeType, name)).toEqual(expected);
  });
});

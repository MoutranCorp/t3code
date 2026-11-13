import {
  annotationHaloColor,
  arrowGeometry,
  normalizedRect,
  type AnnotatedImageOutput,
  type AnnotationOp,
  type Point,
  type Size,
} from "@t3tools/client-runtime/image-annotation";

type Context2D = CanvasRenderingContext2D;

function annotationFont(fontSize: number): string {
  return `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
}

/** Draws one op in natural image pixels; the caller sets the transform. */
export function drawAnnotation(context: Context2D, op: AnnotationOp): void {
  context.save();
  context.strokeStyle = op.color;
  context.fillStyle = op.color;
  context.lineCap = "round";
  context.lineJoin = "round";
  switch (op.kind) {
    case "pen": {
      context.lineWidth = op.width;
      const [first, ...rest] = op.points;
      if (!first) break;
      if (rest.length === 0) {
        context.beginPath();
        context.arc(first.x, first.y, op.width / 2, 0, Math.PI * 2);
        context.fill();
        break;
      }
      context.beginPath();
      context.moveTo(first.x, first.y);
      for (const point of rest) context.lineTo(point.x, point.y);
      context.stroke();
      break;
    }
    case "rect": {
      context.lineWidth = op.width;
      const rect = normalizedRect(op.from, op.to);
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      break;
    }
    case "arrow": {
      const geometry = arrowGeometry(op.from, op.to, op.width);
      if (!geometry) break;
      context.lineWidth = op.width;
      context.beginPath();
      context.moveTo(op.from.x, op.from.y);
      context.lineTo(geometry.shaftEnd.x, geometry.shaftEnd.y);
      context.stroke();
      context.beginPath();
      context.moveTo(geometry.tip.x, geometry.tip.y);
      context.lineTo(geometry.left.x, geometry.left.y);
      context.lineTo(geometry.right.x, geometry.right.y);
      context.closePath();
      context.fill();
      break;
    }
    case "text": {
      context.font = annotationFont(op.fontSize);
      context.textBaseline = "top";
      // A halo keeps the text legible on both light and dark screenshots.
      context.lineWidth = Math.max(2, op.fontSize * 0.16);
      context.strokeStyle = annotationHaloColor(op.color);
      context.strokeText(op.text, op.at.x, op.at.y);
      context.fillText(op.text, op.at.x, op.at.y);
      break;
    }
  }
  context.restore();
}

/** Extends an in-progress pen stroke by one segment without repainting the rest. */
export function drawPenSegment(
  context: Context2D,
  from: Point,
  to: Point,
  color: string,
  width: number,
): void {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  context.restore();
}

/** Sizes the backing store for crisp lines and returns a context scaled to natural pixels. */
export function prepareOverlay(
  canvas: HTMLCanvasElement,
  display: Size,
  natural: Size,
): Context2D | null {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(display.width * ratio));
  const height = Math.max(1, Math.round(display.height * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.setTransform(width / natural.width, 0, 0, height / natural.height, 0, 0);
  return context;
}

let measureContext: Context2D | null | undefined;

export function measureAnnotationText(text: string, fontSize: number): number {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return text.length * fontSize * 0.6;
  measureContext.font = annotationFont(fontSize);
  return measureContext.measureText(text).width;
}

/** Composites the ops onto the original bytes at full resolution. */
export async function renderAnnotatedImage(
  file: File,
  natural: Size,
  ops: ReadonlyArray<AnnotationOp>,
  output: AnnotatedImageOutput,
): Promise<File> {
  // Matches the <img> the marks were drawn over, which applies EXIF orientation.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");
    if (output.mimeType === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(bitmap, 0, 0);
    context.scale(bitmap.width / natural.width, bitmap.height / natural.height);
    for (const op of ops) drawAnnotation(context, op);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, output.mimeType, output.quality),
    );
    if (!blob) throw new Error("The image could not be encoded.");
    return new File([blob], output.name, { type: blob.type || output.mimeType });
  } finally {
    bitmap.close();
    // Release the full-size backing store now rather than at garbage collection.
    canvas.width = 0;
    canvas.height = 0;
  }
}

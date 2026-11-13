import {
  MoveUpRightIcon,
  PenLineIcon,
  Redo2Icon,
  SquareIcon,
  Trash2Icon,
  TypeIcon,
  Undo2Icon,
} from "lucide-react";
import {
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { observeResize } from "~/lib/observeResize";
import { isMacPlatform, randomUUID } from "~/lib/utils";
import { Button } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ExpandedImageAnnotation, ExpandedImageItem } from "./ExpandedImagePreview";
import {
  addAnnotation,
  ANNOTATION_COLORS,
  ANNOTATION_SIZES,
  ANNOTATION_TEXT_LINE_HEIGHT,
  type AnnotationHistory,
  type AnnotationOp,
  type AnnotationSize,
  type AnnotationTool,
  annotatedImageOutput,
  annotationFontSize,
  annotationStrokeWidth,
  clearAnnotations,
  EMPTY_ANNOTATION_HISTORY,
  hitTestText,
  isNegligibleShape,
  type Point,
  redoAnnotation,
  removeAnnotation,
  replaceAnnotation,
  type Size,
  type TextAnnotation,
  toImagePoint,
  undoAnnotation,
} from "@t3tools/client-runtime/image-annotation";
import {
  drawAnnotation,
  drawPenSegment,
  measureAnnotationText,
  prepareOverlay,
  renderAnnotatedImage,
} from "./imageAnnotationCanvas";

export interface ImageAnnotatorHandle {
  focus: () => void;
  /** Escape: asks before discarding marks, and discards on a second press. */
  escape: () => void;
  requestClose: () => void;
}

export type ImageAnnotatorExit = "cancel" | "close";

const TOOLS = [
  { value: "pen", label: "Pen", Icon: PenLineIcon },
  { value: "arrow", label: "Arrow", Icon: MoveUpRightIcon },
  { value: "rect", label: "Rectangle", Icon: SquareIcon },
  { value: "text", label: "Text", Icon: TypeIcon },
] as const;
const SIZE_DOT_PX: Record<AnnotationSize, number> = { small: 4, medium: 7, large: 11 };
const DRAG_THRESHOLD_PX = 4;
const TEXT_FONT_FAMILY = "ui-sans-serif, system-ui, sans-serif";

type Gesture =
  | { kind: "pen"; pointerId: number; color: string; width: number; points: Point[] }
  | {
      kind: "arrow" | "rect";
      pointerId: number;
      color: string;
      width: number;
      from: Point;
      to: Point;
    }
  | {
      kind: "text";
      pointerId: number;
      start: Point;
      target: TextAnnotation | null;
      delta: Point | null;
    };

interface TextDraft {
  readonly id: string;
  readonly at: Point;
  readonly color: string;
  readonly fontSize: number;
  readonly initialText: string;
  readonly replacing: boolean;
}

function clientPoint(event: { clientX: number; clientY: number }): Point {
  return { x: event.clientX, y: event.clientY };
}

/** Previews pass no id; only a committed op needs a stable one. */
function gestureOp(gesture: Exclude<Gesture, { kind: "text" }>, id = ""): AnnotationOp {
  const { color, width } = gesture;
  return gesture.kind === "pen"
    ? { kind: "pen", id, color, width, points: [...gesture.points] }
    : { kind: gesture.kind, id, color, width, from: gesture.from, to: gesture.to };
}

function movedText(text: TextAnnotation, delta: Point): TextAnnotation {
  return { ...text, at: { x: text.at.x + delta.x, y: text.at.y + delta.y } };
}

function paintOps(
  canvas: HTMLCanvasElement | null,
  display: Size,
  natural: Size,
  ops: ReadonlyArray<AnnotationOp>,
  skipId: string | null,
) {
  const context = canvas && prepareOverlay(canvas, display, natural);
  if (!context) return;
  for (const op of ops) if (op.id !== skipId) drawAnnotation(context, op);
}

/**
 * Marks up an editable composer image. Marks stay vector ops in natural image pixels until Save,
 * which composites them onto the original bytes at full resolution.
 */
export function ImageAnnotator({
  src,
  name,
  annotation,
  onSaved,
  onExit,
  ref,
}: {
  readonly src: string;
  readonly name: string;
  readonly annotation: ExpandedImageAnnotation;
  readonly onSaved: (item: ExpandedImageItem) => void;
  readonly onExit: (exit: ImageAnnotatorExit) => void;
  readonly ref?: Ref<ImageAnnotatorHandle>;
}) {
  const [tool, setTool] = useState<AnnotationTool>("pen");
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0].value);
  const [size, setSize] = useState<AnnotationSize>("medium");
  const [history, setHistory] = useState(EMPTY_ANNOTATION_HISTORY);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [pendingExit, setPendingExit] = useState<ImageAnnotatorExit | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [display, setDisplay] = useState<Size | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const draftCanvasRef = useRef<HTMLCanvasElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const discardTextRef = useRef(false);
  const dirty = history.present.length > 0;
  const hiddenTextId = textDraft?.replacing ? textDraft.id : null;
  const scale = natural && display ? display.width / natural.width : 1;

  const exitOrConfirm = (exit: ImageAnnotatorExit) => {
    if (saving) return;
    if (dirty) setPendingExit(exit);
    else onExit(exit);
  };

  useImperativeHandle(ref, () => ({
    focus: () => rootRef.current?.focus({ preventScroll: true }),
    escape: () => {
      if (pendingExit) onExit(pendingExit);
      else exitOrConfirm("cancel");
    },
    requestClose: () => exitOrConfirm("close"),
  }));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- paints committed marks onto the overlay canvases, which React does not render
  useLayoutEffect(() => {
    if (!natural || !display) return;
    paintOps(baseCanvasRef.current, display, natural, history.present, hiddenTextId);
    if (draftCanvasRef.current) prepareOverlay(draftCanvasRef.current, display, natural);
  }, [display, natural, history.present, hiddenTextId]);

  const attachImage = (image: HTMLImageElement | null) => {
    if (!image) return;
    if (image.complete && image.naturalWidth > 0) {
      setNatural({ width: image.naturalWidth, height: image.naturalHeight });
    }
    return observeResize(image, (entries) => {
      const box = entries.at(-1)?.contentRect;
      if (!box) return;
      setDisplay((current) =>
        current?.width === box.width && current.height === box.height
          ? current
          : { width: box.width, height: box.height },
      );
    });
  };

  const clearDraftCanvas = () => {
    if (natural && display && draftCanvasRef.current) {
      prepareOverlay(draftCanvasRef.current, display, natural);
    }
  };

  const changeHistory = (change: (current: AnnotationHistory) => AnnotationHistory) => {
    if (gestureRef.current || saving) return;
    setHistory(change);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement) return;
    const mac = isMacPlatform(navigator.platform);
    if (!(mac ? event.metaKey : event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const redo = (key === "z" && event.shiftKey) || (key === "y" && !mac);
    if (key !== "z" && !redo) return;
    event.preventDefault();
    event.stopPropagation();
    changeHistory(redo ? redoAnnotation : undoAnnotation);
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    // Keeps focus (and so undo shortcuts) inside the viewer.
    event.preventDefault();
    if (!natural || saving || pendingExit || gestureRef.current || event.button !== 0) return;
    if (textDraft) {
      // The first press only commits the open text box.
      textInputRef.current?.blur();
      return;
    }
    const canvas = event.currentTarget;
    const point = toImagePoint(clientPoint(event), canvas.getBoundingClientRect(), natural);
    canvas.setPointerCapture(event.pointerId);
    const pointerId = event.pointerId;
    if (tool === "text") {
      const target = hitTestText(history.present, point, DRAG_THRESHOLD_PX / scale);
      gestureRef.current = { kind: "text", pointerId, start: point, target, delta: null };
      return;
    }
    const width = annotationStrokeWidth(size, natural);
    if (tool === "pen") {
      const pen = { kind: "pen" as const, pointerId, color, width, points: [point] };
      gestureRef.current = pen;
      const context = canvas.getContext("2d");
      if (context) drawAnnotation(context, gestureOp(pen));
      return;
    }
    gestureRef.current = { kind: tool, pointerId, color, width, from: point, to: point };
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !natural || !display) return;
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    if (gesture.kind === "pen") {
      const context = canvas.getContext("2d");
      if (!context) return;
      const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [];
      for (const sample of coalesced.length > 0 ? coalesced : [event.nativeEvent]) {
        const point = toImagePoint(clientPoint(sample), bounds, natural);
        drawPenSegment(
          context,
          gesture.points.at(-1) ?? point,
          point,
          gesture.color,
          gesture.width,
        );
        gesture.points.push(point);
      }
      return;
    }
    const point = toImagePoint(clientPoint(event), bounds, natural);
    if (gesture.kind === "text") {
      if (!gesture.target) return;
      const delta = { x: point.x - gesture.start.x, y: point.y - gesture.start.y };
      if (!gesture.delta) {
        if (Math.hypot(delta.x, delta.y) * scale < DRAG_THRESHOLD_PX) return;
        paintOps(baseCanvasRef.current, display, natural, history.present, gesture.target.id);
      }
      gesture.delta = delta;
      const context = prepareOverlay(canvas, display, natural);
      if (context) drawAnnotation(context, movedText(gesture.target, delta));
      return;
    }
    gesture.to = point;
    const context = prepareOverlay(canvas, display, natural);
    if (context) drawAnnotation(context, gestureOp(gesture));
  };

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !natural) return;
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // Cleared now; committed marks repaint on the base canvas before the next frame.
    clearDraftCanvas();
    if (gesture.kind === "text") {
      const { target } = gesture;
      if (target && gesture.delta) {
        const moved = movedText(target, gesture.delta);
        setHistory((current) => replaceAnnotation(current, moved));
      } else if (target) {
        setTextDraft({
          id: target.id,
          at: target.at,
          color: target.color,
          fontSize: target.fontSize,
          initialText: target.text,
          replacing: true,
        });
      } else {
        const fontSize = annotationFontSize(size, natural);
        setTextDraft({
          id: randomUUID(),
          // The press marks the middle of the first line, not its top edge.
          at: {
            x: gesture.start.x,
            y: gesture.start.y - (fontSize * ANNOTATION_TEXT_LINE_HEIGHT) / 2,
          },
          color,
          fontSize,
          initialText: "",
          replacing: false,
        });
      }
      return;
    }
    if (
      gesture.kind !== "pen" &&
      isNegligibleShape(gesture.from, gesture.to, DRAG_THRESHOLD_PX / scale)
    ) {
      return;
    }
    const op = gestureOp(gesture, randomUUID());
    setHistory((current) => addAnnotation(current, op));
  };

  const cancelGesture = (event: PointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    clearDraftCanvas();
    if (gesture.kind === "text" && gesture.delta && natural && display) {
      paintOps(baseCanvasRef.current, display, natural, history.present, hiddenTextId);
    }
  };

  const onTextBlur = (event: FocusEvent<HTMLInputElement>) => {
    const draft = textDraft;
    const value = event.currentTarget.value.trim();
    const discard = discardTextRef.current;
    discardTextRef.current = false;
    setTextDraft(null);
    if (!event.relatedTarget) rootRef.current?.focus({ preventScroll: true });
    if (!draft || discard || (draft.replacing && value === draft.initialText)) return;
    if (value === "") {
      if (draft.replacing) setHistory((current) => removeAnnotation(current, draft.id));
      return;
    }
    const op: TextAnnotation = {
      kind: "text",
      id: draft.id,
      color: draft.color,
      fontSize: draft.fontSize,
      at: draft.at,
      text: value,
      textWidth: measureAnnotationText(value, draft.fontSize),
    };
    setHistory((current) =>
      draft.replacing ? replaceAnnotation(current, op) : addAnnotation(current, op),
    );
  };

  const attachTextInput = (input: HTMLInputElement | null) => {
    textInputRef.current = input;
    input?.focus({ preventScroll: true });
  };

  const save = async () => {
    if (!natural || saving) return;
    if (history.present.length === 0) {
      onExit("cancel");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const file = await renderAnnotatedImage(
        annotation.file,
        natural,
        history.present,
        annotatedImageOutput(annotation.file.type, name),
      );
      const result = await annotation.save(file);
      if (result.ok) {
        onSaved(result.item);
        return;
      }
      setError(result.message);
    } catch {
      setError("The marked-up image could not be saved.");
    }
    setSaving(false);
  };

  const historyButtons = [
    {
      label: "Undo",
      Icon: Undo2Icon,
      disabled: history.past.length === 0,
      change: undoAnnotation,
    },
    {
      label: "Redo",
      Icon: Redo2Icon,
      disabled: history.future.length === 0,
      change: redoAnnotation,
    },
    {
      label: "Clear all marks",
      Icon: Trash2Icon,
      disabled: history.present.length === 0,
      change: clearAnnotations,
    },
  ];

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex max-w-[var(--media-width)] flex-col items-center gap-2 outline-none"
    >
      <div
        role="toolbar"
        aria-label="Annotation tools"
        className="flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-lg border border-border/70 bg-popover p-1 text-popover-foreground shadow-2xl"
      >
        <ToggleGroup
          aria-label="Tool"
          value={[tool]}
          onValueChange={(next) => {
            const selected = TOOLS.find((entry) => entry.value === next[0]);
            if (selected) setTool(selected.value);
          }}
        >
          {TOOLS.map(({ value, label, Icon }) => (
            <Tooltip key={value}>
              <TooltipTrigger render={<Toggle value={value} aria-label={label} />}>
                <Icon aria-hidden="true" />
              </TooltipTrigger>
              <TooltipPopup side="top">{label}</TooltipPopup>
            </Tooltip>
          ))}
        </ToggleGroup>
        <ToggleGroup
          aria-label="Colour"
          value={[color]}
          onValueChange={(next) => {
            const selected = ANNOTATION_COLORS.find((entry) => entry.value === next[0]);
            if (selected) setColor(selected.value);
          }}
        >
          {ANNOTATION_COLORS.map((entry) => (
            <Toggle key={entry.value} value={entry.value} aria-label={entry.name}>
              <span
                aria-hidden="true"
                className="size-3.5 rounded-full ring-1 ring-black/25 dark:ring-white/35"
                style={{ backgroundColor: entry.value }}
              />
            </Toggle>
          ))}
        </ToggleGroup>
        <ToggleGroup
          aria-label="Stroke and text size"
          value={[size]}
          onValueChange={(next) => {
            const selected = ANNOTATION_SIZES.find((entry) => entry.value === next[0]);
            if (selected) setSize(selected.value);
          }}
        >
          {ANNOTATION_SIZES.map((entry) => (
            <Toggle key={entry.value} value={entry.value} aria-label={entry.name}>
              <span
                aria-hidden="true"
                className="rounded-full bg-current"
                style={{ width: SIZE_DOT_PX[entry.value], height: SIZE_DOT_PX[entry.value] }}
              />
            </Toggle>
          ))}
        </ToggleGroup>
        <div className="flex items-center">
          {historyButtons.map(({ label, Icon, disabled, change }) => (
            <Tooltip key={label}>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={label}
                    disabled={disabled || saving}
                    onClick={() => changeHistory(change)}
                  />
                }
              >
                <Icon aria-hidden="true" />
              </TooltipTrigger>
              <TooltipPopup side="top">{label}</TooltipPopup>
            </Tooltip>
          ))}
        </div>
        {pendingExit ? (
          <div role="alert" className="flex items-center gap-1 ps-1 text-xs">
            <span>Discard your marks?</span>
            <Button
              ref={(button: HTMLButtonElement | null) => button?.focus({ preventScroll: true })}
              size="xs"
              variant="ghost"
              onClick={() => setPendingExit(null)}
            >
              Keep editing
            </Button>
            <Button size="xs" variant="destructive" onClick={() => onExit(pendingExit)}>
              Discard
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Button size="xs" variant="ghost" disabled={saving} onClick={() => onExit("cancel")}>
              Cancel
            </Button>
            <Button
              size="xs"
              disabled={saving || (history.present.length === 0 && textDraft === null)}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>
      <div className="relative">
        <img
          ref={attachImage}
          src={src}
          alt={name}
          draggable={false}
          onLoad={(event) =>
            setNatural({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          className="block max-h-[calc(var(--media-height)-4rem)] max-w-[var(--media-width)] select-none rounded-lg shadow-2xl ring-1 ring-border/70 max-sm:max-h-[calc(var(--media-height)-8rem)]"
        />
        <canvas
          ref={baseCanvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full rounded-lg"
        />
        <canvas
          ref={draftCanvasRef}
          aria-label={`Draw on ${name}`}
          className="absolute inset-0 size-full touch-none rounded-lg"
          style={{ cursor: tool === "text" ? "text" : "crosshair" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={cancelGesture}
          onLostPointerCapture={cancelGesture}
        />
        {textDraft ? (
          <input
            ref={attachTextInput}
            type="text"
            aria-label="Annotation text"
            defaultValue={textDraft.initialText}
            className="absolute m-0 min-w-[2ch] border-0 bg-transparent p-0 font-semibold outline-1 outline-white/70 outline-dashed [field-sizing:content]"
            style={{
              left: textDraft.at.x * scale,
              top: textDraft.at.y * scale,
              fontSize: textDraft.fontSize * scale,
              lineHeight: ANNOTATION_TEXT_LINE_HEIGHT,
              fontFamily: TEXT_FONT_FAMILY,
              color: textDraft.color,
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                // Escape here drops only the text box, so the viewer must not see it.
                event.preventDefault();
                event.stopPropagation();
                discardTextRef.current = true;
                event.currentTarget.blur();
              }
            }}
            onBlur={onTextBlur}
          />
        ) : null}
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-md bg-popover px-2 py-1 text-destructive-foreground text-xs"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

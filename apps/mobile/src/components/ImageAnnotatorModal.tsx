import {
  addAnnotation,
  ANNOTATION_COLORS,
  ANNOTATION_SIZES,
  ANNOTATION_TEXT_LINE_HEIGHT,
  annotationFontSize,
  annotationHaloColor,
  annotationStrokeWidth,
  arrowGeometry,
  clearAnnotations,
  EMPTY_ANNOTATION_HISTORY,
  hitTestText,
  isNegligibleShape,
  normalizedRect,
  redoAnnotation,
  removeAnnotation,
  replaceAnnotation,
  toImagePoint,
  undoAnnotation,
  type AnnotationHistory,
  type AnnotationOp,
  type AnnotationSize,
  type AnnotationTool,
  type Point,
  type Size,
  type TextAnnotation,
} from "@t3tools/client-runtime/image-annotation";
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import {
  Modal,
  PixelRatio,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type GestureResponderEvent,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Image as SvgImage, Path, Rect, Text as SvgText } from "react-native-svg";

import { cn } from "../lib/cn";
import {
  deleteAnnotationFile,
  discardAnnotationPreview,
  encodeAnnotatedImage,
  prepareAnnotationBase,
  type AnnotationBase,
} from "../lib/composerImageAnnotation";
import type { DraftComposerImageAttachment } from "../lib/composerImages";
import { uuidv4 } from "../lib/uuid";
import { AppActivityIndicator } from "./ui/AppActivityIndicator";
import { SymbolView, type AppSymbolName } from "./ui/AppSymbol";
import { Button } from "./ui/Button";
import * as Dialog from "./ui/Dialog";
import { ErrorBanner } from "./ui/ErrorBanner";
import { IconButton } from "./ui/IconButton";
import { SheetHeader } from "./ui/SheetHeader";

const TOOLS: ReadonlyArray<{
  readonly value: AnnotationTool;
  readonly label: string;
  readonly icon: AppSymbolName;
}> = [
  { value: "pen", label: "Pen", icon: "pencil" },
  { value: "arrow", label: "Arrow", icon: "arrow.up.right" },
  { value: "rect", label: "Rectangle", icon: "rectangle" },
  { value: "text", label: "Text", icon: "textformat" },
];
const SIZE_DOT_PX: Record<AnnotationSize, number> = { small: 6, medium: 10, large: 14 };
// Distances in display points, converted to image pixels at the current zoom.
const DRAG_THRESHOLD = 4;
const PEN_MIN_STEP = 1.5;
const TEXT_HIT_SLOP = 8;
// SVG text sits on its baseline; this puts the top of the line box where the label was placed.
const TEXT_BASELINE = 0.95;
const TEXT_ADVANCE = 0.58;
const EXPORT_TIMEOUT_MS = 20_000;

type Gesture =
  | {
      readonly kind: "pen";
      readonly touch: number;
      readonly color: string;
      readonly width: number;
      readonly points: Point[];
    }
  | {
      readonly kind: "arrow" | "rect";
      readonly touch: number;
      readonly color: string;
      readonly width: number;
      readonly from: Point;
      to: Point;
    }
  | { readonly kind: "text"; readonly touch: number; readonly start: Point };

interface TextDraft {
  readonly id: string;
  readonly at: Point;
  readonly color: string;
  readonly fontSize: number;
  readonly text: string;
  readonly initialText: string;
  readonly replacing: boolean;
}

function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * TEXT_ADVANCE;
}

function penPathData(points: ReadonlyArray<Point>): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join("");
}

function gestureOp(gesture: Exclude<Gesture, { kind: "text" }>, id = ""): AnnotationOp {
  const { color, width } = gesture;
  return gesture.kind === "pen"
    ? { kind: "pen", id, color, width, points: [...gesture.points] }
    : { kind: gesture.kind, id, color, width, from: gesture.from, to: gesture.to };
}

function draftText(draft: TextDraft): TextAnnotation {
  const text = draft.text.trim();
  return {
    kind: "text",
    id: draft.id,
    color: draft.color,
    fontSize: draft.fontSize,
    at: draft.at,
    text,
    textWidth: estimateTextWidth(text, draft.fontSize),
  };
}

/** One mark in image pixels; the parent Svg's viewBox scales it to the screen or the export. */
function AnnotationMark({ op }: { readonly op: AnnotationOp }) {
  switch (op.kind) {
    case "pen": {
      const [first, ...rest] = op.points;
      if (!first) return null;
      if (rest.length === 0) {
        return <Circle cx={first.x} cy={first.y} r={op.width / 2} fill={op.color} />;
      }
      return (
        <Path
          d={penPathData(op.points)}
          stroke={op.color}
          strokeWidth={op.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      );
    }
    case "rect":
      return (
        <Rect
          {...normalizedRect(op.from, op.to)}
          stroke={op.color}
          strokeWidth={op.width}
          strokeLinejoin="round"
          fill="none"
        />
      );
    case "arrow": {
      const geometry = arrowGeometry(op.from, op.to, op.width);
      if (!geometry) return null;
      const { shaftEnd, tip, left, right } = geometry;
      return (
        <>
          <Path
            d={`M${op.from.x} ${op.from.y}L${shaftEnd.x} ${shaftEnd.y}`}
            stroke={op.color}
            strokeWidth={op.width}
            strokeLinecap="round"
            fill="none"
          />
          <Path
            d={`M${tip.x} ${tip.y}L${left.x} ${left.y}L${right.x} ${right.y}Z`}
            fill={op.color}
          />
        </>
      );
    }
    case "text": {
      const text = {
        x: op.at.x,
        y: op.at.y + op.fontSize * TEXT_BASELINE,
        fontSize: op.fontSize,
        fontWeight: "600" as const,
        fill: op.color,
      };
      return (
        <>
          <SvgText
            {...text}
            stroke={annotationHaloColor(op.color)}
            strokeWidth={Math.max(2, op.fontSize * 0.16)}
            strokeLinejoin="round"
          >
            {op.text}
          </SvgText>
          <SvgText {...text}>{op.text}</SvgText>
        </>
      );
    }
  }
}

interface DraftLayerHandle {
  readonly show: (op: AnnotationOp | null) => void;
}

/**
 * The stroke being drawn lives here so a touch move re-renders this one Svg, not the image and
 * every committed mark.
 */
function DraftLayer({
  natural,
  display,
  ref,
}: {
  readonly natural: Size;
  readonly display: Size;
  readonly ref: Ref<DraftLayerHandle>;
}) {
  const [op, setOp] = useState<AnnotationOp | null>(null);
  useImperativeHandle(ref, () => ({ show: setOp }), []);
  return (
    <Svg
      pointerEvents="none"
      width={display.width}
      height={display.height}
      viewBox={`0 0 ${natural.width} ${natural.height}`}
      style={StyleSheet.absoluteFill}
    >
      {op ? <AnnotationMark op={op} /> : null}
    </Svg>
  );
}

function exportSvg(svg: Svg, size: Size): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("The image export did not finish.")),
      EXPORT_TIMEOUT_MS,
    );
    svg.toDataURL(
      (base64) => {
        clearTimeout(timeout);
        // iOS calls back with no value when it could not render.
        if (typeof base64 === "string" && base64.length > 0) resolve(base64);
        else reject(new Error("The image export was empty."));
      },
      { width: size.width, height: size.height },
    );
  });
}

/** Returns the message to show, or null once the replacement is in the draft. */
async function saveAnnotatedImage(input: {
  readonly svg: Svg;
  readonly size: Size;
  readonly attachment: DraftComposerImageAttachment;
  readonly onSave: (replacement: DraftComposerImageAttachment) => boolean;
}): Promise<string | null> {
  try {
    const pngBase64 = await exportSvg(input.svg, input.size);
    const result = await encodeAnnotatedImage({ pngBase64, attachment: input.attachment });
    if (!result.ok) return result.message;
    if (!input.onSave(result.attachment)) {
      void discardAnnotationPreview(result.attachment.previewUri);
      return "This image is no longer in the message.";
    }
    void discardAnnotationPreview(input.attachment.previewUri);
    return null;
  } catch (cause) {
    console.warn("[image-annotation] could not save the marked-up image", cause);
    return "The marked-up image could not be saved.";
  }
}

function ToolButton(props: {
  readonly label: string;
  readonly icon: AppSymbolName;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      className={cn(
        "size-11 items-center justify-center rounded-full",
        props.selected ? "bg-subtle-strong" : "active:bg-subtle",
      )}
    >
      <SymbolView name={props.icon} size={20} tintColorClassName="accent-foreground" />
    </Pressable>
  );
}

function SwatchButton(props: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      className={cn(
        "size-9 items-center justify-center rounded-full border-2",
        props.selected ? "border-foreground" : "border-transparent",
      )}
    >
      {props.children}
    </Pressable>
  );
}

/**
 * Marks up an unsent composer image. Marks stay vector ops in image pixels; Save flattens them
 * with the image at full resolution and hands back a replacement attachment.
 */
export function ImageAnnotatorModal(props: {
  readonly attachment: DraftComposerImageAttachment;
  /** False when the image left the draft while it was being marked up. */
  readonly onSave: (replacement: DraftComposerImageAttachment) => boolean;
  readonly onRequestClose: () => void;
}) {
  const { attachment, onRequestClose } = props;
  const [base, setBase] = useState<AnnotationBase | null>(null);
  const [stage, setStage] = useState<Size | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [tool, setTool] = useState<AnnotationTool>("pen");
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0].value);
  const [size, setSize] = useState<AnnotationSize>("medium");
  const [history, setHistory] = useState(EMPTY_ANNOTATION_HISTORY);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<Svg>(null);
  const draftRef = useRef<DraftLayerHandle>(null);
  const gestureRef = useRef<Gesture | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- decodes a working copy of the image on open and deletes it when the annotator closes
  useEffect(() => {
    let disposed = false;
    let prepared: string | null = null;
    void prepareAnnotationBase(attachment).then(
      (next) => {
        if (disposed) {
          void deleteAnnotationFile(next.uri);
          return;
        }
        prepared = next.uri;
        setBase(next);
      },
      (cause: unknown) => {
        console.warn("[image-annotation] could not open the image", cause);
        if (!disposed) setError("This image could not be opened for markup.");
      },
    );
    return () => {
      disposed = true;
      if (prepared !== null) void deleteAnnotationFile(prepared);
    };
  }, [attachment]);

  const natural = base;
  const fit =
    natural && stage ? Math.min(stage.width / natural.width, stage.height / natural.height) : 0;
  const display = natural ? { width: natural.width * fit, height: natural.height * fit } : null;
  // Display points per image pixel.
  const zoom = fit > 0 ? fit : 1;
  // The exported Svg is laid out at the image's pixel size and scaled down to fit: iOS renders
  // toDataURL into the view's own bounds, and Android only exports a view that has drawn.
  const ratio = PixelRatio.get();
  const exportView = natural
    ? {
        width: Math.max(1, Math.round(natural.width / ratio)),
        height: Math.max(1, Math.round(natural.height / ratio)),
      }
    : null;
  const marks = history.present;
  const hiddenTextId = textDraft?.replacing ? textDraft.id : null;
  const dirty = marks.length > 0 || (textDraft !== null && textDraft.text.trim() !== "");
  const editingText = textDraft !== null;

  const requestExit = () => {
    if (saving) return;
    if (!dirty) {
      onRequestClose();
      return;
    }
    Dialog.confirm({
      title: "Discard your marks?",
      cancelText: "Keep editing",
      confirmText: "Discard",
      destructive: true,
      onConfirm: onRequestClose,
    });
  };

  const commitTextDraft = () => {
    const draft = textDraft;
    if (!draft) return;
    setTextDraft(null);
    const op = draftText(draft);
    if (draft.replacing && op.text === draft.initialText) return;
    if (op.text === "") {
      if (draft.replacing) setHistory((current) => removeAnnotation(current, draft.id));
      return;
    }
    setHistory((current) =>
      draft.replacing ? replaceAnnotation(current, op) : addAnnotation(current, op),
    );
  };

  const changeHistory = (change: (current: AnnotationHistory) => AnnotationHistory) => {
    if (gestureRef.current || saving || editingText) return;
    setHistory(change);
  };

  const selectTool = (next: AnnotationTool) => {
    commitTextDraft();
    setTool(next);
  };

  const selectColor = (next: string) => {
    setColor(next);
    setTextDraft((draft) => (draft ? { ...draft, color: next } : draft));
  };

  const selectSize = (next: AnnotationSize) => {
    setSize(next);
    if (natural) {
      const fontSize = annotationFontSize(next, natural);
      setTextDraft((draft) => (draft ? { ...draft, fontSize } : draft));
    }
  };

  const touchPoint = (event: GestureResponderEvent, touch?: number): Point | null => {
    if (!natural || !display) return null;
    const native =
      touch === undefined
        ? event.nativeEvent
        : (event.nativeEvent.touches.find((candidate) => candidate.identifier === touch) ??
          (event.nativeEvent.identifier === touch ? event.nativeEvent : null));
    if (!native) return null;
    return toImagePoint(
      { x: native.locationX, y: native.locationY },
      { left: 0, top: 0, width: display.width, height: display.height },
      natural,
    );
  };

  const onTouchStart = (event: GestureResponderEvent) => {
    if (!natural || saving || gestureRef.current) return;
    if (textDraft) {
      // The first touch only closes the open label.
      commitTextDraft();
      return;
    }
    const point = touchPoint(event);
    if (!point) return;
    const touch = event.nativeEvent.identifier;
    if (tool === "text") {
      gestureRef.current = { kind: "text", touch, start: point };
      return;
    }
    const width = annotationStrokeWidth(size, natural);
    const gesture: Gesture =
      tool === "pen"
        ? { kind: "pen", touch, color, width, points: [point] }
        : { kind: tool, touch, color, width, from: point, to: point };
    gestureRef.current = gesture;
    draftRef.current?.show(gestureOp(gesture));
  };

  const onTouchMove = (event: GestureResponderEvent) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.kind === "text") return;
    const point = touchPoint(event, gesture.touch);
    if (!point) return;
    if (gesture.kind === "pen") {
      const last = gesture.points.at(-1);
      if (last && Math.hypot(point.x - last.x, point.y - last.y) * zoom < PEN_MIN_STEP) return;
      gesture.points.push(point);
    } else {
      gesture.to = point;
    }
    draftRef.current?.show(gestureOp(gesture));
  };

  const onTouchEnd = () => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    draftRef.current?.show(null);
    if (!gesture || !natural) return;
    if (gesture.kind === "text") {
      const target = hitTestText(marks, gesture.start, TEXT_HIT_SLOP / zoom);
      if (target) {
        setTextDraft({
          id: target.id,
          at: target.at,
          color: target.color,
          fontSize: target.fontSize,
          text: target.text,
          initialText: target.text,
          replacing: true,
        });
        return;
      }
      const fontSize = annotationFontSize(size, natural);
      setTextDraft({
        id: uuidv4(),
        // The touch marks the middle of the first line, not its top edge.
        at: {
          x: gesture.start.x,
          y: gesture.start.y - (fontSize * ANNOTATION_TEXT_LINE_HEIGHT) / 2,
        },
        color,
        fontSize,
        text: "",
        initialText: "",
        replacing: false,
      });
      return;
    }
    if (
      gesture.kind !== "pen" &&
      isNegligibleShape(gesture.from, gesture.to, DRAG_THRESHOLD / zoom)
    )
      return;
    const op = gestureOp(gesture, uuidv4());
    setHistory((current) => addAnnotation(current, op));
  };

  const onTouchCancel = () => {
    gestureRef.current = null;
    draftRef.current?.show(null);
  };

  const save = async () => {
    const svg = svgRef.current;
    if (!svg || !natural || !exportView || saving) return;
    setSaving(true);
    setError(null);
    const failure = await saveAnnotatedImage({
      svg,
      // Android exports at the size it is given; iOS multiplies its bounds by the screen scale.
      size: Platform.OS === "ios" ? exportView : natural,
      attachment,
      onSave: props.onSave,
    });
    if (failure === null) {
      onRequestClose();
      return;
    }
    setError(failure);
    setSaving(false);
  };

  const historyButtons = [
    {
      label: "Undo",
      icon: "arrow.uturn.backward",
      disabled: history.past.length === 0,
      change: undoAnnotation,
    },
    {
      label: "Redo",
      icon: "arrow.uturn.forward",
      disabled: history.future.length === 0,
      change: redoAnnotation,
    },
    {
      label: "Clear all marks",
      icon: "trash",
      disabled: marks.length === 0,
      change: clearAnnotations,
    },
  ] as const;

  const textPreview = textDraft ? draftText(textDraft) : null;

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={requestExit}
    >
      {/* A Modal is its own native hierarchy, so it measures its own safe area. */}
      <SafeAreaProvider style={{ flex: 1 }}>
        <View className="flex-1 bg-screen">
          <SafeAreaView style={{ flex: 1 }}>
            <SheetHeader
              presentation="inline"
              title="Annotate"
              subtitle={attachment.name}
              onCancel={requestExit}
              dismissDisabled={saving}
              confirm={{
                label: "Save",
                onPress: () => void save(),
                disabled: !imageLoaded || editingText || marks.length === 0,
                loading: saving,
              }}
            />
            {textDraft ? (
              <View className="flex-row items-center gap-2 px-4 pb-2">
                <TextInput
                  accessibilityLabel="Annotation text"
                  autoFocus
                  placeholder="Type a label"
                  returnKeyType="done"
                  placeholderTextColorClassName="accent-placeholder"
                  selectionColorClassName="accent-focus/32"
                  cursorColorClassName="accent-focus"
                  selectionHandleColorClassName="accent-focus"
                  className="min-h-11 min-w-0 flex-1 rounded-full border border-input-border bg-input px-4 font-sans text-base text-foreground"
                  value={textDraft.text}
                  onChangeText={(text) =>
                    setTextDraft((draft) => (draft ? { ...draft, text } : draft))
                  }
                  onSubmitEditing={commitTextDraft}
                />
                <Button label="Done" tone="primary" size="compact" onPress={commitTextDraft} />
              </View>
            ) : null}
            <View className="flex-1 p-3">
              <View
                className="flex-1 items-center justify-center"
                onLayout={(event) => {
                  const { width, height } = event.nativeEvent.layout;
                  setStage((current) =>
                    current?.width === width && current.height === height
                      ? current
                      : { width, height },
                  );
                }}
              >
                {base && natural && display && exportView && fit > 0 ? (
                  <View
                    accessible
                    accessibilityLabel={`Draw on ${attachment.name}`}
                    style={{ width: display.width, height: display.height }}
                    onStartShouldSetResponder={() => true}
                    onMoveShouldSetResponder={() => true}
                    onResponderTerminationRequest={() => false}
                    onResponderGrant={onTouchStart}
                    onResponderMove={onTouchMove}
                    onResponderRelease={onTouchEnd}
                    onResponderTerminate={onTouchCancel}
                  >
                    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                      <View
                        style={{
                          position: "absolute",
                          left: (display.width - exportView.width) / 2,
                          top: (display.height - exportView.height) / 2,
                          width: exportView.width,
                          height: exportView.height,
                          transform: [{ scale: display.width / exportView.width }],
                        }}
                      >
                        <Svg
                          pointerEvents="none"
                          ref={svgRef}
                          width={exportView.width}
                          height={exportView.height}
                          viewBox={`0 0 ${natural.width} ${natural.height}`}
                        >
                          <SvgImage
                            href={base.uri}
                            x={0}
                            y={0}
                            width={natural.width}
                            height={natural.height}
                            preserveAspectRatio="none"
                            onLoad={() => setImageLoaded(true)}
                          />
                          {marks.map((op) =>
                            op.id === hiddenTextId ? null : <AnnotationMark key={op.id} op={op} />,
                          )}
                        </Svg>
                      </View>
                      <DraftLayer ref={draftRef} natural={natural} display={display} />
                      {textDraft && textPreview ? (
                        <Svg
                          pointerEvents="none"
                          width={display.width}
                          height={display.height}
                          viewBox={`0 0 ${natural.width} ${natural.height}`}
                          style={StyleSheet.absoluteFill}
                        >
                          <Rect
                            x={textDraft.at.x - textDraft.fontSize * 0.15}
                            y={textDraft.at.y}
                            width={
                              Math.max(textPreview.textWidth, textDraft.fontSize) +
                              textDraft.fontSize * 0.3
                            }
                            height={textDraft.fontSize * ANNOTATION_TEXT_LINE_HEIGHT}
                            stroke={annotationHaloColor(textDraft.color)}
                            strokeWidth={1.5 / zoom}
                            strokeDasharray={[4 / zoom, 3 / zoom]}
                            fill="none"
                          />
                          {textPreview.text ? <AnnotationMark op={textPreview} /> : null}
                        </Svg>
                      ) : null}
                    </View>
                    {imageLoaded ? null : (
                      <View
                        pointerEvents="none"
                        className="absolute inset-0 items-center justify-center"
                      >
                        <AppActivityIndicator colorClassName="accent-foreground-muted" />
                      </View>
                    )}
                  </View>
                ) : error ? null : (
                  <AppActivityIndicator colorClassName="accent-foreground-muted" />
                )}
              </View>
            </View>
            {error ? (
              <View className="px-4 pb-2">
                <ErrorBanner message={error} />
              </View>
            ) : null}
            <View
              accessibilityRole="toolbar"
              accessibilityLabel="Annotation tools"
              className="gap-1 px-3 pb-2"
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-1">
                  {TOOLS.map((entry) => (
                    <ToolButton
                      key={entry.value}
                      label={entry.label}
                      icon={entry.icon}
                      selected={tool === entry.value}
                      onPress={() => selectTool(entry.value)}
                    />
                  ))}
                </View>
                <View className="flex-row items-center">
                  {historyButtons.map((entry) => (
                    <IconButton
                      key={entry.label}
                      accessibilityLabel={entry.label}
                      icon={entry.icon}
                      disabled={entry.disabled || saving || editingText}
                      onPress={() => changeHistory(entry.change)}
                    />
                  ))}
                </View>
              </View>
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-0.5">
                  {ANNOTATION_COLORS.map((entry) => (
                    <SwatchButton
                      key={entry.value}
                      label={entry.name}
                      selected={color === entry.value}
                      onPress={() => selectColor(entry.value)}
                    >
                      <View
                        className="size-6 rounded-full border border-border"
                        style={{ backgroundColor: entry.value }}
                      />
                    </SwatchButton>
                  ))}
                </View>
                <View className="flex-row items-center gap-0.5">
                  {ANNOTATION_SIZES.map((entry) => (
                    <SwatchButton
                      key={entry.value}
                      label={entry.name}
                      selected={size === entry.value}
                      onPress={() => selectSize(entry.value)}
                    >
                      <View
                        className="rounded-full bg-foreground"
                        style={{
                          width: SIZE_DOT_PX[entry.value],
                          height: SIZE_DOT_PX[entry.value],
                        }}
                      />
                    </SwatchButton>
                  ))}
                </View>
              </View>
            </View>
          </SafeAreaView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

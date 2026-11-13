import { annotatedImageOutput, type Size } from "@t3tools/client-runtime/image-annotation";
import { fitImageAttachmentSize } from "@t3tools/client-runtime/image-attachment-size";
import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES } from "@t3tools/contracts";

import { estimateBase64ByteSize } from "./base64";
import { resolveOwnedComposerAttachmentFileUri } from "./composerAttachmentFiles";
import { retainComposerAttachmentFileForPreview } from "./composerAttachmentPreviewRetention";
import { renderPhoto } from "./composerImageFit";
import {
  isFileBackedComposerAttachment,
  type DraftComposerImageAttachment,
} from "./composerImages";
import { uuidv4 } from "./uuid";

const ANNOTATION_DIRECTORY = "t3-image-annotations";

/** A decoded, upright copy of the image that the annotator draws over and exports. */
export interface AnnotationBase extends Size {
  readonly uri: string;
}

export type AnnotatedImageResult =
  | { readonly ok: true; readonly attachment: DraftComposerImageAttachment }
  | { readonly ok: false; readonly message: string };

async function annotationDirectory() {
  const { Directory, Paths } = await import("expo-file-system");
  const directory = new Directory(Paths.cache, ANNOTATION_DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

async function writeBase64File(base64: string, extension: string): Promise<string> {
  const { File } = await import("expo-file-system");
  const file = new File(await annotationDirectory(), `${uuidv4()}.${extension}`);
  file.create();
  try {
    await file.write(base64, { encoding: "base64" });
  } catch (error) {
    file.delete();
    throw error;
  }
  return file.uri;
}

export async function deleteAnnotationFile(uri: string): Promise<void> {
  try {
    const { File } = await import("expo-file-system");
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (error) {
    console.warn("[image-annotation] could not remove a temporary image", error);
  }
}

/** Removes a preview an earlier annotation wrote; previews from anywhere else are not ours. */
export async function discardAnnotationPreview(uri: string): Promise<void> {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:") return;
    if (url.pathname.split("/").filter(Boolean).at(-2) !== ANNOTATION_DIRECTORY) return;
  } catch {
    return;
  }
  await deleteAnnotationFile(uri);
}

/**
 * Decodes the attachment's own bytes, bakes in EXIF orientation (the SVG image ignores it) and
 * caps it at the composer's attachment edge, which every save would downscale to anyway.
 */
export async function prepareAnnotationBase(
  attachment: DraftComposerImageAttachment,
): Promise<AnnotationBase> {
  const { ImageManipulator, SaveFormat } = await import("expo-image-manipulator");
  const { Paths } = await import("expo-file-system");
  const release = isFileBackedComposerAttachment(attachment)
    ? retainComposerAttachmentFileForPreview(attachment)
    : undefined;
  let written: string | null = null;
  try {
    let source = attachment.dataUrl ?? attachment.previewUri;
    if (attachment.fileUri !== undefined) {
      source =
        resolveOwnedComposerAttachmentFileUri(attachment.fileUri, Paths.document.uri) ??
        attachment.fileUri;
    } else if (source.startsWith("data:")) {
      written = await writeBase64File(
        source.slice(source.indexOf(",") + 1),
        attachment.mimeType.split("/")[1] ?? "img",
      );
      source = written;
    }
    let image = await ImageManipulator.manipulate(source).renderAsync();
    try {
      const fitted = fitImageAttachmentSize(image);
      if (fitted !== null) {
        const resized = await ImageManipulator.manipulate(image).resize(fitted).renderAsync();
        image.release();
        image = resized;
      }
      const output = annotatedImageOutput(attachment.mimeType, attachment.name);
      const saved = await image.saveAsync({
        format: output.mimeType === "image/png" ? SaveFormat.PNG : SaveFormat.JPEG,
        compress: 1,
      });
      return { uri: saved.uri, width: saved.width, height: saved.height };
    } finally {
      image.release();
    }
  } finally {
    release?.();
    if (written !== null) await deleteAnnotationFile(written);
  }
}

/**
 * Encodes the exported PNG the way a picked photo is encoded, so it meets the same edge and byte
 * limits, and returns it as a new attachment with a preview file this module owns.
 */
export async function encodeAnnotatedImage(input: {
  readonly pngBase64: string;
  readonly attachment: DraftComposerImageAttachment;
}): Promise<AnnotatedImageResult> {
  const output = annotatedImageOutput(input.attachment.mimeType, input.attachment.name);
  // iOS breaks its base64 into lines, which the file writer rejects.
  const exported = await writeBase64File(input.pngBase64.replace(/\s/g, ""), "png");
  let rendered: { base64: string; uri: string };
  try {
    rendered = await renderPhoto(exported, output.mimeType === "image/jpeg" ? "jpeg" : "png");
  } finally {
    await deleteAnnotationFile(exported);
  }
  const sizeBytes = estimateBase64ByteSize(rendered.base64);
  if (sizeBytes <= 0 || sizeBytes > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
    await deleteAnnotationFile(rendered.uri);
    return {
      ok: false,
      message: "The marked-up image is too large to attach, even after compression.",
    };
  }
  const { File } = await import("expo-file-system");
  const preview = new File(
    await annotationDirectory(),
    `${uuidv4()}.${output.mimeType === "image/jpeg" ? "jpg" : "png"}`,
  );
  await new File(rendered.uri).move(preview);
  return {
    ok: true,
    attachment: {
      id: uuidv4(),
      type: "image",
      name: output.name,
      mimeType: output.mimeType,
      sizeBytes,
      dataUrl: `data:${output.mimeType};base64,${rendered.base64}`,
      previewUri: preview.uri,
    },
  };
}

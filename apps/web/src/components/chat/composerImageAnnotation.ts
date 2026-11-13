import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES } from "@t3tools/contracts";

import {
  type ComposerImageAttachment,
  type ComposerThreadTarget,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { releaseAttachmentUpload } from "../../lib/attachmentUploadQueue";
import { compressImageToByteLimit } from "../../lib/imageCompression";

export type ReplaceComposerImageResult =
  | { readonly ok: true; readonly image: ComposerImageAttachment }
  | { readonly ok: false; readonly message: string };

/**
 * Puts a marked-up image in place of the draft attachment it was drawn on. It goes through the
 * same byte limit as a pasted image, and its old upload is released so the composer uploads the
 * new bytes before sending.
 */
export async function replaceComposerImage(input: {
  readonly draftTarget: ComposerThreadTarget;
  readonly imageId: string;
  readonly file: File;
}): Promise<ReplaceComposerImageResult> {
  const prepared = await compressImageToByteLimit(
    input.file,
    PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  ).catch(() => ({ ok: false, reason: "unreadable" }) as const);
  if (!prepared.ok) {
    return {
      ok: false,
      message:
        prepared.reason === "unreadable"
          ? "The marked-up image could not be encoded."
          : "The marked-up image is too large to attach, even after compression.",
    };
  }
  const store = useComposerDraftStore.getState();
  const current = store
    .getComposerDraft(input.draftTarget)
    ?.images.find((image) => image.id === input.imageId);
  if (!current) return { ok: false, message: "This image is no longer in the message." };
  const file = prepared.file;
  const image: ComposerImageAttachment = {
    ...current,
    name: file.name || current.name,
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: URL.createObjectURL(file),
    file,
  };
  if (!store.replaceImage(input.draftTarget, image)) {
    URL.revokeObjectURL(image.previewUrl);
    return { ok: false, message: "This image is no longer in the message." };
  }
  releaseAttachmentUpload(image.id);
  return { ok: true, image };
}

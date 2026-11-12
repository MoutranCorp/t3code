import { create } from "zustand";

import type { DraftId } from "./composerDraftStore";

/** A draft another surface asked to send; its composer sends it once, when it can. */
const useDraftAutoSendStore = create<{ readonly draftId: DraftId | null }>(() => ({
  draftId: null,
}));

export function requestDraftAutoSend(draftId: DraftId): void {
  useDraftAutoSendStore.setState({ draftId });
}

export function useDraftAutoSendRequested(draftId: DraftId | null): boolean {
  return useDraftAutoSendStore((state) => draftId !== null && state.draftId === draftId);
}

/** True only for the first caller, so the draft is sent once. */
export function takeDraftAutoSend(draftId: DraftId): boolean {
  if (useDraftAutoSendStore.getState().draftId !== draftId) return false;
  useDraftAutoSendStore.setState({ draftId: null });
  return true;
}

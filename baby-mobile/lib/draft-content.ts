import type { EditorDraft } from "./models";

/** Opening an empty composer does not create an unfinished task. A restored
 * draft, existing record or deliberately changed care form remains recoverable. */
export function keepDraft(draft: EditorDraft, changed = false) {
  return !!(draft.existing || draft.title.trim() || draft.body.trim() || draft.files.length ||
    draft.data.url?.trim() || draft.data.attachment_ids?.length || draft.data.record_ids?.length ||
    draft.data.items?.length || (changed && ["feeding", "sleep", "diaper"].includes(draft.kind)));
}

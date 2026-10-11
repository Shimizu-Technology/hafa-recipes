import { ExportSaveError, type ExportSaveOptions, type ExportSaveResult } from "./export-save";

export interface DocumentResult {
  status: "selected" | "saved" | "cancelled" | "failed";
  cleanupIncomplete?: boolean;
}
export interface DocumentSaver {
  chooseDestination(operation: string, sourceId: string, ownerScope: string): Promise<DocumentResult>;
  copyToDestination(operation: string): Promise<DocumentResult>;
  discardDestination(operation: string): Promise<DocumentResult>;
  cancel(operation: string): void;
}
class DocumentSaveError extends ExportSaveError {}
const safeErrors = new Set([
  "This export changed or expired while choosing where to save. Prepare a fresh export.",
  "Saving was stopped because your account or training changed.",
  "This private export belongs to a retired account or enrollment.",
  "Export checking was paused.",
  "Export was cancelled because training enrollment changed.",
]);
function completed(result: DocumentResult): ExportSaveResult {
  if (result.cleanupIncomplete)
    throw new DocumentSaveError("Saving did not finish. An incomplete file may remain in the location you chose; check that location before trying again.");
  if (result.status === "saved") return "saved";
  if (result.status === "cancelled") return "cancelled";
  throw new DocumentSaveError("The export could not be saved. Check the location you chose and try a fresh export.");
}
export async function saveDocument(saver: DocumentSaver, operation: string, sourceId: string,
  ownerScope: string, guard: () => void, options: ExportSaveOptions): Promise<ExportSaveResult> {
  let selected = false;
  const abort = () => { try { saver.cancel(operation); } catch { /* Scope guard still prevents copying after picker return. */ } };
  const check = () => {
    guard();
    if (options.signal?.aborted) throw Error("Saving was stopped because your account or training changed.");
  };
  check();
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    options.onModal?.(true);
    let choice: DocumentResult;
    try { choice = await saver.chooseDestination(operation, sourceId, ownerScope); }
    finally { options.onModal?.(false); }
    selected = choice.status === "selected";
    if (!selected) return completed(choice);
    check();
    await options.revalidate();
    check();
    const result = await saver.copyToDestination(operation);
    selected = false; // Native copy closes and cleans its own operation before resolving.
    // A completed write remains a completed write; the caller fences publication to the current scope.
    return completed(result);
  } catch (error) {
    if (selected) {
      let cleanup: DocumentResult;
      try { cleanup = await saver.discardDestination(operation); }
      catch { throw new DocumentSaveError("Saving did not finish. An incomplete file may remain in the location you chose; check that location before trying again."); }
      if (cleanup.cleanupIncomplete) completed(cleanup);
    }
    // Native exceptions may include provider URI/path text. Never surface them.
    if (error instanceof DocumentSaveError) throw error;
    if (error instanceof Error && safeErrors.has(error.message)) throw new DocumentSaveError(error.message);
    const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
    throw Object.assign(new DocumentSaveError("The export could not be saved. Check the location you chose and try a fresh export."),
      { status: [404, 409, 410].includes(status) ? status : 0 });
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
}

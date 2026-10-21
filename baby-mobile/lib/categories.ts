import { ApiError, type BabyApi } from "./api";

/** Read the complete current category before editing membership; never replace
 * another device's additions using a partial or older local cache. */
export async function changeCategory(
  api: Pick<BabyApi, "record" | "save">, categoryId: string, sourceIds: readonly string[], generation: number,
  action: "add" | "remove" = "add"
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const category = await api.record(categoryId);
    if (category.kind !== "collection") throw Error("Choose an available category.");
    const before = category.data.record_ids ?? [], chosen = new Set(sourceIds);
    const added = sourceIds.filter((id) => !before.includes(id));
    const members = action === "add" ? [...new Set([...before, ...sourceIds])] : before.filter((id) => !chosen.has(id));
    if (members.length > 500) throw Error("This category would have more than 500 posts. Choose another category.");
    if (members.length === before.length) return { record: category, added: [] };
    try {
      const record = await api.save({ ...category, data: { ...category.data, record_ids: members } }, generation);
      return { record, added: action === "add" ? [...new Set(added)] : [] };
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409 || attempt) throw error;
    }
  }
  throw Error("This category changed. Try organizing again.");
}

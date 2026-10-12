function validTotals(value: unknown): value is Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) &&
    Object.values(value).every((count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0);
}

// JSONB manifests and encrypted JSON pages can encode the same keys in different orders.
export function sameExportTotals(left: unknown, right: unknown): boolean {
  if (!validTotals(left) || !validTotals(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && left[key] === right[key]);
}

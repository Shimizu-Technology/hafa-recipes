import { kindName, type BabyRecord, type Child } from "./models";

export function visitSummary(rows: BabyRecord[], children: Child[], timezone: string, prepared = new Date()) {
  const date = (value: string | Date) => new Date(value).toLocaleString(undefined, { timeZone: timezone });
  return [
    "Håfa Baby — Questions & observations",
    `Prepared ${date(prepared)} (${timezone})`,
    "",
    ...rows.map((row) => {
      const data = row.data;
      const details = [
        row.title || kindName[row.kind],
        `${kindName[row.kind]} · ${date(row.occurred_at)}`,
        row.child_id ? children.find((child) => child.id === row.child_id)?.name ?? "Child profile unavailable" : "General / personal",
        data.provenance === "clinician_instruction"
          ? "Clinician instruction — labelled by you, not verified by AI."
          : "Personal record / observation",
      ];
      if (row.kind === "feeding") {
        details.push(data.method === "breast" ? "Breastfeeding" : data.method === "bottle" ? "Bottle feeding" : "Feeding");
        if (data.side) details.push(data.side === "both" ? "Both sides" : `${data.side === "left" ? "Left" : "Right"} side`);
        if (data.amount != null) details.push(`${data.amount} ${data.unit === "oz" ? "oz" : "mL"}`);
        if (data.duration_minutes != null) details.push(`${data.duration_minutes} minutes`);
      } else if (row.kind === "sleep") {
        details.push(`Started ${date(row.occurred_at)}`);
        if (data.end_at) {
          details.push(`Ended ${date(data.end_at)}`);
          details.push(`${Math.max(0, Math.round((Date.parse(data.end_at) - Date.parse(row.occurred_at)) / 60000))} minutes`);
        } else details.push("Sleep in progress");
      } else if (row.kind === "diaper") {
        details.push(data.type === "both" ? "Wet + dirty diaper" : `${data.type ?? "Recorded"} diaper`);
      }
      if (row.body) details.push(row.body);
      return details.join("\n");
    }).flatMap((entry, index) => index ? ["\n––––––––\n", entry] : [entry]),
    "",
    "Personal records selected by the account owner. This is not a medical assessment.",
  ].join("\n");
}

export async function savePrivateExport(value: unknown, _owner: string, guard: () => void) {
  guard();
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = "hafa-workouts-export.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

export async function cleanupPrivateExportFiles(_owner: string) {}

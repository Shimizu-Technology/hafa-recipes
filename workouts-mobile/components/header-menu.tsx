import { IconButton } from "./design/controls";
export type HeaderMenuItem = { title: string; onPress(): void; disabled?: boolean };
export function HeaderMenu({ onFallback }: { items: HeaderMenuItem[]; onFallback(): void }) {
  return <IconButton icon="ellipsis-horizontal" label="More options" variant="plain" onPress={onFallback} />;
}

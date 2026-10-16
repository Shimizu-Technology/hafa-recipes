import type { SourcePlayer } from "@/lib/source-playback";
export interface SourcePlayerProps { player: SourcePlayer; title: string; onClose(): void; onOpenOriginal(): void }
/** Web and non-native renderers use the explicit original-source action. */
export function SourcePlayerModal(_props: SourcePlayerProps) { return null; }

import { useState } from "react";
import { Alert, View } from "react-native";
import type { Conversation } from "@/lib/models";
import { Button, Copy, Field, Grouped, Icon, PressTarget, Row, Section, useColors } from "./ui";

/** Past chats. Rename and delete sit beside each row, so VoiceOver reaches them on their own. */
export function AskHistory({ items, manageable, onOpen, onRename, onDelete }: {
  items: Conversation[];
  /** The API only offers these with the new Ask on. */
  manageable: boolean;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const c = useColors(),
    [editing, setEditing] = useState<{ id: string; title: string } | null>(null),
    [busy, setBusy] = useState(false),
    name = (item: Conversation) => item.title || "A previous conversation";
  function menu(item: Conversation) {
    Alert.alert(name(item), undefined, [
      { text: "Rename", onPress: () => setEditing({ id: item.id, title: name(item) }) },
      { text: "Delete", style: "destructive", onPress: () => confirmDelete(item) },
      { text: "Cancel", style: "cancel" },
    ]);
  }
  function confirmDelete(item: Conversation) {
    Alert.alert("Delete this conversation?", "It will be erased from Håfa for good. Your entries aren’t affected.", [
      { text: "Keep it", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void onDelete(item.id) },
    ]);
  }
  async function save() {
    if (!editing?.title.trim() || busy) return;
    setBusy(true);
    const saved = await onRename(editing.id, editing.title.trim());
    setBusy(false);
    if (saved) setEditing(null);
  }
  return <Section title="Your conversations">
    {items.length ? <Grouped>{items.map((item) => editing?.id === item.id
      ? <View key={item.id} style={{ padding: 16, gap: 10, backgroundColor: c.tile }}>
          <Field label="Conversation name" value={editing.title} onChange={(title) => setEditing({ id: item.id, title })} />
          <Button title="Save name" busy={busy} disabled={!editing.title.trim()} onPress={() => void save()} />
          <Button secondary title="Cancel" onPress={() => setEditing(null)} />
        </View>
      : <View key={item.id} style={{ flexDirection: "row", alignItems: "center", backgroundColor: c.surface }}>
          <View style={{ flex: 1 }}>
            <Row title={name(item)} numericDetail detail={item.updated_at ? new Date(item.updated_at).toLocaleDateString() : undefined}
              icon="chatbubbles-outline" onPress={() => onOpen(item.id)} />
          </View>
          {manageable && <PressTarget accessibilityRole="button" accessibilityLabel={`Rename or delete: ${name(item)}`} onPress={() => menu(item)}
            style={{ width: 48, minHeight: 48, alignSelf: "stretch", alignItems: "center", justifyContent: "center" }}>
            <Icon name="ellipsis-horizontal" size={20} color={c.muted} />
          </PressTarget>}
        </View>)}</Grouped>
      : <Copy tone="muted">Your conversations will appear here.</Copy>}
  </Section>;
}

import { useState } from "react";
import { Alert, Platform, Share } from "react-native";
import { Stack, router } from "expo-router";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { messageFor, type BabyRecord } from "@/lib/models";
import { replaceRecord } from "@/lib/outbox";
import { sourceTitle } from "../lib/source-title";
import { CategoryPicker } from "@/components/category-picker";
import { useToast } from "@/components/ui";
import { headerActions } from "@/components/tab-stack";
import { ActionSheet, MenuButton, type MenuAction } from "./detail-chrome";

/** A saved post's own link, when it's one that can be shared. */
export function shareableLink(record: BabyRecord) {
  if (record.kind !== "source" || !record.data.url) return null;
  try {
    const url = new URL(record.data.url);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
}

/** The ⋯ menu's heading: a saved post by its own title, so she knows which post she's acting on. */
export function recordMenuTitle(record: BabyRecord, label: string) {
  if (record.kind !== "source") return label;
  const title = sourceTitle(record).trim();
  return title && title !== "Saved source" ? title : "Saved post";
}

/** What an entry's ⋯ menu offers, in order. Organizing comes first on a saved post, since that's what Saved is for. */
export function recordMenuKeys(record: BabyRecord): ("category" | "edit" | "share" | "delete")[] {
  return [
    ...(record.kind === "source" && !record.cache_partial ? ["category" as const] : []),
    "edit" as const,
    ...(shareableLink(record) ? ["share" as const] : []),
    "delete" as const,
  ];
}

/**
 * An entry's actions, in the ⋯ menu at the top right instead of a pile at the bottom of the page:
 * organize, edit, share and delete. Delete still asks first, with the same words as before.
 */
export function RecordMenu({ record, title, onError }: { record: BabyRecord; title: string; onError: (message: string) => void }) {
  const b = useBaby(), toast = useToast(), [open, setOpen] = useState(false), [organizing, setOrganizing] = useState(false);
  function remove() {
    Alert.alert(
      "Delete this entry?",
      "This removes the saved entry from your Baby history. This action cannot be undone after syncing.",
      [
        { text: "Keep entry", style: "cancel" },
        {
          text: "Delete entry",
          style: "destructive",
          onPress: () => {
            void b.queue({ id: Crypto.randomUUID(), generation: b.state.bootstrap!.generation, type: "delete", record })
              .then(() => { toast("Entry removed."); router.back(); })
              .catch((e) => onError(messageFor(e)));
          },
        },
      ]
    );
  }
  async function categorized(category: BabyRecord, added: string[]) {
    setOrganizing(false);
    try {
      await b.commit((s) => ({ ...s, records: replaceRecord(s.records, category) }));
      toast(added.length ? `Added to ${category.title}.` : `Already in ${category.title}.`);
    } catch (failure) { onError(messageFor(failure)); }
  }
  const link = shareableLink(record);
  const all: Record<ReturnType<typeof recordMenuKeys>[number], MenuAction> = {
    category: { title: "Add to a category", icon: "folder-outline", onPress: () => setOrganizing(true) },
    edit: { title: "Edit", icon: "pencil-outline", onPress: () => router.push({ pathname: "/edit", params: { id: record.id, kind: record.kind } }) },
    share: { title: "Share link", icon: "share-outline", onPress: () => {
      void Share.share(Platform.OS === "ios" ? { url: link! } : { message: link! }).catch(() => onError("Could not open sharing. Try again."));
    } },
    delete: { title: "Delete", icon: "trash-outline", destructive: true, onPress: remove },
  };
  return <>
    <Stack.Screen options={headerActions(<MenuButton label="More actions" onPress={() => setOpen(true)} />)} />
    <ActionSheet visible={open} title={recordMenuTitle(record, title)} actions={recordMenuKeys(record).map((key) => all[key])} onClose={() => setOpen(false)} />
    {organizing && <CategoryPicker sourceIds={[record.id]} onClose={() => setOrganizing(false)} onSaved={(category, added) => void categorized(category, added)} />}
  </>;
}

import { useLayoutEffect, useRef, useState } from "react";
import { Linking, Platform, Text, View } from "react-native";
import { Markdown, MarkdownIt, type RenderRules } from "@believer/react-native-markdown-display";
import { Button, Copy, Notice, Sheet, useColors } from "./ui";
import { typography } from "@/constants/theme";

// Match Recipes: assistant markup never loads a remote image or raw HTML.
const parser = new MarkdownIt({ html: false, linkify: false });
const rules: RenderRules = {
  image: () => null,
  textgroup: (node, children, _parents, styles) => <Text key={node.key} selectable style={styles.textgroup}>{children}</Text>,
  fence: (node, _children, _parents, styles, inherited = {}) => <Text key={node.key} selectable style={[inherited, styles.fence]}>{node.content}</Text>,
  code_block: (node, _children, _parents, styles, inherited = {}) => <Text key={node.key} selectable style={[inherited, styles.code_block]}>{node.content}</Text>,
};
export function CoachReply({ text, scopeToken, isCurrent }: { text: string; scopeToken: object; isCurrent(): boolean }) {
  const c = useColors();
  type Prompt = { url: string; hostname: string; current(): boolean };
  const liveScope = useRef<object | null>(null);
  const pending = useRef<Prompt | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [failure, setFailure] = useState<{ message: string; current(): boolean } | null>(null);
  useLayoutEffect(() => {
    liveScope.current = scopeToken; pending.current = null; setPrompt(null); setFailure(null);
    return () => { if (liveScope.current === scopeToken) liveScope.current = null; pending.current = null; };
  }, [scopeToken]);
  const current = () => liveScope.current === scopeToken && isCurrent();
  function dismiss(selected: Prompt) {
    if (pending.current !== selected) return;
    pending.current = null; setPrompt(null);
  }
  async function confirm(selected: Prompt) {
    if (pending.current !== selected || !selected.current()) return;
    dismiss(selected);
    try { await Linking.openURL(selected.url); }
    catch {
      if (selected.current()) setFailure({ message: "This coach link could not be opened.", current: selected.current });
    }
  }
  function openLink(value: string) {
    if (!current()) return false;
    pending.current = null; setPrompt(null); setFailure(null);
    try {
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw Error("Unsafe link");
      const selected = { url: url.toString(), hostname: url.hostname, current };
      pending.current = selected; setPrompt(selected);
    } catch { setFailure({ message: "This coach link cannot be opened safely.", current }); }
    return false;
  }
  return <View style={{ gap: 8, alignSelf: "stretch", minWidth: 0, flexShrink: 0 }}><Markdown markdownit={parser} rules={rules} onLinkPress={openLink} style={{
    body: { ...typography.body, color: c.text, flexShrink: 0 },
    paragraph: { marginVertical: 4, flexShrink: 0 },
    strong: { fontFamily: typography.heading.fontFamily },
    em: { fontStyle: "italic" },
    bullet_list: { marginVertical: 4 }, ordered_list: { marginVertical: 4 },
    list_item: { marginVertical: 2, flexShrink: 0, flexWrap: "nowrap", alignItems: "flex-start" },
    bullet_list_icon: { color: c.accentText, marginRight: 8 },
    ordered_list_icon: { color: c.accentText, marginRight: 8 },
    bullet_list_content: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
    ordered_list_content: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
    heading1: { ...typography.heading, color: c.text, marginVertical: 8 },
    heading2: { ...typography.subheading, color: c.text, marginVertical: 6 },
    heading3: { ...typography.label, color: c.text, marginVertical: 4 },
    code_inline: { backgroundColor: c.sunken, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
    fence: { backgroundColor: c.sunken, padding: 8, borderRadius: 8, marginVertical: 4, flexShrink: 1 },
    code_block: { backgroundColor: c.sunken, padding: 8, borderRadius: 8, marginVertical: 4, flexShrink: 1 },
    link: { color: c.accentText },
  }}>{text}</Markdown>
    {prompt && <Sheet visible={prompt.current()} title="Open this link?" onClose={() => dismiss(prompt)}>
      <Copy selectable>{prompt.hostname}</Copy>
      <Button title="Open link" onPress={() => { void confirm(prompt); }} />
      <Button title="Cancel" secondary onPress={() => dismiss(prompt)} />
    </Sheet>}
    {failure?.current() && <Notice error>{failure.message}</Notice>}
  </View>;
}

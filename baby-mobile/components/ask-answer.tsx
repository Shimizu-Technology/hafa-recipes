import { Linking, Text, View } from "react-native";
import { answerParts, openableSources } from "@/lib/ask-sources";
import type { WebSource } from "@/lib/models";
import { Copy, Grouped, Row, fonts, useColors, useToast } from "./ui";

function useOpenLink() {
  const toast = useToast();
  return (url: string) => void Linking.openURL(url).catch(() => toast("This device couldn’t open that link."));
}

/** The answer's words. Web references inside them open their page. */
export function AnswerText({ text, sources }: { text: string; sources?: WebSource[] }) {
  const c = useColors(), open = useOpenLink();
  return <Copy>{answerParts(text, sources).map((part, index) => part.url
    ? <Text key={index} accessibilityRole="link" onPress={() => open(part.url!)} style={{ color: c.accentText, fontFamily: fonts.semibold }}>{part.text}</Text>
    : part.text)}</Copy>;
}

function SourceList({ heading, sources }: { heading: string; sources: WebSource[] }) {
  const open = useOpenLink();
  if (!sources.length) return null;
  return <View style={{ gap: 8 }}>
    <Copy kind="small" tone="muted">{heading}</Copy>
    <Grouped>{sources.map((source) => <Row key={source.url} title={source.title} detail={source.domain}
      icon="open-outline" hint="Opens this page in your browser" onPress={() => open(source.url)} />)}</Grouped>
  </View>;
}

/** Where web findings came from, kept apart from her own entries. Every search uses the trusted list. */
export function WebSources({ sources }: { sources?: WebSource[] }) {
  return <SourceList heading="From trusted sources" sources={openableSources(sources)} />;
}

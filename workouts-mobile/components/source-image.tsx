import { useEffect, useState } from "react";
import { Image, Modal, Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Copy, useColors } from "./ui";
export function SourceImage({ uri, label }: { uri: string; label: string }) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [ratio, setRatio] = useState(1);
  const size = useWindowDimensions();
  const c = useColors();
  useEffect(() => { setFailed(false); setOpen(false); setZoom(1); }, [uri]);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Enlarge ${label}`}
        onPress={() => {
          setZoom(1);
          setOpen(true);
        }}
      >
        <Image
          source={{ uri }}
          accessibilityLabel={label}
          onError={() => setFailed(true)}
          onLoad={(event) => {
            const source = event.nativeEvent?.source;
            if (Number.isFinite(source?.width) && Number.isFinite(source?.height) && source.width > 0 && source.height > 0) {
              const nextRatio = source.height / source.width;
              if (Number.isFinite(nextRatio) && nextRatio > 0) setRatio(nextRatio);
            }
          }}
          style={{ width: "100%", height: 260, resizeMode: "contain" }}
        />
        <Copy kind="small">
          {failed
            ? "This image is unavailable. You can still check the original source."
            : "Tap to inspect source image"}
        </Copy>
      </Pressable>
      <Modal visible={open} onRequestClose={() => setOpen(false)} presentationStyle="fullScreen">
        <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
          <View style={{ padding: 16, gap: 12 }}>
            <Copy kind="heading">{label}</Copy>
            <Button title="Close source image" secondary onPress={() => setOpen(false)} />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Zoom out"
                  secondary
                  disabled={zoom <= 1}
                  onPress={() => setZoom((value) => Math.max(1, value - 0.5))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Zoom in"
                  secondary
                  disabled={zoom >= 4}
                  onPress={() => setZoom((value) => Math.min(4, value + 0.5))}
                />
              </View>
            </View>
          </View>
          <ScrollView horizontal contentContainerStyle={{ alignItems: "flex-start" }}>
            <ScrollView style={{ width: size.width * zoom }} contentContainerStyle={{ width: size.width * zoom }}>
              <Image
                source={{ uri }}
                accessibilityLabel={label}
                style={{ width: size.width * zoom, height: size.width * zoom * ratio, resizeMode: "contain" }}
              />
            </ScrollView>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

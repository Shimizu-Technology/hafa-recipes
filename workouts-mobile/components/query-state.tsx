import { ActivityIndicator } from "react-native";
import type { PropsWithChildren } from "react";
import { Button, Notice, useColors } from "./ui";
export function QueryState({
  loading,
  error,
  retry,
  loadingLabel = "Loading your training",
  errorMessage,
  children,
}: PropsWithChildren<{ loading: boolean; error: Error | null; retry(): void; loadingLabel?: string; errorMessage?: string }>) {
  const c = useColors();
  if (loading) return <ActivityIndicator accessibilityLabel={loadingLabel} color={c.action} />;
  if (error)
    return (
      <>
        <Notice error>{errorMessage ?? error.message}</Notice>
        <Button title="Try again" secondary onPress={retry} />
      </>
    );
  return children;
}

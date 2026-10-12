import { ActivityIndicator } from "react-native";
import type { PropsWithChildren } from "react";
import { Button, Notice, useColors } from "./ui";
export function QueryState({
  loading,
  error,
  retry,
  children,
}: PropsWithChildren<{ loading: boolean; error: Error | null; retry(): void }>) {
  const c = useColors();
  if (loading) return <ActivityIndicator accessibilityLabel="Loading your training" color={c.action} />;
  if (error)
    return (
      <>
        <Notice error>{error.message}</Notice>
        <Button title="Try again" secondary onPress={retry} />
      </>
    );
  return children;
}

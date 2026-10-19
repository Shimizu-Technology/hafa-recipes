import type { PropsWithChildren } from "react";
import { Button, Notice, SkeletonCard } from "./ui";
/**
 * Loading, error and retry for a screen's main query. While loading it shows a
 * skeleton card rather than a bare spinner.
 */
export function QueryState({
  loading,
  error,
  retry,
  loadingLabel = "Loading your training",
  errorMessage,
  children,
}: PropsWithChildren<{
  loading: boolean;
  error: Error | null;
  retry(): void;
  loadingLabel?: string;
  errorMessage?: string;
}>) {
  if (loading) return <SkeletonCard lines={3} label={loadingLabel} />;
  if (error)
    return (
      <>
        <Notice error>{errorMessage ?? error.message}</Notice>
        <Button title="Try again" secondary onPress={retry} />
      </>
    );
  return children;
}

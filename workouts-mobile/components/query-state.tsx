import type { PropsWithChildren } from "react";
import { Button, Notice, SkeletonCard } from "./ui";
/**
 * Loading, error and retry for a screen's main query. While loading it shows a
 * skeleton card rather than a bare spinner.
 */
export function QueryState({
  loading,
  hasData = false,
  error,
  retry,
  loadingLabel = "Loading your training",
  errorMessage,
  children,
}: PropsWithChildren<{
  loading: boolean;
  /** A successful cached response exists, including an empty list or null profile. */
  hasData?: boolean;
  error: Error | null;
  retry(): void;
  loadingLabel?: string;
  errorMessage?: string;
}>) {
  if (loading && !hasData) return <SkeletonCard lines={3} label={loadingLabel} />;
  if (error)
    return (
      <>
        <Notice error>{hasData ? "Couldn’t refresh. Showing your saved content." : errorMessage ?? error.message}</Notice>
        <Button title="Try again" secondary size={hasData ? "sm" : undefined} onPress={retry} />
        {hasData && children}
      </>
    );
  return children;
}

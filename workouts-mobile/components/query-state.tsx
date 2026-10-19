import type { PropsWithChildren, ReactNode } from "react";
import { Button, Notice, SkeletonCard } from "./ui";
/**
 * Loading, error and retry for a screen's main query. While loading it shows
 * `placeholder` (shaped like the final layout) or a generic skeleton card.
 */
export function QueryState({
  loading,
  error,
  retry,
  loadingLabel = "Loading your training",
  errorMessage,
  placeholder,
  children,
}: PropsWithChildren<{
  loading: boolean;
  error: Error | null;
  retry(): void;
  loadingLabel?: string;
  errorMessage?: string;
  placeholder?: ReactNode;
}>) {
  if (loading) return placeholder ?? <SkeletonCard lines={3} label={loadingLabel} />;
  if (error)
    return (
      <>
        <Notice error>{errorMessage ?? error.message}</Notice>
        <Button title="Try again" secondary onPress={retry} />
      </>
    );
  return children;
}

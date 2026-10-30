import { useEffect, useState, type PropsWithChildren } from "react";
import { ApiError } from "@/lib/api";
import { Button, Copy, Notice, SkeletonCard } from "./ui";
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
  const [details, setDetails] = useState(false);
  useEffect(() => setDetails(false), [error]);
  if (loading && !hasData) return <SkeletonCard lines={3} label={loadingLabel} />;
  if (error)
    return (
      <>
        <Notice error>{hasData ? "Couldn’t refresh. Showing your saved content." : errorMessage ?? (error instanceof ApiError ? error.message : "We couldn’t load this right now. Check your connection and try again.")}</Notice>
        <Button title="Try again" secondary size={hasData ? "sm" : undefined} onPress={retry} />
        {!(error instanceof ApiError) && <>
          <Button title={details ? "Hide details" : "Show details"} variant="ghost" size="sm" onPress={() => setDetails(!details)} />
          {details && <Copy kind="small" tone="muted">{error.message}</Copy>}
        </>}
        {hasData && children}
      </>
    );
  return children;
}

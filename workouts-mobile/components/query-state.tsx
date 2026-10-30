import { useEffect, useState, type PropsWithChildren } from "react";
import { ApiError } from "@/lib/api";
import { Button, Copy, Notice, SkeletonCard } from "./ui";
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
  const [details, setDetails] = useState(false);
  useEffect(() => setDetails(false), [error]);
  if (loading) return <SkeletonCard lines={3} label={loadingLabel} />;
  if (error)
    return (
      <>
        <Notice error>{errorMessage ?? (error instanceof ApiError ? error.message : "We couldn’t load this right now. Check your connection and try again.")}</Notice>
        <Button title="Try again" secondary onPress={retry} />
        {!(error instanceof ApiError) && <>
          <Button title={details ? "Hide details" : "Show details"} variant="ghost" size="sm" onPress={() => setDetails(!details)} />
          {details && <Copy kind="small" tone="muted">{error.message}</Copy>}
        </>}
      </>
    );
  return children;
}

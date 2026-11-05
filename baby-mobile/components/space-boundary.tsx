import { Fragment, type ReactNode } from "react";
import { useBaby } from "@/lib/context";
import { accessKey } from "../lib/spaces";

/** A family arriving, going or changing role remounts every screen, so no open editor, pager or Ask memory outlives it. */
export function SpaceBoundary({ children }: { children: ReactNode }) {
  const b = useBaby();
  return <Fragment key={accessKey(b.state.bootstrap)}>{children}</Fragment>;
}

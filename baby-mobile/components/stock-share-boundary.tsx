import type { PropsWithChildren } from "react";
import { useAuth } from "@clerk/expo";
import { useShareIntentContext } from "expo-share-intent";
import { configuration } from "../lib/config";
import { stockShareScope } from "../lib/stock-share-scope";

export function StockShareBoundary({ children }: PropsWithChildren) {
  const { isLoaded, isSignedIn, userId } = useAuth(), stock = useShareIntentContext();
  if (stock.hasShareIntent) stockShareScope.observe(stock.shareIntent,
    isLoaded && isSignedIn && userId ? `${configuration.clerkEnvironment}:${userId}` : null);
  return children;
}

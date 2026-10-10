import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import * as Crypto from "expo-crypto";
import { createNativeHealthProvider } from "./health/provider";
import type { HealthProvider, HealthAvailability, HealthAccess } from "./health/types";
import { createHealthClient, healthOwnerScope, type ProviderName } from "./health-client";
import { useTraining } from "./context";
export function useNativeHealth() {
  const { api, owner, enrollment, storage } = useTraining();
  const generation = enrollment?.enrolled ? enrollment.generation : null;
  const name: ProviderName = Platform.OS === "ios" ? "apple_health" : "health_connect";
  const [provider, setProvider] = useState<HealthProvider | null>(null);
  const [availability, setAvailability] = useState<HealthAvailability | null>(null);
  const [access, setAccess] = useState<HealthAccess | null>(null);
  const current = useRef<string | null>(generation ? healthOwnerScope(owner, generation) : null);
  current.current = generation ? healthOwnerScope(owner, generation) : null;
  const foreground = useRef(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      foreground.current = state === "active";
    });
    return () => {
      current.current = null;
      foreground.current = false;
      sub.remove();
    };
  }, []);
  useEffect(() => {
    let active = true;
    void createNativeHealthProvider()
      .then(async (value) => {
        const status = await value.availability();
        if (active) {
          setProvider(value);
          setAvailability(status);
        }
      })
      .catch(() => {
        if (active)
          setAvailability({
            status: "native_build_required",
            message: "Use an installed iPhone or Android build with health modules enabled.",
          });
      });
    return () => {
      active = false;
    };
  }, []);
  const client = useMemo(
    () =>
      provider && generation
        ? createHealthClient({
            api,
            storage,
            owner,
            enrollment_generation: generation,
            provider,
            provider_name: name,
            currentOwnerScope: () => current.current,
            isForeground: () => foreground.current,
            uuid: Crypto.randomUUID,
          })
        : null,
    [provider, generation, owner, api, name, storage]
  );
  async function requestAccess(read: boolean, write: boolean) {
    if (!provider) throw Error("The native health provider is not ready.");
    const status = await provider.requestAccess({ read, write });
    setAccess(status);
    return status;
  }
  return { name, provider, availability, access, requestAccess, client };
}

import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ environment: "development", get: vi.fn(), set: vi.fn(), assets: vi.fn(() => ({})), loaded: true, fontError: null as Error | null }));
vi.mock("@/lib/config", () => ({ configuration: { get environment() { return f.environment; } } }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: f.get, setItem: f.set } }));
vi.mock("expo-font", () => ({ useFonts: () => [f.loaded, f.fontError] }));
vi.mock("@/components/look-fonts", () => ({ lookFonts: f.assets }));
import { LookProvider } from "@/components/look-provider";
import { useLook } from "./look-context";
import { LOOK_STORAGE_KEY } from "@/constants/looks";
let look: ReturnType<typeof useLook>, view: ReactTestRenderer;
function Child() { look = useLook(); return createElement("look", { id: look.id }); }
async function mount() { await act(async () => { view = create(createElement(LookProvider, null, createElement(Child))); }); }
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks(); f.environment = "development"; f.get.mockResolvedValue(null); f.set.mockResolvedValue(undefined); f.loaded = true; f.fontError = null; });
afterEach(() => { act(() => view?.unmount()); });
it("restores selection and persists changes including reset to Current", async () => {
  f.get.mockResolvedValue("athletic"); await mount(); expect(look.id).toBe("athletic");
  await act(async () => look.setLook("coach")); expect(look.id).toBe("coach"); expect(f.set).toHaveBeenLastCalledWith(LOOK_STORAGE_KEY, "coach");
  await act(async () => look.setLook("current")); expect(look.id).toBe("current"); expect(f.set).toHaveBeenLastCalledWith(LOOK_STORAGE_KEY, "current");
});
it("production neither reads storage nor loads preview fonts nor accepts a change", async () => {
  f.environment = "production"; f.get.mockResolvedValue("pro"); await mount();
  act(() => look.setLook("athletic")); expect(look.id).toBe("current"); expect(look.enabled).toBe(false);
  expect(f.get).not.toHaveBeenCalled(); expect(f.set).not.toHaveBeenCalled(); expect(f.assets).not.toHaveBeenCalled();
});
it("keeps the previous look until fonts load and surfaces a font failure", async () => {
  await mount(); f.loaded = false;
  await act(async () => look.setLook("athletic")); expect(look.id).toBe("current"); expect(look.pending).toBe(true);
  f.fontError = new Error("font missing"); await act(async () => view.update(createElement(LookProvider, null, createElement(Child))));
  expect(look.id).toBe("current"); expect(look.error).toContain("font could not load"); expect(f.set).not.toHaveBeenCalled();
});
it("does not let late hydration overwrite an explicit choice", async () => {
  let resolve!: (value: string) => void; f.get.mockReturnValue(new Promise<string>(r => { resolve = r; })); await mount();
  await act(async () => look.setLook("pro")); await act(async () => resolve("athletic")); expect(look.id).toBe("pro");
});
it("reports failed persistence and retries even when the same look is chosen", async () => {
  await mount(); f.set.mockRejectedValueOnce(new Error("disk")); await act(async () => look.setLook("pro")); expect(look.error).toContain("could not be saved");
  await act(async () => look.setLook("pro")); expect(look.error).toBe(""); expect(f.set).toHaveBeenCalledTimes(2);
});

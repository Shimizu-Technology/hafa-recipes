import { requireOptionalNativeModule } from "expo-modules-core";
export interface NativeCapture {
  captureKey: string; captureId: string; ownerId?: string; generation?: number; isPublic: boolean;
  url?: string; text: string; files: Array<{ path: string; mimeType: string; fileName: string; width?: number; height?: number }>;
  jobId?: string; workoutId?: string;
}
export interface ShareSession {
  token: string; account_scope_id: string; credential_id: string; expires_at: string; is_public: boolean; generation: number;
}
type Bridge = {
  installationId(): Promise<string>;
  configureSession(token: string, base: string, scope: string, expires: string, owner: string, generation: number, isPublic: boolean): Promise<void>;
  clearSession(): Promise<void>;
  sessionOwner(): Promise<string | null>;
  captures(): Promise<string>;
  acknowledge(key: string): Promise<boolean>;
  discardCaptures(owner: string): Promise<void>;
};
const bridge = requireOptionalNativeModule<Bridge>("HafaWorkoutsShare");
export const nativeSharingAvailable = !!bridge;
export const installationId = () => bridge!.installationId();
export const configureSession = (value: ShareSession, base: string, owner: string) =>
  bridge!.configureSession(value.token, base, value.account_scope_id, value.expires_at, owner, value.generation, value.is_public);
export const clearSession = async () => { await bridge?.clearSession(); };
export const sessionOwner = async () => bridge?.sessionOwner() ?? null;
export const captures = async (): Promise<NativeCapture[]> => bridge ? JSON.parse(await bridge.captures()) : [];
export const acknowledge = async (key: string) => bridge?.acknowledge(key) ?? false;
export const discardCaptures = async (owner: string) => { await bridge?.discardCaptures(owner); };

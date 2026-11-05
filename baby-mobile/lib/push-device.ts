import { ApiError } from "./api";

/** The phone's side of `/push/devices`. Nothing here ever asks for permission or says anything on screen. */
export interface PushDeviceEnvironment {
  platform: "ios" | "android";
  online(): boolean;
  /** Whether notifications are allowed already. Never prompts. */
  granted(): Promise<boolean>;
  token(): Promise<string | null>;
  installation(): Promise<string>;
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  erase(): Promise<void>;
  put(installation: string, token: string, platform: "ios" | "android", generation: number): Promise<{ registration: string }>;
  remove(installation: string, registration: string): Promise<void>;
  /** For a sign-out the API can't hear about: the phone itself stops taking pushes until the next sign-in registers. */
  stopDelivery(): Promise<void>;
  now(): number;
}
interface Held {
  installation: string;
  registration: string;
  token: string;
}
const retryAfter = 5 * 60_000;

function parsed(value: string | null): Held | null {
  try {
    const held = value ? JSON.parse(value) : null;
    return typeof held?.registration === "string" && typeof held?.installation === "string" ? held : null;
  } catch {
    return null;
  }
}

export function createPushDevice(env: PushDeviceEnvironment) {
  let confirmed = "", failed = { key: "", at: 0 }, running: Promise<boolean> | null = null;
  async function register(generation: number) {
    try {
      if (!(await env.granted())) return false;
      const token = await env.token();
      if (!token) return false;
      const key = JSON.stringify([token, generation]);
      if (key === confirmed) return true;
      if (key === failed.key && env.now() - failed.at < retryAfter) return false;
      try {
        const installation = await env.installation();
        const { registration } = await env.put(installation, token, env.platform, generation);
        await env.write(JSON.stringify({ installation, registration, token } satisfies Held));
        confirmed = key;
        return true;
      } catch {
        failed = { key, at: env.now() };
        return false;
      }
    } catch {
      return false; // No token today, say on a simulator. The next pass looks again.
    }
  }
  return {
    /** Registers if this phone is allowed to notify and the API doesn't have this token yet. True once it does. */
    ensure(generation: number): Promise<boolean> {
      if (running) return running;
      const work = register(generation).finally(() => { running = null; });
      running = work;
      return work;
    },
    /**
     * Sign-out. Sends back the registration it holds, so one that arrives after a newer sign-in leaves that sign-in.
     * Bounded and can't throw: nothing here may keep someone signed in.
     */
    async end(limit = 5000) {
      confirmed = "";
      failed = { key: "", at: 0 };
      try {
        const held = parsed(await env.read());
        if (!held) return;
        let heard = false;
        if (env.online()) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              env.remove(held.installation, held.registration),
              new Promise((_, reject) => { timer = setTimeout(() => reject(new ApiError("Timed out", 0)), limit); }),
            ]);
            heard = true;
          } catch (failure) {
            heard = failure instanceof ApiError && failure.status !== 0 && failure.status < 500;
          } finally {
            if (timer) clearTimeout(timer);
          }
        }
        if (!heard) await env.stopDelivery().catch(() => undefined);
        await env.erase();
      } catch { /* The next registration replaces whatever was left. */ }
    },
  };
}
export type PushDevice = ReturnType<typeof createPushDevice>;

/** The phone's side of `/push/devices`. Nothing here ever asks for permission or says anything on screen. */
export interface PushDeviceEnvironment {
  platform: "ios" | "android";
  /** Whose phone this is now. A removal only answers for that account's phones. */
  binding: string;
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
  /** For a sign-out the API hasn't confirmed: the phone itself stops taking pushes until the next sign-in registers. */
  stopDelivery(): Promise<void>;
  /** One per phone, kept through sign-outs. A token is one row on the API, so only the newest ever matters. */
  readRevocation(): Promise<string | null>;
  writeRevocation(value: string | null): Promise<void>;
  now(): number;
}
interface Held {
  installation: string;
  registration: string;
  token: string;
}
interface Revocation {
  installation: string;
  registration: string;
  binding: string;
}
const retryAfter = 5 * 60_000;

function timeout(ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  const done = new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });
  return { done, clear: () => clearTimeout(timer) };
}

function parsed<T extends { registration: string; installation: string }>(value: string | null): T | null {
  try {
    const held = value ? JSON.parse(value) : null;
    return typeof held?.registration === "string" && typeof held?.installation === "string" ? held : null;
  } catch {
    return null;
  }
}

export function createPushDevice(env: PushDeviceEnvironment) {
  let confirmed = "", failed = { key: "", at: 0 }, running: Promise<boolean> | null = null,
    cleaning: Promise<void> | null = null, session = 0, revokeTried = 0;
  /** Only a removal the API has answered counts. */
  async function removed(installation: string, registration: string, limit: Promise<unknown>) {
    if (!env.online()) return false;
    try {
      return await Promise.race([env.remove(installation, registration).then(() => true), limit.then(() => false)]);
    } catch {
      return false;
    }
  }
  /** Saved before anything native starts, which can stall: Android's token delete needs a network. */
  const remember = (installation: string, registration: string) =>
    env.writeRevocation(JSON.stringify({ installation, registration, binding: env.binding } satisfies Revocation)).catch(() => undefined);
  const stop = () => env.stopDelivery().catch(() => undefined);
  /** Left from a sign-out the API never confirmed. This account can finish it; another can't, until it registers. */
  async function settleRevocation() {
    const held = parsed<Revocation>(await env.readRevocation());
    if (!held || held.binding !== env.binding || !env.online() || env.now() - revokeTried < retryAfter && revokeTried) return;
    revokeTried = env.now();
    await env.remove(held.installation, held.registration);
    await env.writeRevocation(null);
  }
  async function register(generation: number, mine: number) {
    try {
      const token = (await env.granted()) ? await env.token() : null;
      if (!token) {
        await settleRevocation().catch(() => undefined);
        return false;
      }
      const key = JSON.stringify([token, generation]);
      if (key === confirmed) return true;
      if (key === failed.key && env.now() - failed.at < retryAfter) return false;
      try {
        const installation = await env.installation();
        const { registration } = await env.put(installation, token, env.platform, generation);
        // Signed out while this was on its way, past what sign-out would wait for. It's not hers to keep.
        if (mine !== session) {
          const wait = timeout(5000);
          if (!(await removed(installation, registration, wait.done))) {
            await remember(installation, registration);
            await stop();
          }
          wait.clear();
          return false;
        }
        await env.write(JSON.stringify({ installation, registration, token } satisfies Held));
        // The token moved here, whoever had it: anything older has nothing left to remove.
        await env.writeRevocation(null).catch(() => undefined);
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
  async function cleanUp(limit: Promise<unknown>) {
    const settled = running ? await Promise.race([running.then(() => true), limit.then(() => false)]) : true;
    // From here a late answer is revoked where it lands, rather than kept.
    session++;
    const unknown = Symbol();
    const held = await Promise.race([env.read().then(parsed<Held>), limit.then(() => unknown)]).catch(() => unknown);
    const known = typeof held === "object" ? held : null;
    const gone = !!known && (await removed(known.installation, known.registration, limit));
    if (known && !gone) await remember(known.installation, known.registration);
    await env.erase().catch(() => undefined);
    // Last, as the one most likely to stall. Only needed when the API may still be sending here.
    if (!settled || held === unknown || (known && !gone)) await stop();
  }
  return {
    installation: () => env.installation(),
    /** The API says it doesn't know this phone: it asks again on the next pass. */
    forget() {
      confirmed = "";
    },
    /** Registers if this phone is allowed to notify and the API doesn't have this token yet. True once it does. */
    ensure(generation: number): Promise<boolean> {
      if (cleaning) return Promise.resolve(false);
      if (running) return running;
      const work = register(generation, session).finally(() => { if (running === work) running = null; });
      running = work;
      return work;
    },
    /**
     * Sign-out. Sends back the registration it holds, so one that arrives after a newer sign-in leaves that sign-in. A
     * registration still under way is waited for and revoked with it. Always returns within `limit` and can't throw:
     * nothing here may keep someone signed in. Anything still stalled carries on behind, and this phone doesn't register
     * again until it's done, so a late native stop can't undo a new sign-in's registration.
     */
    async end(limit = 5000) {
      confirmed = "";
      failed = { key: "", at: 0 };
      const overall = timeout(limit), network = timeout(limit * 0.9);
      cleaning ??= cleanUp(network.done).catch(() => undefined).finally(() => { cleaning = null; });
      await Promise.race([cleaning, overall.done]);
      overall.clear();
      network.clear();
    },
  };
}
export type PushDevice = ReturnType<typeof createPushDevice>;

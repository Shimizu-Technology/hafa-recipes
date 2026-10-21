import { ApiError } from "./api";

/** Retry only transient failures while the same account is still opening. */
export async function openingAccount<T>(action: () => Promise<T>, current: () => boolean): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (!current()) throw Error("Account setup was stopped.");
    try {
      const result = await action();
      if (!current()) throw Error("Account setup was stopped.");
      return result;
    }
    catch (failure) {
      if (!current() || attempt >= 2 || !(failure instanceof ApiError) || failure.local ||
        ![0, 408, 429, 500, 502, 503, 504].includes(failure.status)) throw failure;
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 300 : 900));
    }
  }
}

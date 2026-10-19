/**
 * App-wide toast state. One toast at a time: a new toast replaces the current
 * one and restarts its timer. Kept free of React Native imports so screens can
 * call `showToast` from anywhere and the timing logic stays testable.
 */

export type ToastTone = 'neutral' | 'success' | 'error';

export type ToastOptions = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: ToastTone;
  /** Override the auto-dismiss delay in milliseconds. */
  duration?: number;
};

export type ToastState = Required<Pick<ToastOptions, 'message' | 'tone'>> &
  Pick<ToastOptions, 'actionLabel' | 'onAction'> & { id: number; duration: number };

export const TOAST_DURATION_MS = 3500;
/** Give people time to reach an action before the toast leaves. */
export const TOAST_ACTION_DURATION_MS = 5000;

type Listener = () => void;

let current: ToastState | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((listener) => listener());
}

function clearTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Show a toast, replacing any visible one. Returns its id. */
export function showToast(options: ToastOptions): number {
  clearTimer();
  const hasAction = Boolean(options.actionLabel && options.onAction);
  const toast: ToastState = {
    id: nextId++,
    message: options.message,
    tone: options.tone ?? 'neutral',
    actionLabel: hasAction ? options.actionLabel : undefined,
    onAction: hasAction ? options.onAction : undefined,
    duration: options.duration ?? (hasAction ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS),
  };
  current = toast;
  timer = setTimeout(() => hideToast(toast.id), toast.duration);
  emit();
  return toast.id;
}

/** Hide the current toast, or only the given toast if it is still current. */
export function hideToast(id?: number) {
  if (!current || (id !== undefined && current.id !== id)) return;
  clearTimer();
  current = null;
  emit();
}

/** Run the toast's action once, then dismiss it. */
export function runToastAction(id: number) {
  if (!current || current.id !== id) return;
  const action = current.onAction;
  hideToast(id);
  action?.();
}

export function getToast(): ToastState | null {
  return current;
}

export function subscribeToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

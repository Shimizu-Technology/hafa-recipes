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
  Pick<ToastOptions, 'actionLabel' | 'onAction'> & {
    id: number;
    duration: number;
    /** Stays until dismissed or replaced (an action toast while a screen reader is on). */
    persistent: boolean;
  };

export const TOAST_DURATION_MS = 3500;
/** Give people time to reach an action before the toast leaves. */
export const TOAST_ACTION_DURATION_MS = 5000;

type Listener = () => void;

let current: ToastState | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;
let screenReaderEnabled = false;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((listener) => listener());
}

function clearTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

function schedule(toast: ToastState) {
  clearTimer();
  if (!toast.persistent) timer = setTimeout(() => hideToast(toast.id), toast.duration);
}

/**
 * Screen reader users need time to find a toast's action, so action toasts
 * do not auto-dismiss while one is running.
 */
export function setToastScreenReaderEnabled(enabled: boolean) {
  if (enabled === screenReaderEnabled) return;
  screenReaderEnabled = enabled;
  if (!current?.actionLabel) return;
  current = { ...current, persistent: enabled };
  schedule(current);
  emit();
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
    persistent: hasAction && screenReaderEnabled,
  };
  current = toast;
  schedule(toast);
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

/** What a screen reader announces: the message, plus the action when there is one. */
export function toastAnnouncement(toast: Pick<ToastState, 'message' | 'actionLabel'>): string {
  const message = toast.message.trim().replace(/[.!?]$/, '');
  return toast.actionLabel ? `${message}. ${toast.actionLabel} button available` : toast.message;
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

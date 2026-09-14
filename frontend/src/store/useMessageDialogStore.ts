/**
 * Global message dialog store — the in-app replacement for window.alert().
 *
 * Any code can open the dialog:
 *   - React components: `showMessageDialog('...', { kind: 'error' })`
 *   - Plain .ts modules (desktop menu handlers, services): same call —
 *     zustand stores work outside React via getState().
 *
 * The dialog itself is rendered by <MessageDialogHost />, mounted once in
 * App.tsx. The pro overlay reuses this store via `@velxio/store/...`.
 */

import { create } from 'zustand';

export type MessageDialogKind = 'info' | 'success' | 'error';

/** 'alert' shows a single OK button; 'confirm' shows Cancel + Confirm. */
export type MessageDialogMode = 'alert' | 'confirm';

export interface MessageDialogOptions {
  kind?: MessageDialogKind;
  /** Optional header line. Callers pass an already-translated string. */
  title?: string;
}

export interface ConfirmDialogOptions extends MessageDialogOptions {
  /** Label for the confirming button. Callers pass an already-translated string. */
  confirmLabel?: string;
  /** Label for the dismissing button. Callers pass an already-translated string. */
  cancelLabel?: string;
  /** Style the confirm button as a destructive action (red). */
  danger?: boolean;
}

interface MessageDialogState {
  open: boolean;
  mode: MessageDialogMode;
  kind: MessageDialogKind;
  title: string | null;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  /** Set while a confirm dialog is open; called with the user's choice. */
  resolve: ((confirmed: boolean) => void) | null;
  show: (message: string, opts?: MessageDialogOptions) => void;
  confirm: (message: string, opts?: ConfirmDialogOptions) => Promise<boolean>;
  /** Resolve/close. `result` is only meaningful for confirm dialogs. */
  close: (result?: boolean) => void;
}

export const useMessageDialogStore = create<MessageDialogState>((set, get) => ({
  open: false,
  mode: 'alert',
  kind: 'info',
  title: null,
  message: '',
  confirmLabel: 'OK',
  cancelLabel: 'Cancel',
  danger: false,
  resolve: null,
  show: (message, opts) => {
    // Reject any in-flight confirm before replacing it with an alert.
    get().resolve?.(false);
    set({
      open: true,
      mode: 'alert',
      message,
      kind: opts?.kind ?? 'info',
      title: opts?.title ?? null,
      resolve: null,
    });
  },
  confirm: (message, opts) =>
    new Promise<boolean>((resolve) => {
      // Reject any in-flight confirm before replacing it.
      get().resolve?.(false);
      set({
        open: true,
        mode: 'confirm',
        message,
        kind: opts?.kind ?? 'info',
        title: opts?.title ?? null,
        confirmLabel: opts?.confirmLabel ?? 'OK',
        cancelLabel: opts?.cancelLabel ?? 'Cancel',
        danger: opts?.danger ?? false,
        resolve,
      });
    }),
  close: (result = false) => {
    get().resolve?.(result);
    set({ open: false, resolve: null });
  },
}));

/** Imperative helper so non-React callers don't need to know zustand. */
export function showMessageDialog(message: string, opts?: MessageDialogOptions): void {
  useMessageDialogStore.getState().show(message, opts);
}

/**
 * In-app replacement for window.confirm(). Returns a promise resolving to
 * true when the user confirms, false when they cancel/dismiss.
 */
export function showConfirmDialog(
  message: string,
  opts?: ConfirmDialogOptions,
): Promise<boolean> {
  return useMessageDialogStore.getState().confirm(message, opts);
}

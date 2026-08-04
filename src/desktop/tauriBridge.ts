/**
 * Thin typed wrapper around the Tauri IPC surface used by the desktop
 * frontend modules. Falls back to `null` when the global isn't present,
 * letting components render gracefully when the bundle is somehow
 * loaded outside Tauri (during `vite dev` against a regular browser
 * tab, for instance).
 */

export type ValidationResult = {
  valid: boolean;
  plan?: string | null;
  status?: string | null;
  reason_code?: string | null;
  trial_ends_at?: string | null;
  subscription_period_end?: string | null;
  entitlements?: Record<string, boolean>;
};

/**
 * Shape returned by the Rust `license_gate_info` command (added in
 * v0.3.0). The `state` field is the same string the sidecar sees in
 * `VELXIO_LICENSE_STATE`, so the welcome flow can switch on it
 * directly.
 *
 * `null` state means the gate is closed — no valid key, grandfather
 * expired. UI should mount the lockout overlay.
 */
export type GateInfo = {
  state: 'valid' | 'soft_grace' | 'hard_grace' | 'grandfather' | null;
  grandfather_days_remaining: number;
  grandfather_active: boolean;
};

export type TauriInvoke = <T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export type TauriListen = <T = unknown>(
  event: string,
  cb: (payload: { payload: T }) => void,
) => Promise<() => void>;

type TauriGlobal = {
  core?: { invoke?: TauriInvoke };
  invoke?: TauriInvoke;
  event?: { listen?: TauriListen };
};

function tauri(): TauriGlobal | null {
  const w = window as { __TAURI__?: TauriGlobal };
  return w.__TAURI__ ?? null;
}

export function isTauri(): boolean {
  return tauri() !== null;
}

export const invoke: TauriInvoke = async (cmd, args) => {
  const t = tauri();
  if (!t) throw new Error('Tauri runtime not available');
  const fn = t.core?.invoke ?? t.invoke;
  if (!fn) throw new Error('Tauri invoke handler not available');
  return fn(cmd, args);
};

export const listen: TauriListen = async (event, cb) => {
  const t = tauri();
  if (!t?.event?.listen) {
    // No-op subscription if event API isn't ready (e.g. during `vite dev`).
    return () => undefined;
  }
  return t.event.listen(event, cb);
};

export async function openExternal(url: string): Promise<void> {
  const t = tauri();

  // Outside Tauri (vite dev in a regular browser tab) — just delegate
  // to window.open. Works because the real browser obeys it.
  if (!t) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  // Inside Tauri the global API path changed between versions and
  // between `withGlobalTauri` exposure flags. Try every known path
  // and stop at the first one that returns without throwing. Each
  // attempt is logged best-effort so the desktop-debug.log file
  // shows exactly which one worked (or that none did).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tg = t as any;
  const attempts: Array<[string, () => Promise<unknown>]> = [
    // tauri-plugin-opener — the official Tauri 2.x way for opening
    // URLs in the system browser. Most reliable, try first.
    ['invoke opener.open_url', () => invoke('plugin:opener|open_url', { url })],
    ['invoke opener.open',     () => invoke('plugin:opener|open_url', { path: url })],
    // tauri-plugin-shell open — older path, arg shape varies between
    // 2.x releases; try both.
    ['invoke shell.open path', () => invoke('plugin:shell|open', { path: url, with: null })],
    ['invoke shell.open url',  () => invoke('plugin:shell|open', { url })],
    // Global wrappers (only present in specific Tauri 2.x configs).
    ['shell.open',     () => tg.shell?.open?.(url)],
    ['opener.openUrl', () => tg.opener?.openUrl?.(url)],
    ['opener.open',    () => tg.opener?.open?.(url)],
  ];

  let lastError: unknown = null;
  for (const [name, fn] of attempts) {
    try {
      const r = fn();
      if (r && typeof (r as Promise<unknown>).then === 'function') {
        await r;
      } else if (r === undefined) {
        // The wrapper didn't exist (optional chaining short-circuited
        // to undefined). Skip silently and try the next path.
        continue;
      }
      tryLog(`openExternal: ${name} succeeded`, { url });
      return;
    } catch (err) {
      lastError = err;
      // Keep trying.
    }
  }

  tryLog('openExternal: every IPC path failed, falling back to window.open', {
    url,
    lastError: lastError ? String(lastError) : null,
  });
  window.open(url, '_blank', 'noopener,noreferrer');
}

// Best-effort, no-throw: log via the desktop write_debug_log command
// when available. Defined here so openExternal can use it without
// importing from desktop/log.ts (which would create a cycle).
function tryLog(message: string, extra?: unknown): void {
  // eslint-disable-next-line no-console
  console.log('[velxio-desktop]', message, extra ?? '');
  const t = tauri();
  if (!t) return;
  const fn = t.core?.invoke ?? t.invoke;
  if (!fn) return;
  let line = message;
  if (extra !== undefined) {
    try { line += ' ' + JSON.stringify(extra); }
    catch { line += ' ' + String(extra); }
  }
  void (fn as TauriInvoke)('write_debug_log', { message: line }).catch(() => {});
}

function randomNonce(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * USB serial port info returned by the Rust shell's `list_serial_ports`
 * command. The hardware-flash modal reads this to populate the port
 * dropdown. `vid` / `pid` etc. are absent for non-USB ports (legacy
 * RS-232, Bluetooth SPP virtual COM ports).
 */
export interface SerialPortInfo {
  path: string;
  vid?: number | null;
  pid?: number | null;
  manufacturer?: string | null;
  product?: string | null;
  serial_number?: string | null;
}

/**
 * Enumerate USB serial ports plugged into the host. Empty array
 * when the Tauri runtime isn't present (web build) so the UI can
 * render its "open Velxio Desktop to flash real boards" CTA without
 * blowing up.
 */
export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<SerialPortInfo[]>('list_serial_ports');
  } catch (err) {
    tryLog('listSerialPorts: command failed', { err: String(err) });
    return [];
  }
}

/**
 * Read the current license gate state (v0.3.0+). Defaults the grandfather
 * fields to {0, false} outside Tauri so dev-in-browser doesn't crash.
 */
export async function getGateInfo(): Promise<GateInfo> {
  if (!isTauri()) {
    return { state: 'valid', grandfather_days_remaining: 0, grandfather_active: false };
  }
  try {
    return await invoke<GateInfo>('license_gate_info');
  } catch (err) {
    tryLog('getGateInfo: command not registered (pre-0.3.0 shell?)', { err: String(err) });
    // Pre-0.3.0 shells don't expose the command; assume legacy "always valid"
    // so the rest of the app stays usable until the user updates.
    return { state: 'valid', grandfather_days_remaining: 0, grandfather_active: false };
  }
}

/**
 * Ask the Tauri shell to restart itself. Used after a successful
 * sign-in / key paste from a lockout state — the sidecar didn't
 * spawn because the gate was closed at startup, and the simplest way
 * to re-evaluate the gate + spawn the sidecar is a full restart.
 */
export async function restartApp(): Promise<void> {
  if (!isTauri()) {
    // In vite-dev (browser) we can't restart the Tauri shell — best
    // we can do is a hard reload so any cached fetch results flush.
    window.location.reload();
    return;
  }
  // The process plugin command is `plugin:process|restart` in 2.x.
  // No args. Returns never (the process exits before the promise
  // resolves), so we don't await meaningfully — but we still call
  // through invoke so the call can be logged on failure.
  try {
    await invoke('plugin:process|restart');
  } catch (err) {
    tryLog('restartApp: invoke failed', { err: String(err) });
    throw err;
  }
}

export async function beginSignIn(apiBase = 'https://logicraftstudios.tech'): Promise<string> {
  const state = randomNonce();
  await invoke('license_register_nonce', { nonce: state });
  const signInUrl =
    `${apiBase.replace(/\/+$/, '')}/auth/desktop?state=${encodeURIComponent(state)}`;
  await openExternal(signInUrl);
  return state;
}

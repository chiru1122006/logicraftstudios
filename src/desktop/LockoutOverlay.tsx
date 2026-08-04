/**
 * Velxio Desktop lockout overlay (v0.3.0+).
 *
 * Full-screen modal mounted by `./index.ts` when the Tauri shell emits
 * `velxio://license-required`. Cannot be dismissed — only resolved by
 * either:
 *
 *   1. Signing in via Velxio (deep-link OAuth) → shell saves the key,
 *      we call `restartApp()` so the sidecar re-evaluates the gate.
 *   2. Pasting a license key directly.
 *   3. Closing the app (X in the title bar — Tauri handles that).
 *
 * Three visual variants driven by `reason`:
 *
 *   - `'no_credential'` (default) — fresh install with no key and the
 *     grandfather window already exhausted. Friendly tone: "trial
 *     available, sign up to continue".
 *   - `'tampered'` — JWT verification failed. Implies user tampered
 *     with the keychain entry OR our verification key rotated and
 *     the cached token is on an old kid. Slightly less friendly:
 *     "authentication problem, please sign in again". Offers a
 *     "Clear stored credentials" button as a self-service repair.
 *   - `'expired'` — had a key, ran out of soft + hard grace. Tone:
 *     "subscription expired, reactivate to continue".
 *
 * NEVER tries to call the sidecar (it isn't running — that's the
 * whole point). All actions go through `license_*` Tauri commands
 * which are shell-side (keychain + network to logicraftstudios.tech).
 */

import { useEffect, useState } from 'react';
import {
  beginSignIn,
  invoke,
  isTauri,
  listen,
  openExternal,
  restartApp,
  type ValidationResult,
} from './tauriBridge';

export type LockoutReason = 'no_credential' | 'tampered' | 'expired';

type Props = {
  reason: LockoutReason;
};

const VELXIO_BASE = 'https://logicraftstudios.tech';

const COPY: Record<LockoutReason, { title: string; subtitle: string; primary: string }> = {
  no_credential: {
    title: 'Sign in to continue',
    subtitle:
      'Velxio Desktop requires an account. Start your 30-day free trial - no credit card needed.',
    primary: 'Start free trial',
  },
  tampered: {
    title: 'Authentication problem',
    subtitle:
      'Your stored credentials could not be verified. Please sign in again to continue.',
    primary: 'Sign in again',
  },
  expired: {
    title: 'Subscription expired',
    subtitle:
      'Reactivate your Velxio Pro subscription to keep using Velxio Desktop.',
    primary: 'Reactivate subscription',
  },
};

type Mode = 'choose' | 'paste';

export const LockoutOverlay = ({ reason }: Props) => {
  const copy = COPY[reason];
  const [mode, setMode] = useState<Mode>('choose');
  const [pastedKey, setPastedKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Same deep-link listener as the welcome page — when the user
  // completes sign-in in the browser, the shell saves the key + emits
  // `velxio://auth-completed`. Restart so the sidecar starts.
  useEffect(() => {
    let dispose: (() => void) | null = null;
    listen<{ ok: boolean; result?: ValidationResult; error?: string }>(
      'velxio://auth-completed',
      (event) => {
        setWaiting(false);
        if (event.payload.ok && event.payload.result?.valid) {
          // Don't even try to mount the editor — sidecar is dead.
          // Restart the shell so setup() re-runs and spawns it.
          void restartApp();
        } else {
          setErr(event.payload.error || 'Sign-in failed. Try again.');
        }
      },
    ).then((off) => {
      dispose = off;
    });
    return () => {
      if (dispose) dispose();
    };
  }, []);

  const handleSignIn = async () => {
    setErr(null);
    if (!isTauri()) {
      setErr('This window is running outside Tauri - paste your key instead.');
      setMode('paste');
      return;
    }
    setBusy(true);
    try {
      await beginSignIn(VELXIO_BASE);
      setWaiting(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    setErr(null);
    try {
      await invoke('license_clear_key');
      // After clearing, restart so the gate sees the empty state and
      // routes to the no_credential variant instead of tampered.
      await restartApp();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const handlePaste = async () => {
    setErr(null);
    const trimmed = pastedKey.trim();
    if (!trimmed) {
      setErr('Paste a license key first.');
      return;
    }
    if (!/^vlx_[a-z_]+_[0-9a-f]+$/.test(trimmed)) {
      setErr("That doesn't look like a Velxio key (vlx_<plan>_<hex>).");
      return;
    }
    setBusy(true);
    try {
      await invoke('license_save_key', { key: trimmed });
      const result = await invoke<ValidationResult>('license_validate', { key: trimmed });
      if (result.valid && result.entitlements?.desktop) {
        // Same as the deep-link path: restart so the sidecar boots.
        await restartApp();
      } else {
        setErr(
          result.reason_code === 'trial_expired'
            ? 'Your trial has ended. Upgrade to Pro to continue.'
            : 'Key was accepted but the Velxio Pro entitlement is not active.',
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="vlx-desktop-lockout"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vlx-lockout-title"
    >
      <div className="vlx-desktop-lockout-card">
        <div className="vlx-desktop-lockout-brand">
          <h1 id="vlx-lockout-title">{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </div>

        {err && <div className="vlx-desktop-welcome-error">{err}</div>}

        {mode === 'choose' && (
          <div className="vlx-desktop-welcome-actions">
            <button
              type="button"
              className="vlx-desktop-welcome-primary"
              onClick={handleSignIn}
              disabled={busy || waiting}
            >
              {waiting ? 'Waiting for browser...' : copy.primary}
            </button>
            <button
              type="button"
              className="vlx-desktop-welcome-secondary"
              onClick={() => setMode('paste')}
              disabled={busy}
            >
              I have a license key
            </button>
            <button
              type="button"
              className="vlx-desktop-welcome-link"
              onClick={() => openExternal(`${VELXIO_BASE}/pricing`)}
            >
              View pricing
            </button>
            {reason === 'tampered' && (
              <button
                type="button"
                className="vlx-desktop-welcome-link"
                onClick={handleClear}
                disabled={busy}
              >
                Clear stored credentials
              </button>
            )}
          </div>
        )}

        {mode === 'paste' && (
          <div className="vlx-desktop-welcome-paste">
            <label htmlFor="vlx-lockout-key">License key</label>
            <input
              id="vlx-lockout-key"
              type="text"
              value={pastedKey}
              onChange={(e) => setPastedKey(e.target.value)}
              placeholder="vlx_pro_... or vlx_trial_..."
              spellCheck={false}
              autoFocus
              disabled={busy}
            />
            <div className="vlx-desktop-welcome-actions">
              <button
                type="button"
                className="vlx-desktop-welcome-primary"
                onClick={handlePaste}
                disabled={busy}
              >
                {busy ? 'Validating...' : 'Activate'}
              </button>
              <button
                type="button"
                className="vlx-desktop-welcome-secondary"
                onClick={() => {
                  setMode('choose');
                  setErr(null);
                }}
                disabled={busy}
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

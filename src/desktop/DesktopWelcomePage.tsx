/**
 * Velxio Desktop welcome / sign-in screen.
 *
 * Rendered by the desktop overlay (`./index.ts::mountDesktop`) when
 * the stored license key fails validation (or doesn't exist yet).
 * Two flows:
 *
 *   1. Sign in with Velxio  — opens the system browser at
 *      `https://logicraftstudios.tech/auth/desktop?state=<nonce>`. The page hands
 *      a license token back via `velxio-desktop://auth?token=…&state=…`,
 *      Tauri's deep-link handler verifies the nonce, persists the key
 *      and emits `velxio://auth-completed`.
 *
 *   2. Paste license key  — manual fallback for headless environments
 *      or shared machines. Validates the key, stores it, hides the
 *      welcome screen.
 *
 * The screen DOES NOT cover the SPA — the SPA isn't mounted yet when
 * we're in welcome mode (see `index.ts::renderWelcomeOrEditor`).
 */

import { useEffect, useState } from 'react';
import {
  beginSignIn,
  invoke,
  isTauri,
  listen,
  openExternal,
  type ValidationResult,
} from './tauriBridge';

type Props = {
  onAuthorised: (result: ValidationResult) => void;
  /**
   * v0.3.0+: when set, the welcome screen renders the grandfather
   * variant - a friendly "you have N days of free grace" with a
   * "continue without signing in" escape hatch. `null` (the legacy
   * default) keeps the original behaviour: no escape, sign-in or
   * paste-key are the only options.
   */
  grandfatherDaysRemaining?: number | null;
};

type Mode = 'choose' | 'paste';

const VELXIO_BASE = 'https://logicraftstudios.tech';

export const DesktopWelcomePage = ({ onAuthorised, grandfatherDaysRemaining = null }: Props) => {
  const [mode, setMode] = useState<Mode>('choose');
  const [pastedKey, setPastedKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Listen for the deep-link callback that fires after the user
  // completes sign-in in the browser. Cleanup on unmount.
  useEffect(() => {
    let dispose: (() => void) | null = null;
    listen<{ ok: boolean; result?: ValidationResult; error?: string }>(
      'velxio://auth-completed',
      (event) => {
        setWaiting(false);
        if (event.payload.ok && event.payload.result?.valid) {
          onAuthorised(event.payload.result);
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
  }, [onAuthorised]);

  const handleSignIn = async () => {
    setErr(null);
    if (!isTauri()) {
      setErr('This window is running outside Tauri — paste your key instead.');
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

  const handlePaste = async () => {
    setErr(null);
    const trimmed = pastedKey.trim();
    if (!trimmed) {
      setErr('Paste a license key first.');
      return;
    }
    if (!/^vlx_[a-z_]+_[0-9a-f]+$/.test(trimmed)) {
      setErr('That doesn\'t look like a Velxio key (vlx_<plan>_<hex>).');
      return;
    }
    setBusy(true);
    try {
      await invoke('license_save_key', { key: trimmed });
      const result = await invoke<ValidationResult>('license_validate', { key: trimmed });
      if (result.valid && result.entitlements?.desktop) {
        onAuthorised(result);
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

  const isGrandfather = grandfatherDaysRemaining !== null && grandfatherDaysRemaining > 0;

  return (
    <div className="vlx-desktop-welcome">
      <div className="vlx-desktop-welcome-card">
        <div className="vlx-desktop-welcome-brand">
          <h1>{isGrandfather ? 'Welcome back to Velxio Desktop' : 'Velxio Desktop'}</h1>
          <p>
            {isGrandfather
              ? `You have ${grandfatherDaysRemaining} days to keep using Velxio Desktop before a Velxio Pro subscription is required.`
              : 'Offline Arduino, RP2040 and ESP32 simulator.'}
          </p>
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
              {waiting ? 'Waiting for browser...' : 'Sign in with Velxio'}
            </button>
            <button
              type="button"
              className="vlx-desktop-welcome-secondary"
              onClick={() => setMode('paste')}
              disabled={busy}
            >
              I have a license key
            </button>
            {isGrandfather && (
              <button
                type="button"
                className="vlx-desktop-welcome-link"
                onClick={() => onAuthorised({ valid: true, plan: 'grandfather' })}
              >
                Continue without signing in
              </button>
            )}
            <button
              type="button"
              className="vlx-desktop-welcome-link"
              onClick={() => openExternal(`${VELXIO_BASE}/pricing`)}
            >
              View pricing
            </button>
          </div>
        )}

        {mode === 'paste' && (
          <div className="vlx-desktop-welcome-paste">
            <label htmlFor="vlx-paste-key">License key</label>
            <input
              id="vlx-paste-key"
              type="text"
              value={pastedKey}
              onChange={(e) => setPastedKey(e.target.value)}
              placeholder="vlx_pro_… or vlx_trial_…"
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
                {busy ? 'Validating…' : 'Activate'}
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

        <p className="vlx-desktop-welcome-trust">
          {isGrandfather
            ? 'No charge during your grace period. Sign in any time to start your trial without losing this window.'
            : '30-day free trial included. After that, requires a Velxio Pro subscription.'}
        </p>
      </div>
    </div>
  );
};

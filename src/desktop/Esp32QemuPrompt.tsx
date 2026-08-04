/**
 * ESP32 QEMU optional-download prompt.
 *
 * Active only in the Tauri desktop build (mounted from main.tsx
 * behind `VITE_DESKTOP=true`). Watches `useSimulatorStore.boards` for
 * the first ESP32 selection; if QEMU isn't installed in the user's
 * data folder, shows a modal that either:
 *
 *   - Eligible (active key)  -> "Download ESP32 support" button +
 *                                inline progress bar driven by the
 *                                `velxio://esp32-qemu-progress` event.
 *   - Grandfather (no key)   -> "Sign up to unlock ESP32" CTA. The
 *                                grandfather grace explicitly does
 *                                not cover ESP32 (would be a free
 *                                escape hatch around the paywall).
 *   - Locked                 -> dimmed; the lockout overlay above is
 *                                already blocking everything else.
 *
 * The eligibility check + the modal copy are v0.3.0 additions. v0.2.0
 * showed only the download path and surfaced "no license key stored"
 * as an opaque error for grandfather users.
 */

import { useEffect, useState } from 'react';
import { useSimulatorStore } from '../store/useSimulatorStore';
import type { BoardKind } from '../types/board';
import { beginSignIn, isTauri, listen, openExternal } from './tauriBridge';

const ESP32_KINDS: BoardKind[] = ['esp32', 'esp32-s3', 'esp32-c3'];

type QemuStatus = { installed: boolean; path?: string | null; version?: string | null };

type Eligibility = 'eligible' | 'grandfather' | 'locked';

type ProgressPayload = {
  bytes_downloaded: number;
  total_bytes: number | null;
  phase: 'starting' | 'downloading' | 'extracting' | 'done';
};

type TauriInvoke = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function tauriInvoke(): TauriInvoke | null {
  const w = window as { __TAURI__?: { core?: { invoke?: TauriInvoke }; invoke?: TauriInvoke } };
  return w.__TAURI__?.core?.invoke ?? w.__TAURI__?.invoke ?? null;
}

const VELXIO_BASE = 'https://logicraftstudios.tech';

export const Esp32QemuPrompt = () => {
  const boards = useSimulatorStore((s) => s.boards);
  const hasEsp32 = boards.some((b) => ESP32_KINDS.includes(b.boardKind));
  const [status, setStatus] = useState<QemuStatus | null>(null);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const invoke = tauriInvoke();
    if (!invoke) return;
    invoke<QemuStatus>('esp32_qemu_status').then(setStatus).catch(() => undefined);
    invoke<Eligibility>('esp32_qemu_eligibility')
      .then(setEligibility)
      .catch(() => setEligibility('eligible')); // pre-0.3.0 shell - fall through to install
  }, []);

  useEffect(() => {
    if (!hasEsp32 || !status || status.installed || dismissed) return;
    setOpen(true);
  }, [hasEsp32, status, dismissed]);

  // Stream progress events while installing.
  useEffect(() => {
    if (!installing) return;
    let dispose: (() => void) | null = null;
    listen<ProgressPayload>('velxio://esp32-qemu-progress', (event) => {
      setProgress(event.payload);
    }).then((off) => {
      dispose = off;
    });
    return () => {
      if (dispose) dispose();
    };
  }, [installing]);

  if (!open) return null;

  const onInstall = async () => {
    setErr(null);
    setInstalling(true);
    setProgress({ bytes_downloaded: 0, total_bytes: null, phase: 'starting' });
    const invoke = tauriInvoke();
    if (!invoke) {
      setErr('Tauri runtime not available.');
      setInstalling(false);
      return;
    }
    try {
      await invoke('esp32_qemu_install');
      const fresh = await invoke<QemuStatus>('esp32_qemu_status');
      setStatus(fresh);
      if (fresh.installed) setOpen(false);
    } catch (e) {
      // Issue #212: the backend returns 404 when the velxio team
      // hasn't published an ESP32 QEMU build for the user's platform
      // yet (Windows / Linux x86_64 / macOS aarch64). The raw
      // "download HTTP 404" string is opaque - reword to something
      // the user can actually act on (or at least understand isn't
      // their fault).
      const raw = e instanceof Error ? e.message : String(e);
      if (/HTTP\s*404|not found/i.test(raw)) {
        setErr(
          'ESP32 support is not yet available for your platform. ' +
            'The Velxio team is preparing this build - try again in a ' +
            'few days, or use Arduino/RP2040 boards in the meantime.',
        );
      } else {
        setErr(raw);
      }
    } finally {
      setInstalling(false);
      setProgress(null);
    }
  };

  const onSignUp = async () => {
    if (!isTauri()) {
      void openExternal(`${VELXIO_BASE}/auth/desktop`);
      return;
    }
    try {
      await beginSignIn(VELXIO_BASE);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const onSkip = () => {
    setDismissed(true);
    setOpen(false);
  };

  const isGrandfather = eligibility === 'grandfather';
  const isLocked = eligibility === 'locked';
  const canDownload = eligibility === 'eligible' || eligibility === null;

  // Progress bar percentage. -1 means indeterminate (extracting /
  // streaming without content-length).
  let pct = -1;
  if (progress?.total_bytes && progress.total_bytes > 0) {
    pct = Math.min(100, Math.round((progress.bytes_downloaded / progress.total_bytes) * 100));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 9500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 440,
          background: '#1e1e23',
          color: '#e6e6e9',
          border: '1px solid #2c2c33',
          borderRadius: 8,
          padding: 24,
          boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>
          {isGrandfather
            ? 'Sign up to use ESP32 boards'
            : isLocked
              ? 'Reactivate to use ESP32 boards'
              : 'ESP32 support not installed'}
        </h2>
        <p style={{ margin: '0 0 16px', color: '#aaa', lineHeight: 1.5 }}>
          {isGrandfather
            ? 'ESP32 simulation requires a Velxio account. Create one in 30 seconds - 30-day free trial included, no credit card needed.'
            : isLocked
              ? 'Your subscription is currently locked. Renew to download ESP32 support.'
              : 'ESP32 boards need an additional QEMU runtime (~42 MB). One-time download. You can keep using AVR and RP2040 boards without it.'}
        </p>
        {err && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 4,
              background: '#3a1a1a',
              color: '#ff8585',
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {err}
          </div>
        )}
        {installing && progress && (
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                height: 6,
                background: '#0c0c11',
                borderRadius: 3,
                overflow: 'hidden',
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: pct >= 0 ? `${pct}%` : '40%',
                  background: '#007acc',
                  transition: 'width 0.2s ease',
                  animation: pct < 0 ? 'vlx-indeterminate 1.5s linear infinite' : undefined,
                }}
              />
            </div>
            <div style={{ fontSize: 12, color: '#888' }}>
              {progress.phase === 'extracting'
                ? 'Extracting...'
                : progress.phase === 'done'
                  ? 'Done'
                  : pct >= 0
                    ? `${pct}% (${(progress.bytes_downloaded / (1 << 20)).toFixed(1)} MB)`
                    : 'Downloading...'}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onSkip}
            disabled={installing}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              color: '#aaa',
              border: '1px solid #2c2c33',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Not now
          </button>
          {canDownload && (
            <button
              type="button"
              onClick={onInstall}
              disabled={installing}
              style={{
                padding: '8px 16px',
                background: '#007acc',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: installing ? 'wait' : 'pointer',
                opacity: installing ? 0.7 : 1,
              }}
            >
              {installing ? 'Downloading...' : 'Download ESP32 support'}
            </button>
          )}
          {isGrandfather && (
            <button
              type="button"
              onClick={onSignUp}
              style={{
                padding: '8px 16px',
                background: '#007acc',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Start free trial
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

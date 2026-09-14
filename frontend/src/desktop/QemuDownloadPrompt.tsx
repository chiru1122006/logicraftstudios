/**
 * Generic QEMU runtime download prompt (desktop / Tauri only).
 *
 * Parameterized version of Esp32QemuPrompt — watches the simulator for a
 * board the given runtime handles, and if the runtime isn't installed shows a
 * modal that downloads it behind the license (eligible), or routes the user to
 * sign up (grandfather), or stays dimmed (locked).
 *
 * Used to add "Download STM32 support" without duplicating the ESP32 flow.
 * The ESP32 prompt keeps its own dedicated component for now; both could
 * later collapse onto this one.
 */

import { useEffect, useState } from 'react';
import { useSimulatorStore } from '../store/useSimulatorStore';
import type { BoardKind } from '../types/board';
import { beginSignIn, isTauri, listen, openExternal } from './tauriBridge';

export interface QemuRuntimeConfig {
  /** Display name, e.g. "STM32". */
  label: string;
  /** True for board kinds this runtime serves. */
  matchKind: (kind: BoardKind) => boolean;
  /** Tauri command names (status/eligibility/install). */
  statusCmd: string;
  eligibilityCmd: string;
  installCmd: string;
  /** Progress event emitted by the install command. */
  progressEvent: string;
  /** Approx download size note, e.g. "~30 MB". */
  sizeNote: string;
  /**
   * True for runtimes the operator sells only with a paid plan (STM32 and
   * the QEMU-Linux boards since 2026-09-06). The Tauri eligibility command
   * answers `paid_required` for a trial / personal key, and the download
   * endpoint answers 403 for the same keys; both are rendered as an
   * upgrade prompt rather than a download button or a raw HTTP status.
   */
  paidOnly?: boolean;
}

type QemuStatus = { installed: boolean; path?: string | null; version?: string | null };
type Eligibility = 'eligible' | 'grandfather' | 'locked' | 'paid_required';
type ProgressPayload = {
  bytes_downloaded: number;
  total_bytes: number | null;
  phase: 'starting' | 'downloading' | 'installing' | 'extracting' | 'done';
};

type TauriInvoke = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * Classify a failed install for the dialog. Pure so it can be unit-tested
 * without a DOM (see __tests__/QemuDownloadPrompt.test.ts).
 *
 * - `paid_required`: the licence endpoint refused the asset for this key's
 *   plan (HTTP 403). For STM32 and the QEMU-Linux runtimes that is the
 *   expected answer on a trial / personal key, so the dialog switches to its
 *   upgrade state instead of printing the status code.
 * - `unavailable`: no build for this OS/arch yet (404).
 * - `other`: anything else, shown verbatim.
 */
export function classifyInstallError(
  raw: string,
): { kind: 'paid_required' } | { kind: 'unavailable' } | { kind: 'other'; message: string } {
  if (/HTTP\s*403\b/i.test(raw)) return { kind: 'paid_required' };
  if (/HTTP\s*404\b|not found/i.test(raw)) return { kind: 'unavailable' };
  return { kind: 'other', message: raw };
}

/** Which of the dialog's four shapes to render for an eligibility answer. */
export function dialogStateFor(
  eligibility: Eligibility | null,
): 'download' | 'grandfather' | 'locked' | 'paid_required' {
  if (eligibility === 'grandfather') return 'grandfather';
  if (eligibility === 'locked') return 'locked';
  if (eligibility === 'paid_required') return 'paid_required';
  // 'eligible', or no answer yet: offer the download and let the server
  // have the final word.
  return 'download';
}

function tauriInvoke(): TauriInvoke | null {
  const w = window as { __TAURI__?: { core?: { invoke?: TauriInvoke }; invoke?: TauriInvoke } };
  return w.__TAURI__?.core?.invoke ?? w.__TAURI__?.invoke ?? null;
}

const VELXIO_BASE = 'https://logicraftstudios.tech';

export const QemuDownloadPrompt = ({ config }: { config: QemuRuntimeConfig }) => {
  const boards = useSimulatorStore((s) => s.boards);
  const hasBoard = boards.some((b) => config.matchKind(b.boardKind));
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
    invoke<QemuStatus>(config.statusCmd).then(setStatus).catch(() => undefined);
    invoke<Eligibility>(config.eligibilityCmd)
      .then(setEligibility)
      .catch(() => setEligibility('eligible'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasBoard || !status || status.installed || dismissed) return;
    setOpen(true);
  }, [hasBoard, status, dismissed]);

  useEffect(() => {
    if (!installing) return;
    let dispose: (() => void) | null = null;
    listen<ProgressPayload>(config.progressEvent, (event) => {
      setProgress(event.payload);
    }).then((off) => {
      dispose = off;
    });
    return () => {
      if (dispose) dispose();
    };
  }, [installing, config.progressEvent]);

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
      await invoke(config.installCmd);
      const fresh = await invoke<QemuStatus>(config.statusCmd);
      setStatus(fresh);
      if (fresh.installed) setOpen(false);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const outcome = classifyInstallError(raw);
      if (outcome.kind === 'paid_required') {
        setEligibility('paid_required');
        setErr(null);
      } else if (outcome.kind === 'unavailable') {
        setErr(
          `${config.label} support is not yet available for your platform. ` +
            'The Logicraft Studios team is preparing this build — try again in a few days, ' +
            'or use Arduino / RP2040 boards in the meantime.',
        );
      } else {
        setErr(outcome.message);
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

  const onUpgrade = () => {
    void openExternal(`${VELXIO_BASE}/pricing?from=desktop-${config.label.toLowerCase().replace(/\s+/g, '-')}`);
  };

  const onSkip = () => {
    setDismissed(true);
    setOpen(false);
  };

  const dialogState = dialogStateFor(eligibility);
  const isGrandfather = dialogState === 'grandfather';
  const isLocked = dialogState === 'locked';
  const isPaidRequired = dialogState === 'paid_required';
  const canDownload = dialogState === 'download';

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
          {isPaidRequired
            ? `${config.label} boards need a paid plan`
            : isGrandfather
              ? `Sign up to use ${config.label} boards`
              : isLocked
                ? `Reactivate to use ${config.label} boards`
                : `${config.label} support not installed`}
        </h2>
        <p style={{ margin: '0 0 16px', color: '#aaa', lineHeight: 1.5 }}>
          {isPaidRequired
            ? `${config.label} emulation is included in the Maker and Pro plans and is not part of the free trial. Upgrade on logicraftstudios.tech, then come back: the download unlocks on the next licence check-in. AVR, ESP32 and RP2040 boards keep working on your current plan.`
            : isGrandfather
              ? `${config.label} simulation requires a Logicraft Studios account. Create one in 30 seconds — 30-day free trial included, no credit card needed.`
              : isLocked
                ? `Your subscription is currently locked. Renew to download ${config.label} support.`
                : `${config.label} boards need an additional QEMU runtime (${config.sizeNote}). One-time download. You can keep using AVR and RP2040 boards without it.`}
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
                : progress.phase === 'installing'
                  ? 'Installing...'
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
              {installing ? 'Downloading...' : `Download ${config.label} support`}
            </button>
          )}
          {isPaidRequired && (
            <button
              type="button"
              onClick={onUpgrade}
              style={{
                padding: '8px 16px',
                background: '#007acc',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              See plans
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

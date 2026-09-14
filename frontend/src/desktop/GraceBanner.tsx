/**
 * Velxio Desktop grace + pre-expiry banner.
 *
 * Reads `license_status` from the Tauri shell on mount, on every
 * `velxio://license-status` event (fired by the background checkin
 * loop), and on a foreground 10-minute poll. Six visible tones:
 *
 *   Active, exp > 5d                       -> nothing rendered.
 *   Active, exp <= 5d, > 24h               -> amber pre-expiry warn,
 *                                             dismissible per session.
 *   Active, exp <= 24h                     -> red pre-expiry warn,
 *                                             NOT dismissible.
 *   SoftGrace (past exp, within soft win)  -> amber post-expiry warn.
 *   HardGrace (past soft, within hard win) -> red post-expiry warn +
 *                                             body class `vlx-desktop-readonly`.
 *   Locked / Tampered                      -> red banner; index.ts
 *                                             mounts the LockoutOverlay
 *                                             on top of this.
 *
 * v0.3.0 changes from v0.2.0:
 *   - Adds the active/pre-expiry tones so users get a warning BEFORE
 *     the trial / sub lapses, not just after.
 *   - Adds a polling timer so the amber -> red transition fires
 *     mid-session without an app restart.
 *   - Adds dismissibility on the amber pre-expiry tone (sessionStorage
 *     keeps it dismissed until the next launch). Red and post-expiry
 *     tones cannot be dismissed.
 */

import { useEffect, useMemo, useState } from 'react';
import { invoke, listen } from './tauriBridge';

type Claims = {
  sub: string;
  plan: string;
  ent?: Record<string, boolean>;
  iat: number;
  exp: number;
  trial_ends_at?: number | null;
  subscription_period_end?: number | null;
  hard_grace_hours?: number;
};

type LicenseStatus =
  | { state: 'unauthenticated' }
  | { state: 'active'; claims: Claims }
  | { state: 'soft_grace'; claims: Claims; days_remaining: number }
  | { state: 'hard_grace'; claims: Claims; hours_remaining: number }
  | { state: 'locked'; last_plan: string | null }
  | { state: 'tampered' };

const READONLY_BODY_CLASS = 'vlx-desktop-readonly';
const POLL_MS = 10 * 60 * 1000; // 10 min
const DISMISS_KEY = 'vlx-desktop-amber-dismissed-at';

type Tone = 'amber' | 'red';

type BannerInfo = {
  tone: Tone;
  message: string;
  dismissible: boolean;
};

// Exported for unit testing in __tests__/GraceBanner.test.ts.
// Pure function: deterministic output for given (status, now) - easy
// to assert against without rendering React.
export function bannerFor(status: LicenseStatus, now: number): BannerInfo | null {
  if (status.state === 'active') {
    // Pre-expiry warnings target the REAL expiry of the
    // entitlement (trial_ends_at for trials, subscription_period_end
    // for paid), NOT claims.exp - that one is the JWT cache window
    // (typically 7d) which gets refreshed every 6h by the checkin
    // loop, so it would never trigger the "5d / 24h" thresholds
    // under normal online use. Fall back to claims.exp only when
    // neither real-expiry field is present.
    const isTrial = status.claims.plan === 'trial';
    const realExp = isTrial
      ? status.claims.trial_ends_at
      : status.claims.subscription_period_end;
    const effectiveExp = realExp ?? status.claims.exp;
    const secondsUntilExp = effectiveExp - Math.floor(now / 1000);
    if (secondsUntilExp <= 0) return null; // shell hasn't transitioned state yet, ignore
    const hoursUntilExp = secondsUntilExp / 3600;
    const subject = isTrial ? 'free trial' : 'Velxio Pro subscription';
    if (hoursUntilExp <= 24) {
      const h = Math.max(1, Math.round(hoursUntilExp));
      return {
        tone: 'red',
        message: `Your ${subject} expires in ${h}h. ${isTrial ? 'Upgrade' : 'Renew'} now to avoid interruption.`,
        dismissible: false,
      };
    }
    if (hoursUntilExp <= 24 * 5) {
      const d = Math.max(1, Math.round(hoursUntilExp / 24));
      return {
        tone: 'amber',
        message: `Your ${subject} expires in ${d} day${d === 1 ? '' : 's'}. ${isTrial ? 'Upgrade' : 'Renew'} to avoid interruption.`,
        dismissible: true,
      };
    }
    return null;
  }
  if (status.state === 'soft_grace') {
    const d = status.days_remaining;
    return {
      tone: 'amber',
      message: `Velxio Desktop is in offline grace. Reconnect to refresh your license. ${d} day${d === 1 ? '' : 's'} remaining.`,
      dismissible: false,
    };
  }
  if (status.state === 'hard_grace') {
    const h = status.hours_remaining;
    return {
      tone: 'red',
      message: `Compile and Save are temporarily disabled. Reconnect within ${h}h to restore full access.`,
      dismissible: false,
    };
  }
  // Locked + Tampered are covered by the full-screen LockoutOverlay
  // (z-index 10001) that index.ts mounts on `velxio://license-required`.
  // Returning a banner here would render behind the overlay and bleed
  // through its 96%-opaque background - users see a confusing red
  // strip behind the modal. The overlay's own copy already explains
  // the state; banner is redundant.
  if (status.state === 'locked' || status.state === 'tampered') {
    return null;
  }
  return null;
}

export const GraceBanner = () => {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  // Initial load + event subscription + polling timer.
  useEffect(() => {
    invoke<LicenseStatus>('license_status').then(setStatus).catch(() => undefined);

    let disposeEvent: (() => void) | null = null;
    listen<LicenseStatus>('velxio://license-status', (event) => {
      setStatus(event.payload);
    }).then((off) => {
      disposeEvent = off;
    });

    // Polling: only refresh while document is visible so we don't
    // wake a backgrounded laptop just to recompute the same number.
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      setNowMs(Date.now());
      try {
        const next = await invoke<LicenseStatus>('license_status');
        setStatus(next);
      } catch { /* shell may be exiting */ }
    };
    const id = window.setInterval(tick, POLL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (disposeEvent) disposeEvent();
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Apply / clear the readonly body class purely based on the
  // status state, not on banner visibility (since the amber pre-
  // expiry banner does NOT disable editor buttons - only soft+hard
  // grace post-expiry do).
  useEffect(() => {
    const readonly = status?.state === 'hard_grace';
    if (readonly) {
      document.body.classList.add(READONLY_BODY_CLASS);
    } else {
      document.body.classList.remove(READONLY_BODY_CLASS);
    }
    return () => document.body.classList.remove(READONLY_BODY_CLASS);
  }, [status?.state]);

  // Reset dismissal if the underlying status changes shape - e.g.
  // user dismissed amber at T-3d, then sub got renewed and status
  // is back to "exp > 5d". Dismissal flag should not stick.
  const banner = useMemo(
    () => (status ? bannerFor(status, nowMs) : null),
    [status, nowMs],
  );

  // On every change in banner identity (tone + dismissibility),
  // re-evaluate the session-storage dismissal flag.
  useEffect(() => {
    if (!banner || !banner.dismissible) {
      setDismissed(false);
      return;
    }
    try {
      const raw = sessionStorage.getItem(DISMISS_KEY);
      setDismissed(raw === banner.tone);
    } catch {
      setDismissed(false);
    }
  }, [banner?.tone, banner?.dismissible]);

  if (!banner || dismissed) return null;

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const next = await invoke<LicenseStatus>('license_refresh');
      setStatus(next);
      setNowMs(Date.now());
    } catch (err) {
      console.warn('[license] manual refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const onDismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, banner.tone); } catch { /* noop */ }
    setDismissed(true);
  };

  const isPreExpiry = status?.state === 'active';

  return (
    <div className={`vlx-desktop-grace vlx-desktop-grace-${banner.tone === 'amber' ? 'warn' : 'error'}`}>
      <span className="vlx-desktop-grace-text">{banner.message}</span>
      <button
        type="button"
        className="vlx-desktop-grace-cta"
        onClick={onRefresh}
        disabled={refreshing}
      >
        {refreshing ? 'Checking...' : isPreExpiry ? 'Renew now' : 'Reconnect now'}
      </button>
      {banner.dismissible && (
        <button
          type="button"
          className="vlx-desktop-grace-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss until next launch"
          title="Dismiss until next launch"
        >
          x
        </button>
      )}
    </div>
  );
};

/**
 * sd-card-gate.test.ts — the OSS->Pro upload-gate seam for microSD uploads.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  installSdCardUploadGate,
  sdCardUploadAllowed,
  triggerSdCardUpgradePrompt,
} from '../lib/proSdCardGate';

afterEach(() => {
  installSdCardUploadGate(null);
  vi.unstubAllGlobals();
});

describe('proSdCardGate', () => {
  it('defaults to allow when no overlay installed a gate (OSS self-host)', () => {
    expect(sdCardUploadAllowed()).toBe(true);
  });

  it('respects the installed gate (paid vs non-paid)', () => {
    installSdCardUploadGate(() => false);
    expect(sdCardUploadAllowed()).toBe(false);
    installSdCardUploadGate(() => true);
    expect(sdCardUploadAllowed()).toBe(true);
  });

  it('fails open (allow) if the installed impl throws', () => {
    installSdCardUploadGate(() => {
      throw new Error('boom');
    });
    expect(sdCardUploadAllowed()).toBe(true);
  });

  it('triggerSdCardUpgradePrompt dispatches the stable contract event', () => {
    const events: Array<{ type: string; detail: { componentName?: string } }> = [];
    const g = globalThis as unknown as { CustomEvent?: unknown };
    if (typeof g.CustomEvent === 'undefined') {
      g.CustomEvent = class {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      };
    }
    vi.stubGlobal('window', {
      dispatchEvent: (e: { type: string; detail: { componentName?: string } }) => {
        events.push(e);
        return true;
      },
    });
    triggerSdCardUpgradePrompt();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('velxio-pro-upgrade-prompt');
    expect(events[0].detail.componentName).toContain('microSD');
  });

  it('names the plan that unlocks it and the free path, so the modal answers', () => {
    const events: Array<{ detail: { requiredPlan?: string; description?: string } }> = [];
    vi.stubGlobal('window', {
      dispatchEvent: (e: { detail: { requiredPlan?: string; description?: string } }) => {
        events.push(e);
        return true;
      },
    });
    triggerSdCardUpgradePrompt();
    // Any paid plan unlocks the upload: the modal must not claim the top tier.
    expect(events[0].detail.requiredPlan).toBe('maker');
    expect(events[0].detail.description).toMatch(/free plan/i);
    expect(events[0].detail.description).toMatch(/copied onto the card automatically/);
  });
});

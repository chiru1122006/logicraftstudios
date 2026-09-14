/**
 * Vitest for the pure helpers behind QemuDownloadPrompt: how a failed
 * runtime install is classified and which dialog shape an eligibility
 * answer maps to.
 *
 * Run from velxio/frontend:
 *   npx vitest run src/desktop/__tests__/QemuDownloadPrompt.test.ts
 *
 * Background (2026-09-06): STM32 and the QEMU-Linux runtimes are paid-only.
 * The Tauri eligibility command answers `paid_required` for a trial /
 * personal key and the licence endpoint answers 403 for the same keys. Both
 * must render as "needs a paid plan" with an upgrade button, never as the
 * raw "download HTTP 403" string a Maker user reported.
 */

import { describe, it, expect } from 'vitest';
import { classifyInstallError, dialogStateFor } from '../QemuDownloadPrompt';

describe('classifyInstallError', () => {
  it('maps the licence endpoint 403 to paid_required', () => {
    expect(classifyInstallError('download HTTP 403')).toEqual({ kind: 'paid_required' });
    expect(classifyInstallError('download HTTP 403 Forbidden')).toEqual({ kind: 'paid_required' });
  });

  it('keeps the 404 / not-found path as unavailable', () => {
    expect(classifyInstallError('download HTTP 404')).toEqual({ kind: 'unavailable' });
    expect(classifyInstallError('asset not found for platform')).toEqual({ kind: 'unavailable' });
  });

  it('does not confuse a 4030-byte message or a sha mismatch with a plan refusal', () => {
    expect(classifyInstallError('read 4030 bytes').kind).toBe('other');
    const sha = classifyInstallError('sha256 mismatch — expected ab, got cd');
    expect(sha).toEqual({ kind: 'other', message: 'sha256 mismatch — expected ab, got cd' });
  });

  it('passes unknown errors through verbatim', () => {
    expect(classifyInstallError('Tauri runtime not available.')).toEqual({
      kind: 'other',
      message: 'Tauri runtime not available.',
    });
  });
});

describe('dialogStateFor', () => {
  it('offers the download for eligible and for a missing answer', () => {
    expect(dialogStateFor('eligible')).toBe('download');
    expect(dialogStateFor(null)).toBe('download');
  });

  it('routes trial / personal keys to the upgrade state', () => {
    expect(dialogStateFor('paid_required')).toBe('paid_required');
  });

  it('keeps the grandfather and locked shapes', () => {
    expect(dialogStateFor('grandfather')).toBe('grandfather');
    expect(dialogStateFor('locked')).toBe('locked');
  });
});

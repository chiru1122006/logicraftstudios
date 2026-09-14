// @vitest-environment jsdom
/**
 * sd-card-panel-copy.test.ts — the SD panel says, BEFORE any click, whether
 * this user can upload, and what the free path is when they cannot.
 *
 * Background: the panel showed a "Paid" tag and an "Add files" button to
 * everyone; a free user only learned it was gated after clicking, and was
 * never told that a data file in the project workspace reaches the card by
 * itself. Server-rendered on purpose: the copy is a pure function of the
 * gate, no effects or bridge needed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SdCardPanel } from '../components/simulator/SdCardPanel';
import { installSdCardUploadGate } from '../lib/proSdCardGate';

afterEach(() => installSdCardUploadGate(null));

const render = () =>
  renderToStaticMarkup(createElement(SdCardPanel, { files: [], onChange: () => {}, boardId: null }));

describe('SdCardPanel copy vs the upload gate', () => {
  it('OSS / paid: plain "Add files" and the upload hint', () => {
    installSdCardUploadGate(() => true);
    const html = render();
    expect(html).toContain('+ Add files<');
    expect(html).not.toContain('(paid)');
    expect(html).toContain('Upload your own files');
    expect(html).not.toContain('part of the paid plans');
  });

  it('gated: the button says paid, the hint names the free path', () => {
    installSdCardUploadGate(() => false);
    const html = render();
    expect(html).toContain('+ Add files (paid)');
    expect(html).toContain('part of the paid plans');
    // The free alternative, in the same breath.
    expect(html).toMatch(/copied onto the card\s+automatically/);
  });
});

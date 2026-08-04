/**
 * Runtime burnout (P4) — pure decision + stress-computation logic.
 */
import { describe, it, expect } from 'vitest';
import { componentStress, decideBurn } from '../simulation/parts/runtimeBurnout';

describe('decideBurn — thermal delay', () => {
  it('destroys instantly at a catastrophic ratio (>=3x)', () => {
    expect(decideBurn(5, 0, 1000).burn).toBe(true);
  });
  it('does not destroy on a first over-limit sample — starts the clock', () => {
    expect(decideBurn(1.5, 0, 1000)).toEqual({ burn: false, overSince: 1000 });
  });
  it('destroys once sustained over the limit past the delay', () => {
    expect(decideBurn(1.5, 1000, 1800).burn).toBe(true); // 800ms > 700ms
  });
  it('tolerates a brief spike (under the delay)', () => {
    expect(decideBurn(1.5, 1000, 1500).burn).toBe(false); // 500ms < 700ms
  });
  it('cools down (resets the clock) when back under the limit', () => {
    expect(decideBurn(0.5, 1000, 2000)).toEqual({ burn: false, overSince: 0 });
  });
});

describe('componentStress — resistor power', () => {
  const pinNetMap = new Map([
    ['r1:1', 'n0'],
    ['r1:2', '0'],
  ]);
  it('100Ω across 9V dissipates 0.81W → over the 2x-safety burn threshold', () => {
    const s = componentStress(
      { id: 'r1', metadataId: 'resistor', properties: { value: '100' } },
      { n0: 9, '0': 0 },
      pinNetMap,
    );
    expect(s).not.toBeNull();
    // 0.81W / (2 × 0.25W) = 1.62 → would burn after the sustained delay
    expect(s!.ratio).toBeCloseTo(1.62, 1);
    expect(s!.ratio).toBeGreaterThan(1);
  });
  it('1k across 9V is well within rating (no stress)', () => {
    const s = componentStress(
      { id: 'r1', metadataId: 'resistor', properties: { value: '1k' } },
      { n0: 9, '0': 0 },
      pinNetMap,
    );
    expect(s!.ratio).toBeLessThan(1);
  });
  it('respects a custom power property', () => {
    const s = componentStress(
      { id: 'r1', metadataId: 'resistor', properties: { value: '100', power: 5 } },
      { n0: 9, '0': 0 },
      pinNetMap,
    );
    expect(s!.ratio).toBeLessThan(1); // 0.81W / 5W
  });
  it('returns null when a terminal is not on a solved net', () => {
    const s = componentStress(
      { id: 'r1', metadataId: 'resistor', properties: { value: '100' } },
      { n0: 9 },
      new Map([['r1:1', 'n0']]), // pin 2 unwired
    );
    expect(s).toBeNull();
  });
});

describe('componentStress — electrolytic capacitor', () => {
  it('9V across a 6.3V cap → over-voltage (>1x)', () => {
    const s = componentStress(
      { id: 'c1', metadataId: 'capacitor-electrolytic', properties: { voltage: '6.3' } },
      { n0: 9, '0': 0 },
      new Map([
        ['c1:+', 'n0'],
        ['c1:−', '0'],
      ]),
    );
    expect(s!.ratio).toBeCloseTo(1.43, 1);
  });
  it('within rating → no stress', () => {
    const s = componentStress(
      { id: 'c1', metadataId: 'capacitor-electrolytic', properties: { voltage: '25' } },
      { n0: 5, '0': 0 },
      new Map([
        ['c1:+', 'n0'],
        ['c1:−', '0'],
      ]),
    );
    expect(s!.ratio).toBeLessThan(1);
  });
  it('reverse polarity is catastrophic regardless of magnitude', () => {
    const s = componentStress(
      { id: 'c1', metadataId: 'capacitor-electrolytic', properties: { voltage: '25' } },
      { n0: 9, '0': 0 },
      new Map([
        ['c1:+', '0'], // + at 0V, − at 9V → reverse-biased
        ['c1:−', 'n0'],
      ]),
    );
    expect(s!.ratio).toBeGreaterThanOrEqual(3);
    expect(s!.message).toMatch(/backwards|reverse/i);
  });
});

describe('componentStress — non-monitored parts', () => {
  it('returns null for an LED (handled separately in BasicParts)', () => {
    expect(
      componentStress({ id: 'd1', metadataId: 'led', properties: {} }, {}, new Map()),
    ).toBeNull();
  });
});

/**
 * circuitVerifier — the "cannot emulate" path.
 *
 * When ngspice cannot find a stable operating point it returns NaN/Infinity
 * for the offending branch current (the classic case: an LED with no series
 * resistor — a near-short across the supply). The verifier must surface that
 * as a BLOCKING `unstable-solve` fault, NOT silently treat it as 0 A and wave
 * the circuit through (the production bug behind the 9V→LED report).
 *
 * The real Node ngspice build always converges this circuit, so we mock the
 * solver to deterministically return non-finite currents.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../simulation/spice/runNetlist', () => ({
  runNetlist: vi.fn(async () => ({
    variableNames: ['v(n0)', 'v(n1)', 'i(v_bat)', 'i(v_led1_sense)'],
    dcValue: (name: string) => {
      switch (name) {
        case 'v(n0)':
          return 1.05;
        case 'v(n1)':
          return -1.05;
        case 'i(v_bat)':
          return NaN; // source current — no stable solution
        case 'i(v_led1_sense)':
          return Infinity; // LED forward current — no stable solution
        default:
          return 0;
      }
    },
    vec: () => [],
    vAtLast: () => 0,
    findVar: () => -1,
  })),
}));

import { verifyCircuit } from '../simulation/verify/circuitVerifier';
import type { BuildNetlistInput } from '../simulation/spice/types';

describe('verifyCircuit — non-finite solve → unstable-solve fault', () => {
  it('blocks a 9V battery wired straight to an LED (no resistor)', async () => {
    const input: BuildNetlistInput = {
      components: [
        { id: 'bat', metadataId: 'battery-9v', properties: {} },
        { id: 'led1', metadataId: 'led', properties: { color: 'red' } },
      ],
      wires: [
        { id: 'w1', start: { componentId: 'bat', pinName: '+' }, end: { componentId: 'led1', pinName: 'A' } },
        { id: 'w2', start: { componentId: 'led1', pinName: 'C' }, end: { componentId: 'bat', pinName: '−' } },
      ],
      boards: [],
      analysis: { kind: 'op' },
    };
    const result = await verifyCircuit(input);
    const codes = result.errors.map((e) => e.code);
    // Both the source and the LED report the unstable solve — either is enough
    // to block, and both must be `unstable-solve` (not silently dropped to 0 A).
    expect(codes, JSON.stringify(result.errors)).toContain('unstable-solve');
    expect(result.errors.length).toBeGreaterThan(0);
    const ledFault = result.errors.find((e) => e.componentId === 'led1');
    expect(ledFault?.code).toBe('unstable-solve');
  });
});

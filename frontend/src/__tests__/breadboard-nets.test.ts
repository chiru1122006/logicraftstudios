/**
 * Breadboard internal-connectivity tests.
 *
 * A breadboard joins holes in fixed groups (5-hole column strips, power
 * rails). The joining is modelled at the union-find level in NetlistBuilder
 * (see unionBreadboardGroups) and keyed by utils/breadboardNets.ts — these
 * tests pin the group semantics and the resulting nets end-to-end through
 * buildNetlist / buildWireNetMap.
 */
import { describe, it, expect } from 'vitest';
import { breadboardGroupKey, isBreadboard } from '../utils/breadboardNets';
import { buildNetlist, buildWireNetMap } from '../simulation/spice/NetlistBuilder';

describe('breadboardGroupKey', () => {
  it('groups the 5 holes of a column strip', () => {
    const keys = ['a', 'b', 'c', 'd', 'e'].map((r) => breadboardGroupKey('breadboard', `18t.${r}`));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('col18t');
  });

  it('separates top and bottom banks of the same column', () => {
    expect(breadboardGroupKey('breadboard', '18t.a')).not.toBe(
      breadboardGroupKey('breadboard', '18b.f'),
    );
  });

  it('separates different columns', () => {
    expect(breadboardGroupKey('breadboard', '17t.a')).not.toBe(
      breadboardGroupKey('breadboard', '18t.a'),
    );
  });

  it('groups a whole power rail as one net', () => {
    expect(breadboardGroupKey('breadboard', 'bn.1')).toBe('railbn');
    expect(breadboardGroupKey('breadboard', 'bn.50')).toBe('railbn');
    expect(breadboardGroupKey('breadboard', 'bp.3')).toBe('railbp');
    expect(breadboardGroupKey('breadboard', 'tp.9')).toBe('railtp');
  });

  it('works for the mini breadboard and rejects non-breadboards', () => {
    expect(breadboardGroupKey('breadboard-mini', '5t.c')).toBe('col5t');
    expect(breadboardGroupKey('resistor', '1')).toBeNull();
    expect(breadboardGroupKey('breadboard', 'not-a-hole')).toBeNull();
    expect(isBreadboard('breadboard')).toBe(true);
    expect(isBreadboard('breadboard-mini')).toBe(true);
    expect(isBreadboard('pushbutton')).toBe(false);
  });
});

describe('breadboard nets in NetlistBuilder', () => {
  const BOARD = {
    id: 'arduino',
    vcc: 5,
    pins: { '5V': { type: 'digital', v: 5 }, GND: { type: 'digital', v: 0 } },
    groundPinNames: ['GND'],
    vccPinNames: ['5V'],
  };

  it('buildWireNetMap: two wires into the same column strip share a net', () => {
    const map = buildWireNetMap({
      components: [
        { id: 'bb1', metadataId: 'breadboard', properties: {} },
        { id: 'r1', metadataId: 'resistor', properties: { value: '1k' } },
      ],
      wires: [
        {
          id: 'w-in',
          start: { componentId: 'arduino', pinName: '5V' },
          end: { componentId: 'bb1', pinName: '10t.a' },
        },
        {
          id: 'w-out',
          start: { componentId: 'bb1', pinName: '10t.e' },
          end: { componentId: 'r1', pinName: '1' },
        },
      ],
      boards: [BOARD],
    } as never);
    expect(map.get('w-in')).toBeDefined();
    expect(map.get('w-in')).toBe(map.get('w-out'));
  });

  it('buildWireNetMap: different columns stay separate nets', () => {
    const map = buildWireNetMap({
      components: [{ id: 'bb1', metadataId: 'breadboard', properties: {} }],
      wires: [
        {
          id: 'w-a',
          start: { componentId: 'arduino', pinName: '5V' },
          end: { componentId: 'bb1', pinName: '10t.a' },
        },
        {
          id: 'w-b',
          start: { componentId: 'bb1', pinName: '11t.a' },
          end: { componentId: 'arduino', pinName: 'GND' },
        },
      ],
      boards: [BOARD],
    } as never);
    expect(map.get('w-a')).not.toBe(map.get('w-b'));
  });

  it('buildNetlist: a resistor fed through breadboard strips + rail resolves to vcc/gnd nets', () => {
    // 5V → rail tp.1 | rail tp.30 → column 5t.a | 5t.c → R1.1 | R1.2 → 20b.f | 20b.j → GND
    const { netlist } = buildNetlist({
      components: [
        { id: 'bb1', metadataId: 'breadboard', properties: {} },
        { id: 'r1', metadataId: 'resistor', properties: { value: '1k' } },
      ],
      wires: [
        { id: 'w1', start: { componentId: 'arduino', pinName: '5V' }, end: { componentId: 'bb1', pinName: 'tp.1' } },
        { id: 'w2', start: { componentId: 'bb1', pinName: 'tp.30' }, end: { componentId: 'bb1', pinName: '5t.a' } },
        { id: 'w3', start: { componentId: 'bb1', pinName: '5t.c' }, end: { componentId: 'r1', pinName: '1' } },
        { id: 'w4', start: { componentId: 'r1', pinName: '2' }, end: { componentId: 'bb1', pinName: '20b.f' } },
        { id: 'w5', start: { componentId: 'bb1', pinName: '20b.j' }, end: { componentId: 'arduino', pinName: 'GND' } },
      ],
      boards: [BOARD],
      analysis: { kind: 'op' },
    } as never);
    // The resistor's card must connect vcc_rail directly to ground — every
    // breadboard hop collapsed into the two canonical nets.
    expect(netlist).toMatch(/R_r1 (vcc_rail 0|0 vcc_rail) 1000/);
  });
});

/**
 * Regression repro for GitHub issue #247 — "There are problems with the
 * simulation results."
 *
 * An ESP32-C3 reads a slide switch on GPIO2 and drives a red LED (GPIO7) and a
 * green LED (GPIO6): `red = state; green = !state`. On Wokwi both LEDs respond
 * to the switch; on Velxio only the green LED ever lit because GPIO2 never went
 * high no matter the switch position.
 *
 * Two bugs combined, both proven here at the netlist/solve level:
 *
 *   1. The slide-switch SPICE model only wired pin 1 <-> pin 2 (an SPST),
 *      ignoring pin 3. The switch is really an SPDT whose common (pin 2)
 *      selects pin 1 at value=0 or pin 3 at value=1, so the common could never
 *      reach whatever pin 3 carried.
 *   2. The ESP32-C3 exposes its supply as 3V3.1/3V3.2 (no bare "3V3"), and
 *      VCC_PIN_RE has no numeric-suffix branch, so 3V3.2 was never canonicalised
 *      to the vcc_rail and floated at 0 V — the switch's HIGH side was dead.
 *
 * The circuit mirrors the reported project (accdba79-...): switch pin 3 -> 3V3.2,
 * pin 1 -> GND.2, pin 2 (common) -> GPIO2; red LED via 330R from GPIO7; green
 * LED via 330R from GPIO6; both cathodes to GND.8.
 */
import { describe, it, expect } from 'vitest';
import { buildNetlist } from '../simulation/spice/NetlistBuilder';
import { BOARD_PIN_GROUPS } from '../simulation/spice/boardPinGroups';
import { runNetlist } from './helpers/testSolver';
import type { BuildNetlistInput } from '../simulation/spice/types';

const GROUP = BOARD_PIN_GROUPS['esp32-c3'];

function buildIssue247(switchValue: 0 | 1): BuildNetlistInput {
  return {
    components: [
      { id: 'sw', metadataId: 'slide-switch', properties: { value: switchValue } },
      { id: 'led_red', metadataId: 'led', properties: { color: 'red' } },
      { id: 'led_green', metadataId: 'led', properties: { color: 'green' } },
      { id: 'r_red', metadataId: 'resistor', properties: { value: '330' } },
      { id: 'r_green', metadataId: 'resistor', properties: { value: '330' } },
    ],
    wires: [
      // Slide switch: 3V3 on pin 3, GND on pin 1, common (pin 2) -> GPIO2.
      { id: 'w1', start: { componentId: 'esp32-c3', pinName: '3V3.2' }, end: { componentId: 'sw', pinName: '3' } },
      { id: 'w2', start: { componentId: 'sw', pinName: '1' }, end: { componentId: 'esp32-c3', pinName: 'GND.2' } },
      { id: 'w3', start: { componentId: 'sw', pinName: '2' }, end: { componentId: 'esp32-c3', pinName: '2' } },
      // Red LED: GPIO7 -> 330R -> anode; cathode -> GND.8.
      { id: 'w4', start: { componentId: 'esp32-c3', pinName: '7' }, end: { componentId: 'r_red', pinName: '1' } },
      { id: 'w5', start: { componentId: 'r_red', pinName: '2' }, end: { componentId: 'led_red', pinName: 'A' } },
      { id: 'w6', start: { componentId: 'esp32-c3', pinName: 'GND.8' }, end: { componentId: 'led_red', pinName: 'C' } },
      // Green LED: GPIO6 -> 330R -> anode; cathode -> GND.8.
      { id: 'w7', start: { componentId: 'esp32-c3', pinName: '6' }, end: { componentId: 'r_green', pinName: '1' } },
      { id: 'w8', start: { componentId: 'r_green', pinName: '2' }, end: { componentId: 'led_green', pinName: 'A' } },
      { id: 'w9', start: { componentId: 'esp32-c3', pinName: 'GND.8' }, end: { componentId: 'led_green', pinName: 'C' } },
    ],
    boards: [
      {
        id: 'esp32-c3',
        boardKind: 'esp32-c3',
        vcc: GROUP.vcc,
        // GPIO2 is a plain INPUT (no internal pull); the switch alone drives it.
        pins: {
          '2': { type: 'input' },
          '7': { type: 'digital', v: 0 },
          '6': { type: 'digital', v: 0 },
        },
        groundPinNames: GROUP.gnd,
        vccPinNames: GROUP.vcc_pins,
      },
    ],
    analysis: { kind: 'op' },
  };
}

describe('issue #247 — ESP32-C3 slide switch drives GPIO2 (SPDT + 3V3 rail)', () => {
  it('ties the ESP32-C3 3V3.2 pin to the 3.3 V rail (not floating at 0 V)', () => {
    const { netlist, pinNetMap } = buildNetlist(buildIssue247(0));
    // The bug: 3V3.2 fell through VCC canonicalisation and got its own dead net.
    expect(pinNetMap.get('esp32-c3:3V3.2')).toBe('vcc_rail');
    expect(netlist).toMatch(/V_VCC_RAIL vcc_rail 0 DC 3\.3/);
  });

  it('reads GPIO2 LOW when the switch selects GND (value=0)', { timeout: 30_000 }, async () => {
    const input = buildIssue247(0);
    const { netlist, pinNetMap } = buildNetlist(input);
    const gpio2 = pinNetMap.get('esp32-c3:2')!;
    expect(gpio2).toBeTruthy();
    const result = await runNetlist(netlist);
    // Common wired to pin 1 (GND) -> ~0 V -> digitalRead LOW -> green LED path.
    expect(result.dcValue(`v(${gpio2})`)).toBeCloseTo(0, 1);
  });

  it('reads GPIO2 HIGH when the switch selects 3V3 (value=1)', { timeout: 30_000 }, async () => {
    const input = buildIssue247(1);
    const { netlist, pinNetMap } = buildNetlist(input);
    const gpio2 = pinNetMap.get('esp32-c3:2')!;
    expect(gpio2).toBeTruthy();
    const result = await runNetlist(netlist);
    // Common wired to pin 3 (3V3) -> ~3.3 V -> digitalRead HIGH -> red LED path.
    // Before the fix this sat at 0 V (switch ignored pin 3 AND 3V3.2 floated).
    expect(result.dcValue(`v(${gpio2})`)).toBeGreaterThan(3.0);
  });
});

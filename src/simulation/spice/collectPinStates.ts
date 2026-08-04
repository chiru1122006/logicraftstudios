/**
 * collectPinStates — read MCU output pin states from each board's
 * PinManager for pins that are referenced by a wire.
 *
 * Domain helper used by `CircuitSimulationService` to populate
 * `BoardForSpice.pins` at solve time.  Lives in its own module so
 * the service doesn't depend on (and the legacy `subscribeToStore`
 * doesn't own) the per-board pin-number mapping.
 */
import { getBoardPinManager } from '../../store/useSimulatorStore';
import type { PinSourceState } from './types';
import type { BoardKind } from '../../types/board';
import { isStm32BoardKind } from '../../types/board';
import { stm32PinNameToLinear } from '../Stm32Bridge';
import { BOARD_PIN_GROUPS } from './boardPinGroups';

/**
 * Convert a board pin name (e.g. "9", "A0", "GP26", "GPIO32") to the
 * Arduino-style pin number that PinManager uses internally.
 * Returns -1 if the name doesn't map to a GPIO pin.
 */
function pinNameToArduinoPin(pinName: string, boardKind: BoardKind): number {
  const group = BOARD_PIN_GROUPS[boardKind] ?? BOARD_PIN_GROUPS.default;
  if (group.gnd.includes(pinName) || group.vcc_pins.includes(pinName)) return -1;
  if (pinName.startsWith('GP')) {
    const n = parseInt(pinName.slice(2), 10);
    return Number.isFinite(n) ? n : -1;
  }
  if (pinName.startsWith('GPIO')) {
    const n = parseInt(pinName.slice(4), 10);
    return Number.isFinite(n) ? n : -1;
  }
  if (/^A\d+$/.test(pinName)) {
    return 14 + parseInt(pinName.slice(1), 10);
  }
  // ATtiny85 port-style names (PB0..PB5) map 1:1 to Arduino pin numbers
  // because ATTinyCore's pinMap is identity for the tiny85 variant.
  if (/^PB\d+$/.test(pinName)) {
    return parseInt(pinName.slice(2), 10);
  }
  if (/^\d+$/.test(pinName)) {
    return parseInt(pinName, 10);
  }
  return -1;
}

/**
 * Build the `pinStates` field for a board going into the
 * NetlistBuilder.  Iterates pins that any wire references for this
 * board, asks PinManager for the current digital / PWM value, and
 * shapes it into the SPICE-side PinSourceState union.
 *
 * MCU output pins not in any wire are skipped — the netlist doesn't
 * need a V source for an unconnected pin.
 */
export function collectPinStates(
  boardId: string,
  boardKind: BoardKind,
  wires: Array<{
    start: { componentId: string; pinName: string };
    end: { componentId: string; pinName: string };
  }>,
): Record<string, PinSourceState> {
  const pm = getBoardPinManager(boardId);
  if (!pm) return {};
  const group = BOARD_PIN_GROUPS[boardKind] ?? BOARD_PIN_GROUPS.default;
  const vcc = group.vcc;

  const result: Record<string, PinSourceState> = {};
  const pinNames = new Set<string>();
  for (const w of wires) {
    if (w.start.componentId === boardId) pinNames.add(w.start.pinName);
    if (w.end.componentId === boardId) pinNames.add(w.end.pinName);
  }

  const outputPins = pm.getOutputPins();

  // STM32 names pins PA0/PC13 and keys its PinManager on the linear pin
  // (port*16+pin). It runs in backend QEMU, where its OUTPUT pins are surfaced
  // to the canvas via the part layer (not SPICE), so here we only contribute
  // the INPUT internal pull (reported by the worker's gpio_pull) — enough for
  // NetlistBuilder to stamp the weak resistor so an INPUT_PULLUP button-to-GND
  // solves to idle-HIGH / pressed-LOW. connectDigitalInputsToMcu then drives
  // the guest IDR from the solve. Leaving outputs out keeps STM32 LED rendering
  // exactly as before.
  const isStm32 = isStm32BoardKind(boardKind);
  if (isStm32) {
    for (const pinName of pinNames) {
      const linear = stm32PinNameToLinear(pinName);
      if (linear < 0 || outputPins.has(linear)) continue;
      const pull = pm.getPinPull(linear);
      if (pull !== 0) result[pinName] = { type: 'input', pull };
    }
    return result;
  }

  for (const pinName of pinNames) {
    const arduinoPin = pinNameToArduinoPin(pinName, boardKind);
    if (arduinoPin < 0) continue;
    const pwmDuty = pm.getPwmValue(arduinoPin);
    if (pwmDuty > 0) {
      result[pinName] = { type: 'pwm', duty: pwmDuty };
      continue;
    }
    if (outputPins.has(arduinoPin)) {
      // The MCU has actually driven this pin at least once
      // (digitalWrite / PWM / port-listener fire), so emit a V-source
      // for NetlistBuilder.  MixedModeScheduler.onMcuPinChange will
      // alterSource() on each subsequent edge; the V-source needs to
      // exist in the netlist for the alter to bind (otherwise it's a
      // silent no-op and the LED never updates).
      result[pinName] = {
        type: 'digital',
        v: pm.getPinState(arduinoPin) ? vcc : 0,
      };
    } else {
      // Not driven by the MCU. If the firmware enabled an internal pull
      // (INPUT_PULLUP / INPUT_PULLDOWN), surface it so NetlistBuilder can
      // stamp the weak resistor — without it a button-to-GND input floats
      // to 0 V and reads LOW even at idle, so active-low buttons never work.
      // For pull-less inputs leave the net free: external components (sensor
      // divider, pull-up, button, etc.) drive the SPICE node, and an
      // unconditional 0 V source would short out any analog sensor on the pin.
      const pull = pm.getPinPull(arduinoPin);
      if (pull !== 0) result[pinName] = { type: 'input', pull };
    }
  }
  return result;
}

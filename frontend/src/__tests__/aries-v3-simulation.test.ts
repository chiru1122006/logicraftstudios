import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AriesV3Simulator } from '../simulation/AriesV3Simulator';
import { PinManager } from '../simulation/PinManager';
import { requestLine, lineGaps, clearLineGaps } from '../simulation/line/requestLine';
import { isLineCapable } from '../simulation/line/LineHost';
import '../simulation/line/models/hc-sr04';

describe('AriesV3Simulator End-to-End Execution', () => {
  it('loads Motorola SREC firmware and drives GPIO10 high and low through PinManager', () => {
    const srecPath = path.join(__dirname, 'test_aries.srec');
    const content = fs.readFileSync(srecPath, 'utf8');

    const pm = new PinManager();
    const sim = new AriesV3Simulator(pm);

    const pinChanges: Array<{ pin: number; state: boolean }> = [];
    pm.onPinChange(10, (pin, state) => {
      pinChanges.push({ pin, state });
    });

    sim.loadHex(content);
    expect(sim.isRunning()).toBe(false);

    // Step manually to observe execution without requestAnimationFrame
    const core = (sim as any).core;

    // Run until GPIO10 turns high
    for (let step = 0; step < 10000; step++) {
      core.step();
      if (pinChanges.some((c) => c.state === true)) break;
    }

    expect(pinChanges.some((c) => c.pin === 10 && c.state === true)).toBe(true);
    expect(pm.getPinState(10)).toBe(true);

    // Run through delay(500) until GPIO10 turns low
    for (let step = 0; step < 35_000_000; step++) {
      core.step();
      if (pinChanges.some((c) => c.state === false)) break;
    }

    expect(pinChanges.some((c) => c.pin === 10 && c.state === false)).toBe(true);
    expect(pm.getPinState(10)).toBe(false);
  });

  it('supports HC-SR04 ultrasonic sensor with cycle-accurate timed edges on GPIO 30/31', () => {
    clearLineGaps();
    const pm = new PinManager();
    const sim = new AriesV3Simulator(pm);

    expect(isLineCapable(sim)).toBe(true);
    expect(sim.lineSupport()).toEqual({ mode: 'local' });
    expect(sim.getClockHz()).toBe(100_000_000);

    // Request HC-SR04 on TRIG=GPIO 30, ECHO=GPIO 31, distance=25 cm
    const answer = requestLine(sim, {
      sensor_type: 'hc-sr04',
      pin: 30,
      echo_pin: 31,
      distance: 25,
    });

    expect(answer.mode).toBe('local');
    // Pre-flight check / lineGaps must NOT contain any refusal warning
    expect(lineGaps().filter((g: any) => g.sensorType === 'hc-sr04')).toEqual([]);
    expect(sim.ownsPin(31)).toBe(true);

    // Initial state: ECHO pin rests low
    expect(pm.getPinState(31)).toBe(false);

    // Simulate MCU driving TRIG (GPIO 30) HIGH at cycle 1000
    (sim as any).core.cycles = 1000;
    pm.reportPad(30, 'high', 0, 1000);

    // At cycle 1000, ECHO has not fired yet
    expect(pm.getPinState(31)).toBe(false);

    // Fast-forward CPU cycles to triggerCycle + 600us processing time
    // At 100 MHz: 600 us = 60,000 cycles -> cycle 61,000
    // Round trip for 25 cm: (25 / 17150) * 1e6 us ~ 1457.73 us = 145,773 cycles -> cycle 206,773
    (sim as any).core.cycles = 61_000;
    (sim as any).flushScheduledPinChanges();
    expect(pm.getPinState(31)).toBe(true); // ECHO pulse raised

    (sim as any).core.cycles = 206_772;
    (sim as any).flushScheduledPinChanges();
    expect(pm.getPinState(31)).toBe(true); // Still high during round-trip

    (sim as any).core.cycles = 206_774;
    (sim as any).flushScheduledPinChanges();
    expect(pm.getPinState(31)).toBe(false); // ECHO pulse fell

    // Clean up
    answer.release?.();
    expect(sim.ownsPin(31)).toBe(false);
  });
});


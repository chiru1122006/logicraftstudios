// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '../elements-register';
import { BOARD_KIND_LABELS, BOARD_KIND_FQBN, isKnownBoardKind } from '../types/board';
import { boardPinToNumber } from '../utils/boardPinMapping';
import { boardPinGroupFor } from '../simulation/spice/boardPinGroups';
import { BOARD_SIZE } from '../components/simulator/BoardOnCanvas';
import type { AriesV3Element } from '../components/velxio-components/AriesV3Element';

describe('C-DAC ARIES v3.0 Board Integration', () => {
  it('is registered in board types, labels, and FQBN maps', () => {
    expect(isKnownBoardKind('aries-v3')).toBe(true);
    expect(BOARD_KIND_LABELS['aries-v3']).toBe('ARIES v3.0');
    expect(BOARD_KIND_FQBN['aries-v3']).toBe('vega:riscv:aries_v3');
  });

  it('has canvas visual dimensions defined in BOARD_SIZE', () => {
    const size = BOARD_SIZE['aries-v3'];
    expect(size).toBeDefined();
    expect(size.w).toBe(210);
    expect(size.h).toBe(270);
  });

  it('instantiates custom element velxio-aries-v3 and exposes pinInfo', () => {
    const el = document.createElement('velxio-aries-v3') as unknown as AriesV3Element;
    expect(el).toBeDefined();
    const pinInfo = el.pinInfo;
    expect(pinInfo).toBeDefined();
    expect(pinInfo.length).toBeGreaterThan(50);

    // Verify key pins exist with valid coordinates
    const pinNames = pinInfo.map((p) => p.name);
    expect(pinNames).toContain('GPIO0');
    expect(pinNames).toContain('GPIO31');
    expect(pinNames).toContain('PWM0');
    expect(pinNames).toContain('PWM7');
    expect(pinNames).toContain('I2C0_SDA');
    expect(pinNames).toContain('I2C0_SCL');
    expect(pinNames).toContain('SPI0_SCLK');
    expect(pinNames).toContain('UART1_TX');
    expect(pinNames).toContain('UART1_RX');
    expect(pinNames).toContain('A0');
    expect(pinNames).toContain('3V3');
    expect(pinNames).toContain('5V');
    expect(pinNames).toContain('GND');

    // Verify coordinates are within board bounds
    for (const pin of pinInfo) {
      expect(pin.x).toBeGreaterThanOrEqual(0);
      expect(pin.x).toBeLessThanOrEqual(210);
      expect(pin.y).toBeGreaterThanOrEqual(0);
      expect(pin.y).toBeLessThanOrEqual(270);
    }
  });

  it('maps pin names accurately in boardPinToNumber', () => {
    // GPIOs
    expect(boardPinToNumber('aries-v3', 'GPIO0')).toBe(0);
    expect(boardPinToNumber('aries-v3', 'GPIO15')).toBe(15);
    expect(boardPinToNumber('aries-v3', 'GPIO31')).toBe(31);

    // PWMs
    expect(boardPinToNumber('aries-v3', 'PWM0')).toBe(0);
    expect(boardPinToNumber('aries-v3', 'PWM1')).toBe(1);

    // ADCs
    expect(boardPinToNumber('aries-v3', 'A0')).toBe(32);
    expect(boardPinToNumber('aries-v3', 'A3')).toBe(35);

    // Rails return -1 (not GPIOs)
    expect(boardPinToNumber('aries-v3', 'GND')).toBe(-1);
    expect(boardPinToNumber('aries-v3', '3V3')).toBe(-1);
    expect(boardPinToNumber('aries-v3', '5V')).toBe(-1);
    expect(boardPinToNumber('aries-v3', 'VIN')).toBe(-1);
    expect(boardPinToNumber('aries-v3', 'RST')).toBe(-1);
    expect(boardPinToNumber('aries-v3', 'BOOT_SEL')).toBe(-1);
  });

  it('defines 3.3V logic level and power rail grouping for SPICE', () => {
    const group = boardPinGroupFor('aries-v3');
    expect(group.vcc).toBe(3.3);
    expect(group.vcc_pins).toContain('3V3');
    expect(group.gnd).toContain('GND');
    expect(group.aux?.volts).toBe(5);
    expect(group.aux?.pins).toContain('5V');
  });
});

/**
 * The line-host conformance suite against the real AriesV3Simulator (THEJAS32 RISC-V SoC).
 */
import { vi } from 'vitest';
import { AriesV3Simulator } from '../../AriesV3Simulator';
import { PinManager } from '../../PinManager';
import { describeLineHostConformance, type LineRig } from './lineHostConformance';

vi.stubGlobal('requestAnimationFrame', () => 1);
vi.stubGlobal('cancelAnimationFrame', () => {});

const DIR0_BASE = 0x100c0000;
const GPIO0_BASE = 0x10080000;

function makeRig(pin = 10): LineRig {
  const pm = new PinManager();
  const sim = new AriesV3Simulator(pm);
  const core = (sim as any).core;

  const byteOffset = Math.floor(pin / 8);
  const bit = pin % 8;
  const pinDataAddr = GPIO0_BASE + (1 << (pin + 2));

  return {
    sim,
    pads: {
      onPad: (p, cb) => sim.pinManager.onPadChange(p, cb),
      get: (p) => sim.pinManager.getPad(p),
    },
    pin,
    otherPin: pin + 1,
    guest: {
      modeInput(pull) {
        sim.pinManager.setPinPull(pin, pull);
        if (pull === 1) {
          sim.setPinState(pin, true);
        }
        // Clear direction bit -> input (0)
        const cur = core.readByte(DIR0_BASE + byteOffset);
        core.writeByte(DIR0_BASE + byteOffset, cur & ~(1 << bit));
      },
      modeOutput() {
        // Set direction bit -> output (1)
        const cur = core.readByte(DIR0_BASE + byteOffset);
        core.writeByte(DIR0_BASE + byteOffset, cur | (1 << bit));
      },
      write(level) {
        core.writeByte(pinDataAddr + (pin >= 8 ? 1 : 0), level ? (1 << bit) : 0);
      },
      read() {
        return pm.getPinState(pin);
      },
    },
    run(cycles) {
      const until = sim.getCurrentCycles() + cycles;
      while (sim.getCurrentCycles() < until) {
        sim.step();
      }
    },
    now: () => sim.getCurrentCycles(),
    clockHz: () => sim.getClockHz(),
  };
}

describeLineHostConformance('AriesV3Simulator (C-DAC ARIES v3.0, GPIO10)', () => makeRig());

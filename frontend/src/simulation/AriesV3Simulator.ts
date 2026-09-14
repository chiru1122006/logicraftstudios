/**
 * AriesV3Simulator — C-DAC ARIES v3.0 (THEJAS32 RISC-V SoC) simulator.
 *
 * Wraps RiscVCore (RV32IM) with:
 * - THEJAS32 memory map: RAM @ 0x00200000 (512 KB)
 * - Motorola S-record (SREC) and Intel HEX loader with entry point detection
 * - THEJAS32 MMIO peripherals:
 *   - GPIO0 @ 0x10080000 (pins 0–15)
 *   - GPIO1 @ 0x10180000 (pins 16–31)
 *   - Direction registers @ 0x100C0000 / 0x101C0000
 *   - UART0 @ 0x10000100 (Serial monitor)
 *   - UART1 @ 0x10000200, UART2 @ 0x10000300
 *   - Timers, PWM, SPI, I2C stub registers
 * - Time-budgeted requestAnimationFrame execution loop (~60–100 MHz target)
 */

import { RiscVCore } from './RiscVCore';
import type { PinManager } from './PinManager';
import { hexToUint8Array } from '../utils/hexParser';
import type { LineCapable, LineHostPort, LineSupport } from './line/LineHost';
import { LineSensorHub } from './line/LineSensorHub';

// ── Memory Map ──────────────────────────────────────────────────────────────
const RAM_BASE = 0x00200000;
const RAM_SIZE = 512 * 1024; // 512 KB flat memory

// ── MMIO Base Addresses (from platform.h) ──────────────────────────────────
const GPIO0_BASE = 0x10080000; // Pins 0–15 data registers
const GPIO1_BASE = 0x10180000; // Pins 16–31 data registers
const GPIO_REGION_SIZE = 0x10000; // 64 KB bit-band / offset window

const DIR0_BASE = 0x100c0000; // Pins 0–15 direction register
const DIR1_BASE = 0x101c0000; // Pins 16–31 direction register
const DIR_SIZE = 0x1000;

const UART0_BASE = 0x10000100; // Primary Serial port
const UART1_BASE = 0x10000200;
const UART2_BASE = 0x10000300;
const UART_SIZE = 0x100;

// UART 16550 registers
const UART_DR = 0x00;
const UART_LSR = 0x14;
const UART_LSR_THRE = 1 << 5;
const UART_LSR_TEMT = 1 << 6;
const UART_LSR_DR = 1;

/**
 * Parses either Motorola S-record (SREC) text or Intel HEX into flat memory.
 */
function parseFirmwareToMemory(content: string, mem: Uint8Array, memBase: number): number {
  const lines = content.split('\n');
  let startAddress = 0x00202000; // Default THEJAS32 link1.lds entry point
  let isSrec = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('S')) {
      isSrec = true;
      const type = line[1];
      const count = parseInt(line.slice(2, 4), 16);
      if (isNaN(count)) continue;

      if (type === '1') {
        // 16-bit address
        const addr = parseInt(line.slice(4, 8), 16);
        const dataLen = count - 3;
        for (let i = 0; i < dataLen; i++) {
          const byte = parseInt(line.slice(8 + i * 2, 10 + i * 2), 16);
          const off = addr + i - memBase;
          if (off >= 0 && off < mem.length) mem[off] = byte;
        }
      } else if (type === '2') {
        // 24-bit address (used by VEGA ARIES)
        const addr = parseInt(line.slice(4, 10), 16);
        const dataLen = count - 4;
        for (let i = 0; i < dataLen; i++) {
          const byte = parseInt(line.slice(10 + i * 2, 12 + i * 2), 16);
          const off = addr + i - memBase;
          if (off >= 0 && off < mem.length) mem[off] = byte;
        }
      } else if (type === '3') {
        // 32-bit address
        const addr = parseInt(line.slice(4, 12), 16);
        const dataLen = count - 5;
        for (let i = 0; i < dataLen; i++) {
          const byte = parseInt(line.slice(12 + i * 2, 14 + i * 2), 16);
          const off = addr + i - memBase;
          if (off >= 0 && off < mem.length) mem[off] = byte;
        }
      } else if (type === '7') {
        startAddress = parseInt(line.slice(4, 12), 16);
      } else if (type === '8') {
        startAddress = parseInt(line.slice(4, 10), 16);
      } else if (type === '9') {
        startAddress = parseInt(line.slice(4, 8), 16);
      }
    }
  }

  if (!isSrec) {
    // Fallback: Intel HEX
    const bytes = hexToUint8Array(content);
    const maxCopy = Math.min(bytes.length, mem.length);
    mem.set(bytes.subarray(0, maxCopy), 0);
  }

  return startAddress;
}

export class AriesV3Simulator implements LineCapable {
  private core: RiscVCore;
  private mem: Uint8Array;
  private running = false;
  private animFrameId = 0;
  private startAddress = 0x00202000;
  private rxFifo: number[] = [];
  private scheduledPinChanges: Array<{ cycle: number; pin: number; state: boolean }> = [];
  private lines: LineSensorHub | null = null;

  // Buffers for reconstructed byte/halfword MMIO writes
  private gpio0Buf = new Uint8Array(GPIO_REGION_SIZE);
  private gpio1Buf = new Uint8Array(GPIO_REGION_SIZE);
  private dir0Buf = new Uint8Array(DIR_SIZE);
  private dir1Buf = new Uint8Array(DIR_SIZE);

  public pinManager: PinManager;
  public onSerialData: ((ch: string) => void) | null = null;
  public onBaudRateChange: ((baud: number) => void) | null = null;
  public onPinChangeWithTime: ((pin: number, state: boolean, timeMs: number) => void) | null = null;

  constructor(pinManager: PinManager) {
    this.pinManager = pinManager;
    this.mem = new Uint8Array(RAM_SIZE);
    this.core = new RiscVCore(this.mem, RAM_BASE);

    this._registerPeripherals();
  }

  // ── MMIO Setup ────────────────────────────────────────────────────────────

  private _registerPeripherals(): void {
    // 1. GPIO 0: pins 0–15
    this.core.addMmio(
      GPIO0_BASE,
      GPIO_REGION_SIZE,
      (addr) => {
        const offset = addr - GPIO0_BASE;
        const wordOffset = offset & ~1;
        const pinMask = ((wordOffset >> 2) & 0xffff) || 0xffff;
        let word16 = 0;
        for (let p = 0; p < 16; p++) {
          if (pinMask & (1 << p)) {
            if (this.pinManager.getPinState(p)) {
              word16 |= 1 << p;
            }
          }
        }
        return (addr & 1) ? (word16 >> 8) & 0xff : word16 & 0xff;
      },
      (addr, val) => {
        const offset = addr - GPIO0_BASE;
        const isHighByte = (addr & 1) === 1;
        const startPin = isHighByte ? 8 : 0;
        const endPin = isHighByte ? 16 : 8;
        const wordOffset = offset & ~1;
        const pinMask = ((wordOffset >> 2) & 0xffff) || 0xffff;

        for (let p = startPin; p < endPin; p++) {
          if (pinMask & (1 << p)) {
            const bit = p % 8;
            const level = Boolean((val >> bit) & 1);
            this.pinManager.setPinState(p, level, 'mcu');
            this.pinManager.reportPad(p, level ? 'high' : 'low', 0, this.core.cycles);
            this.onPinChangeWithTime?.(p, level, performance.now());
          }
        }
      },
    );

    // 2. GPIO 1: pins 16–31
    this.core.addMmio(
      GPIO1_BASE,
      GPIO_REGION_SIZE,
      (addr) => {
        const offset = addr - GPIO1_BASE;
        const wordOffset = offset & ~1;
        const pinMask = ((wordOffset >> 2) & 0xffff) || 0xffff;
        let word16 = 0;
        for (let p = 0; p < 16; p++) {
          if (pinMask & (1 << p)) {
            if (this.pinManager.getPinState(16 + p)) {
              word16 |= 1 << p;
            }
          }
        }
        return (addr & 1) ? (word16 >> 8) & 0xff : word16 & 0xff;
      },
      (addr, val) => {
        const offset = addr - GPIO1_BASE;
        const isHighByte = (addr & 1) === 1;
        const startPin = isHighByte ? 8 : 0;
        const endPin = isHighByte ? 16 : 8;
        const wordOffset = offset & ~1;
        const pinMask = ((wordOffset >> 2) & 0xffff) || 0xffff;

        for (let p = startPin; p < endPin; p++) {
          if (pinMask & (1 << p)) {
            const actualPin = 16 + p;
            const bit = p % 8;
            const level = Boolean((val >> bit) & 1);
            this.pinManager.setPinState(actualPin, level, 'mcu');
            this.pinManager.reportPad(actualPin, level ? 'high' : 'low', 0, this.core.cycles);
            this.onPinChangeWithTime?.(actualPin, level, performance.now());
          }
        }
      },
    );

    // 3. Direction registers
    this.core.addMmio(
      DIR0_BASE,
      DIR_SIZE,
      (addr) => this.dir0Buf[addr - DIR0_BASE] ?? 0,
      (addr, val) => {
        const offset = addr - DIR0_BASE;
        const oldVal = this.dir0Buf[offset] ?? 0;
        this.dir0Buf[offset] = val & 0xff;
        const basePin = offset * 8;
        for (let b = 0; b < 8; b++) {
          const pin = basePin + b;
          if (pin >= 16) break;
          const oldDir = (oldVal >> b) & 1;
          const newDir = (val >> b) & 1;
          if (oldDir !== newDir) {
            if (newDir === 0) {
              const pull = this.pinManager.getPinPull(pin);
              this.pinManager.reportPad(pin, 'z', pull, this.core.cycles);
            } else {
              const level = this.pinManager.getPinState(pin);
              this.pinManager.reportPad(pin, level ? 'high' : 'low', 0, this.core.cycles);
            }
          }
        }
      },
    );
    this.core.addMmio(
      DIR1_BASE,
      DIR_SIZE,
      (addr) => this.dir1Buf[addr - DIR1_BASE] ?? 0,
      (addr, val) => {
        const offset = addr - DIR1_BASE;
        const oldVal = this.dir1Buf[offset] ?? 0;
        this.dir1Buf[offset] = val & 0xff;
        const basePin = 16 + offset * 8;
        for (let b = 0; b < 8; b++) {
          const pin = basePin + b;
          if (pin >= 32) break;
          const oldDir = (oldVal >> b) & 1;
          const newDir = (val >> b) & 1;
          if (oldDir !== newDir) {
            if (newDir === 0) {
              const pull = this.pinManager.getPinPull(pin);
              this.pinManager.reportPad(pin, 'z', pull, this.core.cycles);
            } else {
              const level = this.pinManager.getPinState(pin);
              this.pinManager.reportPad(pin, level ? 'high' : 'low', 0, this.core.cycles);
            }
          }
        }
      },
    );

    // 4. UART0 (Primary Serial)
    this.core.addMmio(
      UART0_BASE,
      UART_SIZE,
      (addr) => {
        const off = addr - UART0_BASE;
        if (off === UART_DR) {
          return this.rxFifo.shift() ?? 0;
        }
        if (off === UART_LSR) {
          return UART_LSR_THRE | UART_LSR_TEMT | (this.rxFifo.length > 0 ? UART_LSR_DR : 0);
        }
        return 0;
      },
      (addr, val) => {
        const off = addr - UART0_BASE;
        if (off === UART_DR) {
          this.onSerialData?.(String.fromCharCode(val & 0xff));
        }
      },
    );

    // 5. UART1 & UART2
    this.core.addMmio(
      UART1_BASE,
      UART_SIZE,
      (addr) => ((addr - UART1_BASE) === UART_LSR ? UART_LSR_THRE | UART_LSR_TEMT : 0),
      () => {},
    );
    this.core.addMmio(
      UART2_BASE,
      UART_SIZE,
      (addr) => ((addr - UART2_BASE) === UART_LSR ? UART_LSR_THRE | UART_LSR_TEMT : 0),
      () => {},
    );

    // 6. Timers & other peripherals (no-op reads)
    this.core.addMmio(0x10000a00, 0x100, () => 0, () => {});
    this.core.addMmio(0x10000800, 0x200, () => 0, () => {}); // I2C
    this.core.addMmio(0x10000600, 0x200, () => 0, () => {}); // SPI
    this.core.addMmio(0x10400000, 0x100, () => 0, () => {}); // PWM
  }

  // ── Firmware Loading ──────────────────────────────────────────────────────

  loadHex(content: string): void {
    this.mem.fill(0);
    this.gpio0Buf.fill(0);
    this.gpio1Buf.fill(0);
    this.dir0Buf.fill(0);
    this.dir1Buf.fill(0);
    this.rxFifo = [];

    this.startAddress = parseFirmwareToMemory(content, this.mem, RAM_BASE);
    this.core.reset(this.startAddress);
    console.log(`[AriesV3] Firmware loaded, entry point at 0x${this.startAddress.toString(16)}`);
  }

  // ── Simulation Lifecycle ──────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this._loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.animFrameId);
  }

  reset(): void {
    this.stop();
    this.rxFifo = [];
    this.scheduledPinChanges = [];
    this.lines?.reset();
    this.gpio0Buf.fill(0);
    this.gpio1Buf.fill(0);
    this.dir0Buf.fill(0);
    this.dir1Buf.fill(0);
    this.core.reset(this.startAddress);
  }

  serialWrite(text: string): void {
    for (let i = 0; i < text.length; i++) {
      this.rxFifo.push(text.charCodeAt(i));
    }
  }

  setPinState(pin: number, state: boolean): void {
    this.pinManager.setPinState(pin, state, 'external');
  }

  isRunning(): boolean {
    return this.running;
  }

  step(): number {
    this.flushScheduledPinChanges();
    const result = this.core.step();
    this.flushScheduledPinChanges();
    return result;
  }

  getCurrentCycles(): number {
    return this.core.cycles;
  }

  getClockHz(): number {
    return 100_000_000;
  }

  /**
   * Schedule a GPIO pin state change at a specific future cycle count.
   * Enables cycle-accurate protocol simulation (e.g. HC-SR04 echo timing, DHT22).
   */
  schedulePinChange(pin: number, state: boolean, atCycle: number): void {
    let i = this.scheduledPinChanges.length;
    while (i > 0 && this.scheduledPinChanges[i - 1].cycle > atCycle) i--;
    this.scheduledPinChanges.splice(i, 0, { cycle: atCycle, pin, state });
  }

  private flushScheduledPinChanges(): void {
    if (this.scheduledPinChanges.length === 0) return;
    const now = this.core.cycles;
    while (
      this.scheduledPinChanges.length > 0 &&
      this.scheduledPinChanges[0].cycle <= now
    ) {
      const { pin, state } = this.scheduledPinChanges.shift()!;
      this.setPinState(pin, state);
    }
  }

  // ── Line-owning sensors (simulation/line) ─────────────────────────────────

  lineSupport(): LineSupport {
    return { mode: 'local' };
  }

  lineHub(): LineSensorHub {
    if (!this.lines) {
      const port: LineHostPort = {
        now: () => this.core.cycles,
        clockHz: () => 100_000_000,
        scheduleEdge: (pin, level, atCycle) => this.schedulePinChange(pin, level, atCycle),
        onPad: (pin, cb) => this.pinManager.onPadChange(pin, cb),
        restPad: (pin, level) => this.setPinState(pin, level),
      };
      this.lines = new LineSensorHub(port);
    }
    return this.lines;
  }

  /**
   * Pads a hosted line model drives itself — the SPICE-threshold connector
   * asks before pushing a solved level into the guest (connectDigitalInputsToMcu).
   */
  ownsPin(pin: number): boolean {
    return this.lines?.ownsPin(pin) ?? false;
  }

  registerSensor(_type: string, _pin: number, _props: Record<string, unknown>): boolean {
    return false;
  }
  updateSensor(_pin: number, _props: Record<string, unknown>): void {}
  unregisterSensor(_pin: number): void {}

  // ── Execution Loop ────────────────────────────────────────────────────────

  private _loop(): void {
    if (!this.running) return;

    // Run in chunks up to 10ms budget or 1,200,000 instructions per frame
    const start = performance.now();
    let cycles = 0;
    const maxCycles = 1_200_000;
    const chunkSize = 20_000;

    while (cycles < maxCycles && performance.now() - start < 10) {
      const targetChunk = this.scheduledPinChanges.length > 0
        ? Math.min(chunkSize, Math.max(1, this.scheduledPinChanges[0].cycle - this.core.cycles))
        : chunkSize;

      for (let i = 0; i < targetChunk; i++) {
        this.core.step();
      }
      cycles += targetChunk;

      if (this.scheduledPinChanges.length > 0 && this.scheduledPinChanges[0].cycle <= this.core.cycles) {
        this.flushScheduledPinChanges();
      }
    }

    this.animFrameId = requestAnimationFrame(() => this._loop());
  }
}

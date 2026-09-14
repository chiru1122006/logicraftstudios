/**
 * EEPROM regression tests (GitHub issue #203 — "Arduino EEPROM").
 *
 * Before the fix, AVRSimulator never instantiated avr8js's AVREEPROM
 * peripheral, so the Arduino EEPROM library's `while (EECR & (1<<EEPE))`
 * write-completion poll never exited and any EEPROM.read/write/update hung
 * the sketch. These tests drive the EEPROM register protocol against the
 * *production* AVRSimulator (via loadHex + step) and assert that:
 *   1. a byte round-trips through EEPROM and the EEPE poll terminates, and
 *   2. EEPROM contents survive a reset (persist "between boots").
 *
 * The programs are hand-assembled with the mini-assembler in
 * ./helpers/avrTestHarness so the tests don't depend on arduino-cli.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AVRSimulator } from '../simulation/AVRSimulator';
import { PinManager } from '../simulation/PinManager';
import { assemble, LDI, STS, LDS, SBRC, RJMP } from './helpers/avrTestHarness';

// ATmega328P EEPROM registers (data-space addresses, as avr8js uses them).
const EECR = 0x3f;
const EEDR = 0x40;
const EEARL = 0x41;
const EEARH = 0x42;
const EEMPE = 0x04; // master write enable (bit 2)
const EEPE = 0x02; // write enable (bit 1)
const EERE = 0x01; // read enable (bit 0)

/** Encode a flash image (16-bit words, little-endian) as Intel HEX. */
function toIntelHex(words: Uint16Array): string {
  const hh = (n: number) => (n & 0xff).toString(16).toUpperCase().padStart(2, '0');
  const bytes: number[] = [];
  for (const w of words) bytes.push(w & 0xff, (w >> 8) & 0xff);
  let out = '';
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16);
    let sum = chunk.length + ((i >> 8) & 0xff) + (i & 0xff);
    let rec = `:${hh(chunk.length)}${hh(i >> 8)}${hh(i)}00`;
    for (const b of chunk) {
      rec += hh(b);
      sum += b;
    }
    out += `${rec}${hh((0x100 - (sum & 0xff)) & 0xff)}\n`;
  }
  return `${out}:00000001FF\n`;
}

/** Set EEAR to `addr` (r16 is clobbered). */
const setEepromAddr = (addr: number) => [
  LDI(16, addr & 0xff),
  STS(EEARL, 16),
  LDI(16, (addr >> 8) & 0xff),
  STS(EEARH, 16),
];

/**
 * Write `value` to EEPROM `addr` (atomic), poll EEPE until the write
 * completes, then read it back into r20 — mirroring avr-libc's
 * eeprom_write_byte / eeprom_read_byte sequence.
 */
function eepromWritePollReadProgram(addr: number, value: number): Uint16Array {
  return assemble([
    ...setEepromAddr(addr),
    LDI(16, value),
    STS(EEDR, 16),
    LDI(16, EEMPE),
    STS(EECR, 16), // EEMPE = 1
    LDI(16, EEPE),
    STS(EECR, 16), // EEPE = 1 → start atomic write (within 4 cycles of EEMPE)
    // poll: while (EECR & EEPE) ;
    LDS(17, EECR),
    SBRC(17, 1), // skip the RJMP once EEPE (bit 1) is clear
    RJMP(-4),
    // read back
    ...setEepromAddr(addr),
    LDI(16, EERE),
    STS(EECR, 16), // EERE = 1 → EEDR = backend[addr]
    LDS(20, EEDR), // r20 = read value
    RJMP(-1), // spin
  ]);
}

describe('EEPROM (issue #203)', () => {
  let pm: PinManager;
  let sim: AVRSimulator;

  beforeEach(() => {
    pm = new PinManager();
    sim = new AVRSimulator(pm);
  });

  afterEach(() => sim.stop());

  it('round-trips a byte and the EEPE write-completion poll terminates (no hang)', () => {
    sim.loadHex(toIntelHex(eepromWritePollReadProgram(0, 123)));

    // Step until the program reaches its read (r20 == 123). The cap is the
    // regression guard: with the EEPROM peripheral missing, EEPE never clears,
    // the poll spins forever, r20 stays 0, and the cap is hit -> assertion fails.
    const cpu = (sim as unknown as { cpu: { data: Uint8Array } }).cpu;
    for (let i = 0; i < 300000 && cpu.data[20] !== 123; i++) sim.step();

    expect(cpu.data[20]).toBe(123);
    const backend = (sim as unknown as { eepromBackend: { readMemory(a: number): number } })
      .eepromBackend;
    expect(backend.readMemory(0)).toBe(123);
  });

  it('persists EEPROM contents across a reset (between boots)', () => {
    sim.loadHex(toIntelHex(eepromWritePollReadProgram(7, 42)));
    const cpu = (sim as unknown as { cpu: { data: Uint8Array } }).cpu;
    for (let i = 0; i < 300000 && cpu.data[20] !== 42; i++) sim.step();
    expect(cpu.data[20]).toBe(42);

    // A reset re-boots the CPU but must leave EEPROM intact.
    sim.reset();

    const backend = (sim as unknown as { eepromBackend: { readMemory(a: number): number } })
      .eepromBackend;
    expect(backend.readMemory(7)).toBe(42);
  });
});

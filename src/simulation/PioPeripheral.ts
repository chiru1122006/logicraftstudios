/**
 * PioPeripheral — generic extension seam for a bit-banged-SPI/PIO peripheral
 * attached to an RP2040 board (e.g. a WiFi co-processor reached over gSPI).
 *
 * RP2040Simulator owns the fragile PIO-FIFO plumbing (the non-dropping TX
 * queue, the on-demand RX-pull, the sm.restart framing reset, the GPIO24
 * host-wake re-sync after loadMicroPython swaps the chip) and drives it
 * through this interface. A peripheral supplies only the *protocol*: it
 * observes each outbound 32-bit word and returns reply bytes the plumbing
 * repacks into the RX FIFO.
 *
 * This is deliberately generic (no product-specific names): any private SPI
 * peripheral can register a factory. In the open-source build no factory is
 * installed, so `createPioPeripheral` returns null and a pi-pico-w board
 * simulates as a plain Pico (no WiFi). The logicraftstudios.tech pro overlay registers
 * a CYW43439 implementation, gated behind a paid plan.
 *
 * Mirrors the install-impl + safe-dispatch + has-check shape of the pro
 * gates in `src/lib/proBoardGate.ts`.
 */

export interface PioPeripheral {
  /** Process one 32-bit word the firmware bit-banged onto the bus. Returns
   *  zero or more reply byte-blobs to repack into the RX FIFO. */
  feedWord(word: number): Uint8Array[];
  /** True while the firmware is streaming bulk data the peripheral wants the
   *  plumbing to DISCARD (keep only a few words so the PIO TXSTALLs). */
  inDiscardableWriteData(): boolean;
  /** Reset framing at a transfer boundary (the PIO sm.restart). */
  resetFraming(): void;
  /** Current host-wake level to drive onto GPIO24 (active-high). */
  hostWakeLevel(): boolean;
  /** Register the callback the peripheral fires when host-wake changes. */
  onHostWake(cb: (active: boolean) => void): void;
  /** Optional: called when the board's simulation starts (with the sketch
   *  files), so the peripheral can e.g. detect WiFi usage and connect. */
  onSimulationStart?(files: { content: string }[]): void;
  /** Optional teardown when the peripheral is detached. */
  detach?(): void;
}

/** Factory the overlay installs. Returns null for OSS / unsupported boards. */
export type PioPeripheralFactory =
  (boardKind: string, boardId: string) => PioPeripheral | null;

let _factory: PioPeripheralFactory | null = null;

/** Install (or clear with null) the peripheral factory. Called once by the
 *  pro overlay's mountPro(); never called in OSS builds. */
export function installPioPeripheralFactory(factory: PioPeripheralFactory | null): void {
  _factory = factory;
}

/** True if a factory has been installed (pro build). */
export function hasPioPeripheralFactory(): boolean {
  return _factory !== null;
}

/** Create a peripheral for the given board, or null if none applies (OSS,
 *  unsupported board, or the factory declined — e.g. a free user). Never throws. */
export function createPioPeripheral(boardKind: string, boardId: string): PioPeripheral | null {
  if (!_factory) return null;
  try {
    return _factory(boardKind, boardId);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[pio-peripheral] factory threw:', e);
    return null;
  }
}

/**
 * ATtiny85 USI → I2C bridge.
 *
 * The ATtiny85 has no hardware TWI. TinyWireM (and Tiny4kOLED, the Adafruit
 * tiny ports, etc.) drive I2C through the USI peripheral in two-wire mode:
 * SDA on PB0, SCL on PB2. avr8js's `AVRUSI` shifts the USI data register out
 * onto those port pins. This bridge sniffs the SDA/SCL lines, reconstructs the
 * I2C transaction (START / STOP conditions + 8-bit bytes, MSB first) and
 * replays it onto the shared I2C bus as start / connectToSlave / writeByte /
 * stop — exactly what `AVRTWI` does for the ATmega328P/Uno. I2C devices
 * (SSD1306 OLED, etc.) then receive data normally.
 *
 * TinyWireM does not abort on NACK, so the bridge is a passive sniffer and
 * never drives the ACK bit — which keeps it simple and avoids fighting the
 * open-collector line.
 *
 * Validated against the real ATTinyCore-compiled Tiny4kOLED firmware: the
 * decoded stream is `connectToSlave(0x3C,W)` followed by the SSD1306 init
 * commands (0x00, 0xC8, 0xA1, 0xAD, 0x30, 0x8D, 0x14 …) and framebuffer data
 * (0x40, …) — identical to the hardware-TWI path.
 */
import { AVRUSI } from 'avr8js';
import type { CPU, AVRIOPort } from 'avr8js';
import type { I2CBusManager } from './I2CBusManager';

export interface UsiI2cOptions {
  /** PIN register address (PINB on the ATtiny85 = 0x36). */
  pinAddr?: number;
  /** SDA bit within the port (USI DI/DO → PB0). */
  sda?: number;
  /** SCL bit within the port (USI USCK → PB2). */
  scl?: number;
}

/**
 * Instantiate the USI peripheral and attach the I2C sniffer to `port`.
 * Returns the AVRUSI instance so the caller can keep it alive (GC roots).
 */
export function attachUsiI2c(
  cpu: CPU,
  port: AVRIOPort,
  bus: I2CBusManager,
  opts: UsiI2cOptions = {},
): AVRUSI {
  const pinAddr = opts.pinAddr ?? 0x36; // ATtiny85 PINB
  const sdaPin = opts.sda ?? 0; // PB0 = USI DI/DO (SDA)
  const sclPin = opts.scl ?? 2; // PB2 = USI USCK (SCL)

  const usi = new AVRUSI(cpu, port, pinAddr, sdaPin, sclPin);

  let sda = 1;
  let scl = 1;
  let inFrame = false;
  let bit = 0;
  let cur = 0;
  let addressByte = false;

  // PinState.Low === 0; everything else (High / pulled-up / floating) reads as 1.
  const lineOf = (pin: number) => (port.pinState(pin) === 0 ? 0 : 1);

  port.addListener(() => {
    const nextScl = lineOf(sclPin);
    const nextSda = lineOf(sdaPin);

    // START / STOP are SDA edges while SCL is held HIGH.
    if (scl === 1 && nextScl === 1) {
      if (sda === 1 && nextSda === 0) {
        bus.start(inFrame); // repeated START if a frame was already open
        inFrame = true;
        bit = 0;
        cur = 0;
        addressByte = true;
      } else if (sda === 0 && nextSda === 1) {
        if (inFrame) bus.stop();
        inFrame = false;
      }
    }

    // Data bits are sampled on the SCL rising edge (MSB first). After 8 bits the
    // 9th clock is the ACK slot, which the sniffer ignores.
    if (scl === 0 && nextScl === 1 && inFrame) {
      if (bit < 8) {
        cur = ((cur << 1) | nextSda) & 0xff;
        bit++;
        if (bit === 8) {
          if (addressByte) {
            bus.connectToSlave(cur >> 1, (cur & 1) === 0);
            addressByte = false;
          } else {
            bus.writeByte(cur);
          }
        }
      } else {
        bit = 0;
        cur = 0;
      }
    }

    scl = nextScl;
    sda = nextSda;
  });

  return usi;
}

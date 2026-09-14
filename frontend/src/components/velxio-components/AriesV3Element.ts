/**
 * C-DAC ARIES v3.0 RISC-V Development Board Web Component.
 *
 * Based on the C-DAC THEJAS32 SoC (VEGA ET1031 RISC-V core @ 100MHz).
 * Renders the crisp vector board SVG (cdac_aries_v3_board_only.svg) and exposes
 * mathematically calibrated pin coordinates for wire snapping via `pinInfo`.
 */

import ariesSvg from '../../assets/cdac_aries_v3_board_only.svg';

export interface PinDef {
  name: string;
  x: number;
  y: number;
  signals?: string[];
}

// Native SVG viewBox: "317.9 137.8 162.0 208.2"
const SVG_X = 317.9;
const SVG_Y = 137.8;
const SVG_W = 162.0;
const SVG_H = 208.2;

// Canvas render dimensions (preserving exact aspect ratio 162 : 208.2)
export const ARIES_DISPLAY_W = 210;
export const ARIES_DISPLAY_H = 270;

const SCALE_X = ARIES_DISPLAY_W / SVG_W;
const SCALE_Y = ARIES_DISPLAY_H / SVG_H;

/**
 * Maps an exact (x, y) coordinate from the board's SVG coordinate space
 * directly into element-local CSS canvas pixels.
 */
function svgToCanvas(svgX: number, svgY: number): { x: number; y: number } {
  return {
    x: Math.round((svgX - SVG_X) * SCALE_X * 10) / 10,
    y: Math.round((svgY - SVG_Y) * SCALE_Y * 10) / 10,
  };
}

/**
 * Pre-computed pin coordinates calibrated to the SVG header slot holes.
 * All positions are scaled to canvas CSS pixels.
 */
function buildAriesPinInfo(): PinDef[] {
  const pins: PinDef[] = [];

  const addPin = (name: string, svgX: number, svgY: number, signals?: string[]) => {
    const pt = svgToCanvas(svgX, svgY);
    pins.push({
      name,
      x: pt.x,
      y: pt.y,
      signals: signals ?? [],
    });
  };

  // ── J1: Top Right Inner 10-pin Header (X = 465.43) ───────────────────────
  addPin('I2C1_SCL', 465.43, 194.37, ['SCL1']);
  addPin('I2C1_SDA', 465.43, 202.15, ['SDA1']);
  addPin('NC', 465.43, 209.92);
  addPin('GND', 465.43, 217.70);
  addPin('SPI0_SCLK', 465.43, 225.47, ['SCLK0']);
  addPin('SPI0_MISO', 465.43, 233.25, ['MISO0']);
  addPin('SPI0_MOSI', 465.43, 241.03, ['MOSI0']);
  addPin('SPI0_SS', 465.43, 248.81, ['SS0']);
  addPin('PWM4', 465.43, 256.58, ['~4']);
  addPin('PWM3', 465.43, 264.36, ['~3']);

  // ── J3: Top Right Outer 8-pin Header (X = 473.21) ────────────────────────
  addPin('PWM7', 473.21, 209.92, ['~7']);
  addPin('PWM6', 473.21, 217.70, ['~6']);
  addPin('PWM5', 473.21, 225.47, ['~5']);
  addPin('GPIO15', 473.21, 233.25, ['15', 'D15']);
  addPin('GPIO14', 473.21, 241.03, ['14', 'D14']);
  addPin('GPIO13', 473.21, 248.81, ['13', 'D13']);
  addPin('GPIO12', 473.21, 256.58, ['12', 'D12']);
  addPin('GPIO11', 473.21, 264.36, ['11', 'D11']);

  // ── J2: Bottom Right Header (2x8) ────────────────────────────────────────
  // Outer column: GPIO10..GPIO3 (X = 472.95)
  addPin('GPIO10', 472.95, 275.10, ['10', 'D10']);
  addPin('GPIO9', 472.95, 282.87, ['9', 'D9']);
  addPin('GPIO8', 472.95, 290.65, ['8', 'D8']);
  addPin('GPIO7', 472.95, 298.42, ['7', 'D7']);
  addPin('GPIO6', 472.95, 306.20, ['6', 'D6']);
  addPin('GPIO5', 472.95, 313.98, ['5', 'D5']);
  addPin('GPIO4', 472.95, 321.76, ['4', 'D4']);
  addPin('GPIO3', 472.95, 329.53, ['3', 'D3']);

  // Inner column: PWM2..PWM0, GPIO2..GPIO0, UART1 (X = 465.18)
  addPin('PWM2', 465.18, 275.10, ['~2']);
  addPin('PWM1', 465.18, 282.87, ['~1']);
  addPin('PWM0', 465.18, 290.65, ['~0']);
  addPin('GPIO2', 465.18, 298.42, ['2', 'D2', '*2']);
  addPin('GPIO1', 465.18, 306.20, ['1', 'D1', '*1']);
  addPin('GPIO0', 465.18, 313.98, ['0', 'D0', '*0']);
  addPin('UART1_TX', 465.18, 321.76, ['TX1']);
  addPin('UART1_RX', 465.18, 329.53, ['RX1']);

  // ── J11: Top Left Outer Power Header (8 pins, X = 326.58) ────────────────
  addPin('NC', 326.58, 223.52);
  addPin('IOREF', 326.58, 231.29);
  addPin('RST', 326.58, 239.07, ['RESET']);
  addPin('3V3', 326.58, 246.85, ['3.3V']);
  addPin('5V', 326.58, 254.63, ['5.0V', 'VCC']);
  addPin('GND', 326.58, 262.40);
  addPin('GND', 326.58, 270.18);
  addPin('VIN', 326.58, 277.96, ['7-12V']);

  // ── J9: Top Left Inner GPIO Header (8 pins, X = 334.36) ──────────────────
  addPin('GPIO31', 334.36, 223.52, ['31', 'D31']);
  addPin('GPIO30', 334.36, 231.29, ['30', 'D30']);
  addPin('GPIO29', 334.36, 239.07, ['29', 'D29']);
  addPin('GPIO28', 334.36, 246.85, ['28', 'D28']);
  addPin('GPIO27', 334.36, 254.63, ['27', 'D27']);
  addPin('GPIO26', 334.36, 262.40, ['26', 'D26']);
  addPin('GPIO25', 334.36, 270.18, ['25', 'D25']);
  addPin('GND', 334.36, 277.96);

  // ── J10: Bottom Left Header (2x6) ────────────────────────────────────────
  // Outer column: A0..A3, I2C0 (X = 326.58)
  addPin('A0', 326.58, 290.65, ['ADC_CH0']);
  addPin('A1', 326.58, 298.43, ['ADC_CH1']);
  addPin('A2', 326.58, 306.20, ['ADC_CH2']);
  addPin('A3', 326.58, 313.98, ['ADC_CH3']);
  addPin('I2C0_SDA', 326.58, 321.76, ['SDA0']);
  addPin('I2C0_SCL', 326.58, 329.53, ['SCL0']);

  // Inner column: GPIO21..GPIO16 (X = 334.36)
  addPin('GPIO21', 334.36, 290.65, ['21', 'D21']);
  addPin('GPIO20', 334.36, 298.43, ['20', 'D20']);
  addPin('GPIO19', 334.36, 306.20, ['19', 'D19']);
  addPin('GPIO18', 334.36, 313.98, ['18', 'D18']);
  addPin('GPIO17', 334.36, 321.76, ['17', 'D17']);
  addPin('GPIO16', 334.36, 329.53, ['16', 'D16']);

  // ── J14: Power Selector Header (Top Edge, Y = 146.15) ────────────────────
  addPin('VIN', 369.65, 146.15);
  addPin('5V0', 377.31, 146.15, ['5V']);
  addPin('VCC_USB', 384.97, 146.15);

  // ── J12: Boot Select Header (Bottom Edge) ────────────────────────────────
  addPin('BOOT_SEL', 350.63, 337.58);
  addPin('GND', 353.99, 344.10);

  // ── J7: SPI1 Header (Bottom Edge 2x3) ────────────────────────────────────
  addPin('SPI1_SS', 394.19, 327.63, ['SS1']);
  addPin('SPI1_SCLK', 402.03, 327.63, ['SCLK1']);
  addPin('SPI1_MISO', 409.88, 327.63, ['MISO1']);
  addPin('GND', 394.19, 335.48);
  addPin('SPI1_MOSI', 402.03, 335.48, ['MOSI1']);
  addPin('3V3', 409.88, 335.48);

  // ── J5: UART2 Header (Bottom Edge 2x2) ───────────────────────────────────
  addPin('3V3', 436.92, 320.77);
  addPin('UART2_TX', 444.77, 320.77, ['TX2']);
  addPin('GND', 436.92, 328.62);
  addPin('UART2_RX', 444.77, 328.62, ['RX2']);

  // ── J4: SPI2 Header (Middle Right 2x3) ───────────────────────────────────
  addPin('3V3', 446.77, 178.29);
  addPin('SPI2_MOSI', 454.61, 178.29, ['MOSI2']);
  addPin('SPI2_MISO', 446.77, 186.13, ['MISO2']);
  addPin('SPI2_SCLK', 454.61, 186.13, ['SCLK2']);
  addPin('GND', 446.77, 193.98);
  addPin('SPI2_SS', 454.61, 193.98, ['SS2']);

  // ── RESET Button ─────────────────────────────────────────────────────────
  addPin('RESET', 453.46, 149.93, ['RST']);

  return pins;
}

const ARIES_PIN_INFO: PinDef[] = buildAriesPinInfo();

const HTMLElementCtor: typeof HTMLElement =
  typeof HTMLElement !== 'undefined'
    ? HTMLElement
    : (class { } as unknown as typeof HTMLElement);

export class AriesV3Element extends HTMLElementCtor {
  private _heartbeat = false;
  private _rgbColor = '';

  constructor() {
    super();
    if (this.attachShadow) {
      this.attachShadow({ mode: 'open' });
    }
  }

  connectedCallback() {
    this.render();
  }

  get pinInfo(): PinDef[] {
    return ARIES_PIN_INFO;
  }

  set heartbeat(active: boolean) {
    this._heartbeat = active;
    const el = this.shadowRoot?.getElementById('hb-led');
    if (el) {
      if (active) {
        el.classList.add('active');
        el.style.opacity = '1';
      } else {
        el.classList.remove('active');
        el.style.opacity = '0.2';
      }
    }
  }

  get heartbeat(): boolean {
    return this._heartbeat;
  }

  set rgb(color: string) {
    this._rgbColor = color;
    const el = this.shadowRoot?.getElementById('rgb-led');
    if (el) {
      el.style.backgroundColor = color || 'transparent';
      el.style.boxShadow = color ? `0 0 6px 2px ${color}` : 'none';
    }
  }

  get rgb(): string {
    return this._rgbColor;
  }

  render() {
    if (!this.shadowRoot) return;

    // LED positions calculated from exact SVG coordinates:
    // LD4 (Processor Heartbeat): (331.18, 211.16)
    // LD1 (RGB LED): (331.18, 202.37)
    const hbPos = svgToCanvas(331.18, 211.16);
    const rgbPos = svgToCanvas(331.18, 202.37);

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: ${ARIES_DISPLAY_W}px;
          height: ${ARIES_DISPLAY_H}px;
          position: relative;
          user-select: none;
        }
        img {
          width: 100%;
          height: 100%;
          display: block;
          user-select: none;
          -webkit-user-drag: none;
          pointer-events: none;
        }
        #hb-led {
          position: absolute;
          left: ${hbPos.x - 3}px;
          top: ${hbPos.y - 3}px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #00ff2aff;
          box-shadow: 0 0 5px 2px #5cfd38ff;
          opacity: 0.2;
          transition: opacity 120ms ease-out;
          pointer-events: none;
        }
        #hb-led.active {
          animation: hb-pulse 1.2s infinite ease-in-out;
        }
        @keyframes hb-pulse {
          0%, 100% { opacity: 0.25; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1.25); }
        }
        #rgb-led {
          position: absolute;
          left: ${rgbPos.x - 3.5}px;
          top: ${rgbPos.y - 3.5}px;
          width: 7px;
          height: 7px;
          border-radius: 2px;
          background: transparent;
          transition: background-color 80ms ease-out, box-shadow 80ms ease-out;
          pointer-events: none;
        }
      </style>
      <img src="${ariesSvg}" alt="C-DAC ARIES v3.0 RISC-V Development Board" draggable="false" />
      <div id="hb-led" title="Heartbeat LED (LD4)"></div>
      <div id="rgb-led" title="RGB LED (LD1)"></div>
    `;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('velxio-aries-v3')) {
  customElements.define('velxio-aries-v3', AriesV3Element);
}

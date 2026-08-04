/**
 * Ssd1306I2cElement — `<velxio-ssd1306-i2c-4pin>` Web Component.
 *
 * The common cheap 0.96" SSD1306 OLED **I2C module with only 4 pins**
 * (GND / VCC / SCL / SDA) — the counterpart to the 8-pin `wokwi-ssd1306`
 * breakout, and the layout most beginners actually have on their desk
 * (matches Wokwi's `board-ssd1306`). A velxio-local element because
 * `@wokwi/elements` only ships the 8-pin variant. See issue #215.
 *
 * Same rendering surface as `wokwi-ssd1306` so `SSD1306Core.syncElement`
 * (simulation/parts/ProtocolParts.ts) drives it unchanged:
 *   - `element.imageData` — a 128×64 ImageData (RGBA)
 *   - `element.redraw()`  — flushes imageData to the internal canvas
 *
 * Per CLAUDE.md §6a this MUST be a real Web Component — the wire system reads
 * `pinInfo` from the DOM node to place wire endpoints on the pin tips.
 */

const SCREEN_W = 128;
const SCREEN_H = 64;

// Body geometry (CSS px). Kept visually in the same family as wokwi-ssd1306
// (blue PCB, dark screen, corner mounting holes, star) but narrower — a 4-pin
// header instead of 8. Screen sits at (SCREEN_X, SCREEN_Y).
const BODY_W = 150;
const BODY_H = 108;
const SCREEN_X = 11;
const SCREEN_Y = 30;

// 4-pin 0.1" header, centred along the top edge. `x`/`y` are the pin tips the
// wire system snaps to.
const PIN_Y = 11;
const PIN_SPACING = 15;
const PIN_NAMES = ['GND', 'VCC', 'SCL', 'SDA'] as const;
const PIN_X0 = BODY_W / 2 - ((PIN_NAMES.length - 1) * PIN_SPACING) / 2;
// Ring colours echo the wokwi-ssd1306 pin styling.
const PIN_RING = ['#B4AEAB', '#C08540', '#009E9B', '#007ADB'];

function signalsFor(name: string) {
  if (name === 'GND') return [{ type: 'power', signal: 'GND' }];
  if (name === 'VCC') return [{ type: 'power', signal: 'VCC' }];
  if (name === 'SCL') return [{ type: 'i2c', signal: 'SCL' }];
  if (name === 'SDA') return [{ type: 'i2c', signal: 'SDA' }];
  return [];
}

class Ssd1306I2cElement extends HTMLElement {
  private _imageData: ImageData = new ImageData(SCREEN_W, SCREEN_H);
  private ctx: CanvasRenderingContext2D | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
    this.initContext();
  }

  /** Wire system reads this from the DOM — do NOT memoize. */
  get pinInfo() {
    return PIN_NAMES.map((name, i) => ({
      name,
      x: PIN_X0 + i * PIN_SPACING,
      y: PIN_Y,
      number: i + 1,
      signals: signalsFor(name),
    }));
  }

  get canvas(): HTMLCanvasElement | null {
    return this.shadowRoot?.querySelector('canvas') ?? null;
  }

  /** Accepts the ImageData pushed by SSD1306Core; ignores anything else (e.g. a
   *  stray string property assignment from the loader). */
  set imageData(v: ImageData) {
    if (v instanceof ImageData) this._imageData = v;
  }
  get imageData(): ImageData {
    return this._imageData;
  }

  /** Flush the current imageData to the canvas (called by SSD1306Core). */
  redraw(): void {
    if (!this.ctx) this.initContext();
    try {
      this.ctx?.putImageData(this._imageData, 0, 0);
    } catch {
      /* canvas not ready yet */
    }
  }

  private initContext(): void {
    const c = this.canvas;
    this.ctx = c?.getContext('2d') ?? null;
    this.ctx?.putImageData(this._imageData, 0, 0);
  }

  private render(): void {
    if (!this.shadowRoot) return;
    const holes = [
      [8, 8],
      [BODY_W - 8, 8],
      [8, BODY_H - 8],
      [BODY_W - 8, BODY_H - 8],
    ];
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: inline-block; line-height: 0; position: relative; }
        svg { display: block; user-select: none; -webkit-user-select: none; }
        canvas {
          position: absolute;
          left: ${SCREEN_X}px;
          top: ${SCREEN_Y}px;
          image-rendering: pixelated;
          pointer-events: none;
        }
      </style>
      <svg width="${BODY_W}" height="${BODY_H}" xmlns="http://www.w3.org/2000/svg">
        <!-- Blue PCB -->
        <rect stroke="#BE9B72" fill="#025CAF" x=".5" y=".5"
              width="${BODY_W - 1}" height="${BODY_H - 1}" rx="10" />

        <!-- Corner mounting holes -->
        <g fill="#59340A" stroke="#BE9B72" stroke-width="0.6">
          ${holes.map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="4.5" />`).join('')}
        </g>

        <!-- 128 x 64 screen (the <canvas> paints on top of this) -->
        <rect x="${SCREEN_X}" y="${SCREEN_Y}" width="${SCREEN_W}" height="${SCREEN_H}" fill="#1A1A1A" />

        <!-- Star decoration, echoing the 8-pin part -->
        <path fill="#FFF" stroke="#FFF"
          d="M133 6.5l-1.4 2.6-3 .4 2.2 2-.53 2.83 2.75-1.34 2.75 1.34-.53-2.83 2.2-2-3-.4-1.4-2.6z" />

        <!-- 4-pin header + labels -->
        <g font-family="monospace" font-size="6" font-weight="300" fill="#FFF" text-anchor="middle">
          ${PIN_NAMES.map(
            (name, i) => `<text x="${PIN_X0 + i * PIN_SPACING}" y="${PIN_Y + 12}">${name}</text>`,
          ).join('')}
        </g>
        <g fill="#9D9D9A" stroke-width="0.4">
          ${PIN_NAMES.map(
            (_, i) =>
              `<circle stroke="${PIN_RING[i]}" cx="${PIN_X0 + i * PIN_SPACING}" cy="${PIN_Y}" r="3.5" />`,
          ).join('')}
        </g>
      </svg>
      <canvas width="${SCREEN_W}" height="${SCREEN_H}"></canvas>
    `;
  }
}

if (!customElements.get('velxio-ssd1306-i2c-4pin')) {
  customElements.define('velxio-ssd1306-i2c-4pin', Ssd1306I2cElement);
}

export type { Ssd1306I2cElement };

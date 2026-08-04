/**
 * RaspberryPi3Bridge
 *
 * Manages the WebSocket connection from the frontend to the backend
 * QEMU manager for one Raspberry Pi 3B board instance.
 *
 * Protocol (JSON frames):
 *   Frontend → Backend
 *     { type: 'start_pi', data: { board: 'raspberry-pi-3'|'raspberry-pi-4'|'raspberry-pi-5' } }
 *     { type: 'stop_pi' }
 *     { type: 'serial_input', data: { bytes: number[] } }
 *     { type: 'gpio_in', data: { pin: number, state: 0 | 1 } }
 *     { type: 'pi_attach_slave', data: {
 *         bus_kind: 'i2c'|'spi'|'uart',
 *         bus_num:  number,
 *         address?: number,   // i2c
 *         cs?:      number,   // spi
 *         model_id: string,   // e.g. 'bme280'
 *         config?:  Record<string, unknown>,
 *     }}
 *     { type: 'pi_detach_slave', data: { bus_kind, bus_num, address?|cs? } }
 *
 *   Backend → Frontend
 *     { type: 'serial_output', data: { data: string } }
 *     { type: 'gpio_change',   data: { pin: number, state: 0 | 1 } }
 *     { type: 'system',        data: { event: string, ... } }
 *     { type: 'error',         data: { message: string } }
 */

const API_BASE = (): string => {
  // The desktop shell injects the sidecar URL at runtime (random port) via
  // window.__VELXIO_API_BASE__; honor it first so the QEMU-board WebSocket
  // reaches the local Python sidecar instead of the build-time / dev
  // default. Without this, ESP32 / Pi / STM32 simulations never start in
  // the desktop app (the WS dialed localhost:8001, not the sidecar port).
  if (typeof window !== 'undefined') {
    const injected = (window as { __VELXIO_API_BASE__?: string }).__VELXIO_API_BASE__;
    if (typeof injected === 'string' && injected) {
      return injected.replace(/\/+$/, '');
    }
  }
  return (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8001/api';
};

export class RaspberryPi3Bridge {
  readonly boardId: string;
  /** Pi family member: 'raspberry-pi-3' | 'raspberry-pi-4' | 'raspberry-pi-5'.
   * The backend uses this to pick the QEMU -cpu / -m. Defaults to Pi 3 for
   * back-compat with code paths that don't know the kind yet. */
  readonly boardKind: string;

  // Callbacks wired up by useSimulatorStore
  onSerialData: ((char: string) => void) | null = null;
  onPinChange: ((gpioPin: number, state: boolean) => void) | null = null;
  onConnected: (() => void) | null = null;
  onDisconnected: (() => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  onSystemEvent: ((event: string, data: Record<string, unknown>) => void) | null = null;
  /** Fires once when the guest Linux has finished booting and reached an
   * interactive shell prompt. `connected` only means the WebSocket is open
   * (~1s); the guest still takes 30-60s to boot. Drives the "booting" UI and
   * gates file uploads. */
  onBooted: (() => void) | null = null;

  private socket: WebSocket | null = null;
  private _connected = false;
  private _booted = false;
  /** Rolling, escape-stripped tail of recent guest output, used to detect the
   * boot-complete marker and shell prompts for flow-controlled sends. */
  private _serialTail = '';
  private _promptWaiters: Array<() => void> = [];

  constructor(boardId: string, boardKind: string = 'raspberry-pi-3') {
    this.boardId = boardId;
    this.boardKind = boardKind;
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) return;

    const base = API_BASE();
    const path = `/simulation/ws/${encodeURIComponent(this.boardId)}`;
    let wsUrl: string;
    if (import.meta.env.VITE_WS_BASE) {
      wsUrl = (import.meta.env.VITE_WS_BASE as string).replace(/\/+$/, '') + path;
    } else if (base.startsWith('http://') || base.startsWith('https://')) {
      const wsProtocol = base.startsWith('https') ? 'wss:' : 'ws:';
      wsUrl = base.replace(/^https?:/, wsProtocol) + path;
    } else {
      wsUrl = `ws://104.214.172.50/api${path}`;
    }

    const socket = new WebSocket(wsUrl);
    this.socket = socket;

    socket.onopen = () => {
      this._connected = true;
      this.onConnected?.();
      // Tell the backend which Pi family member to boot.
      this._send({ type: 'start_pi', data: { board: this.boardKind } });
    };

    socket.onmessage = (event: MessageEvent) => {
      let msg: { type: string; data: Record<string, unknown> };
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'serial_output': {
          const text = (msg.data.data as string) ?? '';
          if (this.onSerialData) {
            for (const ch of text) this.onSerialData(ch);
          }
          this._observeSerial(text);
          break;
        }
        case 'gpio_change': {
          const pin = msg.data.pin as number;
          const state = (msg.data.state as number) === 1;
          this.onPinChange?.(pin, state);
          break;
        }
        case 'system':
          if (msg.data.event === 'booted' || msg.data.event === 'booting') {
            this._booted = true;
            this.onBooted?.();
          }
          this.onSystemEvent?.(msg.data.event as string, msg.data);
          break;
        case 'error':
          this.onError?.(msg.data.message as string);
          break;
      }
    };

    socket.onclose = () => {
      this._connected = false;
      this.socket = null;
      this._resetBootState();
      this.onDisconnected?.();
    };

    socket.onerror = () => {
      this.onError?.('WebSocket error');
    };
  }

  disconnect(): void {
    if (this.socket) {
      // Tell backend to stop Pi before closing
      this._send({ type: 'stop_pi' });
      this.socket.close();
      this.socket = null;
    }
    this._connected = false;
    this._resetBootState();
  }

  /** Clear boot/prompt state and release any pending prompt waiters so an
   * in-flight upload resolves (rather than hanging) when the Pi stops. */
  private _resetBootState(): void {
    this._booted = false;
    this._serialTail = '';
    const waiters = this._promptWaiters;
    this._promptWaiters = [];
    for (const w of waiters) w();
  }

  /** Send a byte to the Pi's ttyAMA0 (user serial) */
  sendSerialByte(byte: number): void {
    this._send({ type: 'serial_input', data: { bytes: [byte] } });
  }

  /** Send multiple bytes at once */
  sendSerialBytes(bytes: number[]): void {
    if (bytes.length === 0) return;
    this._send({ type: 'serial_input', data: { bytes } });
  }

  /** Write a UTF-8 string to the guest shell. */
  sendSerialText(text: string): void {
    this.sendSerialBytes(Array.from(new TextEncoder().encode(text)));
  }

  /**
   * Send a line to the guest shell and resolve once the shell prompt returns
   * (i.e. the command has been consumed and executed), or after `timeoutMs`.
   * This replaces fixed setTimeout pacing for uploads so long lines are not
   * dropped by the unflow-controlled console. Always resolves (never rejects)
   * so a missed prompt degrades to a time-bounded wait rather than a hang.
   */
  sendAndWaitForPrompt(text: string, timeoutMs = 5000): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const i = this._promptWaiters.indexOf(waiter);
        if (i >= 0) this._promptWaiters.splice(i, 1);
        resolve();
      };
      const waiter = finish;
      const timer = setTimeout(finish, timeoutMs);
      // Forget any prompt already on screen so we wait for the NEXT one,
      // which only reappears after this command has run.
      this._serialTail = '';
      this._promptWaiters.push(waiter);
      this.sendSerialText(text);
    });
  }

  private static _stripAnsi(s: string): string {
    return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b[=>]/g, '');
  }

  /** Update the rolling tail, fire onBooted once, and release prompt waiters. */
  private _observeSerial(text: string): void {
    this._serialTail = (this._serialTail + text).slice(-512);
    const clean = RaspberryPi3Bridge._stripAnsi(this._serialTail);
    if (!this._booted && (clean.length > 0 || /login on 'hvc0'/.test(clean) || /:~[#$]/.test(clean) || /[\/#$]/.test(clean))) {
      this._booted = true;
      this.onBooted?.();
    }
    // A shell prompt ends in "# " / "$ " (trailing space, no newline). Trim
    // only trailing spaces/tabs (not newlines) so command OUTPUT ending in
    // "#\n" is NOT mistaken for a prompt; heredoc continuation "> " is also
    // excluded since it ends in ">".
    const promptTail = clean.replace(/[ \t]+$/, '');
    if (this._promptWaiters.length && (promptTail.endsWith('#') || promptTail.endsWith('$'))) {
      const waiters = this._promptWaiters;
      this._promptWaiters = [];
      for (const w of waiters) w();
    }
  }

  /** Drive a GPIO pin from an external source (e.g. connected Arduino) */
  sendPinEvent(gpioPin: number, state: boolean): void {
    this._send({ type: 'gpio_in', data: { pin: gpioPin, state: state ? 1 : 0 } });
  }

  /**
   * Attach an I2C/SPI/UART slave model to the running Pi. The backend
   * pro overlay turns this into a PiSlaveRegistry entry that the
   * protocol dispatcher consults on each guest read. OSS images
   * silently drop the message.
   */
  attachSlave(spec: {
    bus_kind: 'i2c' | 'spi' | 'uart';
    bus_num: number;
    address?: number;
    cs?: number;
    model_id: string;
    config?: Record<string, unknown>;
  }): void {
    this._send({ type: 'pi_attach_slave', data: spec });
  }

  detachSlave(spec: {
    bus_kind: 'i2c' | 'spi' | 'uart';
    bus_num: number;
    address?: number;
    cs?: number;
  }): void {
    this._send({ type: 'pi_detach_slave', data: spec });
  }

  private _send(payload: unknown): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }
}

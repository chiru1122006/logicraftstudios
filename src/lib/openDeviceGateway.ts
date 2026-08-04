/**
 * openDeviceGateway
 *
 * Opens an emulated board's IoT-gateway page in a small, FLOATING, draggable
 * panel docked to the top-right — NOT a modal overlay and NOT a new tab.
 *
 * Why not a new tab: the Raspberry Pi Pico W emulation runs in THIS browser
 * tab, driven by requestAnimationFrame. A new tab backgrounds the emulation
 * tab, the browser pauses its rAF, the simulated chip freezes, and the gateway
 * can no longer reach the server on it (request times out / 502). An in-tab
 * iframe keeps the emulation in the foreground so the chip keeps answering.
 *
 * Why not a modal: the panel must NOT block the canvas or the editor — the
 * user needs to watch the board react (LED/relay) and keep pressing buttons,
 * wiring components, editing code while the device page is open. So: no
 * backdrop, draggable by its title bar, resizable, parked out of the way.
 *
 * (The ESP32 doesn't need any of this — its server runs in QEMU on the
 * backend, immune to tab visibility — so it still opens in a new tab.)
 */

const PANEL_ID = 'velxio-device-gateway-panel';

export function openDeviceGateway(url: string): void {
  if (typeof document === 'undefined') return;
  document.getElementById(PANEL_ID)?.remove();

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.cssText =
    'position:fixed;top:64px;right:20px;z-index:100000;' +
    'width:340px;height:500px;display:flex;flex-direction:column;' +
    'background:#1e1e1e;border:1px solid #444;border-radius:10px;overflow:hidden;' +
    'box-shadow:0 12px 48px rgba(0,0,0,0.55);resize:both;min-width:240px;min-height:220px;';

  const bar = document.createElement('div');
  bar.style.cssText =
    'flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px;' +
    'padding:7px 10px;background:#2d2d2e;color:#ddd;cursor:move;user-select:none;' +
    'font:12px -apple-system,BlinkMacSystemFont,sans-serif;border-bottom:1px solid #444;';

  const title = document.createElement('span');
  title.textContent = 'Device web page';
  title.style.cssText = 'font-weight:600;white-space:nowrap;';

  const right = document.createElement('div');
  right.style.cssText = 'display:flex;align-items:center;gap:12px;';

  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Reload';
  reload.style.cssText = 'background:none;border:none;color:#4fc3f7;cursor:pointer;font-size:12px;padding:0;';

  // No "open in a new tab" affordance: a background tab pauses the chip's
  // rAF loop, freezing the emulated server (502). The in-tab iframe is the
  // only way the Pico W's device page stays reachable.

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.style.cssText = 'background:#444;border:none;color:#fff;cursor:pointer;font-size:12px;border-radius:4px;padding:3px 9px;';

  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.style.cssText = 'flex:1 1 auto;border:none;width:100%;background:#fff;';

  reload.onclick = () => { iframe.src = url; };
  close.onclick = () => panel.remove();

  // Drag by the title bar. Switch from right-anchored to left/top on grab so
  // the panel follows the cursor cleanly.
  bar.addEventListener('mousedown', (e) => {
    if (e.target !== bar && e.target !== title) return; // not on a button
    e.preventDefault();
    const rect = panel.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    panel.style.right = 'auto';
    panel.style.left = rect.left + 'px';
    panel.style.top = rect.top + 'px';
    // While dragging, don't let the iframe swallow mouse events.
    iframe.style.pointerEvents = 'none';
    const onMove = (m: MouseEvent) => {
      const maxX = window.innerWidth - 60;
      const maxY = window.innerHeight - 30;
      panel.style.left = Math.max(0, Math.min(maxX, m.clientX - dx)) + 'px';
      panel.style.top = Math.max(0, Math.min(maxY, m.clientY - dy)) + 'px';
    };
    const onUp = () => {
      iframe.style.pointerEvents = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  right.append(reload, close);
  bar.append(title, right);
  panel.append(bar, iframe);
  document.body.append(panel);
}

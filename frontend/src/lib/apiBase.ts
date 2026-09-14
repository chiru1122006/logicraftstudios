/**
 * Resolve the base URL of the Logicraft Studios FastAPI backend at runtime.
 *
 * Layers of override:
 *   1. `window.__LOGICRAFT_API_BASE__` or `window.__VELXIO_API_BASE__` (injected at runtime)
 *   2. `localStorage.getItem('LOGICRAFT_API_BASE')` (user-configurable setting)
 *   3. `import.meta.env.VITE_API_BASE` (build/dev-time environment variable)
 *   4. Azure production backend (http://104.214.172.50/api) where QEMU, ESP32, and Arduino toolchains run.
 */

export function getApiBase(): string {
  if (typeof window !== 'undefined') {
    const w = window as { __LOGICRAFT_API_BASE__?: string; __VELXIO_API_BASE__?: string };
    if (typeof w.__LOGICRAFT_API_BASE__ === 'string' && w.__LOGICRAFT_API_BASE__) {
      return w.__LOGICRAFT_API_BASE__.replace(/\/+$/, '');
    }
    if (typeof w.__VELXIO_API_BASE__ === 'string' && w.__VELXIO_API_BASE__) {
      return w.__VELXIO_API_BASE__.replace(/\/+$/, '');
    }
    try {
      const stored = localStorage.getItem('LOGICRAFT_API_BASE');
      if (stored) return stored.replace(/\/+$/, '');
    } catch {
      // ignore localStorage errors
    }
  }
  const fromEnv = import.meta.env.VITE_API_BASE;
  if (typeof fromEnv === 'string' && fromEnv) {
    return fromEnv.replace(/\/+$/, '');
  }
  return 'http://104.214.172.50/api';
}

/**
 * Construct the correct WebSocket URL for simulation sessions across local dev,
 * custom domains, and Azure production.
 */
export function getSimWebSocketUrl(clientId: string, suffix = ''): string {
  const base = getApiBase();
  const path = `/simulation/ws/${encodeURIComponent(clientId)}${suffix}`;

  if (base.startsWith('http://') || base.startsWith('https://')) {
    const wsProto = base.startsWith('https://') ? 'wss:' : 'ws:';
    return base.replace(/^https?:/, wsProto) + path;
  }

  // Relative path (e.g. '/api')
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const cleanBase = base.startsWith('/') ? base : '/' + base;
    return `${proto}//${window.location.host}${cleanBase}${path}`;
  }

  return `ws://104.214.172.50/api${path}`;
}

declare global {
  interface Window {
    __LOGICRAFT_API_BASE__?: string;
    __VELXIO_API_BASE__?: string;
  }
}

let _cachedWsBase: string | null = null;
let _isFetchingWsBase = false;

/**
 * Eagerly fetch and cache the secure WebSocket base from the backend.
 * On production (https://www.logicraftstudios.tech), the backend provides
 * the active secure WSS endpoint URL to avoid Mixed Content errors and Vercel edge WS limitations.
 */
export async function fetchSimulationWsBase(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  if (_isFetchingWsBase) return _cachedWsBase;

  _isFetchingWsBase = true;
  try {
    const base = getApiBase();
    const configUrl = `${base.replace(/\/+$/, '')}/simulation/config`;
    const res = await fetch(configUrl);
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.ws_url === 'string' && data.ws_url) {
        _cachedWsBase = data.ws_url.replace(/\/+$/, '');
        try {
          localStorage.setItem('LOGICRAFT_WS_BASE', _cachedWsBase);
        } catch {
          // ignore localStorage errors
        }
        return _cachedWsBase;
      }
    }
  } catch (err) {
    // Non-fatal: bridge will use fallback URL
  } finally {
    _isFetchingWsBase = false;
  }
  return _cachedWsBase;
}

// Automatically initiate lookup in browser environments
if (typeof window !== 'undefined') {
  try {
    const stored = localStorage.getItem('LOGICRAFT_WS_BASE');
    if (stored) _cachedWsBase = stored.replace(/\/+$/, '');
  } catch {
    // ignore localStorage errors
  }
  fetchSimulationWsBase();
}

/**
 * Resolve the base URL of the Logicraft Studios FastAPI backend at runtime.
 *
 * Layers of override:
 *   1. `window.__LOGICRAFT_API_BASE__` or `window.__VELXIO_API_BASE__` (injected at runtime)
 *   2. `localStorage.getItem('LOGICRAFT_API_BASE')` (user-configurable setting)
 *   3. `import.meta.env.VITE_API_BASE` (build/dev-time environment variable)
 *   4. Relative '/api' on HTTPS production (proxied by Vercel to Azure backend)
 *   5. Azure production backend (http://104.214.172.50/api)
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

  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return '/api';
  }

  return 'http://104.214.172.50/api';
}

/**
 * Construct the correct WebSocket URL for simulation sessions across local dev,
 * custom domains, and Azure production.
 */
export function getSimWebSocketUrl(clientId: string, suffix = ''): string {
  const path = `/simulation/ws/${encodeURIComponent(clientId)}${suffix}`;

  if (typeof window !== 'undefined') {
    const w = window as { __LOGICRAFT_WS_BASE__?: string; __VELXIO_WS_BASE__?: string };
    const customWs = w.__LOGICRAFT_WS_BASE__ || w.__VELXIO_WS_BASE__;
    if (customWs) {
      return `${customWs.replace(/\/+$/, '')}${path}`;
    }

    if (_cachedWsBase) {
      return `${_cachedWsBase}${path}`;
    }

    try {
      const stored = localStorage.getItem('LOGICRAFT_WS_BASE');
      if (stored) {
        _cachedWsBase = stored.replace(/\/+$/, '');
        return `${_cachedWsBase}${path}`;
      }
    } catch {
      // ignore
    }

    if (window.location.protocol === 'https:') {
      // Trigger async refresh for next time
      fetchSimulationWsBase();
    }
  }

  const base = getApiBase();

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
    __LOGICRAFT_WS_BASE__?: string;
    __VELXIO_WS_BASE__?: string;
  }
}

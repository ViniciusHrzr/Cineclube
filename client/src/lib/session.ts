type Pair = { access: string; refresh: string };

const declared =
  (globalThis as { __CINECLUBE_API__?: string }).__CINECLUBE_API__ ??
  (import.meta.env?.VITE_API_BASE as string | undefined) ??
  '';

export const apiBase = declared.replace(/\/$/, '');

export const appMode = apiBase !== '';

const STORE = 'cc.session';

let pair: Pair | null = read();

function read(): Pair | null {
  if (!appMode) return null;
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const held = JSON.parse(raw);
    return held?.access && held?.refresh ? held : null;
  } catch {
    return null;
  }
}

export function setPair(next: Pair | null) {
  pair = next;
  try {
    if (next) localStorage.setItem(STORE, JSON.stringify(next));
    else localStorage.removeItem(STORE);
  } catch {
  }
}

export const hasPair = () => !!pair;

export function authHeaders(): Record<string, string> {
  return pair ? { Authorization: `Bearer ${pair.access}` } : {};
}

export const credentialsMode: RequestCredentials = appMode ? 'include' : 'same-origin';

export const urlFor = (path: string) => (path.startsWith('/') ? apiBase + path : path);

export const mediaUrl = (src?: string | null) =>
  src ? (src.startsWith('/') ? urlFor(src) : src) : undefined;

let running: Promise<boolean> | null = null;

export function refreshSession(): Promise<boolean> {
  if (!pair) return Promise.resolve(false);
  if (!running) {
    running = rotate().finally(() => {
      running = null;
    });
  }
  return running;
}

async function rotate(): Promise<boolean> {
  const atual = pair;
  if (!atual) return false;
  try {
    const res = await fetch(urlFor('/api/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: credentialsMode,
      body: JSON.stringify({ refresh: atual.refresh }),
    });
    if (!res.ok) {
      if (res.status === 401) setPair(null);
      return false;
    }
    const novo = await res.json();
    if (!novo?.access || !novo?.refresh) return false;
    setPair({ access: novo.access, refresh: novo.refresh });
    return true;
  } catch {
    return false;
  }
}

export async function streamUrl(path: string): Promise<string> {
  const url = urlFor(path);
  if (!appMode || !pair) return url;
  try {
    const res = await fetch(urlFor('/api/auth/ticket'), {
      method: 'POST',
      headers: authHeaders(),
      credentials: credentialsMode,
    });
    if (!res.ok) return url;
    const { ticket } = await res.json();
    return ticket ? `${url}${url.includes('?') ? '&' : '?'}ticket=${encodeURIComponent(ticket)}` : url;
  } catch {
    return url;
  }
}

export const refreshToken = () => pair?.refresh ?? null;

export function appIsReady() {
  const bridge = (globalThis as { Capacitor?: { Plugins?: Record<string, { notifyAppReady?: () => void }> } })
    .Capacitor;
  try {
    bridge?.Plugins?.CapacitorUpdater?.notifyAppReady?.();
  } catch {
  }
}

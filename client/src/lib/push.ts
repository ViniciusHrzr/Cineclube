import { api, post } from '@/lib/api';
import { inShell, plugin } from '@/lib/shell';

export type PushState = 'sem' | 'servidor' | 'bloqueado' | 'ligado' | 'desligado';

const supported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

let portas: { key: string | null; fcm: boolean } | null | undefined;

async function serverDoors() {
  if (portas !== undefined) return portas;
  try {
    portas = await api<{ key: string | null; fcm: boolean }>('/api/push/key');
  } catch {
    portas = null;
  }
  return portas;
}

const FCM_STORE = 'cc.push.fcm';
const fcmToken = () => {
  try {
    return localStorage.getItem(FCM_STORE);
  } catch {
    return null;
  }
};

async function nativeToken(): Promise<string | null> {
  const nativo = plugin('PushNotifications');
  if (!nativo) return null;

  return new Promise(resolve => {
    let pronto = false;
    const handles: { remove?: () => void }[] = [];
    const acabou = (token: string | null) => {
      if (pronto) return;
      pronto = true;
      for (const h of handles) h.remove?.();
      resolve(token);
    };

    const espera = window.setTimeout(() => acabou(null), 10_000);
    const guarda = (p: unknown) =>
      void Promise.resolve(p).then(h => handles.push(h as { remove?: () => void }));

    guarda(
      nativo.addListener('registration', (t: unknown) => {
        window.clearTimeout(espera);
        acabou((t as { value?: string })?.value ?? null);
      })
    );
    guarda(
      nativo.addListener('registrationError', () => {
        window.clearTimeout(espera);
        acabou(null);
      })
    );
    void nativo.register();
  });
}

async function current(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function pushState(): Promise<PushState> {
  const portas = await serverDoors();

  if (inShell()) {
    const nativo = plugin('PushNotifications');
    if (!nativo) return 'sem';
    if (!portas?.fcm) return 'servidor';
    const perm = (await nativo.checkPermissions()) as { receive?: string };
    if (perm?.receive === 'denied') return 'bloqueado';
    return fcmToken() ? 'ligado' : 'desligado';
  }

  if (!supported()) return 'sem';
  if (!portas?.key) return 'servidor';
  if (Notification.permission === 'denied') return 'bloqueado';
  return (await current()) ? 'ligado' : 'desligado';
}

function bytesOf(base64url: string) {
  const base = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const texto = atob(base + '='.repeat((4 - (base.length % 4)) % 4));
  return Uint8Array.from(texto, c => c.charCodeAt(0));
}

export async function enablePush(): Promise<PushState> {
  const portas = await serverDoors();

  if (inShell()) {
    const nativo = plugin('PushNotifications');
    if (!nativo) return 'sem';
    if (!portas?.fcm) return 'servidor';

    const perm = (await nativo.requestPermissions()) as { receive?: string };
    if (perm?.receive !== 'granted') return perm?.receive === 'denied' ? 'bloqueado' : 'desligado';

    const token = await nativeToken();
    if (!token) return 'desligado';
    await post('/api/push/subscribe', { kind: 'fcm', token });
    try {
      localStorage.setItem(FCM_STORE, token);
    } catch {
    }
    return 'ligado';
  }

  if (!supported()) return 'sem';
  const key = portas?.key;
  if (!key) return 'servidor';

  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') return permissao === 'denied' ? 'bloqueado' : 'desligado';

  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytesOf(key),
    }));

  await post('/api/push/subscribe', sub.toJSON());
  return 'ligado';
}

export async function disablePush(): Promise<PushState> {
  if (inShell()) {
    const token = fcmToken();
    if (token) {
      await api('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }).catch(() => {
      });
      try {
        localStorage.removeItem(FCM_STORE);
      } catch {
      }
    }
    return 'desligado';
  }

  if (!supported()) return 'sem';
  const sub = await current();
  if (!sub) return 'desligado';

  await api('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {
  });

  await sub.unsubscribe();
  return 'desligado';
}

export const testPush = () =>
  post<{ aparelhos: number; enviados: number; falhas: number }>('/api/push/test', {});

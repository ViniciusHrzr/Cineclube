type Plugin = Record<string, (...args: unknown[]) => Promise<unknown>>;
type Bridge = {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, Plugin>;
};

const bridge = () => (globalThis as { Capacitor?: Bridge }).Capacitor;

export const inShell = () => !!bridge()?.isNativePlatform?.();

export const plugin = (nome: string) => bridge()?.Plugins?.[nome] ?? null;

export function openOutside(url: string) {
  const browser = bridge()?.Plugins?.Browser;
  if (browser?.open) void browser.open({ url });
  else window.open(url, '_blank', 'noopener');
}

export function closeOutside() {
  void bridge()?.Plugins?.Browser?.close?.();
}

export function onDeepLink(handler: (url: string) => void) {
  const app = bridge()?.Plugins?.App;
  if (!app?.addListener) return () => {};

  const pedido = app.addListener('appUrlOpen', (evento: unknown) => {
    const url = (evento as { url?: string })?.url;
    if (url) handler(url);
  }) as unknown as Promise<{ remove: () => void }>;

  return () => {
    void Promise.resolve(pedido).then(h => h?.remove?.());
  };
}

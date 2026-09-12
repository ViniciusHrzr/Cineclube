/* ══════════════════════════════════════════════════════════════════════════
   A CASCA, VISTA DE DENTRO DO CLIENTE.

   O mesmo código roda no site e dentro do aplicativo, e três coisas só existem
   no segundo: abrir o navegador DO SISTEMA, ser acordado por um endereço, e
   fechar aquele navegador quando ele já serviu.

   Falado pelo bridge global e não por importação, como o aviso de que a tela
   subiu: os plugins são dependência da CASCA, e o site não pode carregar o que
   ele nunca usa. Fora de um aplicativo, tudo aqui é falso ou não faz nada.
   ══════════════════════════════════════════════════════════════════════════ */

type Plugin = Record<string, (...args: unknown[]) => Promise<unknown>>;
type Bridge = {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, Plugin>;
};

const bridge = () => (globalThis as { Capacitor?: Bridge }).Capacitor;

/** Este código está rodando dentro de uma casca, e não num navegador. */
export const inShell = () => !!bridge()?.isNativePlatform?.();

/** Um plugin nativo pelo nome, ou nulo fora de uma casca. */
export const plugin = (nome: string) => bridge()?.Plugins?.[nome] ?? null;

/* ── abrir por fora ───────────────────────────────────────────────────────
   O Google recusa OAuth dentro de um WebView — a página dele responde
   `disallowed_useragent` e não há configuração que conserte. Então a entrada
   abre no navegador do sistema, que é uma janela de verdade com barra de
   endereço, e a volta chega por `cineclube://auth`. */
export function openOutside(url: string) {
  const browser = bridge()?.Plugins?.Browser;
  if (browser?.open) void browser.open({ url });
  else window.open(url, '_blank', 'noopener');
}

/** Fecha aquela janela quando ela já entregou o que tinha para entregar. */
export function closeOutside() {
  void bridge()?.Plugins?.Browser?.close?.();
}

/* ── ser acordado por um endereço ─────────────────────────────────────────
   Dois tipos chegam aqui, e o manifesto do Android declara os dois:

   · `cineclube://auth?code=…` — a volta do Google, com um bilhete de um uso.
   · `https://<o domínio do clube>/#…` — um link mandado no grupo, que o Android
     entrega ao app em vez de ao navegador depois de conferir o assetlinks.

   Devolve como desinscrever, que é o que um efeito de React espera. */
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

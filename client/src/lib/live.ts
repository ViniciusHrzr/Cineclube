import { useEffect, useRef } from 'react';

/* ══════════════════════════════════════════════════════════════════════════
   A metade do navegador do clube ao vivo.

   O servidor manda uma palavra — `social`, `reviews`, `watchlist`,
   `reviewers` — e quem está ouvindo vai buscar aquela coleção pela rota que já
   existe. O porquê de ser um aviso e não o dado está em live.js.

   ── uma conexão por aba, não uma por tela ────────────────────────────────
   O sino ouve, o feed ouve e o clube inteiro ouve, e os três são coisas
   diferentes montadas em lugares diferentes da árvore. Se cada `useLive`
   abrisse o seu próprio `EventSource`, uma aba com o sino e o feed na tela
   custaria três conexões — e o teto do servidor é três POR PESSOA, então a
   segunda aba do mesmo membro seria recusada.

   Então o `EventSource` mora no módulo, contado por quem está ouvindo: abre
   quando aparece o primeiro ouvinte e fecha quando sai o último. Um quadro que
   chega é entregue a todos eles.

   ── e por que a pergunta periódica continua existindo ────────────────────
   Porque isto pode cair. O `EventSource` reconecta sozinho, mas nem sempre — um
   429 por abas demais, uma sessão que expirou e um proxy que fecha a conexão
   são recusas em que insistir é um laço que não resolve. Depois de algumas
   seguidas ele desiste, e o sino e o feed voltam a ser o que eram: uma pergunta
   a cada minuto e meio. Ao vivo é o caminho rápido, não o único caminho, e essa
   é a diferença entre uma tela atrasada e uma tela quebrada.
   ══════════════════════════════════════════════════════════════════════════ */

export type LiveKind = 'social' | 'reviews' | 'watchlist' | 'reviewers';

const KINDS: readonly string[] = ['social', 'reviews', 'watchlist', 'reviewers'];

type Frame = { kind: LiveKind | 'hello'; by: string | null; at: number };

/* Junta o que chegou junto. Gravar uma nota emite três avisos no mesmo
   milissegundo — a ficha, a fila e os votos que caíram — e sem esta janela isso
   seriam três buscas em vez de uma rodada de três coleções. Curta o bastante
   para ninguém perceber que houve espera. */
const COALESCE_MS = 200;

/** Recusas seguidas antes de desistir e deixar a pergunta periódica valendo. */
const MAX_FAILURES = 6;

const listeners = new Set<(kind: LiveKind) => void>();
let source: EventSource | null = null;
let failures = 0;

function open() {
  if (source) return;
  const es = new EventSource('/api/live/stream');
  source = es;
  failures = 0;

  es.onopen = () => {
    failures = 0;
  };

  es.onmessage = e => {
    let frame: Frame;
    try {
      frame = JSON.parse(e.data);
    } catch {
      return;
    }
    // O `hello` só serve para o navegador considerar a conexão aberta.
    if (!KINDS.includes(frame.kind)) return;
    listeners.forEach(fn => fn(frame.kind as LiveKind));
  };

  es.onerror = () => {
    failures += 1;
    if (failures < MAX_FAILURES) return;
    es.close();
    if (source === es) source = null;
  };
}

function close() {
  source?.close();
  source = null;
}

/* Voltar para a aba é a hora certa de tentar de novo: a instância é gratuita e
   dorme, um notebook que fechou derruba tudo o que estava aberto, e uma pessoa
   que volta depois de duas horas quer a tela certa agora — não no próximo
   ciclo. Reabre do zero, e a busca que vem junto do primeiro quadro traz o que
   se perdeu enquanto a aba estava fora. */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!listeners.size || source) return;
    failures = 0;
    open();
  });
}

/**
 * Ouve o clube. O handler recebe TUDO o que mudou na janela de coalescência,
 * junto, para poder buscar cada coleção uma vez só.
 *
 * `enabled` existe por causa da sessão: sem ela a rota responde 401 e insistir
 * seria gastar as seis tentativas antes de alguém sequer ter entrado.
 */
export function useLive(
  handler: (kinds: ReadonlySet<LiveKind>) => void,
  enabled = true
) {
  /* O handler é recriado a cada render de quem chama, e uma dependência assim
     reabriria a conexão o tempo todo. A ref é a cópia que nunca está velha. */
  const held = useRef(handler);
  held.current = handler;

  useEffect(() => {
    if (!enabled) return;

    let timer = 0;
    const pending = new Set<LiveKind>();

    const fn = (kind: LiveKind) => {
      pending.add(kind);
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        const batch = new Set(pending);
        pending.clear();
        held.current(batch);
      }, COALESCE_MS);
    };

    listeners.add(fn);
    if (!source) open();

    return () => {
      listeners.delete(fn);
      if (timer) window.clearTimeout(timer);
      if (!listeners.size) close();
    };
  }, [enabled]);
}

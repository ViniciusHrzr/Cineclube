import { useEffect, useRef } from 'react';
import { clubPath, hasClub } from '@/lib/api';

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

export type LiveKind = 'social' | 'reviews' | 'watchlist' | 'reviewers' | 'screening' | 'club';

const KINDS: readonly string[] = [
  'social',
  'reviews',
  'watchlist',
  'reviewers',
  'screening',
  /* A sala em si: alguém entrou, saiu, virou ADM, ou o ADM trocou a foto. */
  'club',
];

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
  /* ── fora de uma sala não há o que ouvir ────────────────────────────────
     O cano é POR CLUBE, e desde que o sino virou o da rede ele é montado também
     no saguão, onde não há sala nenhuma. Sem esta linha, `clubPath` lançava e a
     tela inteira caía no boundary com "clubPath foi chamado cedo demais" —
     tecnicamente verdade, e inútil como diagnóstico: ninguém chamou cedo
     demais, o saguão simplesmente não tem clube.

     Voltar a abrir quando houver sala é trabalho de `resetLive`, logo abaixo. */
  if (!hasClub()) return;

  /* `clubPath` e não uma URL fixa: o cano é de uma sala, e o servidor só entrega
     nele o que é daquela sala. Ver live.js — sem isso, um aviso de clube privado
     chegaria a quem não é dele. */
  const es = new EventSource(clubPath('/live/stream'));
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

/* ── trocar de sala ───────────────────────────────────────────────────────
   A conexão é de uma sala e não pode sobreviver à saída dela: quem sai do
   Cineclube e entra no clube de terror com o cano velho aberto continuaria
   recebendo — e buscando — o que acontece numa sala que já não está na tela.

   ── e reabre, o que fechar sozinho não fazia ──────────────────────────────
   Fechar era o suficiente enquanto todo ouvinte vivia dentro de uma sala: sair
   dela desmontava o ouvinte, entrar noutra montava um novo, e o novo reabria.

   Deixou de ser, e por uma ordem que não se vê no código: os efeitos dos FILHOS
   rodam antes dos do pai. Quem escuta monta e chama `open()` enquanto o clube
   do módulo ainda é o anterior — ou nenhum, vindo do saguão —, e só depois o
   pai chama `setClub` e este `resetLive`. O resultado era o cano fechado até
   alguém trocar de aba e voltar.

   Reabrir aqui é o conserto, e é o lugar certo: esta é a única função que roda
   DEPOIS de o clube novo estar escrito. Sem ouvinte não abre nada, e sem sala
   `open` volta na porta. */
export function resetLive() {
  close();
  failures = 0;
  if (listeners.size) open();
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

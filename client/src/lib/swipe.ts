import { useEffect, useRef } from 'react';

/* ══════════════════════════════════════════════════════════════════════════
   TROCAR DE ABA COM O DEDO.

   No dedo, a barra de seções fica no rodapé e as abas são cinco ou seis: ir da
   primeira à última é apontar cinco vezes. Arrastar é o gesto que todo mundo já
   tenta, e ele não existia.

   ── na JANELA, e não num elemento ───────────────────────────────────────
   A primeira versão escutava o `<main>` por uma ref, e não funcionava em
   aparelho nenhum: o efeito roda uma vez, e se naquele instante o elemento
   ainda não existe — uma tela que está carregando, uma lente que monta depois —
   ele sai pela porta e nunca mais volta. A janela está sempre lá.

   ── o que este arquivo mais faz é NÃO agir ──────────────────────────────
   Uma tela cheia de coisas que também respondem a arrasto horizontal: as réguas
   dos critérios, a barra de tempo da Sessão, uma fileira que rola de lado, o
   vídeo. Roubar o gesto de qualquer uma delas seria trocar de aba no meio de
   uma nota sendo dada — e quem perdeu a nota não vai saber por quê.

   Então a recusa é por origem e por forma:

   · **por origem** — onde o dedo encostou. Controle deslizante, vídeo, algo que
     rola de lado DE VERDADE, ou qualquer coisa dentro de uma folha aberta.
   · **por forma** — um arrasto de aba é largo, é mais horizontal que vertical,
     e é rápido. Rolar a página inclina; escolher um ponto numa régua é lento e
     curto.

   Só no dedo, e por meio do ponteiro e não do tamanho da tela: um monitor com
   tela sensível continua com o mouse, e um telefone deitado não vira
   computador.
   ══════════════════════════════════════════════════════════════════════════ */

/** O quanto o dedo precisa andar para isto ser um gesto, e não um toque torto. */
const DISTANCIA = 56;
/** Quanto mais horizontal que vertical. Abaixo disso é rolagem inclinada. */
const INCLINACAO = 1.5;
/** Um arrasto de aba é um gesto, não uma leitura: passado isto, não é mais. */
const TEMPO_MS = 800;

/* Uma fileira só "rola de lado" quando há lado para rolar. O número não é
   frescura: a coluna do app tem `overflow-y` no dedo, e uma caixa com um eixo
   rolável passa a calcular o OUTRO como rolável também — então quase todo
   ancestral do toque diz ter uma sobra horizontal de um ou dois pixels, de
   arredondamento. Com uma tolerância pequena, o gesto era recusado sempre. */
const SOBRA = 24;

/* O que o dedo pode encostar sem que isto seja um gesto de aba. `data-noswipe`
   existe para o que não cabe numa regra: quem tiver um arrasto próprio marca. */
const DE_OUTRO_DONO = 'input[type="range"], video, [data-noswipe], dialog[open]';

function daquiNao(alvo: EventTarget | null) {
  const el = alvo instanceof Element ? alvo : null;
  if (!el) return true;
  if (el.closest(DE_OUTRO_DONO)) return true;

  for (let no: Element | null = el; no; no = no.parentElement) {
    if (no.scrollWidth - no.clientWidth < SOBRA) continue;
    const estilo = getComputedStyle(no).overflowX;
    if (estilo === 'auto' || estilo === 'scroll') return true;
  }
  return false;
}

/**
 * Arrastar para a esquerda chama `onNext`; para a direita, `onPrev` — a direção
 * do papel, e não a do dedo: puxar a página para a esquerda traz o que está à
 * direita.
 */
export function useSwipeTabs(onPrev: () => void, onNext: () => void, enabled = true) {
  /* Os dois passam por uma ref porque o efeito não pode remontar a cada render
     de quem chama — remontar no meio de um arrasto perderia o toque. */
  const held = useRef({ onPrev, onNext, enabled });
  held.current = { onPrev, onNext, enabled };

  useEffect(() => {
    if (!window.matchMedia('(hover: none), (pointer: coarse)').matches) return;

    let x = 0;
    let y = 0;
    let quando = 0;
    let vale = false;

    const começou = (e: TouchEvent) => {
      /* Dois dedos é pinça, e pinça é da página. */
      vale = held.current.enabled && e.touches.length === 1 && !daquiNao(e.target);
      if (!vale) return;
      x = e.touches[0].clientX;
      y = e.touches[0].clientY;
      quando = Date.now();
    };

    const acabou = (e: TouchEvent) => {
      if (!vale) return;
      vale = false;
      const toque = e.changedTouches[0];
      if (!toque) return;

      const dx = toque.clientX - x;
      const dy = toque.clientY - y;
      if (Date.now() - quando > TEMPO_MS) return;
      if (Math.abs(dx) < DISTANCIA) return;
      if (Math.abs(dx) < Math.abs(dy) * INCLINACAO) return;

      if (dx < 0) held.current.onNext();
      else held.current.onPrev();
    };

    const cancelou = () => {
      vale = false;
    };

    /* Passivos: isto não cancela rolagem nenhuma — ele decide DEPOIS que o dedo
       saiu, e um ouvinte que promete não interferir é um ouvinte que o
       navegador não espera antes de rolar. */
    window.addEventListener('touchstart', começou, { passive: true });
    window.addEventListener('touchend', acabou, { passive: true });
    window.addEventListener('touchcancel', cancelou, { passive: true });

    return () => {
      window.removeEventListener('touchstart', começou);
      window.removeEventListener('touchend', acabou);
      window.removeEventListener('touchcancel', cancelou);
    };
  }, []);
}

/** A aba vizinha na tabela da lente, pulando as que não aparecem na barra. */
export function neighbour<T extends { id: string; hidden?: boolean }>(
  tabs: readonly T[],
  atual: string,
  passo: 1 | -1
): string | null {
  const visiveis = tabs.filter(t => !t.hidden);
  const onde = visiveis.findIndex(t => t.id === atual);
  /* Numa tela que não está na barra — uma ficha, uma série aberta — o gesto não
     tem vizinho para onde ir. Ele não faz nada, em vez de adivinhar. */
  if (onde < 0) return null;
  const proximo = visiveis[onde + passo];
  return proximo ? proximo.id : null;
}

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Maximize2,
  Play,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Fault, IconKey, Key, Poster, Skeleton, Strip, TrailerKey } from '@/components/bits';
import { WatchOn } from '@/components/film';
import { Breakdown } from '@/components/take';
import { Conversation, TakeVotes } from '@/components/social';
import { PersonName, PersonReel } from '@/components/person';
import {
  api,
  fmt,
  reels,
  runtimeOf,
  type EpisodeTake,
  type Movie,
  type ReelItem,
  type Review,
  type ShowDetail,
} from '@/lib/api';
import { cn, norm, plural, useFinePointer } from '@/lib/utils';
import { BAR_ORDER, useClub, type TabId } from '@/App';

/* ══════════════════════════════════════════════════════════════════════════
   O REEL — A PORTA DA SALA.

   Era uma lista de acontecimentos em ordem de tempo, e ela respondia bem a uma
   pergunta que ninguém faz ao abrir o app: "o que houve por aqui?". A pergunta
   de verdade é "o que a gente vê hoje?", e a resposta dela não é texto — é o
   trailer tocando.

   ── a forma é a do protótipo do usuário ─────────────────────────────────
   Uma COLUNA 9:16, e tudo mora dentro dela: o filtro de gênero é uma chave no
   alto que abre um painel por cima, a legenda deita sobre o degradê no pé, e os
   controles são um trilho vertical na borda direita que não rola com o
   conteúdo. Nada disso é enfeite — é o que faz o quadro inteiro ser o vídeo. A
   primeira versão desta tela empilhava vídeo, legenda e controles em coluna, e
   no telefone os controles caíam para fora da moldura.

   ── o que o clube fez continua na frente ────────────────────────────────
   O reel abre pelo que o clube avaliou, e não pelo que o TMDB acha popular: o
   filme que alguém acabou de avaliar é o primeiro que rola, com a chave da ficha
   acesa e uma dica dizendo que já tem nota. É o princípio *"o grupo é visível"*
   dito pelo material do produto em vez de por uma linha de texto.

   ── e o que sumiu ────────────────────────────────────────────────────────
   A lista de acontecimentos. As avaliações não se perderam: elas moram dentro
   da ficha da obra, onde se curte e se responde cada uma.

   ── uma tela, dois universos ─────────────────────────────────────────────
   Filme e série rolam no mesmo componente. O que muda entre eles chega por
   propriedade; ver `MovieReels` e `SeriesReels` no fim do arquivo.
   ══════════════════════════════════════════════════════════════════════════ */

/** Uma obra que o clube já avaliou, do jeito que o reel precisa saber disso. */
export type RatedTitle = {
  id: number;
  /** A média do clube. Null quando existe ficha mas nenhuma delas tem nota. */
  score: number | null;
  /** Quantas fichas. É o que separa "eu achei" de "a gente achou". */
  takes: number;
  /** Se uma delas é sua: a dica fala na segunda pessoa quando é. */
  mine: boolean;
  /** Quando foi a mais recente. Só ordena — nunca é desenhado. */
  at: string;
};

/* A que distância do fim a próxima página é pedida. Quatro quadros é cerca de
   um segundo de rolagem contínua: tempo de a resposta chegar antes de alguém
   encostar no vazio. */
const AHEAD = 4;

/* Quantos quadros em volta do ativo existem de verdade. Três de cada lado cobre
   qualquer rolagem que o dedo consiga fazer entre dois quadros de tela, e é o
   que separa quarenta imagens carregadas de sete. */
const WINDOW = 3;

/* A largura da coluna contra a altura dela. 9:16 é o formato do reel e é
   estreito demais num monitor: numa coluna de 850px de altura sobra um trailer
   de 269px, que é um filme visto de longe. Sete décimos guarda o gesto vertical
   e devolve a imagem ao tamanho de assistir. */
const COLUMN = 0.7;

/* Quanto o trilho fica à vista depois do último gesto. Generoso o bastante para
   a dica da ficha ser lida inteira na chegada, e curto o bastante para o filme
   ficar limpo enquanto ninguém está comandando nada. */
const HUD_MS = 3600;

/* Quantas obras do clube alimentam a sugestão do servidor. O teto de verdade é
   dele; aqui é só não mandar o acervo inteiro por uma consulta. */
const SEEDS = 4;

/* A folga entre uma obra avaliada e a próxima, no meio da descoberta. Mínimo e
   quantos passos acima dele — dois a quatro. Elas vinham todas emendadas na
   frente, o que fazia o reel abrir como um resumo do acervo em vez de como uma
   sala projetando. */
const GAP_MIN = 2;
const GAP_SPREAD = 3;

/* Uma folga que não se repete e não muda. Sorteio de verdade reembaralharia a
   ordem a cada render — a obra debaixo do dedo trocaria sozinha —, então o
   "acaso" sai do próprio id: sempre o mesmo para a mesma obra, e sem padrão
   nenhum entre obras diferentes. */
function gapOf(id: number) {
  return GAP_MIN + ((Math.imul(id, 2654435761) >>> 0) % GAP_SPREAD);
}

export function ReelsScreen({
  kind,
  rated,
  openLabel,
  onOpen,
  queued,
  onQueue,
  queueLabel,
  renderTakes,
  onExit,
}: {
  kind: ReelItem['kind'];
  rated: RatedTitle[];
  /** O que a chave principal da ficha faz: avaliar um filme, abrir uma série. */
  openLabel: string;
  onOpen: (item: ReelItem) => void;
  queued: (id: number) => boolean;
  onQueue: (item: ReelItem) => void;
  queueLabel: [off: string, on: string];
  /** As fichas do clube sobre esta obra, desenhadas pelo universo que as tem. */
  renderTakes: (id: number) => React.ReactNode;
  /* Para onde o gesto de sair leva, no dedo: a seção vizinha na barra. −1 é a
     de trás, +1 a da frente. Ver `useSideSwipe`. */
  onExit: (dir: -1 | 1) => void;
}) {
  const [genre, setGenre] = useState<string | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const [pinned, setPinned] = useState<ReelItem[]>([]);
  const [found, setFound] = useState<ReelItem[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [settled, setSettled] = useState(0);
  const [muted, setMuted] = useState(true);
  const [filtering, setFiltering] = useState(false);
  const [full, setFull] = useState(false);
  const [ficha, setFicha] = useState<ReelItem | null>(null);
  const [toast, setToast] = useState('');
  /* O trilho começa à vista e se recolhe sozinho — ver `showHud`. */
  const [hud, setHud] = useState(true);

  const stage = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const alarm = useRef<number>();
  const hudTimer = useRef<number>();
  /* O quadro de agora, para `jump` mirar sem ser refeito a cada rolagem. */
  const atRef = useRef(0);

  /* ── no dedo, o reel é a tela ─────────────────────────────────────────
     Sem marquise em cima e sem barra de seções embaixo. Não é gosto: numa coluna
     9:16 dentro de uma casca de 130px, o vídeo termina menor que a legenda que
     fala dele — foi o que aconteceu quando esta tela nasceu encaixada. Um reel
     ou é a tela toda ou é um cartão sobre um trailer.

     No computador a casca fica: lá sobra largura, a coluna cabe inteira embaixo
     dela, e esconder a navegação seria tirar o que ninguém pediu. */
  const immersive = !useFinePointer();

  /* A lista de ids é a identidade da fixação, e não o array: `rated` é derivado
     a cada render do acervo em memória, então comparar por referência pediria a
     mesma página de novo a cada tecla digitada em qualquer lugar do app. */
  const pinIds = useMemo(
    () =>
      rated
        .slice()
        .sort((a, b) => b.at.localeCompare(a.at))
        .map(r => r.id)
        .join(','),
    [rated]
  );

  const scoreOf = useMemo(() => new Map(rated.map(r => [r.id, r])), [rated]);

  /* O que o clube mais gostou, que é do que a sugestão é feita. Por nota e não
     por data: o reel já abre pelo que foi avaliado por último, e sugerir a
     partir do mais RECENTE faria uma noite ruim contaminar a semana inteira. */
  const seeds = useMemo(
    () =>
      rated
        .filter(r => r.score != null)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, SEEDS)
        .map(r => r.id)
        .join(','),
    [rated]
  );

  /* A taxonomia vem do servidor e não do clube: são nove nomes de cada lado e
     não são a mesma lista — o TMDB não tem gênero de terror em série, e um chip
     que ele não sabe descobrir mostraria tudo dizendo que filtrou. */
  useEffect(() => {
    let alive = true;
    reels
      .genres(kind)
      .then(got => alive && setGenres(got.genres))
      .catch(() => alive && setGenres([]));
    return () => {
      alive = false;
    };
  }, [kind]);

  useEffect(() => {
    if (!pinIds) {
      setPinned([]);
      return;
    }
    let alive = true;
    reels
      .pinned(kind, pinIds.split(',').map(Number))
      .then(got => alive && setPinned(got.results))
      /* Uma fixação que não veio não é um erro na tela: o reel continua inteiro
         com o que o TMDB está passando, e é só a frente dele que muda. */
      .catch(() => alive && setPinned([]));
    return () => {
      alive = false;
    };
  }, [kind, pinIds]);

  const load = useCallback(
    async (want: number) => {
      setLoading(true);
      try {
        const got = await reels.page(kind, genre, want, seeds ? seeds.split(',').map(Number) : []);
        /* Uma página de sugestão não sabe quantas são — ela é montada de quatro
           listas —, então o servidor devolve sempre "tem mais uma". Quem sabe
           que acabou é esta linha: página vazia é o fim, e sem ela o reel
           pediria a próxima para sempre. */
        setPages(got.results.length ? got.totalPages : want);
        setFound(prev => (want === 1 ? got.results : prev.concat(got.results)));
        setPage(want);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [kind, genre, seeds]
  );

  useEffect(() => {
    setFound([]);
    setActive(0);
    setSettled(0);
    atRef.current = 0;
    track.current?.scrollTo({ top: 0 });
    void load(1);
  }, [load]);

  /* ── o que o clube avaliou entra ESPALHADO ─────────────────────────────
     A primeira continua sendo uma delas: a obra avaliada por último abre o reel,
     que é o que faz o clube ser a primeira coisa que se vê. As outras entram no
     meio da descoberta, com folgas de dois a quatro quadros que não se repetem.

     Emendadas, como estavam, o reel abria com uma sequência do acervo e só
     depois começava a mostrar filme — o clube virava uma introdução a ser
     passada em vez de uma presença ao longo da rolagem.

     Sem repetir: a mesma obra pode voltar como descoberta, e vê-la duas vezes
     num reel é o produto perdendo o fio. Com um gênero escolhido, uma avaliada
     de outro gênero sairia do filtro que a pessoa acabou de pedir. */
  const items = useMemo(() => {
    const mine = genre ? pinned.filter(p => p.genres.includes(genre)) : pinned;
    const seen = new Set(mine.map(p => p.id));
    const rest = found.filter(f => !seen.has(f.id));
    if (!mine.length) return rest;

    const out: ReelItem[] = [];
    let at = 0;
    mine.forEach((p, i) => {
      out.push(p);
      /* A última leva todo o resto atrás de si: uma folga aqui deixaria a
         descoberta terminando antes do fim da página que já chegou. */
      const gap = i === mine.length - 1 ? rest.length - at : gapOf(p.id);
      out.push(...rest.slice(at, at + gap));
      at += gap;
    });
    return out;
  }, [pinned, found, genre]);

  const here = items[active] ?? null;

  /* ── qual quadro está na tela ──────────────────────────────────────────
     Observado e não calculado da rolagem: o mesmo sinal serve para o dedo, para
     a roda, para as setas e para o snap terminando sozinho, e nenhum deles
     precisa avisar ninguém. */
  useEffect(() => {
    const box = track.current;
    if (!box) return;
    const spy = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const at = Number((e.target as HTMLElement).dataset.frame);
          atRef.current = at;
          setActive(at);
        }
      },
      { root: box, threshold: 0.6 }
    );
    for (const f of box.querySelectorAll<HTMLElement>('[data-frame]')) spy.observe(f);
    return () => spy.disconnect();
  }, [items.length]);

  /* ── o player espera o dedo parar ──────────────────────────────────────
     Montar o embed do YouTube é caro, e passar cinco trailers de uma vez montava
     e destruía cinco players em meio segundo: o telefone gastava tudo o que
     tinha carregando o que ninguém ia ver. O quadro ativo muda na hora — a
     legenda, a luz da parede, o trilho —, e só o VÍDEO espera um instante de
     quietude para nascer. */
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(active), 320);
    return () => window.clearTimeout(t);
  }, [active]);

  useEffect(() => {
    if (loading || page >= pages) return;
    if (active >= items.length - AHEAD) void load(page + 1);
  }, [active, items.length, loading, page, pages, load]);

  /* Mira o quadro de destino pelo topo dele, e não um deslocamento relativo:
     `scrollBy` suave dentro de um rolador com encaixe obrigatório é disputado
     pelo próprio encaixe, que recalcula o alvo no meio da animação e devolve a
     rolagem para onde ela estava — a chave de passar não fazia nada, e só o
     dedo andava. Um destino absoluto não tem o que ser recalculado. */
  const jump = useCallback((delta: number) => {
    const box = track.current;
    if (!box) return;
    const frames = box.querySelectorAll<HTMLElement>('[data-frame]');
    const target = frames[Math.min(Math.max(atRef.current + delta, 0), frames.length - 1)];
    if (target) box.scrollTo({ top: target.offsetTop, behavior: 'smooth' });
  }, []);

  /* ── o trilho é um HUD, e um HUD se recolhe ────────────────────────────
     Cinco teclas paradas em cima do filme são cinco pedaços de imagem que
     ninguém vê, e o reel existe para mostrar a imagem. Elas aparecem quando a
     pessoa demonstra querer comandar alguma coisa — o ponteiro se move no
     computador, o dedo toca no telefone — e somem sozinhas depois disso, como
     em qualquer player.

     Começa à vista: um controle que só existe depois de um gesto que ninguém
     ensinou é um controle que não existe. A primeira aparição dura o bastante
     para a dica da ficha ser lida inteira antes de as duas saírem juntas. */
  const showHud = useCallback(() => {
    window.clearTimeout(hudTimer.current);
    setHud(true);
    hudTimer.current = window.setTimeout(() => setHud(false), HUD_MS);
  }, []);

  /* E a cada quadro novo, uma vez. É o que faz a dica de "já foi avaliado"
     existir: ela mora pendurada na chave da ficha, e uma dica que só aparece
     depois de um gesto não é uma dica. As duas entram juntas e saem juntas. */
  useEffect(() => {
    showHud();
    return () => window.clearTimeout(hudTimer.current);
  }, [active, showHud]);

  /* No dedo o toque alterna, que é o que um player faz: um segundo toque sobre
     controles à vista é a pessoa pedindo a imagem de volta. */
  const toggleHud = useCallback(() => {
    if (!hud) return showHud();
    window.clearTimeout(hudTimer.current);
    setHud(false);
  }, [hud, showHud]);

  const flash = useCallback((msg: string) => {
    window.clearTimeout(alarm.current);
    setToast(msg);
    alarm.current = window.setTimeout(() => setToast(''), 2400);
  }, []);
  useEffect(() => () => window.clearTimeout(alarm.current), []);

  /* Uma camada por vez escuta o teclado, de cima para baixo: com a ficha aberta
     as setas pertencem ao texto que está sendo lido, e o Esc fecha o que estiver
     por cima antes de qualquer outra coisa. */
  useEffect(() => {
    if (ficha) return;
    const key = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') setFiltering(false);
        return;
      }
      if (e.key === 'Escape') {
        if (filtering) return setFiltering(false);
        if (full) return setFull(false);
        return;
      }
      if (filtering) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        jump(e.key === 'ArrowDown' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [jump, ficha, filtering, full]);

  const height = useReelHeight(stage);
  /* A coluna do protótipo: 9:16 quando há altura para isso, e a largura inteira
     quando não há. Na tela cheia não há o que calcular — ela É a tela.

     Antes da primeira medida ela é só larga: uma largura derivada de altura zero
     é uma coluna de zero pixel, ou seja um quadro em branco no primeiro pintar. */
  const column: React.CSSProperties =
    !immersive && height
      ? { height: '100%', width: `min(100%, ${Math.round(height * COLUMN)}px)` }
      : { height: '100%', width: '100%' };

  const save = (it: ReelItem) => {
    const on = !queued(it.id);
    onQueue(it);
    flash(on ? `“${it.title}” ${queueLabel[1].toLowerCase()}` : `Tirado: ${it.title}`);
  };

  /* Só na tela cheia, e não com o painel de gênero aberto: lá o deslize
     horizontal pertence a quem está rolando a lista de gêneros. */
  const sideways = useSideSwipe(immersive && !filtering ? onExit : undefined);

  return (
    /* Presa à janela e por cima de tudo, inclusive da marquise e da barra de
       seções — que continuam montadas atrás e voltam inteiras quando esta tela
       sai. Esconder é o que uma camada opaca faz; desmontar a navegação do app
       para servir uma aba seria a aba mandando na casca. */
    <section
      className={cn(immersive ? 'fixed inset-0 z-40 bg-house-deep' : 'flex flex-col')}
      onTouchStart={sideways.onTouchStart}
      onTouchEnd={sideways.onTouchEnd}
    >
      {/* Os recuos do `<main>` são devolvidos: a coluna começa colada na
          marquise e termina colada no fim da janela, que é a altura inteira que
          sobrou. Um respiro em volta de uma tela de projeção é tela que ela
          deixou de ter. */}
      <div
        ref={stage}
        style={!immersive && height ? { height } : undefined}
        className={cn(
          immersive
            ? 'h-full w-full'
            : 'grid place-items-center -mt-7 -mb-20 sm:-mt-10',
          !immersive && !height && 'h-[70dvh]'
        )}
      >
        <div
          style={column}
          /* O ponteiro que se move é a intenção de comandar alguma coisa; o que
             sai da moldura desistiu dela. Só o mouse: um `pointermove` de toque
             chega junto com a rolagem, e o trilho piscaria a cada arrasto. */
          onPointerMove={e => {
            if (e.pointerType === 'mouse') showHud();
          }}
          onPointerLeave={e => {
            if (e.pointerType !== 'mouse') return;
            window.clearTimeout(hudTimer.current);
            setHud(false);
          }}
          className={cn(
            'relative overflow-hidden bg-house',
            !immersive && 'rounded-plate ring-1 ring-white/[0.07]'
          )}
        >
          <div
            ref={track}
            /* Focável porque é uma caixa de rolagem: sem isto, quem navega por
               teclado não tem onde pousar para folhear. */
            tabIndex={0}
            role="region"
            aria-label="Reel de trailers"
            /* No próprio rolador e não na moldura: assim um toque nas teclas do
               trilho comanda a tecla em vez de recolher o trilho debaixo do
               dedo. */
            onClick={toggleHud}
            className={cn(
              'absolute inset-0 snap-y snap-mandatory overflow-y-auto overscroll-contain',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-dye-brass/70',
              '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
            )}
          >
            {items.length ? (
              items.map((it, i) => (
                <Frame
                  key={`${it.kind}-${it.id}-${i}`}
                  index={i}
                  item={it}
                  rated={scoreOf.get(it.id) ?? null}
                  /* Uma moldura por vez: montar as vizinhas seriam três players
                     do YouTube no ar, e o que está fora da tela tocando som. O
                     que abre por cima também desmonta, senão o trailer continua
                     atrás. */
                  live={i === settled && i === active && !ficha && !full && !filtering}
                  near={Math.abs(i - active) <= 1}
                  within={Math.abs(i - active) <= WINDOW}
                  muted={muted}
                />
              ))
            ) : (
              <div className="grid h-full place-items-center px-6 text-center">
                {loading ? (
                  <Skeleton className="aspect-video w-full" />
                ) : error ? (
                  <Fault detail={error}>Não foi possível carregar os trailers.</Fault>
                ) : (
                  <p className="text-[13px] leading-relaxed text-ink-dim">
                    Nenhum trailer neste gênero. Escolha outro na chave acima — ou volte para tudo.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── a barra de cima ──────────────────────────────────────────
              Sobre um degradê que garante contraste contra qualquer quadro que
              passe por baixo. `pointer-events-none` na faixa e `auto` em cada
              chave: a faixa é só a sombra. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[4] flex items-center gap-2 bg-gradient-to-b from-house-deep/90 via-house-deep/40 to-transparent p-3">
            {immersive ? (
              /* O gesto de sair é deslizar para o lado, e um gesto não deixa
                 marca na tela. Esta chave é a marca: uma saída que só quem já
                 sabe encontra não é uma saída. */
              <button
                type="button"
                onClick={() => onExit(-1)}
                title="Sair do reel"
                aria-label="Sair do reel"
                className="pointer-events-auto grid h-10 w-10 flex-none place-items-center rounded-cell bg-house-seat/85 text-ink-dim ring-1 ring-house-rail transition-colors hover:text-beam"
              >
                <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setFiltering(true)}
              aria-expanded={filtering}
              aria-label={`Filtrar por gênero — ${genre ?? 'tudo'}`}
              className="pointer-events-auto inline-flex items-center gap-2 rounded-cell bg-house-seat/85 px-3 py-2 font-display text-[12px] uppercase leading-none tracking-[0.12em] text-ink-dim ring-1 ring-house-rail transition-colors hover:text-beam hover:ring-white/25 coarse:min-h-[40px]"
            >
              <span>Gênero</span>
              <span className="text-dye-brass">{genre ?? 'Tudo'}</span>
              <ChevronDown className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2} aria-hidden />
            </button>

            {items.length ? (
              <span className="q ml-auto flex-none pr-1 text-[11px] text-ink-dim">
                {active + 1} / {items.length}
              </span>
            ) : null}
          </div>

          {/* ── o trilho ─────────────────────────────────────────────────
              Fora do rolador, de propósito: os controles são da SALA e não do
              quadro, então eles ficam parados enquanto os trailers passam por
              trás. */}
          {here ? (
            <div
              className={cn(
                'absolute bottom-14 right-3 z-[3] flex flex-col items-end gap-3',
                'transition-opacity duration-200',
                hud ? 'opacity-100' : 'pointer-events-none opacity-0'
              )}
            >
              <RailKey
                label={queued(here.id) ? queueLabel[1] : queueLabel[0]}
                active={queued(here.id)}
                onClick={() => save(here)}
              >
                <Bookmark
                  className="h-[18px] w-[18px]"
                  fill={queued(here.id) ? 'currentColor' : 'none'}
                  strokeWidth={1.7}
                />
              </RailKey>

              <RailKey label="Maximizar o trailer" onClick={() => setFull(true)}>
                <Maximize2 className="h-[17px] w-[17px]" strokeWidth={1.8} />
              </RailKey>

              {/* A chave da ficha, acesa quando há ficha do clube atrás dela, com
                  a dica pendurada à esquerda — para dentro da coluna, que é o
                  único lado onde ela cabe. */}
              <div className="relative">
                {scoreOf.has(here.id) ? (
                  <RatedTip key={here.id} rated={scoreOf.get(here.id)!} />
                ) : null}
                <RailKey
                  label={`Abrir a ficha de ${here.title}`}
                  lit={scoreOf.has(here.id)}
                  onClick={() => setFicha(here)}
                >
                  <span className="font-display text-[10.5px] uppercase leading-none tracking-[0.1em]">
                    Ficha
                  </span>
                </RailKey>
              </div>

              <RailKey
                label={muted ? 'Ligar o som' : 'Tirar o som'}
                active={!muted}
                onClick={() => setMuted(m => !m)}
              >
                {muted ? (
                  <VolumeX className="h-[17px] w-[17px]" strokeWidth={1.8} />
                ) : (
                  <Volume2 className="h-[17px] w-[17px]" strokeWidth={1.8} />
                )}
              </RailKey>

              <RailKey label="Passar para o próximo" onClick={() => jump(1)}>
                <ChevronDown className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </RailKey>
            </div>
          ) : null}

          {filtering ? (
            <GenrePanel
              genres={genres}
              value={genre}
              onPick={g => {
                setGenre(g);
                setFiltering(false);
              }}
              onClose={() => setFiltering(false)}
            />
          ) : null}

          {toast ? (
            <div className="pointer-events-none absolute inset-x-3 bottom-4 z-[8] flex justify-center">
              <span className="plate flex items-center gap-2.5 px-4 py-2.5 animate-frame-in">
                <span className="h-1.5 w-1.5 flex-none rounded-full bg-dye-green-lit" />
                <span className="text-[12.5px] leading-none text-ink">{toast}</span>
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {full && here ? (
        <FullTrailer
          item={here}
          muted={muted}
          rated={scoreOf.get(here.id) ?? null}
          queued={queued(here.id)}
          queueLabel={queueLabel}
          onQueue={() => save(here)}
          onSound={() => setMuted(m => !m)}
          onPrev={() => jump(-1)}
          onNext={() => jump(1)}
          onClose={() => setFull(false)}
        />
      ) : null}

      {ficha ? (
        <Ficha
          item={ficha}
          rated={scoreOf.get(ficha.id) ?? null}
          openLabel={openLabel}
          onOpen={() => {
            const it = ficha;
            setFicha(null);
            onOpen(it);
          }}
          queued={queued(ficha.id)}
          queueLabel={queueLabel}
          onQueue={() => save(ficha)}
          onClose={() => setFicha(null)}
          renderTakes={renderTakes}
        />
      ) : null}
    </section>
  );
}

/* ── a altura que sobra ───────────────────────────────────────────────────
   O reel é o único rolador da sua aba, e para ser isso ele precisa terminar
   exatamente onde a janela termina: um pixel a mais e a página inteira ganha
   uma segunda barra de rolagem, com dois roladores disputando cada gesto do
   dedo — o defeito que a folha de projeção já teve e que está escrito lá.

   Medido e não escrito em `calc`, porque o que está acima dele varia com a
   largura da janela e um número fixo estaria errado em metade dos tamanhos. */
function useReelHeight(ref: React.RefObject<HTMLElement>) {
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      /* ── as duas réguas da sala ──────────────────────────────────────
         A interface inteira roda sob `zoom` (ver `--ui-zoom` em index.css), e
         `zoom` divide o mundo em duas unidades: `getBoundingClientRect` e
         `innerHeight` respondem em pixels da JANELA, e a altura que este
         elemento recebe é lida em pixels DELE. A conta corre toda na primeira
         régua e converte uma vez, no fim. */
      const zoom = Number(getComputedStyle(document.documentElement).zoom) || 1;
      /* Até o fim da janela, sem descontar nada: o recuo do `<main>` é anulado
         por margem negativa na própria moldura, então ele não está mais aqui
         para ser descontado. Isto só vale para o ponteiro fino — no dedo a tela
         é a camada presa à janela, que não mede nada. */
      setHeight(Math.max(380, (window.innerHeight - el.getBoundingClientRect().top) / zoom));
    };
    measure();
    const eye = new ResizeObserver(measure);
    eye.observe(document.documentElement);
    window.addEventListener('resize', measure);
    return () => {
      eye.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref]);

  return height;
}

/* ── sair de lado ─────────────────────────────────────────────────────────
   O reel toma a tela inteira no dedo, então o gesto de sair tem de ser um que
   ele mesmo não usa: a rolagem é vertical, e o que sobra é o horizontal.

   Deslizar para a DIREITA volta para a seção de trás e para a esquerda avança
   para a da frente — a mesma ordem da barra que estava ali antes de o reel
   cobri-la. É o que faz o gesto ter para onde ir, em vez de só "fechar" e
   deixar a pessoa num lugar que ela não escolheu.

   O limiar é generoso e é comparado com o eixo vertical: ninguém rola trailers
   em linha reta, e um limiar apertado tiraria a pessoa da tela no meio de um
   gesto que era para passar de filme. */
const SIDE = 72;

function useSideSwipe(onExit?: (dir: -1 | 1) => void) {
  const from = useRef<{ x: number; y: number } | null>(null);

  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      from.current = t ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const start = from.current;
      from.current = null;
      const t = e.changedTouches[0];
      if (!start || !t || !onExit) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dx) < SIDE || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      onExit(dx > 0 ? -1 : 1);
    },
  };
}

/** Se a pessoa pediu para o mundo parar de se mexer. */
function useGentle() {
  const [gentle, setGentle] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setGentle(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return gentle;
}

/* ── o endereço do player ─────────────────────────────────────────────────
   `bare` é o reel: ali o vídeo não é um player, é a imagem projetada. Barra de
   controle, teclado, legendas, anotações e tela cheia do YouTube saem todos —
   quem comanda é o trilho do clube, e dois conjuntos de controle sobre a mesma
   imagem é a pessoa tendo de escolher em qual acreditar.

   O que os parâmetros não tiram, o `pointer-events: none` da moldura tira: a
   faixa de título e a parede de "mais vídeos" do fim aparecem por PASSAGEM DE
   PONTEIRO, e um vídeo que não recebe ponteiro nunca é passado por cima.

   Na tela cheia o player volta inteiro: lá a pessoa foi assistir, e arrastar
   pelo minuto 2:10 é exatamente o que ela quer poder fazer. */
const embedOf = (key: string, muted: boolean, loop: boolean, bare: boolean) =>
  `https://www.youtube-nocookie.com/embed/${key}?autoplay=1&mute=${muted ? 1 : 0}` +
  `&rel=0&modestbranding=1&playsinline=1` +
  (bare ? '&controls=0&disablekb=1&fs=0&iv_load_policy=3&cc_load_policy=0&enablejsapi=1' : '') +
  (loop ? `&loop=1&playlist=${key}` : '');

/* ── esperar o projetor pegar ─────────────────────────────────────────────
   Entre carregar a moldura e o filme começar a correr, o YouTube desenha a
   própria abertura: título, canal, botões grandes e a palavra "Mais vídeos".
   Nenhum parâmetro tira isso, porque não é a barra de controle — é a tela de
   espera do player, e ela só existe enquanto ele está esperando.

   Então o quadro parado do filme fica por cima até o player DIZER que está
   rodando. Ele diz: com `enablejsapi`, a moldura publica o estado dela por
   `postMessage` depois de a gente se apresentar. Estado 1 é "tocando".

   Um relógio atrás disso, porque uma promessa de rede sem prazo é uma tela
   parada para sempre: passados quatro segundos o quadro sai de qualquer jeito.
   Ver um segundo da abertura do YouTube é melhor do que ver um cartaz parado
   achando que o app travou. */
const ROLLING = 1;
const GIVE_UP_MS = 4000;
const HELLO_MS = 260;

function useRolling(on: string | null, frame: React.RefObject<HTMLIFrameElement>) {
  const [rolling, setRolling] = useState(false);

  useEffect(() => {
    setRolling(false);
    if (!on) return;

    const hello = () =>
      frame.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
        '*'
      );

    const heard = (e: MessageEvent) => {
      if (!/(^|\.)youtube(-nocookie)?\.com$/.test(hostOf(e.origin))) return;
      let said: unknown;
      try {
        said = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      /* O player fala de duas formas conforme a versão: `onStateChange` com o
         estado solto, e `infoDelivery` com ele dentro de `info`. */
      const box = said as { event?: string; info?: number | { playerState?: number } };
      const state =
        typeof box?.info === 'number' ? box.info : box?.info?.playerState;
      if (state === ROLLING) setRolling(true);
    };

    window.addEventListener('message', heard);
    const ping = window.setInterval(hello, HELLO_MS);
    const giveUp = window.setTimeout(() => setRolling(true), GIVE_UP_MS);
    hello();

    return () => {
      window.removeEventListener('message', heard);
      window.clearInterval(ping);
      window.clearTimeout(giveUp);
    };
  }, [on, frame]);

  return rolling;
}

/** O host de uma origem, sem explodir num `origin` que não é URL. */
function hostOf(origin: string) {
  try {
    return new URL(origin).hostname;
  } catch {
    return '';
  }
}

/* ── um quadro ────────────────────────────────────────────────────────────
   O trailer 16:9 no meio da coluna, a legenda deitada sobre o degradê no pé, e
   atrás de tudo o próprio quadro do filme desfocado — não é vidro decorativo, é
   a luz da projeção batendo na parede da sala.

   A legenda recua da direita pela largura do trilho: os controles são uma
   coluna fixa, e texto que passa por baixo deles é texto que não se lê.

   ── memorizado, e vazio quando está longe ───────────────────────────────
   Uma rolagem troca o quadro ativo, e trocar o quadro ativo redesenharia os
   quarenta que existem: `memo` deixa passar só aqueles cujas propriedades
   mudaram de verdade, que são três.

   E quem está a mais de três quadros da tela desenha só a própria altura. A
   altura é a mesma sempre — cada quadro é exatamente a moldura —, então a
   rolagem não escorrega quando um deles volta a ter conteúdo, e o telefone deixa
   de carregar quarenta imagens, quarenta legendas e quarenta camadas de luz para
   mostrar uma. */
const Frame = memo(function Frame({
  index,
  item,
  rated,
  live,
  near,
  within,
  muted,
}: {
  index: number;
  item: ReelItem;
  rated: RatedTitle | null;
  live: boolean;
  /** Se este quadro está à vista ou é o vizinho de quem está. */
  near: boolean;
  /** Se vale a pena existir: fora da janela ele é só altura. */
  within: boolean;
  muted: boolean;
}) {
  const gentle = useGentle();
  /* Sob `prefers-reduced-motion` nada começa a se mexer sozinho: o quadro fica
     parado com a chave de tocar, e o reel continua sendo folheável. */
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (!live) setAsked(false);
  }, [live]);
  const playing = live && (!gentle || asked);
  const still = item.backdrop ?? item.poster;
  /* A moldura, para se apresentar a ela e ouvir quando o filme começar. */
  const beam = useRef<HTMLIFrameElement>(null);
  /* A identidade da moldura, e não um booleano: trocar o som monta outro player,
     e outro player tem outra abertura do YouTube para cobrir. */
  const rolling = useRolling(playing ? `${item.trailerKey}:${muted}` : null, beam);

  if (!within) {
    return (
      <section
        data-frame={index}
        aria-label={item.title}
        className="h-full w-full snap-start snap-always bg-house-deep"
      />
    );
  }

  return (
    <section
      data-frame={index}
      aria-label={item.title}
      className="relative h-full w-full snap-start snap-always overflow-hidden bg-house-deep"
    >
      {/* Acesa só perto da tela, e a partir do CARTAZ e não do quadro deitado:
          o custo de um desfoque é o número de pixels que ele atravessa, e o
          cartaz é cinco vezes menor. Borrado a este ponto os dois são a mesma
          mancha de cor. */}
      {near ? (
        <>
          {item.poster ?? still ? (
            <div
              aria-hidden
              className="absolute -inset-10 bg-cover bg-center opacity-[0.55] blur-2xl saturate-[.6]"
              style={{ backgroundImage: `url(${item.poster ?? still})` }}
            />
          ) : null}
          <div aria-hidden className="absolute inset-0 bg-house-deep/60" />
        </>
      ) : null}

      <div className="absolute inset-0 grid place-items-center">
        <div
          className={cn(
            'relative aspect-video w-full overflow-hidden bg-black ring-1 ring-white/10',
            live && 'animate-beam-in'
          )}
        >
          {still ? (
            <img
              src={still}
              alt=""
              loading="lazy"
              /* Sai quando o filme está correndo, e não quando a moldura foi
                 montada: entre uma coisa e outra o YouTube desenha a abertura
                 dele, e era ela que aparecia. */
              /* `z-[2]`: ele vem antes da moldura na árvore e precisa ficar
                 DEPOIS dela na tela. Sem isto ele é um quadro parado atrás de
                 um vídeo, que é o mesmo que não existir. */
              className={cn(
                'pointer-events-none absolute inset-0 z-[2] h-full w-full object-cover',
                'transition-opacity duration-500',
                rolling ? 'opacity-0' : 'opacity-100'
              )}
            />
          ) : null}
          {playing ? (
            <iframe
              /* `key` no som para o player renascer quando ele muda: o YouTube
                 não desliga o mudo de um player já montado, e uma chave que não
                 faz nada é pior que uma chave ausente. */
              key={muted ? 'mudo' : 'som'}
              ref={beam}
              src={embedOf(item.trailerKey, muted, true, true)}
              title={`Trailer de ${item.title}`}
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              tabIndex={-1}
              className="pointer-events-none absolute inset-0 h-full w-full border-0"
            />
          ) : null}
          {live && gentle && !asked ? (
            <button
              type="button"
              onClick={() => setAsked(true)}
              /* Acima do quadro parado, que sobe a `z-[2]` para cobrir a
                 abertura do player: embaixo dele esta chave seria uma chave
                 invisível e inclicável. */
              className="absolute inset-0 z-[3] grid place-items-center bg-house-deep/45 text-beam transition-colors hover:bg-house-deep/20"
            >
              <span className="flex items-center gap-2 rounded-cell bg-house-seat/85 px-4 py-2.5 font-display text-[12px] uppercase tracking-[0.14em] ring-1 ring-house-rail">
                <Play className="h-3.5 w-3.5 fill-current" strokeWidth={0} aria-hidden />
                Tocar o trailer
              </span>
            </button>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          'absolute inset-x-0 bottom-0 px-5 pb-6 pt-5',
          // O recuo do trilho: 12 de margem + 44 de alvo + 12 de folga.
          'pr-[68px]',
          'bg-gradient-to-t from-house-deep/[0.96] via-house-deep/[0.86] to-transparent',
          live && 'animate-frame-in'
        )}
      >
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="rounded-[1px] bg-dye-brass px-1.5 py-[3px] font-display text-[10.5px] uppercase leading-none tracking-[0.14em] text-house-deep">
            {item.genre}
          </span>
          <span className="q text-[11px] text-ink-dim">
            {[item.year, item.crowd ? `TMDB ${fmt(item.crowd.score)}` : null].filter(Boolean).join(' · ')}
          </span>
        </p>

        <h2 className="mt-2 font-display text-[26px] uppercase leading-[0.92] tracking-[0.02em] text-beam sm:text-[30px]">
          {item.title}
        </h2>

        {rated ? (
          <span className="mt-2 flex items-center gap-2">
            <Strip value={rated.score ?? 0} cells={10} className="h-[5px] w-[88px] flex-none" />
            <span className="q text-[13px] text-beam">{rated.score != null ? fmt(rated.score) : '—'}</span>
            <span className="q text-[10.5px] text-ink-faint">
              {plural(rated.takes, 'ficha do clube', 'fichas do clube')}
            </span>
          </span>
        ) : null}

        {item.overview ? (
          <p className="mt-2 line-clamp-2 text-[12.5px] leading-snug text-ink-dim">{item.overview}</p>
        ) : null}
      </div>
    </section>
  );
});

/* ── uma tecla do trilho ──────────────────────────────────────────────────
   Quadrada, de 44, sobre uma placa: elas ficam por cima de um vídeo que muda
   todo quadro, e um anel em volta de nada deixaria o ícone se virar contra o
   que estivesse passando naquele segundo.

   **Opaca e não desfocada.** Ela já foi `backdrop-blur`, e sete destas por cima
   de um vídeo tocando obrigam o navegador a reler e reborrar o que está atrás
   A CADA QUADRO DO FILME — no telefone é a conta que faz o reel engasgar. Uma
   superfície opaca diz a mesma coisa e não custa nada.

   `lit` é a chave da ficha quando há ficha do clube atrás dela: latão, porque a
   regra da sala é que latão diz "isto tem alguma coisa sua". Quem pulsa é uma
   camada por cima, em opacidade, e não a sombra da tecla — ver `bulb` em
   tailwind.config. Termina acesa, então com menos movimento pedido index.css
   corta o laço em uma volta e sobra a lâmpada parada. */
function RailKey({
  label,
  active,
  lit,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  lit?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'relative grid h-11 w-11 flex-none place-items-center rounded-cell bg-house-seat/85',
        'ring-1 transition-colors duration-150 active:translate-y-px',
        lit
          ? 'text-dye-brass ring-dye-brass/70 hover:text-beam-hot'
          : active
            ? 'text-dye-brass ring-dye-brass/60'
            : 'text-ink-dim ring-house-rail hover:text-beam hover:ring-white/25'
      )}
    >
      {lit ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-bulb rounded-cell bg-dye-brass/[0.18]"
        />
      ) : null}
      <span className="relative">{children}</span>
    </button>
  );
}

/* ── a dica que flutua ────────────────────────────────────────────────────
   Pendurada NA chave da ficha, à esquerda dela porque é o único lado que tem
   coluna. Não intercepta ponteiro nenhum: o que está embaixo continua clicável.

   E ela vai embora sozinha. Uma dica é uma apresentação, não um rótulo: dita
   uma vez ela cumpriu o que tinha para dizer, e ficar pendurada sobre o filme
   até o fim do reel é a interface repetindo a mesma frase para sempre. O que
   fica é a chave acesa, que é o mesmo fato dito pelo tamanho certo.

   Montada com `key` no id da obra lá em cima, então cada quadro novo recomeça
   o relógio dela. */
const TIP_MS = 3200;

function RatedTip({ rated }: { rated: RatedTitle }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setGone(true), TIP_MS);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <span
      aria-hidden={gone}
      className={cn(
        'pointer-events-none absolute right-[calc(100%+8px)] top-1/2 z-10 -translate-y-1/2',
        'flex items-center gap-2 rounded-cell bg-house-seat/95 px-2.5 py-1.5 ring-1 ring-dye-brass/45',
        'animate-frame-in transition-opacity duration-500',
        gone && 'opacity-0'
      )}
    >
      <Check className="h-3.5 w-3.5 flex-none text-dye-brass" strokeWidth={2.2} aria-hidden />
      <span className="whitespace-nowrap font-display text-[10.5px] uppercase leading-none tracking-[0.12em] text-ink">
        {rated.mine ? 'Você já avaliou' : 'O clube já avaliou'}
      </span>
      {rated.score != null ? (
        <span className="q text-[11px] leading-none text-dye-brass">{fmt(rated.score)}</span>
      ) : null}
    </span>
  );
}

/* ── o painel do gênero ───────────────────────────────────────────────────
   Cai POR CIMA da coluna e não empurra nada: escolher é uma visita, e uma visita
   não reorganiza a sala. Uma linha por gênero, em coluna, porque em coluna os
   nomes alinham e truncam num lugar só.

   Sem contagem ao lado de cada um, ao contrário do protótipo: lá o acervo era
   uma lista fixa de dezoito filmes e dava para contar. Aqui o outro lado é o
   TMDB inteiro, e um número inventado ao lado de um filtro é pior que nenhum. */
function GenrePanel({
  genres,
  value,
  onPick,
  onClose,
}: {
  genres: string[];
  value: string | null;
  onPick: (g: string | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const q = norm(query.trim());
  const shown = genres.filter(g => !q || norm(g).includes(q));
  const all = !q || norm('Tudo').includes(q);

  return (
    <div className="absolute inset-0 z-[6] flex flex-col gap-3 bg-house-deep/[0.97] p-4 animate-frame-in">
      <div className="flex items-center justify-between gap-3">
        <span className="legend">Filtrar o reel</span>
        <IconKey aria-label="Fechar o filtro" onClick={onClose} className="flex-none">
          <X className="h-4 w-4" strokeWidth={1.8} />
        </IconKey>
      </div>

      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Buscar gênero…"
        aria-label="Buscar gênero"
        className="w-full rounded-cell bg-house-seat px-3 py-2.5 text-[13px] text-ink ring-1 ring-house-rail placeholder:text-ink-faint focus:outline-none focus:ring-dye-brass/70"
      />

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain">
        {all ? <GenreRow label="Tudo" on={value === null} onClick={() => onPick(null)} /> : null}
        {shown.map(g => (
          <GenreRow key={g} label={g} on={value === g} onClick={() => onPick(g)} />
        ))}
        {!all && !shown.length ? (
          <p className="mt-6 text-center text-[13px] text-ink-dim">Nenhum gênero com esse nome.</p>
        ) : null}
      </div>
    </div>
  );
}

function GenreRow({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-cell px-3 py-2.5 text-left',
        'font-display text-[13px] uppercase leading-none tracking-[0.12em]',
        'ring-1 transition-colors duration-150 coarse:min-h-[44px]',
        on
          ? 'bg-dye-brass/[0.14] text-dye-brass ring-dye-brass/70'
          : 'text-ink ring-house-rail hover:ring-white/25'
      )}
    >
      <span className="truncate">{label}</span>
      {on ? <Check className="h-4 w-4 flex-none" strokeWidth={2.2} aria-hidden /> : null}
    </button>
  );
}

/* ── o trailer inteiro ────────────────────────────────────────────────────
   A coluna 9:16 é o folhear; isto é o assistir. Sai da moldura e ocupa a tela,
   com a barra de baixo carregando o mesmo trilho na horizontal — passar de
   trailer sem sair do modo cheio é o gesto que este modo existe para servir. */
function FullTrailer({
  item,
  muted,
  rated,
  queued,
  queueLabel,
  onQueue,
  onSound,
  onPrev,
  onNext,
  onClose,
}: {
  item: ReelItem;
  muted: boolean;
  rated: RatedTitle | null;
  queued: boolean;
  queueLabel: [string, string];
  onQueue: () => void;
  onSound: () => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener('cancel', cancel);
    return () => el.removeEventListener('cancel', cancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-label={`Trailer de ${item.title}`}
      className="h-[calc(100dvh/var(--ui-zoom))] max-h-none w-full max-w-none border-0 bg-house-deep p-0 text-ink backdrop:bg-house-deep open:animate-beam-in"
    >
      <div className="flex h-full flex-col">
        <div className="grid min-h-0 flex-1 place-items-center p-3 sm:p-5">
          <div className="aspect-video w-full max-w-[min(100%,calc((100dvh/var(--ui-zoom)-190px)*16/9))] overflow-hidden bg-black ring-1 ring-white/10">
            <iframe
              key={muted ? 'mudo' : 'som'}
              src={embedOf(item.trailerKey, muted, false, false)}
              title={`Trailer de ${item.title}`}
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
              className="h-full w-full border-0"
            />
          </div>
        </div>

        <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-3 border-t border-house-rail bg-house px-4 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="legend truncate">
              {[item.genre, item.year, rated?.score != null ? `clube ${fmt(rated.score)}` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className="mt-1.5 truncate font-display text-[24px] uppercase leading-none tracking-[0.03em] text-beam">
              {item.title}
            </p>
          </div>

          <div className="flex flex-none items-center gap-2.5">
            <IconKey aria-label="Trailer anterior" onClick={onPrev}>
              <ChevronUp className="h-4 w-4" strokeWidth={1.9} />
            </IconKey>
            <IconKey aria-label="Próximo trailer" onClick={onNext}>
              <ChevronDown className="h-4 w-4" strokeWidth={1.9} />
            </IconKey>
            <IconKey
              aria-label={muted ? 'Ligar o som' : 'Tirar o som'}
              active={!muted}
              onClick={onSound}
            >
              {muted ? (
                <VolumeX className="h-4 w-4" strokeWidth={1.8} />
              ) : (
                <Volume2 className="h-4 w-4" strokeWidth={1.8} />
              )}
            </IconKey>
            <IconKey
              aria-label={queued ? queueLabel[1] : queueLabel[0]}
              active={queued}
              onClick={onQueue}
            >
              <Bookmark className="h-4 w-4" fill={queued ? 'currentColor' : 'none'} strokeWidth={1.7} />
            </IconKey>
            <Key tone="commit" onClick={onClose}>
              Voltar ao reel
            </Key>
          </div>
        </div>
      </div>
    </dialog>
  );
}

/* ══ a ficha ══════════════════════════════════════════════════════════════
   Tudo o que se sabe da obra, e embaixo o que o clube escreveu sobre ela — com
   o polegar e a conversa em cada ficha, que é onde eles moram desde que a lista
   de acontecimentos deixou de existir.

   Um `<dialog>` e não uma rota, pela mesma razão da folha de projeção: a posição
   do reel é o que a pessoa volta a encontrar, e a plataforma dá a armadilha de
   foco, o Esc e a inércia do fundo de graça. */
type FichaData = {
  title: string;
  original: string | null;
  year: number | null;
  poster: string | null;
  facts: string[];
  genres: string[];
  overview: string | null;
  cast: string[];
  trailerUrl: string | null;
  crowd: { score: number; votes: number } | null;
  watch: Movie['watch'];
};

function Ficha({
  item,
  rated,
  openLabel,
  onOpen,
  queued,
  queueLabel,
  onQueue,
  onClose,
  renderTakes,
}: {
  item: ReelItem;
  rated: RatedTitle | null;
  openLabel: string;
  onOpen: () => void;
  queued: boolean;
  queueLabel: [string, string];
  onQueue: () => void;
  onClose: () => void;
  renderTakes: (id: number) => React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<FichaData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  /* O Esc fecha pelo nosso caminho: fechado por fora, o React continuaria
     achando a folha aberta e o trailer atrás dela não voltaria a tocar. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener('cancel', cancel);
    return () => el.removeEventListener('cancel', cancel);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    const ask =
      item.kind === 'show'
        ? api<{ show: ShowDetail }>(`/api/series/${item.id}`).then(r => showFicha(r.show))
        : api<Movie>(`/api/catalog/movie/${item.id}`).then(movieFicha);
    ask.then(f => alive && setData(f)).catch(e => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [item.id, item.kind]);

  return (
    <dialog
      ref={ref}
      aria-label={`Ficha de ${item.title}`}
      onClick={e => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'w-full max-w-[900px] max-h-[calc(100dvh/var(--ui-zoom))] overflow-hidden bg-transparent p-2 text-ink',
        'backdrop:bg-house-deep/95 open:animate-beam-in sm:p-4'
      )}
    >
      {/* Um rolador só, e ele é a placa — ver a folha de projeção em film.tsx,
          onde está escrito por que o diálogo sai da disputa. */}
      <div className="plate relative max-h-[calc(100dvh/var(--ui-zoom)-1rem)] overflow-y-auto overscroll-contain p-5 sm:max-h-[calc(100dvh/var(--ui-zoom)-2rem)] sm:p-7">
        <IconKey aria-label="Fechar" onClick={onClose} className="absolute right-3 top-3 z-10">
          <X className="h-4 w-4" strokeWidth={1.8} />
        </IconKey>

        {error ? (
          <Fault detail={error}>Não foi possível carregar a ficha.</Fault>
        ) : !data ? (
          <div className="flex flex-col gap-5 sm:flex-row">
            <Skeleton className="aspect-[2/3] w-[132px] flex-none sm:w-[176px]" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-7 w-3/5" />
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <Poster
                src={data.poster}
                alt={`Pôster de ${data.title}`}
                className="aspect-[2/3] w-[132px] flex-none sm:w-[176px]"
              />
              <div className="min-w-0 flex-1">
                <h2 className="pr-10 font-display text-[30px] leading-none tracking-[0.03em] text-beam">
                  {data.title}
                </h2>
                {data.original ? (
                  <p className="q mt-1.5 pr-10 text-[13px] text-ink-dim">{data.original}</p>
                ) : null}
                {data.facts.length ? (
                  <p className="q mt-2 text-[12.5px] text-ink-dim">{data.facts.join(' · ')}</p>
                ) : null}

                <span className="mt-3 flex flex-wrap items-center gap-1.5">
                  {data.genres.map(g => (
                    <span
                      key={g}
                      className="rounded-[1px] px-2 py-0.5 font-display text-[11px] uppercase tracking-[0.14em] text-dye-red-lit ring-1 ring-dye-red-lit/50"
                    >
                      {g}
                    </span>
                  ))}
                </span>

                <Verdicts rated={rated} crowd={data.crowd} />

                <p className="mt-4 max-w-[66ch] text-[13.5px] leading-relaxed text-ink-dim">
                  {data.overview || 'Sem sinopse disponível no TMDB.'}
                </p>
                {data.cast.length ? (
                  <p className="mt-3 text-[12px] text-ink-dim">Elenco: {data.cast.join(', ')}</p>
                ) : null}
                {data.trailerUrl ? (
                  <TrailerKey url={data.trailerUrl} title={data.title} className="mt-3">
                    Ver o trailer inteiro
                  </TrailerKey>
                ) : null}

                <WatchOn watch={data.watch} title={data.title} />

                <div className="mt-6 flex flex-wrap gap-2">
                  <Key tone="commit" onClick={onOpen}>
                    <Check className="h-4 w-4" strokeWidth={2} />
                    {openLabel}
                  </Key>
                  <Key
                    tone="flush"
                    className={queued ? 'text-dye-red-lit ring-dye-red-lit/50' : undefined}
                    onClick={onQueue}
                  >
                    <Bookmark className="h-4 w-4" fill={queued ? 'currentColor' : 'none'} strokeWidth={1.7} />
                    {queued ? queueLabel[1] : queueLabel[0]}
                  </Key>
                </div>
              </div>
            </div>

            {/* O que o clube achou, embaixo de tudo o que o TMDB sabe: a ordem é
                a do produto, não a da fonte. */}
            <div className="mt-7 border-t border-white/[0.07] pt-5">{renderTakes(item.id)}</div>
          </>
        )}
      </div>
    </dialog>
  );
}

/* O clube contra a multidão, na ficha do reel. Gêmeo do bloco da folha de
   projeção e mais curto que ele: aqui a média do clube já chegou pronta com o
   quadro, e não há o que buscar. */
function Verdicts({ rated, crowd }: { rated: RatedTitle | null; crowd: FichaData['crowd'] }) {
  const votes = (n: number) =>
    new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

  const line = (label: string, score: number, note: string, lit: boolean) => (
    <span className="flex items-center gap-2">
      <span className="legend w-[6ch] flex-none">{label}</span>
      <Strip value={score} cells={10} className="h-[5px] w-[70px] flex-none" />
      <span className={cn('q whitespace-nowrap text-[12px]', lit ? 'text-beam' : 'text-ink-dim')}>
        {fmt(score)} <span className="text-ink-faint">· {note}</span>
      </span>
    </span>
  );

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {rated?.score != null ? (
        line('Clube', rated.score, plural(rated.takes, 'ficha', 'fichas'), true)
      ) : (
        <p className="q text-[12px] text-ink-dim">sem avaliação do clube</p>
      )}
      {crowd ? line('TMDB', crowd.score, `${votes(crowd.votes)} votos`, false) : null}
    </div>
  );
}

const movieFicha = (m: Movie): FichaData => ({
  title: m.title,
  original: m.original ?? null,
  year: m.year,
  poster: m.poster,
  facts: [m.year ? String(m.year) : null, runtimeOf(m.runtime), m.director ? `dir. ${m.director}` : null].filter(
    Boolean
  ) as string[],
  genres: m.genres?.length ? m.genres : [m.genre],
  overview: m.overview ?? null,
  cast: (m.cast ?? []).map(c => c.name),
  trailerUrl: m.trailerUrl ?? null,
  crowd: m.crowd ?? null,
  watch: m.watch,
});

const showFicha = (s: ShowDetail): FichaData => ({
  title: s.title,
  original: s.original,
  year: s.year,
  poster: s.poster,
  facts: [
    /* Uma série se datamarca por um intervalo, e o fim dele é a resposta de "já
       acabou?" — a pergunta que se faz antes de começar a acompanhar. */
    s.year ? (s.endedYear && s.endedYear !== s.year ? `${s.year}–${s.endedYear}` : String(s.year)) : null,
    s.totalEpisodes ? `${s.totalEpisodes} ${plural(s.totalEpisodes, 'episódio', 'episódios')}` : null,
    runtimeOf(s.runtime),
    s.creators.length ? `criada por ${s.creators.join(', ')}` : null,
  ].filter(Boolean) as string[],
  genres: s.genres?.length ? s.genres : [s.genre],
  overview: s.overview,
  cast: [],
  trailerUrl: s.trailerUrl,
  crowd: s.crowd,
  watch: s.watch,
});

/* ══ as duas montagens ════════════════════════════════════════════════════
   O reel é um só; o que muda é de onde vem "o clube já avaliou isto" e o que a
   chave principal abre. Cada casca do App monta a sua e não sabe da outra.

   Do lado dos filmes o adaptador lê o contexto grande, porque ele existe. Do
   lado das séries chega por propriedade, porque lá não há contexto nenhum — e
   inventar um segundo seria uma segunda verdade sobre a mesma sala. */
/* A seção ao lado desta na barra do dedo, que é para onde o deslize leva. Presa
   nas pontas: da primeira não há como ir mais para trás, e um gesto que não faz
   nada é melhor do que um que dá a volta e some com a pessoa do outro lado. */
function beside(dir: -1 | 1): TabId {
  const at = BAR_ORDER.indexOf('feed');
  return BAR_ORDER[Math.min(Math.max(at + dir, 0), BAR_ORDER.length - 1)];
}

export function MovieReels() {
  const club = useClub();

  /* Uma linha por FILME e não por ficha: o reel mostra a obra, e três pessoas
     que avaliaram Parasita são um quadro com três fichas dentro, não três
     quadros. A média e a contagem vêm do acervo que o clube já tem em memória. */
  const rated = useMemo(() => {
    const by = new Map<number, RatedTitle>();
    for (const r of club.reviews) {
      const held = by.get(r.movieId);
      if (held) {
        held.mine = held.mine || r.reviewerId === club.me.id;
        if (r.date > held.at) held.at = r.date;
        continue;
      }
      const avg = club.averages[r.movieId];
      by.set(r.movieId, {
        id: r.movieId,
        score: avg?.avg ?? r.final,
        takes: avg?.count ?? 1,
        mine: r.reviewerId === club.me.id,
        at: r.date,
      });
    }
    return [...by.values()];
  }, [club.reviews, club.averages, club.me.id]);

  return (
    <ReelsScreen
      kind="movie"
      rated={rated}
      openLabel="Avaliar este filme"
      onOpen={it => club.rateMovie(it.id)}
      queued={id => club.inWatchlist(id)}
      onQueue={it =>
        void club.toggleWatch({
          id: it.id,
          title: it.title,
          year: it.year,
          genre: it.genre,
          poster: it.poster,
        })
      }
      queueLabel={['Quero ver', 'Na fila']}
      renderTakes={id => <MovieTakes movieId={id} />}
      onExit={dir => club.goTab(beside(dir))}
    />
  );
}

export function SeriesReels({
  takes,
  meId,
  queued,
  onQueue,
  onOpen,
  onTab,
}: {
  takes: EpisodeTake[] | null;
  meId: string;
  queued: (id: number) => boolean;
  onQueue: (s: { id: number; title: string; year: number | null; genre: string; poster: string | null }) => void;
  onOpen: (showId: number) => void;
  /** A casca de séries não tem contexto: a troca de seção chega por aqui. */
  onTab: (t: TabId) => void;
}) {
  /* Uma série é avaliada por EPISÓDIO, então a nota que o reel mostra é a média
     dos episódios que têm nota — a mesma conta que o acervo de séries faz. Uma
     série só marcada como vista não entra: ela não tem o que dizer. */
  const rated = useMemo(() => {
    const by = new Map<number, RatedTitle & { sum: number }>();
    for (const t of takes ?? []) {
      if (t.final == null) continue;
      const at = t.ratedAt ?? t.watchedAt;
      const held = by.get(t.showId);
      if (held) {
        held.sum += t.final;
        held.takes += 1;
        held.score = held.sum / held.takes;
        held.mine = held.mine || t.reviewerId === meId;
        if (at > held.at) held.at = at;
        continue;
      }
      by.set(t.showId, {
        id: t.showId,
        sum: t.final,
        score: t.final,
        takes: 1,
        mine: t.reviewerId === meId,
        at,
      });
    }
    return [...by.values()];
  }, [takes, meId]);

  return (
    <ReelsScreen
      kind="show"
      rated={rated}
      openLabel="Abrir a série"
      onOpen={it => onOpen(it.id)}
      queued={queued}
      onQueue={it =>
        onQueue({ id: it.id, title: it.title, year: it.year, genre: it.genre, poster: it.poster })
      }
      queueLabel={['Acompanhar', 'Nas minhas séries']}
      renderTakes={id => <ShowTakes showId={id} takes={takes} />}
      onExit={dir => onTab(beside(dir))}
    />
  );
}

/* ══ as fichas do clube, por universo ═════════════════════════════════════
   O reel é o mesmo dos dois lados; isto não é. Uma ficha de filme é uma por
   pessoa por obra, e uma de série é uma por EPISÓDIO — a mesma pessoa tem oito
   sobre a mesma série. Um componente só, com um `if` dentro, seria os dois
   universos disputando as mesmas linhas.

   O que os dois têm igual é o que importa: cada ficha aceita o polegar do clube
   e uma conversa embaixo. As duas peças são as mesmas — ver components/social —
   e é por isso que elas não sabem em qual universo estão. */
export function MovieTakes({ movieId }: { movieId: number }) {
  const club = useClub();
  const here = club.reviews
    .filter(r => r.movieId === movieId)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!here.length) {
    return (
      <p className="text-[13px] text-ink-dim">
        Ninguém do clube avaliou este filme ainda. A chave vermelha acima abre a ficha em branco.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <span className="legend">O que o clube achou</span>
      {here.map(r => (
        <TakePlate
          key={r.id}
          take={{ id: r.id, reviewerId: r.reviewerId, reviewerName: r.reviewerName }}
          person={{ id: r.reviewerId, name: r.reviewerName, dot: r.reviewerDot }}
          final={r.final}
          line={null}
          review={r}
        />
      ))}
    </div>
  );
}

export function ShowTakes({ showId, takes }: { showId: number; takes: EpisodeTake[] | null }) {
  const here = (takes ?? [])
    .filter(t => t.showId === showId && t.final != null)
    .sort((a, b) => (b.ratedAt ?? b.watchedAt).localeCompare(a.ratedAt ?? a.watchedAt));

  if (!here.length) {
    return (
      <p className="text-[13px] text-ink-dim">
        Ninguém do clube avaliou um episódio desta série ainda.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <span className="legend">O que o clube achou</span>
      {here.map(t => (
        <TakePlate
          key={t.id}
          take={{ id: t.id, reviewerId: t.reviewerId, reviewerName: t.reviewerName ?? '' }}
          person={{ id: t.reviewerId, name: t.reviewerName ?? '', dot: t.reviewerDot }}
          final={t.final ?? 0}
          line={`T${t.season}E${t.episode}${t.episodeTitle ? ` · ${t.episodeTitle}` : ''}`}
          review={t}
        />
      ))}
    </div>
  );
}

/* Uma ficha, inteira: quem, quanto, os critérios abertos, o polegar do clube e
   a conversa. É o que a linha do mural mostrava depois de dois cliques, e aqui
   ela chega aberta — a ficha já é o lugar onde se veio parar. */
function TakePlate({
  take,
  person,
  final,
  line,
  review,
}: {
  take: { id: string; reviewerId: string; reviewerName: string };
  person: { id: string; name: string; dot: string | null };
  final: number;
  /** O que esta ficha é, quando não é a obra inteira: o episódio. */
  line: string | null;
  review: Review | EpisodeTake;
}) {
  return (
    <div className="rounded-cell bg-house-deep/55 p-4 ring-1 ring-inset ring-white/[0.06]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PersonReel person={person} size="sm" />
        <PersonName
          person={person}
          className="font-display text-[13px] uppercase tracking-[0.1em] text-ink"
        />
        {line ? <span className="q text-[11.5px] text-ink-dim">{line}</span> : null}
        <span className="ml-auto flex flex-none items-center gap-2.5">
          <Strip value={final} cells={10} className="hidden h-[6px] w-[90px] flex-none sm:block" />
          <span className="q font-display text-[20px] leading-none text-beam">{fmt(final)}</span>
        </span>
        <TakeVotes take={take} />
      </div>

      <div className="mt-3">
        <Breakdown r={review} comment={review.comment ?? undefined} />
      </div>

      <Conversation take={take} />
    </div>
  );
}

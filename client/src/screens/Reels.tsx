import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Check, ChevronDown, Play, Volume2, VolumeX, X } from 'lucide-react';
import { Bill, Blank, Chip, Fault, IconKey, Key, Poster, Skeleton, Strip, TrailerKey } from '@/components/bits';
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
import { cn, plural } from '@/lib/utils';
import { useClub } from '@/App';

/* ══════════════════════════════════════════════════════════════════════════
   O REEL — A PORTA DA SALA.

   Era uma lista de acontecimentos em ordem de tempo, e ela respondia bem a uma
   pergunta que ninguém faz ao abrir o app: "o que houve por aqui?". A pergunta
   de verdade é "o que a gente vê hoje?", e a resposta dela não é texto — é o
   trailer tocando.

   ── o que o clube fez continua na frente ────────────────────────────────
   O reel abre pelo que o clube avaliou, e não pelo que o TMDB acha popular. É a
   mesma afirmação que o mural fazia — *o grupo é visível* — dita pelo material
   do produto em vez de por uma linha de texto: o filme que alguém acabou de
   avaliar é o primeiro que rola, com a chave da ficha acesa e uma dica dizendo
   que já tem nota. Quem chega encontra a conversa do clube antes da descoberta.

   ── e o que sumiu ────────────────────────────────────────────────────────
   A lista de acontecimentos. As avaliações não se perderam: elas moram dentro
   da ficha da obra, onde se curte e se responde cada uma — que era o que a
   lista fazia, com a diferença de que agora estão ao lado do filme de que
   falam.

   ── uma tela, dois universos ─────────────────────────────────────────────
   Filme e série rolam no mesmo componente. O que muda entre eles — quem já foi
   avaliado, o que a chave de avaliar abre, e como uma ficha do clube é
   desenhada — chega por propriedade. As duas cascas do App montam o mesmo reel
   com adaptadores diferentes; ver `MovieTakes` e `ShowTakes` no fim do arquivo.
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

export function ReelsScreen({
  kind,
  rated,
  openLabel,
  onOpen,
  queued,
  onQueue,
  queueLabel,
  renderTakes,
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
  const [muted, setMuted] = useState(true);
  const [open, setOpen] = useState<ReelItem | null>(null);

  const track = useRef<HTMLDivElement>(null);

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
        const got = await reels.page(kind, genre, want);
        setPages(got.totalPages);
        setFound(prev => (want === 1 ? got.results : prev.concat(got.results)));
        setPage(want);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [kind, genre]
  );

  useEffect(() => {
    setFound([]);
    setActive(0);
    track.current?.scrollTo({ top: 0 });
    void load(1);
  }, [load]);

  /* Fixadas primeiro, na ordem em que o clube avaliou, e sem repetir: a mesma
     obra pode voltar como descoberta, e vê-la duas vezes num reel é o produto
     perdendo o fio. Com um gênero escolhido, uma fixada de outro gênero sairia
     do filtro que a pessoa acabou de pedir. */
  const items = useMemo(() => {
    const head = genre ? pinned.filter(p => p.genres.includes(genre)) : pinned;
    const seen = new Set(head.map(p => p.id));
    return head.concat(found.filter(f => !seen.has(f.id)));
  }, [pinned, found, genre]);

  /* ── qual quadro está na tela ──────────────────────────────────────────
     Observado e não calculado da rolagem: o mesmo sinal serve para o dedo, para
     a roda, para as setas e para o snap terminando sozinho, e nenhum deles
     precisa avisar ninguém. */
  useEffect(() => {
    const box = track.current;
    if (!box) return;
    const frames = Array.from(box.querySelectorAll<HTMLElement>('[data-frame]'));
    const spy = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.frame));
        }
      },
      { root: box, threshold: 0.6 }
    );
    for (const f of frames) spy.observe(f);
    return () => spy.disconnect();
  }, [items.length]);

  useEffect(() => {
    if (loading || page >= pages) return;
    if (active >= items.length - AHEAD) void load(page + 1);
  }, [active, items.length, loading, page, pages, load]);

  const jump = useCallback((delta: number) => {
    const box = track.current;
    if (!box) return;
    box.scrollBy({ top: delta * box.clientHeight, behavior: 'smooth' });
  }, []);

  /* As setas movem o reel, e só quando nada por cima dele está escutando: com a
     ficha aberta elas pertencem ao texto que está sendo lido. */
  useEffect(() => {
    if (open) return;
    const key = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        jump(e.key === 'ArrowDown' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [jump, open]);

  const height = useReelHeight(track);

  return (
    <section>
      <Bill
        title="Reels"
        note={
          items.length
            ? `${active + 1} de ${items.length}${pinned.length ? ' · o que o clube avaliou vem primeiro' : ''}`
            : 'trailers do que está passando'
        }
      >
        <IconKey
          aria-label={muted ? 'Ligar o som' : 'Tirar o som'}
          aria-pressed={!muted}
          title={muted ? 'Ligar o som' : 'Tirar o som'}
          onClick={() => setMuted(m => !m)}
          className={cn(!muted && 'text-dye-brass ring-dye-brass/60')}
        >
          {muted ? <VolumeX className="h-4 w-4" strokeWidth={1.8} /> : <Volume2 className="h-4 w-4" strokeWidth={1.8} />}
        </IconKey>
      </Bill>

      {/* Uma fileira que rola de lado em vez de embrulhar: dez gêneros em duas
          linhas comeriam a altura que é o reel inteiro. */}
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden">
        <Chip on={genre === null} onClick={() => setGenre(null)}>
          Tudo
        </Chip>
        {genres.map(g => (
          <Chip key={g} on={genre === g} onClick={() => setGenre(g)}>
            {g}
          </Chip>
        ))}
      </div>

      {error && !items.length ? (
        <div className="max-w-[60ch]">
          <Fault detail={error}>Não foi possível carregar os trailers.</Fault>
        </div>
      ) : null}

      <div
        ref={track}
        /* Focável porque é uma caixa de rolagem: sem isto, quem navega por
           teclado não tem como pousar no reel para folheá-lo. As setas já
           funcionam da página inteira; o que faltava era um lugar de parada. */
        tabIndex={0}
        role="region"
        aria-label="Reel de trailers"
        style={height ? { height } : undefined}
        /* Um rolador só, e ele é este. `overscroll-contain` fecha a porta para o
           gesto vazar para a página atrás no fim da lista — sem ele, chegar ao
           último quadro dispara o "puxar para atualizar" do Android. */
        className={cn(
          'relative snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-plate',
          'ring-1 ring-white/[0.06] focus-visible:outline-none focus-visible:ring-dye-brass/70',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          !height && 'h-[70dvh] min-h-[420px]'
        )}
      >
        {!items.length ? (
          loading || error ? (
            <div className="flex h-full flex-col gap-4 p-4 lg:flex-row">
              <Skeleton className="aspect-video w-full flex-1" />
              <div className="flex w-full flex-col gap-3 lg:w-[340px]">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-8 w-4/5" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-11/12" />
              </div>
            </div>
          ) : (
            <div className="grid h-full place-items-center px-6">
              <Blank title="Nenhum trailer neste gênero">
                O TMDB não devolveu nada com vídeo aqui. Escolha outro gênero — ou volte para tudo.
              </Blank>
            </div>
          )
        ) : (
          items.map((it, i) => (
            <Frame
              key={`${it.kind}-${it.id}-${i}`}
              index={i}
              item={it}
              rated={scoreOf.get(it.id) ?? null}
              /* Uma moldura por vez: montar as vizinhas seria três players do
                 YouTube no ar, e o que está fora da tela tocando som. A ficha
                 aberta também desmonta, senão o trailer continua atrás dela. */
              live={i === active && !open}
              near={Math.abs(i - active) <= 1}
              muted={muted}
              queued={queued(it.id)}
              queueLabel={queueLabel}
              onQueue={() => onQueue(it)}
              onFicha={() => setOpen(it)}
              onNext={() => jump(1)}
            />
          ))
        )}
      </div>

      {open ? (
        <Ficha
          item={open}
          rated={scoreOf.get(open.id) ?? null}
          openLabel={openLabel}
          onOpen={() => {
            const it = open;
            setOpen(null);
            onOpen(it);
          }}
          queued={queued(open.id)}
          queueLabel={queueLabel}
          onQueue={() => onQueue(open)}
          onClose={() => setOpen(null)}
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

   Medido e não escrito em `calc`, porque o que está acima dele varia: a
   marquise, a fileira de gêneros e o cabeçalho mudam de altura com a largura da
   janela, e um número fixo aqui estaria errado em metade dos tamanhos. */
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
         régua e converte uma vez, no fim — misturar as duas dá um reel um quarto
         alto demais e a segunda barra de rolagem que isto existe para evitar. */
      const zoom = Number(getComputedStyle(document.documentElement).zoom) || 1;
      const host = el.closest('main');
      const style = host ? getComputedStyle(host) : null;
      /* No dedo é o `<main>` que rola, e ele tem altura definida — ali o fim é a
         borda dele, e não a da janela, que ainda tem a barra de seções embaixo.
         No computador quem rola é a página, e o fim é a janela mesmo. */
      const bottom =
        host && style && style.overflowY !== 'visible'
          ? host.getBoundingClientRect().bottom
          : window.innerHeight;
      // O respiro que o rodapé de toda tela já pede, e que aqui vem do `<main>`.
      const pad = style ? parseFloat(style.paddingBottom) || 0 : 0;
      setHeight(Math.max(400, (bottom - el.getBoundingClientRect().top) / zoom - pad));
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

/* ── um quadro ────────────────────────────────────────────────────────────
   O trailer 16:9 no meio da sala e o que se sabe dele numa coluna ao lado. No
   telefone a coluna desce para baixo do vídeo em vez de deitar por cima dele:
   legenda sobre imagem em movimento é texto sem contraste garantido, e este
   texto é o que decide se alguém quer ver o filme.

   Atrás de tudo, o próprio quadro do filme desfocado — não é vidro decorativo,
   é a luz da projeção batendo na parede da sala. */
function Frame({
  index,
  item,
  rated,
  live,
  near,
  muted,
  queued,
  queueLabel,
  onQueue,
  onFicha,
  onNext,
}: {
  index: number;
  item: ReelItem;
  rated: RatedTitle | null;
  live: boolean;
  /** Se este quadro está à vista ou é o vizinho de quem está. */
  near: boolean;
  muted: boolean;
  queued: boolean;
  queueLabel: [string, string];
  onQueue: () => void;
  onFicha: () => void;
  onNext: () => void;
}) {
  const gentle = useGentle();
  /* Sob `prefers-reduced-motion` nada começa a se mexer sozinho: o quadro fica
     parado com a chave de tocar, e o reel continua sendo folheável. Quem apertou
     uma vez segue querendo — a escolha vale por quadro. */
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (!live) setAsked(false);
  }, [live]);
  const playing = live && (!gentle || asked);

  const still = item.backdrop ?? item.poster;

  return (
    <section
      data-frame={index}
      aria-label={item.title}
      className="relative h-full w-full snap-start snap-always overflow-hidden bg-house-deep"
    >
      {/* A parede da sala, acesa pelo próprio quadro do filme. Desenhada só
          perto da tela: um desfoque de tela cheia por quadro, vinte vezes, é
          vinte camadas grandes que o navegador repinta por nada. */}
      {still && near ? (
        <>
          <div
            aria-hidden
            className="absolute -inset-12 bg-cover bg-center opacity-60 blur-3xl saturate-[.65]"
            style={{ backgroundImage: `url(${still})` }}
          />
          <div aria-hidden className="absolute inset-0 bg-house-deep/70" />
        </>
      ) : null}

      <div className="relative flex h-full flex-col lg:flex-row">
        <div className="flex min-h-0 flex-1 items-center justify-center p-3 lg:p-6">
          <div className="relative aspect-video w-full max-h-full overflow-hidden bg-black ring-1 ring-white/10">
            {still ? (
              <img
                src={still}
                alt=""
                loading="lazy"
                className={cn(
                  'absolute inset-0 h-full w-full object-cover transition-opacity duration-700',
                  playing ? 'opacity-0' : 'opacity-100'
                )}
              />
            ) : null}
            {playing ? (
              <iframe
                /* `key` no som para o player renascer quando ele muda: o YouTube
                   não desliga o mudo de um player já montado, e uma chave que
                   não faz nada é pior que uma chave ausente. */
                key={muted ? 'mudo' : 'som'}
                src={`https://www.youtube-nocookie.com/embed/${item.trailerKey}?autoplay=1&mute=${muted ? 1 : 0}&rel=0&modestbranding=1&playsinline=1&loop=1&playlist=${item.trailerKey}`}
                title={`Trailer de ${item.title}`}
                allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
                className="absolute inset-0 h-full w-full border-0"
              />
            ) : null}
            {live && gentle && !asked ? (
              <button
                type="button"
                onClick={() => setAsked(true)}
                className="absolute inset-0 grid place-items-center bg-house-deep/45 text-beam transition-colors hover:bg-house-deep/25"
              >
                <span className="flex items-center gap-2 rounded-cell bg-house-seat/85 px-4 py-2.5 font-display text-[13px] uppercase tracking-[0.14em] ring-1 ring-house-rail">
                  <Play className="h-4 w-4 fill-current" strokeWidth={0} aria-hidden />
                  Tocar o trailer
                </span>
              </button>
            ) : null}
          </div>
        </div>

        <aside className="flex w-full flex-none flex-col justify-center gap-3 border-t border-white/[0.07] px-4 pb-5 pt-4 lg:w-[356px] lg:border-l lg:border-t-0 lg:px-6 lg:py-8">
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="rounded-[1px] px-2 py-0.5 font-display text-[11px] uppercase tracking-[0.14em] text-dye-red-lit ring-1 ring-dye-red-lit/50">
              {item.genre}
            </span>
            {item.year ? <span className="q text-[11.5px] text-ink-dim">{item.year}</span> : null}
            {item.crowd ? (
              <span className="q text-[11.5px] text-ink-faint">TMDB {fmt(item.crowd.score)}</span>
            ) : null}
          </p>

          <h2 className="font-display text-[30px] leading-[0.92] tracking-[0.02em] text-beam lg:text-[38px]">
            {item.title}
          </h2>
          {item.original ? (
            <p className="q -mt-1 text-[12px] text-ink-faint">{item.original}</p>
          ) : null}

          {rated ? <ClubScore rated={rated} /> : null}

          {item.overview ? (
            <p className="line-clamp-3 text-[13px] leading-relaxed text-ink-dim lg:line-clamp-5">
              {item.overview}
            </p>
          ) : null}

          <div className="relative mt-1 flex flex-wrap items-center gap-2">
            {rated ? <RatedTip rated={rated} /> : null}
            <FichaKey lit={!!rated} onClick={onFicha} title={item.title} />
            <IconKey
              active={queued}
              aria-pressed={queued}
              aria-label={queued ? queueLabel[1] : queueLabel[0]}
              title={queued ? queueLabel[1] : queueLabel[0]}
              onClick={onQueue}
            >
              <Bookmark className="h-4 w-4" fill={queued ? 'currentColor' : 'none'} strokeWidth={1.7} />
            </IconKey>
            <IconKey aria-label="Próximo trailer" title="Próximo trailer" onClick={onNext} className="ml-auto">
              <ChevronDown className="h-4 w-4" strokeWidth={1.8} />
            </IconKey>
          </div>
        </aside>
      </div>
    </section>
  );
}

/** A nota do clube na coluna do reel: a régua, o número e de quantos ele é. */
function ClubScore({ rated }: { rated: RatedTitle }) {
  if (rated.score == null) {
    return (
      <p className="q text-[12px] text-ink-dim">
        {plural(rated.takes, 'ficha do clube', 'fichas do clube')}, ainda sem nota
      </p>
    );
  }
  return (
    <div className="flex items-center gap-2.5">
      <Strip value={rated.score} cells={10} className="h-[6px] w-[104px] flex-none" />
      <span className="q text-[15px] text-beam">{fmt(rated.score)}</span>
      <span className="q text-[11px] text-ink-faint">
        /10 · {plural(rated.takes, 'ficha', 'fichas')}
      </span>
    </div>
  );
}

/* ── a chave da ficha, acesa ──────────────────────────────────────────────
   Uma obra que o clube avaliou tem coisa escrita atrás desta chave, e o reel
   inteiro depende de isso ser visível de relance. Latão porque é estado — a
   regra da sala é que latão diz "isto tem alguma coisa sua" e vermelho diz onde
   você está. O pulso é lento e para sob `prefers-reduced-motion`, que é o que
   separa uma lâmpada de marquise de um alarme. */
function FichaKey({ lit, onClick, title }: { lit: boolean; onClick: () => void; title: string }) {
  return (
    <Key
      tone="flush"
      onClick={onClick}
      aria-label={`Abrir a ficha de ${title}`}
      className={cn(
        lit &&
          'animate-bulb bg-dye-brass/[0.12] text-dye-brass ring-dye-brass/70 hover:text-beam-hot hover:ring-dye-brass'
      )}
    >
      Ficha
    </Key>
  );
}

/* ── a dica que flutua ────────────────────────────────────────────────────
   Sobre a chave e não ao lado dela: é uma etiqueta pendurada NAQUELA chave, e ao
   lado ela viraria mais um pedaço da fileira. Não intercepta ponteiro nenhum —
   o que está embaixo continua clicável. */
function RatedTip({ rated }: { rated: RatedTitle }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute bottom-[calc(100%+8px)] left-0 z-10 flex items-center gap-2',
        'rounded-cell bg-house-seat/95 px-2.5 py-1.5 ring-1 ring-dye-brass/45',
        'animate-frame-in motion-reduce:animate-none'
      )}
    >
      <Check className="h-3.5 w-3.5 flex-none text-dye-brass" strokeWidth={2.2} aria-hidden />
      <span className="whitespace-nowrap font-display text-[11px] uppercase leading-none tracking-[0.12em] text-ink">
        {rated.mine ? 'Você já avaliou' : 'O clube já avaliou'}
      </span>
      {rated.score != null ? (
        <span className="q text-[11.5px] leading-none text-dye-brass">{fmt(rated.score)}</span>
      ) : null}
    </span>
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
    />
  );
}

export function SeriesReels({
  takes,
  meId,
  queued,
  onQueue,
  onOpen,
}: {
  takes: EpisodeTake[] | null;
  meId: string;
  queued: (id: number) => boolean;
  onQueue: (s: { id: number; title: string; year: number | null; genre: string; poster: string | null }) => void;
  onOpen: (showId: number) => void;
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, Play, Plus, Trash2, X } from 'lucide-react';
import {
  Bill,
  Blank,
  Chip,
  Fault,
  IconKey,
  Key,
  Poster,
  SearchField,
  Skeleton,
} from '@/components/bits';
import { Channels, Gauge } from '@/components/channels';
import {
  fmt,
  seriesApi,
  /* Renomeado porque `shows` também é o nome da fila numa das telas daqui, e
     duas coisas com o mesmo nome no mesmo arquivo é uma delas sendo lida como a
     outra em algum momento. */
  shows as showsApi,
  type Criterion,
  type Episode,
  type EpisodeDetail,
  type EpisodeTake,
  type QueuedShow,
  type SeasonDetail,
  type SeriesItem,
  type ShowDetail,
  type TakePatch,
} from '@/lib/api';
import { cn, plural } from '@/lib/utils';

/* ══════════════════════════════════════════════════════════════════════════
   O UNIVERSO DE SÉRIES, DENTRO DE UM CLUBE.

   O de filmes gira em torno de uma noite: escolhe-se um filme, assiste-se
   junto, e cada um preenche a ficha quando dá. O de séries gira em torno de
   SEMANAS, e a unidade deixa de ser a obra e passa a ser o episódio.

   Isso muda o gesto principal. Lá o gesto é avaliar; aqui é MARCAR — dizer "vi
   esse" —, e avaliar é o que se faz por cima disso quando o episódio mereceu.
   Por isso a lista de episódios é a tela central, e por isso marcar é um toque
   enquanto a ficha criteriosa é uma folha que se abre.

   Os três estados de uma linha (visto / nota rápida / criteriosa) são um só
   registro no banco, e a tela desenha os três com a mesma peça. Ver
   `episode_takes` em db.js. */

/* ── o catálogo ───────────────────────────────────────────────────────────
   Irmão do catálogo de filmes: populares do TMDB, busca, filtro por gênero. O
   que muda é o destino do clique — aqui um cartaz abre a SÉRIE, com as
   temporadas e os episódios, e não uma folha de leitura. */
export function SeriesCatalogScreen({
  queued,
  onQueue,
  onOpen,
  fault,
}: {
  queued: Set<number>;
  onQueue: (s: SeriesItem) => void;
  onOpen: (showId: number) => void;
  fault: (msg: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('Todos');
  const [items, setItems] = useState<SeriesItem[] | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const busca = query.trim();

  useEffect(() => {
    let vivo = true;
    setItems(null);
    const pedido = busca
      ? seriesApi.search(busca, page)
      : genre === 'Todos'
        ? seriesApi.popular(page)
        : seriesApi.byGenre(genre, page);
    void pedido
      .then(r => {
        if (!vivo) return;
        setItems(r.results);
        setTotalPages(r.totalPages);
      })
      .catch(e => {
        if (!vivo) return;
        setItems([]);
        fault('Não foi possível falar com o TMDB: ' + (e as Error).message);
      });
    return () => {
      vivo = false;
    };
  }, [busca, genre, page, fault]);

  /* Trocar de busca ou de gênero é outra lista: manter a página seria abrir a
     página 7 de uma lista que a pessoa nunca viu a primeira. */
  const cut = `${busca}|${genre}`;
  const lastCut = useRef(cut);
  if (lastCut.current !== cut) {
    lastCut.current = cut;
    if (page !== 1) setPage(1);
  }

  return (
    <section>
      <Bill
        title="Catálogo"
        note={busca ? `buscando "${busca}"` : 'as séries mais vistas no TMDB'}
      />

      <div className="mb-5 max-w-[440px]">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Buscar uma série…"
          hint={busca ? 'busca no TMDB, não no que o clube já viu' : undefined}
        />
      </div>

      {/* O filtro só faz sentido sem busca: uma busca já é o filtro. */}
      {!busca ? (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {['Todos', ...GENRES].map(g => (
            <Chip key={g} size="sm" on={genre === g} onClick={() => setGenre(g)}>
              {g}
            </Chip>
          ))}
        </div>
      ) : null}

      {!items ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="aspect-[2/3] w-full" />
          ))}
        </div>
      ) : !items.length ? (
        <Blank title="Nenhuma série com esse nome">
          Tente o título original, se souber — o TMDB indexa os dois.
        </Blank>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {items.map(s => (
              <li key={s.id}>
                <SeriesCell
                  show={s}
                  inQueue={queued.has(s.id)}
                  onOpen={() => onOpen(s.id)}
                  onQueue={() => onQueue(s)}
                />
              </li>
            ))}
          </ul>
          {totalPages > 1 ? (
            <div className="mt-8 flex items-center gap-3">
              <Key tone="ghost" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                Anterior
              </Key>
              <span className="q text-[12px] text-ink-dim">
                {page} de {totalPages.toLocaleString('pt-BR')}
              </span>
              <Key tone="ghost" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                Próxima
              </Key>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

/* Os nove gêneros internos. Escritos aqui e não buscados porque a lista é a
   mesma do universo de filmes e já é constante no servidor — uma requisição
   para nove strings que nunca mudam seria encanamento. */
const GENRES = [
  'Ação', 'Animação', 'Comédia', 'Documentário', 'Drama',
  'Ficção científica', 'Romance', 'Suspense', 'Terror',
];

function SeriesCell({
  show,
  inQueue,
  onOpen,
  onQueue,
}: {
  show: SeriesItem;
  inQueue: boolean;
  onOpen: () => void;
  onQueue: () => void;
}) {
  return (
    <div className="group/cell relative">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <Poster src={show.poster} alt={`Pôster de ${show.title}`} className="aspect-[2/3] w-full" />
        <span className="mt-2 block truncate text-[13.5px] text-ink transition-colors group-hover/cell:text-beam">
          {show.title}
        </span>
        <span className="q block text-[11px] text-ink-dim">
          {[show.year ?? '—', show.genre].filter(Boolean).join(' · ')}
        </span>
      </button>

      {/* Pôr na fila sem abrir a série: o gesto de "essa a gente vai ver" é
          rápido e não precisa de uma tela. Fora do botão do cartaz porque um
          controle não se aninha em outro. */}
      <button
        type="button"
        onClick={onQueue}
        disabled={inQueue}
        title={inQueue ? 'Já está na fila do clube' : 'Pôr na fila do clube'}
        aria-label={inQueue ? `${show.title} já está na fila` : `Pôr ${show.title} na fila`}
        className={cn(
          'absolute right-1.5 top-1.5 z-10 flex h-8 w-8 items-center justify-center rounded-cell',
          'bg-house-deep/90 ring-1 ring-white/10 transition-colors',
          inQueue ? 'text-dye-brass' : 'text-ink-dim hover:text-beam'
        )}
      >
        {inQueue ? <Check className="h-4 w-4" strokeWidth={2.2} /> : <Plus className="h-4 w-4" strokeWidth={2} />}
      </button>
    </div>
  );
}

/* ── a fila do clube ──────────────────────────────────────────────────────
   O que a sala combinou de acompanhar. Cada linha carrega o progresso DO CLUBE
   — episódios distintos vistos, não linhas —, porque quem abre esta tela está
   perguntando onde a sala está, e não onde ela mesma está. */
export function SeriesQueueScreen({
  shows,
  onOpen,
  onRemove,
}: {
  shows: QueuedShow[] | null;
  onOpen: (showId: number) => void;
  onRemove: (showId: number) => void;
}) {
  if (!shows) {
    return (
      <section>
        <Bill title="Quero ver" note="carregando…" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2].map(i => <Skeleton key={i} className="aspect-[2/3] w-full" />)}
        </div>
      </section>
    );
  }

  if (!shows.length) {
    return (
      <section>
        <Bill title="Quero ver" />
        <Blank title="A fila de séries está vazia">
          Ache uma série no catálogo e ponha na fila. O que o clube combinar de acompanhar
          aparece aqui, com o quanto já foi visto.
        </Blank>
      </section>
    );
  }

  return (
    <section>
      <Bill title="Quero ver" note={`${plural(shows.length, 'série', 'séries')} na fila do clube`} />
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {shows.map(s => (
          <li key={s.id} className="group/cell relative">
            <button type="button" onClick={() => onOpen(s.id)} className="block w-full text-left">
              <Poster src={s.poster} alt={`Pôster de ${s.title}`} className="aspect-[2/3] w-full" />
              <span className="mt-2 block truncate text-[13.5px] text-ink transition-colors group-hover/cell:text-beam">
                {s.title}
              </span>
              <span className="q block text-[11px] text-ink-dim">
                {/* O progresso, e a média só quando existe: um clube que
                    acompanha sem avaliar não tem nota, e imprimir 0,0 ali seria
                    a tela inventando um veredito. */}
                {s.totalEpisodes ? `${s.seen}/${s.totalEpisodes} vistos` : `${s.seen} vistos`}
                {s.average != null ? ` · ${fmt(s.average)}` : ''}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(s.id)}
              title="Tirar da fila"
              aria-label={`Tirar ${s.title} da fila`}
              className="absolute right-1.5 top-1.5 z-10 flex h-8 w-8 items-center justify-center rounded-cell bg-house-deep/90 text-ink-dim ring-1 ring-white/10 transition-colors hover:text-dye-red-lit"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.7} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ══ a série, que é a tela central deste universo ══════════════════════════
   Cabeçalho, um seletor de temporada, e a lista de episódios. Cada episódio é
   uma linha com um gesto de um toque — marcar visto — e uma porta para a ficha
   criteriosa.

   A temporada é carregada sozinha, e não todas de uma vez: uma série longa são
   dez requisições ao TMDB para desenhar uma lista que cabe em uma. */
export function ShowScreen({
  showId,
  takes,
  criteria,
  meId,
  inQueue,
  onQueue,
  onBack,
  onSaved,
  fault,
}: {
  showId: number;
  /** Todas as fichas do clube nesta série, de todo mundo. */
  takes: EpisodeTake[];
  criteria: Record<string, Criterion[]> | null;
  meId: string;
  inQueue: boolean;
  onQueue: (s: { id: number; title: string; year: number | null; genre: string; poster: string | null }) => void;
  onBack: () => void;
  onSaved: () => void;
  fault: (msg: string) => void;
}) {
  const [show, setShow] = useState<ShowDetail | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [temporada, setTemporada] = useState<SeasonDetail | null>(null);
  const [aberto, setAberto] = useState<Episode | null>(null);

  useEffect(() => {
    let vivo = true;
    setShow(null);
    setErro(null);
    void seriesApi
      .show(showId)
      .then(r => {
        if (!vivo) return;
        setShow(r.show);
        /* A primeira temporada com episódio, e não a de número 1: uma série
           relançada pode começar na 2, e uma minissérie tem só a 1. */
        setSeason(r.show.seasons?.[0]?.season ?? null);
      })
      .catch(e => vivo && setErro((e as Error).message));
    return () => {
      vivo = false;
    };
  }, [showId]);

  useEffect(() => {
    if (season == null) return;
    let vivo = true;
    setTemporada(null);
    void seriesApi
      .season(showId, season)
      .then(r => vivo && setTemporada(r.season))
      .catch(e => vivo && fault('Não foi possível carregar a temporada: ' + (e as Error).message));
    return () => {
      vivo = false;
    };
  }, [showId, season, fault]);

  /* As fichas indexadas por episódio, uma vez: a lista pergunta por cada linha
     que desenha, e varrer o array inteiro por episódio é o mesmo trabalho
     repetido vinte vezes. */
  const porEpisodio = useMemo(() => {
    const mapa = new Map<string, EpisodeTake[]>();
    for (const t of takes) {
      const chave = `${t.season}x${t.episode}`;
      const lista = mapa.get(chave);
      if (lista) lista.push(t);
      else mapa.set(chave, [t]);
    }
    return mapa;
  }, [takes]);

  if (erro) {
    return (
      <section>
        <Key tone="flush" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
          Voltar
        </Key>
        <div className="mt-5 max-w-[60ch]">
          <Fault detail={erro}>Não foi possível abrir esta série.</Fault>
        </div>
      </section>
    );
  }

  if (!show) {
    return (
      <section>
        <div className="flex gap-5">
          <Skeleton className="aspect-[2/3] w-[120px] flex-none" />
          <div className="flex-1 space-y-3 pt-2">
            <Skeleton className="h-6 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-2.5 w-full" />
            <Skeleton className="h-2.5 w-5/6" />
          </div>
        </div>
      </section>
    );
  }

  const genero = show.genre;

  return (
    <section>
      <Key tone="flush" onClick={onBack}>
        <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
        Voltar
      </Key>

      <header className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-start">
        <Poster
          src={show.poster}
          alt={`Pôster de ${show.title}`}
          className="aspect-[2/3] w-[120px] flex-none sm:w-[150px]"
        />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[30px] leading-none tracking-[0.03em] text-beam sm:text-[38px]">
            {show.title}
          </h1>
          {show.original ? (
            <p className="q mt-1.5 text-[12.5px] text-ink-dim">{show.original}</p>
          ) : null}
          <p className="q mt-2 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-dim">
            <span>{show.year ?? '—'}</span>
            <span aria-hidden>·</span>
            <span>{show.genre}</span>
            {show.totalEpisodes ? (
              <>
                <span aria-hidden>·</span>
                <span>{plural(show.totalEpisodes, 'episódio', 'episódios')}</span>
              </>
            ) : null}
            {/* Se ainda vem episódio. Acompanhar uma série no ar é outra
                relação com ela, e é a primeira coisa que se pergunta. */}
            {show.inProduction ? (
              <>
                <span aria-hidden>·</span>
                <span className="text-dye-brass">em exibição</span>
              </>
            ) : null}
          </p>
          {show.creators.length ? (
            <p className="q mt-1.5 text-[12px] text-ink-faint">
              criada por {show.creators.join(' · ')}
            </p>
          ) : null}

          {show.overview ? (
            <p className="mt-4 max-w-[66ch] text-[13px] leading-relaxed text-ink-dim">
              {show.overview}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Key
              tone={inQueue ? 'ghost' : 'flush'}
              disabled={inQueue}
              onClick={() =>
                onQueue({
                  id: show.id,
                  title: show.title,
                  year: show.year,
                  genre: show.genre,
                  poster: show.poster,
                })
              }
            >
              {inQueue ? <Check className="h-3.5 w-3.5" strokeWidth={2.2} /> : <Plus className="h-3.5 w-3.5" strokeWidth={2} />}
              {inQueue ? 'Na fila do clube' : 'Pôr na fila'}
            </Key>
            {show.trailerUrl ? (
              <a
                href={show.trailerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-cell px-2 py-1.5 font-display text-[12px] uppercase leading-none tracking-[0.12em] text-dye-red-lit transition-colors hover:text-dye-red-glow"
              >
                <Play className="h-3.5 w-3.5 fill-current" strokeWidth={0} aria-hidden />
                Trailer
              </a>
            ) : null}
          </div>
        </div>
      </header>

      {/* ── as temporadas ──────────────────────────────────────────────────
          `null` e não lista vazia quando a série veio do cache: a diferença
          entre "o TMDB não respondeu agora" e "esta série não tem temporada". */}
      {show.seasons === null ? (
        <p className="mt-8 text-[13px] leading-relaxed text-ink-dim">
          O TMDB não respondeu agora, então as temporadas não puderam ser lidas. O que o clube
          já gravou continua no acervo.
        </p>
      ) : show.seasons.length ? (
        <>
          <div className="mt-8 flex flex-wrap items-center gap-2">
            {show.seasons.map(s => (
              <Chip key={s.season} size="sm" on={s.season === season} onClick={() => setSeason(s.season)}>
                {`T${s.season}`}
              </Chip>
            ))}
          </div>

          {!temporada ? (
            <div className="mt-6 flex flex-col gap-2">
              {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[76px] w-full" />)}
            </div>
          ) : (
            <ul className="mt-6 flex flex-col">
              {temporada.episodes.map(ep => (
                <EpisodeRow
                  key={`${ep.season}x${ep.episode}`}
                  ep={ep}
                  takes={porEpisodio.get(`${ep.season}x${ep.episode}`) ?? []}
                  meId={meId}
                  onOpen={() => setAberto(ep)}
                />
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="mt-8 text-[13px] text-ink-dim">Esta série não tem temporadas listadas no TMDB.</p>
      )}

      {aberto ? (
        <EpisodeSheet
          key={`${aberto.season}x${aberto.episode}`}
          showId={show.id}
          showTitle={show.title}
          showPoster={show.poster}
          genre={genero}
          ep={aberto}
          mine={(porEpisodio.get(`${aberto.season}x${aberto.episode}`) ?? []).find(t => t.reviewerId === meId) ?? null}
          criteria={criteria?.[genero] ?? null}
          onClose={() => setAberto(null)}
          onSaved={onSaved}
          fault={fault}
        />
      ) : null}
    </section>
  );
}

/* ── uma linha de episódio ────────────────────────────────────────────────
   O quadro, o número, o título, e o que o clube já disse. A linha inteira abre
   a folha; o que ela mostra sem abrir é o placar. */
function EpisodeRow({
  ep,
  takes,
  meId,
  onOpen,
}: {
  ep: Episode;
  takes: EpisodeTake[];
  meId: string;
  onOpen: () => void;
}) {
  const minha = takes.find(t => t.reviewerId === meId) ?? null;
  const comNota = takes.filter(t => t.final != null);
  const media = comNota.length
    ? comNota.reduce((s, t) => s + (t.final ?? 0), 0) / comNota.length
    : null;

  return (
    <li className="border-t border-white/[0.06] first:border-t-0">
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-center gap-3 rounded-cell px-2 py-3 text-left transition-colors duration-150 hover:bg-beam/[0.05]"
      >
        {/* O quadro do episódio é 16:9 e não um cartaz: é uma cena, não uma
            capa. Sem quadro, uma caixa vazia da mesma medida — o buraco tem de
            ter forma, ou a lista desalinha. */}
        {ep.still ? (
          <img
            src={ep.still}
            alt=""
            loading="lazy"
            className="aspect-video w-[104px] flex-none rounded-cell object-cover ring-1 ring-white/[0.06]"
          />
        ) : (
          <span aria-hidden className="aspect-video w-[104px] flex-none rounded-cell bg-house-deep ring-1 ring-white/[0.06]" />
        )}

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="q text-[11.5px] text-ink-dim">
              T{ep.season}E{String(ep.episode).padStart(2, '0')}
            </span>
            <span className="truncate text-[14px] text-ink transition-colors group-hover:text-beam">
              {ep.title}
            </span>
            {/* O TMDB marca fim de arco e fim de temporada. É informação que o
                clube usaria de cor, e ela vem de graça. */}
            {ep.kind === 'finale' ? (
              <span className="legend flex-none text-[9px] text-dye-brass">Final</span>
            ) : null}
          </span>
          <span className="q mt-1 block text-[11px] text-ink-faint">
            {[ep.airDate ? whenBR(ep.airDate) : null, ep.runtime ? `${ep.runtime} min` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>

        <span className="flex flex-none items-center gap-3">
          {/* O que o clube deu, e o que VOCÊ deu. Os dois calam quando não
              existem: um zero ali seria a tela inventando um veredito. */}
          {media != null ? (
            <span className="hidden flex-col items-end sm:flex">
              <span className="q text-[15px] font-medium text-beam">{fmt(media)}</span>
              <span className="q text-[10px] text-ink-faint">
                {plural(comNota.length, 'nota', 'notas')}
              </span>
            </span>
          ) : null}

          {/* O estado da SUA linha, num símbolo só: visto, nota rápida, ou a
              criteriosa. É o placar do gesto principal desta tela. */}
          <MineMark take={minha} />
        </span>
      </button>
    </li>
  );
}

/** A sua marca no episódio: nada, visto, nota, ou ficha. */
function MineMark({ take }: { take: EpisodeTake | null }) {
  if (!take) {
    return (
      <span
        aria-label="Você ainda não viu"
        title="Você ainda não viu"
        className="flex h-9 w-9 items-center justify-center rounded-cell text-ink-faint ring-1 ring-house-rail"
      >
        <Check className="h-4 w-4" strokeWidth={1.8} />
      </span>
    );
  }
  if (take.final == null) {
    return (
      <span
        aria-label="Visto, sem nota"
        title="Visto, sem nota"
        className="flex h-9 w-9 items-center justify-center rounded-cell bg-dye-brass/10 text-dye-brass ring-1 ring-dye-brass/50"
      >
        <Check className="h-4 w-4" strokeWidth={2.4} />
      </span>
    );
  }
  return (
    <span
      aria-label={`Sua nota: ${fmt(take.final)}${take.scores ? ', criteriosa' : ''}`}
      title={take.scores ? 'Avaliação criteriosa' : 'Sua nota'}
      className={cn(
        'flex h-9 min-w-[38px] items-center justify-center rounded-cell px-1.5 ring-1',
        /* A criteriosa é creme e a rápida é tinta: as duas são notas, e a
           diferença entre elas é quanto se olhou. */
        take.scores
          ? 'bg-beam/10 text-beam ring-beam/45'
          : 'text-ink ring-house-rail'
      )}
    >
      <span className="q text-[14px] font-medium">{fmt(take.final)}</span>
    </span>
  );
}

/** A data de exibição, curta. Um episódio de 2009 não precisa do dia da semana. */
function whenBR(iso: string) {
  const at = new Date(iso + 'T12:00:00');
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ══ a folha do episódio ═══════════════════════════════════════════════════
   Onde os três estados são escritos. Abre no estado em que a linha já está: sem
   ficha, oferece o gesto barato primeiro — visto, e uma nota rápida ao lado.

   A criteriosa é uma segunda porta dentro da mesma folha, e não outra tela: ela
   é a mesma linha com mais dito sobre ela, e mandar a pessoa para outro lugar
   para dizer mais seria a folha desistindo no meio.

   As duas notas se substituem. A rápida não é oferecida por cima de uma
   criteriosa — nove réguas não se perdem num toque distraído. */
function EpisodeSheet({
  showId,
  showTitle,
  showPoster,
  genre,
  ep,
  mine,
  criteria,
  onClose,
  onSaved,
  fault,
}: {
  showId: number;
  showTitle: string;
  showPoster: string | null;
  genre: string;
  ep: Episode;
  mine: EpisodeTake | null;
  criteria: Criterion[] | null;
  onClose: () => void;
  onSaved: () => void;
  fault: (msg: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [detalhe, setDetalhe] = useState<EpisodeDetail | null>(null);
  const [modo, setModo] = useState<'rapida' | 'criteriosa'>(mine?.scores ? 'criteriosa' : 'rapida');
  const [quick, setQuick] = useState<number>(mine?.quick ?? 7);
  const [scores, setScores] = useState<Record<string, number>>(mine?.scores ?? {});
  const [comment, setComment] = useState(mine?.comment ?? '');
  const [salvando, setSalvando] = useState(false);

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

  /* Quem dirigiu e quem escreveu ESTE episódio. É o motivo de a avaliação ser
     por episódio: os nomes mudam a cada um, e o melhor da temporada é com
     frequência o de alguém que dirigiu aquele e mais nenhum. */
  useEffect(() => {
    let vivo = true;
    void seriesApi
      .episode(showId, ep.season, ep.episode)
      .then(r => vivo && setDetalhe(r.episode))
      .catch(() => {
        /* Engolido: a assinatura é um enfeite caro. Sem ela a ficha continua
           inteira, e um erro por causa dela seria o produto reclamando de um
           trabalho que ele mesmo inventou. */
      });
    return () => {
      vivo = false;
    };
  }, [showId, ep.season, ep.episode]);

  const gravar = useCallback(
    async (patch: Partial<TakePatch>) => {
      if (salvando) return;
      setSalvando(true);
      try {
        await showsApi.mark(showId, ep.season, ep.episode, {
          showTitle,
          showPoster,
          episodeTitle: ep.title,
          genre,
          ...patch,
        });
        onSaved();
      } catch (e) {
        fault('Não foi possível gravar: ' + (e as Error).message);
      } finally {
        setSalvando(false);
      }
    },
    [salvando, showId, ep.season, ep.episode, ep.title, showTitle, showPoster, genre, onSaved, fault]
  );

  const desmarcar = useCallback(async () => {
    if (salvando) return;
    setSalvando(true);
    try {
      await showsApi.unmark(showId, ep.season, ep.episode);
      onSaved();
      onClose();
    } catch (e) {
      fault('Não foi possível desmarcar: ' + (e as Error).message);
    } finally {
      setSalvando(false);
    }
  }, [salvando, showId, ep.season, ep.episode, onSaved, onClose, fault]);

  const media = criteria?.length
    ? criteria.reduce((s, c) => s + (scores[c.key] ?? 5), 0) / criteria.length
    : 0;

  return (
    <dialog
      ref={ref}
      aria-label={`${showTitle} — T${ep.season}E${ep.episode}`}
      onClick={e => {
        if (e.target === ref.current) onClose();
      }}
      /* Um rolador só e o fundo sem desfoque — os dois porquês estão em
         components/film.tsx. */
      className="w-full max-w-[760px] max-h-[calc(100dvh/var(--ui-zoom))] overflow-hidden bg-transparent p-2 text-ink backdrop:bg-house-deep/95 open:animate-beam-in sm:p-4"
    >
      <div className="plate relative max-h-[calc(100dvh/var(--ui-zoom)-1rem)] overflow-y-auto overscroll-contain p-5 sm:max-h-[calc(100dvh/var(--ui-zoom)-2rem)] sm:p-6">
        <IconKey aria-label="Fechar" onClick={onClose} className="absolute right-3 top-3 z-10">
          <X className="h-4 w-4" strokeWidth={1.8} />
        </IconKey>

        <p className="legend">
          {showTitle} · T{ep.season}E{String(ep.episode).padStart(2, '0')}
        </p>
        <h2 className="mt-2 pr-10 font-display text-[24px] leading-none tracking-[0.03em] text-beam sm:text-[28px]">
          {ep.title}
        </h2>

        {/* Quem assina, logo abaixo do nome: é o que esta ficha julga. */}
        {detalhe?.crew?.direcao || detalhe?.crew?.roteiro ? (
          <p className="q mt-2 text-[12px] text-beam-dim">
            {[
              detalhe.crew.direcao?.length ? `dir. ${detalhe.crew.direcao.join(', ')}` : null,
              detalhe.crew.roteiro?.length ? `rot. ${detalhe.crew.roteiro.join(', ')}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}

        {ep.overview ? (
          <p className="mt-3 max-w-[66ch] text-[13px] leading-relaxed text-ink-dim">{ep.overview}</p>
        ) : null}

        {/* ── o gesto barato, primeiro ────────────────────────────────────
            Marcar visto é o que mais se faz neste universo, e ele não pode
            estar depois de nove réguas. */}
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-5">
          <Key
            tone={mine ? 'ghost' : 'commit'}
            disabled={salvando}
            onClick={() => (mine ? void desmarcar() : void gravar({}))}
          >
            <Check className="h-4 w-4" strokeWidth={2.2} />
            {mine ? 'Desmarcar' : 'Marcar como visto'}
          </Key>
          {mine ? (
            <span className="q text-[11.5px] text-ink-faint">
              {mine.final == null
                ? 'visto, sem nota'
                : mine.scores
                  ? `criteriosa · ${fmt(mine.final)}`
                  : `nota rápida · ${fmt(mine.final)}`}
            </span>
          ) : null}
        </div>

        {/* ── e a nota ────────────────────────────────────────────────────
            Dois modos, e a criteriosa não é oferecida como "avançado": ela é o
            que este produto faz de diferente, então tem o mesmo peso visual que
            a rápida. O que decide o padrão é o que a pessoa já disse. */}
        <div className="mt-6 border-t border-white/[0.07] pt-5">
          <div className="flex flex-wrap items-center gap-2">
            {/* A rápida não some quando há criteriosa — trocar de ideia é
                legítimo. O aviso do que ela custa está dentro do modo, junto do
                botão que cobra o preço, e não num `title` que só o mouse lê. */}
            <Chip size="sm" on={modo === 'rapida'} onClick={() => setModo('rapida')}>
              Nota rápida
            </Chip>
            <Chip size="sm" on={modo === 'criteriosa'} onClick={() => setModo('criteriosa')}>
              Avaliação criteriosa
            </Chip>
          </div>

          {modo === 'rapida' ? (
            <div className="mt-5">
              <div className="flex items-baseline gap-3">
                <span className="q text-[34px] font-medium leading-none text-beam">{fmt(quick)}</span>
                <span className="q text-[12px] text-ink-faint">/10</span>
              </div>
              {/* A MESMA régua dos critérios, e não um `input` solto: o
                  `film-range` é transparente por desenho, então usá-lo sozinho
                  produzia um controle invisível — funcionava e não tinha corpo. */}
              <Gauge
                value={quick}
                onChange={setQuick}
                label="Nota do episódio"
                className="mt-4"
              />
              {mine?.scores ? (
                <p className="mt-3 text-[12.5px] leading-relaxed text-dye-brass">
                  Você já avaliou este episódio pelos nove critérios. Gravar uma nota rápida
                  substitui aquela ficha.
                </p>
              ) : null}
              <Key
                tone="commit"
                className="mt-5"
                disabled={salvando}
                onClick={() => void gravar({ quick, comment: comment.trim() || null })}
              >
                <Check className="h-4 w-4" strokeWidth={2} />
                {salvando ? 'Gravando…' : 'Gravar a nota'}
              </Key>
            </div>
          ) : !criteria ? (
            <p className="mt-5 text-[13px] text-ink-dim">Carregando os critérios…</p>
          ) : (
            <div className="mt-5">
              {/* As mesmas réguas da ficha de um filme, sobre nove critérios em
                  vez de onze: um episódio não escolhe gênero. */}
              <Channels
                criteria={criteria}
                scores={scores}
                crew={detalhe?.crew}
                /* A folha já entra animada; nove entradas escalonadas por cima
                   dela é o que se sentia como travamento ao abrir. */
                still
                onChange={(key, value) => setScores(s => ({ ...s, [key]: value }))}
              />
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <span className="q text-[28px] font-medium leading-none text-beam">{fmt(media)}</span>
                <span className="q text-[11px] text-ink-faint">
                  média dos {criteria.length} critérios
                </span>
              </div>
              <Key
                tone="commit"
                className="mt-4"
                disabled={salvando}
                onClick={() => {
                  /* O que não foi tocado vale 5, que é o que a régua mostra. Um
                     critério sem resposta seria uma pergunta em branco numa
                     ficha que a pessoa acabou de dizer que preencheu. */
                  const cheio: Record<string, number> = {};
                  for (const c of criteria) cheio[c.key] = scores[c.key] ?? 5;
                  void gravar({ scores: cheio, comment: comment.trim() || null });
                }}
              >
                <Check className="h-4 w-4" strokeWidth={2} />
                {salvando ? 'Gravando…' : 'Gravar a avaliação criteriosa'}
              </Key>
            </div>
          )}

          <label className="mt-5 block">
            <span className="legend mb-1.5 block">O que você achou</span>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Opcional. Fica junto da nota."
              className="w-full resize-y rounded-cell bg-house-deep px-3 py-2.5 text-[14px] text-ink caret-dye-red ring-1 ring-house-rail transition-shadow placeholder:text-ink-dim focus-visible:outline-none focus-visible:ring-dye-brass"
            />
          </label>
        </div>
      </div>
    </dialog>
  );
}

/* ── o acervo de séries ───────────────────────────────────────────────────
   O que o clube gravou, do mais recente para o mais antigo. Uma lista e não uma
   grade: a unidade aqui é o episódio, e um episódio não tem cartaz próprio — o
   que ele tem é a série a que pertence, e vinte cartazes iguais em fila seriam
   a mesma imagem repetida. */
export function SeriesArchiveScreen({
  takes,
  onOpen,
}: {
  takes: EpisodeTake[] | null;
  onOpen: (showId: number) => void;
}) {
  const [query, setQuery] = useState('');

  if (!takes) {
    return (
      <section>
        <Bill title="Avaliados" note="carregando…" />
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-[64px] w-full" />)}
        </div>
      </section>
    );
  }

  const q = query.trim().toLowerCase();
  const vistos = q
    ? takes.filter(
        t =>
          t.showTitle.toLowerCase().includes(q) ||
          (t.episodeTitle ?? '').toLowerCase().includes(q) ||
          (t.reviewerName ?? '').toLowerCase().includes(q)
      )
    : takes;

  /* Só o que tem nota conta como avaliação: o resto é o que o clube viu, e
     misturar os dois num contador faria o número medir o gesto mais barato. */
  const comNota = takes.filter(t => t.final != null).length;

  if (!takes.length) {
    return (
      <section>
        <Bill title="Avaliados" />
        <Blank title="Nenhum episódio marcado ainda">
          Abra uma série, marque um episódio como visto, e a partir daí ele pode receber a nota
          rápida ou a avaliação criteriosa.
        </Blank>
      </section>
    );
  }

  return (
    <section>
      <Bill
        title="Avaliados"
        note={`${plural(takes.length, 'episódio visto', 'episódios vistos')} · ${plural(comNota, 'com nota', 'com nota')}`}
      />

      <div className="mb-5 max-w-[440px]">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Buscar por série, episódio ou pessoa…"
        />
      </div>

      {!vistos.length ? (
        <Blank title="Nada com esse nome">Limpe o campo para ver o registro inteiro.</Blank>
      ) : (
        <ul className="flex flex-col">
          {vistos.map(t => (
            <li key={t.id} className="border-t border-white/[0.06] first:border-t-0">
              <button
                type="button"
                onClick={() => onOpen(t.showId)}
                className="group flex w-full items-center gap-3 rounded-cell px-2 py-3 text-left transition-colors hover:bg-beam/[0.05]"
              >
                <Poster src={t.showPoster} className="h-[52px] w-[35px] flex-none" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink transition-colors group-hover:text-beam">
                    {t.showTitle}
                  </span>
                  <span className="q block truncate text-[11px] text-ink-dim">
                    T{t.season}E{String(t.episode).padStart(2, '0')}
                    {t.episodeTitle ? ` · ${t.episodeTitle}` : ''}
                    {t.reviewerName ? ` · ${t.reviewerName}` : ''}
                  </span>
                </span>
                <MineMark take={t} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

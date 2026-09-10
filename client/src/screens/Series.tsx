import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  Layers,
  MessageSquare,
  Plus,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import { CardBody, CardContainer, CardItem } from '@/components/ui/3d-card-effect';
import {
  Bill,
  Blank,
  Chip,
  Drawer,
  Fault,
  IconKey,
  Key,
  Poster,
  Reel,
  ReelPicker,
  SearchField,
  Skeleton,
  Strip,
  TrailerKey,
} from '@/components/bits';
import { Channels, Gauge } from '@/components/channels';
/* A fileira de marcas do cartão de filme, e não uma cópia dela: é a mesma
   resposta à mesma pergunta, e duas cópias divergiriam na terceira mexida. */
import { OnCell, WatchOn } from '@/components/film';
/* As mesmas peças do universo de filmes: o voto na ficha, a conversa, o
   detalhamento dos critérios, o retrato clicável. Elas leem a sala pelo
   `useWorld`, e a raiz de séries entrega uma — ver lib/world.tsx. */
import { Conversation, TakeVotes } from '@/components/social';
import { Breakdown } from '@/components/take';
import { PersonName, PersonReel } from '@/components/person';
import {
  fmt,
  initialsOf,
  lobby as lobbyApi,
  reelColor,
  seriesApi,
  /* Renomeado porque `shows` também é o nome da fila numa das telas daqui, e
     duas coisas com o mesmo nome no mesmo arquivo é uma delas sendo lida como a
     outra em algum momento. */
  shows as showsApi,
  type Criterion,
  type Episode,
  type EpisodeDetail,
  type EpisodeTake,
  type LobbyTake,
  type QueuedShow,
  type Reviewer,
  type SeasonDetail,
  type SeriesItem,
  type ShowDetail,
  type ShowFeedEvent,
  showsSocial,
  type TakePatch,
} from '@/lib/api';
import { useLive } from '@/lib/live';
import { cn, clockOf, dayOf, plural, whenOf } from '@/lib/utils';
import { useWorld } from '@/lib/world';
import { SuggestionsKey } from '@/screens/Reels';
import type { TabId } from '@/App';

/* ══════════════════════════════════════════════════════════════════════════
   O UNIVERSO DE SÉRIES, DENTRO DE UM CLUBE.

   O de filmes gira em torno de uma noite; este gira em torno de SEMANAS, e a
   unidade deixa de ser a obra e passa a ser o episódio. Isso muda o gesto
   principal: lá é avaliar, aqui é MARCAR — dizer "vi esse" —, e avaliar é o que
   se faz por cima disso quando o episódio mereceu. Por isso a lista de
   episódios é a tela central, e marcar é um toque enquanto a ficha criteriosa é
   uma folha que se abre.

   Os três estados de uma linha (visto / nota rápida / criteriosa) são um só
   registro no banco, e a tela desenha os três com a mesma peça. */

/* ── o catálogo ───────────────────────────────────────────────────────────
   Irmão do catálogo de filmes: populares do TMDB, busca, filtro por gênero. O
   que muda é o destino do clique — aqui um cartaz abre a SÉRIE, com as
   temporadas e os episódios, e não uma folha de leitura. */
export function SeriesCatalogScreen({
  queued,
  onQueue,
  onOpen,
  onTab,
  fault,
}: {
  queued: Set<number>;
  onQueue: (s: SeriesItem) => void;
  onOpen: (showId: number) => void;
  /** A casca de séries não tem contexto: a troca de seção chega por aqui. */
  onTab: (t: TabId) => void;
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

      {/* A mesma linha do catálogo de filmes: quem sabe o nome escreve, quem
          não sabe pede que sugiram. */}
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <div className="min-w-[240px] max-w-[440px] flex-1">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Buscar uma série…"
            hint={busca ? 'busca no TMDB, não no que o clube já viu' : undefined}
          />
        </div>
        <SuggestionsKey onOpen={() => onTab('sugestoes')} />
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

/* ── o cartaz de uma série ────────────────────────────────────────────────
   A MESMA peça do catálogo de filmes, e não uma parecida: um catálogo com duas
   físicas diferentes é o app dizendo que são dois apps.

   A tarja que sobe muda de texto porque o destino é outro — num filme abre a
   folha de leitura, aqui abrem as temporadas. Prometer "sinopse e trailer" e
   entregar uma lista de episódios seria a tarja mentindo pela metade.

   Os controles moram na fileira de baixo e não sobre o cartaz: era um `+`
   flutuando no canto do pôster, brigando com as camadas em relevo e com a
   tarja.

   Sem ponteiro fino, `CardContainer` não constrói nada — nem perspectiva, nem
   contexto 3D, nem manipuladores. */
function SeriesCell({
  show,
  inQueue,
  seen,
  average,
  onOpen,
  onQueue,
  onRemove,
}: {
  show: SeriesItem;
  inQueue?: boolean;
  /** O progresso do clube, quando esta célula está na lista de acompanhadas. */
  seen?: string | null;
  average?: number | null;
  onOpen: () => void;
  onQueue?: () => void;
  onRemove?: () => void;
}) {
  return (
    <CardContainer containerClassName="block h-full w-full" className="h-full w-full">
      <CardBody className="flex h-full w-full flex-col">
        <CardItem translateZ={60} className="w-full">
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Ver as temporadas de ${show.title}`}
            className="group/cell block w-full text-left"
          >
            {/* A tarja está escondida por um translate, então precisa de uma
                caixa posicionada que a corte — senão ela resolve contra um
                ancestral distante e fica permanentemente sobre o título. */}
            <span className="relative block overflow-hidden rounded-cell">
              <Poster src={show.poster} alt={`Pôster de ${show.title}`} className="aspect-[2/3] w-full" />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 flex translate-y-full items-center justify-center gap-1.5 bg-beam px-2 py-2 font-display text-[11px] uppercase tracking-[0.14em] text-house-deep transition-transform duration-200 ease-beam group-hover/cell:translate-y-0 group-focus-visible/cell:translate-y-0 motion-reduce:transition-none">
                <Layers className="h-3.5 w-3.5" strokeWidth={2} />
                Temporadas
              </span>
            </span>
          </button>
        </CardItem>

        <CardItem translateZ={30} className="mt-3 w-full">
          <h3 className="text-[14px] font-semibold leading-tight text-ink">{show.title}</h3>
          {show.original ? (
            <p className="q mt-0.5 truncate text-[11px] text-ink-faint" title={show.original}>
              {show.original}
            </p>
          ) : null}
          <p className="q mt-0.5 text-[11.5px] text-ink-dim">
            {show.year ?? '—'} · {show.genre}
          </p>
          {/* As mesmas marcas do cartão de filme, e aqui elas decidem mais: um
              filme quase sempre dá para alugar, uma série o clube ou tem numa
              assinatura ou não maratona. Ficam acima do progresso porque a
              pergunta "dá para ver?" vem antes de "onde a gente parou?". */}
          <OnCell watch={show.watch} title={show.title} />
          {/* O progresso do clube, e a média só quando existe: um clube que
              acompanha sem avaliar não tem nota, e imprimir 0,0 ali seria a tela
              inventando um veredito. */}
          {seen ? (
            <div className="mt-2 flex items-center gap-2">
              {average != null ? (
                <>
                  <Strip value={average} cells={10} className="h-[5px] flex-1" />
                  <span className="q text-[11.5px] text-beam">{fmt(average)}</span>
                </>
              ) : (
                <span className="q flex-1 text-[11.5px] text-ink-dim">sem nota ainda</span>
              )}
            </div>
          ) : null}
          {seen ? <p className="q mt-1 text-[11px] text-ink-faint">{seen}</p> : null}
        </CardItem>

        {/* A chave repete o destino do cartaz, e isso não é redundância: a tarja
            que anuncia esse destino é de HOVER, e no dedo ela não existe. Sem a
            palavra escrita aqui, um cartaz no telefone não diz o que faz. */}
        <CardItem translateZ={18} className="mt-auto flex w-full items-center gap-2 pt-3">
          <Key tone="flush" className="flex-1 px-2" onClick={onOpen}>
            Episódios
          </Key>
          {onQueue ? (
            <IconKey
              active={inQueue}
              aria-pressed={inQueue}
              aria-label={inQueue ? `${show.title} já está na lista` : `Acompanhar ${show.title}`}
              onClick={onQueue}
            >
              <Bookmark
                className="h-4 w-4"
                fill={inQueue ? 'currentColor' : 'none'}
                strokeWidth={1.7}
              />
            </IconKey>
          ) : null}
          {onRemove ? (
            <IconKey aria-label={`Tirar ${show.title} da lista`} onClick={onRemove}>
              <Trash2 className="h-4 w-4" strokeWidth={1.7} />
            </IconKey>
          ) : null}
        </CardItem>
      </CardBody>
    </CardContainer>
  );
}

/** O balde de quem não tem dono registrado. Nunca é um id de gente. */
const NINGUEM = '\0sem-dono';

/* ── a fila do clube ──────────────────────────────────────────────────────
   O que a sala combinou de acompanhar. Cada linha carrega o progresso DO CLUBE
   — episódios distintos vistos, não linhas —, porque quem abre esta tela está
   perguntando onde a sala está, e não onde ela mesma está. */
export function SeriesQueueScreen({
  shows,
  roster,
  onOpen,
  onRemove,
}: {
  shows: QueuedShow[] | null;
  /** Quem está no clube, para a tira de quem escolheu. */
  roster: Reviewer[];
  onOpen: (showId: number) => void;
  onRemove: (showId: number) => void;
}) {
  /** Qual pessoa a grade está mostrando, ou null para a fila inteira. */
  const [quem, setQuem] = useState<string | null>(null);

  /* A MESMA tira da fila de filmes, contada da própria fila e não do clube
     inteiro: seis retratos em que quatro levam a uma grade vazia é uma tira que
     promete o que não tem.

     Um `addedBy` pode apontar para quem já saiu do clube — a coluna não tem
     chave estrangeira —, e isso cai no mesmo balde de quem nunca teve dono. */
  const { donos, orfas } = useMemo(() => {
    const conta = new Map<string, number>();
    for (const s of shows ?? []) {
      const dono = s.addedBy && roster.some(p => p.id === s.addedBy) ? s.addedBy : NINGUEM;
      conta.set(dono, (conta.get(dono) ?? 0) + 1);
    }
    return {
      donos: roster
        .map(p => ({ ...p, count: conta.get(p.id) ?? 0 }))
        .filter(p => p.count > 0),
      orfas: conta.get(NINGUEM) ?? 0,
    };
  }, [shows, roster]);

  /* Quem sai do clube, ou tem a última série tirada da fila, não pode deixar a
     grade vazia e sem explicação: o filtro cai sozinho para a fila inteira. */
  if (quem && quem !== NINGUEM && !donos.some(d => d.id === quem)) setQuem(null);
  if (quem === NINGUEM && !orfas) setQuem(null);

  const naTela = (shows ?? []).filter(s => {
    if (!quem) return true;
    const dono = s.addedBy && roster.some(p => p.id === s.addedBy) ? s.addedBy : NINGUEM;
    return dono === quem;
  });

  if (!shows) {
    return (
      <section>
        <Bill title="Minhas séries" note="carregando…" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2].map(i => <Skeleton key={i} className="aspect-[2/3] w-full" />)}
        </div>
      </section>
    );
  }

  if (!shows.length) {
    return (
      <section>
        <Bill title="Minhas séries" />
        <Blank title="O clube ainda não acompanha nenhuma série">
          Ache uma no catálogo e marque para acompanhar. O que o clube combinar de ver aparece
          aqui, com o quanto já foi visto.
        </Blank>
      </section>
    );
  }

  return (
    <section>
      <Bill
        title="Minhas séries"
        note={
          quem
            ? `${naTela.length} de ${plural(shows.length, 'série', 'séries')}`
            : `${plural(shows.length, 'série', 'séries')} que o clube acompanha`
        }
      />

      {/* ── a chave de quem escolheu ─────────────────────────────────────
          A mesma da fila de filmes, pela mesma razão: numa sala de seis, a
          primeira pergunta feita a uma lista comum é de quem é cada coisa.

          "Todos" primeiro: um filtro sem a porta de volta em cima é um filtro
          em que dá para ficar preso.

          E aparece com UMA pessoa também. A chave não é só o filtro: é onde se
          lê de quem é a lista, e numa sala que está começando "isto aqui é
          tudo seu" é uma resposta. Escondê-la até chegar a segunda pessoa faz
          o recurso nascer invisível justamente para quem montou a sala — e ele
          apareceria sozinho, num dia qualquer, sem ninguém ter pedido. */}
      {donos.length || orfas ? (
        <div className="mb-5">
          <ReelPicker
            title="Quem pôs na lista"
            value={quem}
            onPick={setQuem}
            choices={[
              { id: null, label: 'Todos', count: shows.length, hint: 'Ver a lista inteira' },
              ...donos.map(d => ({
                id: d.id,
                label: d.name,
                count: d.count,
                hint: `Ver só o que ${d.name} pôs na lista`,
                reel: (
                  <Reel color={reelColor(d.dot, d.id)} src={d.avatar ?? null} size="md">
                    {initialsOf(d.name)}
                  </Reel>
                ),
              })),
              /* Só aparece quando existe: as séries postas antes de a coluna
                 existir, e as de quem saiu do clube. */
              ...(orfas
                ? [
                    {
                      id: NINGUEM,
                      label: 'Sem registro',
                      count: orfas,
                      hint: 'Ver só o que a lista não sabe de quem é',
                    },
                  ]
                : []),
            ]}
          />
        </div>
      ) : null}

      {!naTela.length ? (
        <Blank title="Nada nesta lista por essa pessoa">
          Escolha <span className="text-ink">Todos</span> para ver o que o clube inteiro acompanha.
        </Blank>
      ) : null}

      {/* A MESMA célula do catálogo, com a tesoura no lugar do marcador. É o que
          o universo de filmes já faz — a fila e o catálogo desenham o mesmo
          `FilmCell` —, e duas células parecidas para a mesma coisa divergem na
          terceira mexida. */}
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {naTela.map(s => (
          <li key={s.id}>
            <SeriesCell
              show={{
                id: s.id,
                title: s.title,
                original: s.original,
                year: s.year,
                genre: s.genre,
                genres: [s.genre],
                poster: s.poster,
                crowd: null,
                watch: s.watch,
              }}
              seen={
                s.totalEpisodes ? `${s.seen}/${s.totalEpisodes} vistos` : `${s.seen} vistos`
              }
              average={s.average}
              onOpen={() => onOpen(s.id)}
              onRemove={() => onRemove(s.id)}
            />
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

  /** O que VOCÊ já viu, para a chave de marcar a temporada saber o que falta. */
  const meusVistos = useMemo(
    () =>
      new Set(
        takes.filter(t => t.reviewerId === meId).map(t => `${t.season}x${t.episode}`)
      ),
    [takes, meId]
  );

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
              {inQueue ? 'O clube acompanha' : 'Acompanhar'}
            </Key>
            {show.trailerUrl ? (
              <TrailerKey
                url={show.trailerUrl}
                title={show.title}
                className="rounded-cell px-2 py-1.5 tracking-[0.12em]"
              >
                Trailer
              </TrailerKey>
            ) : null}
          </div>

          {/* O mesmo bloco da folha de projeção de um filme, e a pergunta que
              esta tela mais provoca: o cartão da grade já traz as marcas, e a
              ficha aberta — onde se decide começar vinte horas — não trazia
              nada. Numa série a resposta vale mais: ou está numa assinatura que
              alguém já paga, ou o clube não maratona. */}
          <WatchOn watch={show.watch} title={show.title} />
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
            {/* Na ponta da fileira de temporadas porque é sobre a que está
                aberta, e não sobre a série. */}
            {temporada ? (
              <MarkSeason
                episodes={temporada.episodes}
                mine={meusVistos}
                showId={show.id}
                showTitle={show.title}
                showPoster={show.poster}
                genre={genero}
                onSaved={onSaved}
                fault={fault}
              />
            ) : null}
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
                  showId={show.id}
                  showTitle={show.title}
                  showPoster={show.poster}
                  genre={genero}
                  onOpen={() => setAberto(ep)}
                  onSaved={onSaved}
                  fault={fault}
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
          /* A folha recebe TODAS as fichas do episódio, e não só a sua: ela
             mostra o que o clube achou logo abaixo do que você achou, e
             descobrir isso pedia sair da folha antes. */
          takes={porEpisodio.get(`${aberto.season}x${aberto.episode}`) ?? []}
          meId={meId}
          criteria={criteria?.[genero] ?? null}
          onClose={() => setAberto(null)}
          onSaved={onSaved}
          fault={fault}
        />
      ) : null}
    </section>
  );
}

/* ── a temporada inteira, de uma vez ──────────────────────────────────────
   Quem chega a uma série no meio já viu as três primeiras temporadas, e marcar
   isso eram trinta cliques — o suficiente para ninguém marcar nada, e um
   progresso do clube que mente para baixo.

   Só o que FALTA, nunca o que já está marcado: uma linha já gravada carrega a
   nota de quem a gravou, e reescrevê-la seria uma marcação em massa apagando
   uma avaliação que ninguém mandou apagar.

   E nunca o que ainda não foi ao ar. Uma série em exibição lista o resto da
   temporada com data futura, e "marcar tudo" ali dentro marcaria como visto o
   que não existe.

   Só marca. Desmarcar em massa apagaria fichas com nota dentro, e o caminho de
   desfazer continua sendo a linha, uma a uma, que já pergunta antes de levar
   uma nota junto. */
const LANES_MARCAR = 4;

function MarkSeason({
  episodes,
  mine,
  showId,
  showTitle,
  showPoster,
  genre,
  onSaved,
  fault,
}: {
  episodes: Episode[];
  /** `${season}x${episode}` do que você já viu. */
  mine: Set<string>;
  showId: number;
  showTitle: string;
  showPoster: string | null;
  genre: string;
  onSaved: () => void;
  fault: (msg: string) => void;
}) {
  const [marcando, setMarcando] = useState(false);

  const hoje = new Date().toISOString().slice(0, 10);
  const faltando = episodes.filter(
    e => !mine.has(`${e.season}x${e.episode}`) && (!e.airDate || e.airDate <= hoje)
  );

  /* Sem nada a fazer, nenhuma chave: uma temporada inteira marcada não precisa
     de um botão desabilitado dizendo isso — a fileira de checks já diz. */
  if (!faltando.length) return null;

  const marcar = async () => {
    if (marcando) return;
    if (
      !confirm(
        `Marcar ${plural(faltando.length, 'episódio', 'episódios')} desta temporada como assistido?`
      )
    ) {
      return;
    }
    setMarcando(true);
    const fila = [...faltando];
    let falhou = 0;
    try {
      await Promise.all(
        Array.from({ length: Math.min(LANES_MARCAR, fila.length) }, async () => {
          while (fila.length) {
            const ep = fila.shift()!;
            try {
              await showsApi.mark(showId, ep.season, ep.episode, {
                showTitle,
                showPoster,
                episodeTitle: ep.title,
                genre,
              });
            } catch {
              /* Contado e seguido: um episódio que não gravou não pode custar os
                 outros dezenove, e a releitura no fim diz a verdade sobre todos. */
              falhou += 1;
            }
          }
        })
      );
    } finally {
      setMarcando(false);
      // Uma releitura só, e no fim: uma por episódio seriam vinte recargas do
      // acervo inteiro para desenhar a mesma lista.
      onSaved();
      if (falhou) fault(`${plural(falhou, 'episódio ficou', 'episódios ficaram')} sem marcar.`);
    }
  };

  return (
    <Key tone="flush" disabled={marcando} onClick={() => void marcar()} className="ml-1 px-3 py-1.5">
      <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
      {marcando ? 'Marcando…' : `Marcar ${faltando.length}`}
    </Key>
  );
}

/* A linha tem dois gestos, de tamanhos diferentes. **Marcar que viu** é o de
   toda semana, e por isso o check é o próprio controle: clicar marca, clicar de
   novo desmarca, e nada abre. Ele era um símbolo do estado — parecia um check e
   não era —, e mudar de estado obrigava a abrir a folha e achar um botão lá
   dentro.

   **Avaliar** é o gesto raro, e é um botão com nome ao lado do check. */
function EpisodeRow({
  ep,
  takes,
  meId,
  showId,
  showTitle,
  showPoster,
  genre,
  onOpen,
  onSaved,
  fault,
}: {
  ep: Episode;
  takes: EpisodeTake[];
  meId: string;
  showId: number;
  showTitle: string;
  showPoster: string | null;
  genre: string;
  onOpen: () => void;
  onSaved: () => void;
  fault: (msg: string) => void;
}) {
  const minha = takes.find(t => t.reviewerId === meId) ?? null;
  const comNota = takes.filter(t => t.final != null);
  const media = comNota.length
    ? comNota.reduce((s, t) => s + (t.final ?? 0), 0) / comNota.length
    : null;

  const [salvando, setSalvando] = useState(false);
  /* O check responde ao toque e não à volta da rede: gravar recarrega o acervo
     inteiro, e esperar por ele deixava o gesto mais barato do produto com meio
     segundo de silêncio depois do clique. O palpite cai sozinho quando a ficha
     volta do servidor — ou na hora, se ela não voltar. */
  const [otimista, setOtimista] = useState<boolean | null>(null);
  useEffect(() => {
    setOtimista(null);
  }, [minha]);
  const visto = otimista ?? minha != null;

  const alternar = useCallback(async () => {
    if (salvando) return;
    const marcar = minha == null;
    /* Desmarcar apaga a linha, e a linha é onde a nota mora. Um toque distraído
       não leva uma ficha criteriosa junto sem perguntar. */
    if (
      !marcar &&
      minha?.final != null &&
      !confirm(
        `Desmarcar T${ep.season}E${ep.episode} apaga também a sua nota deste episódio. Continuar?`
      )
    ) {
      return;
    }
    setSalvando(true);
    setOtimista(marcar);
    try {
      if (marcar) {
        await showsApi.mark(showId, ep.season, ep.episode, {
          showTitle,
          showPoster,
          episodeTitle: ep.title,
          genre,
        });
      } else {
        await showsApi.unmark(showId, ep.season, ep.episode);
      }
      onSaved();
    } catch (e) {
      setOtimista(null);
      fault(
        (marcar ? 'Não foi possível marcar: ' : 'Não foi possível desmarcar: ') +
          (e as Error).message
      );
    } finally {
      setSalvando(false);
    }
  }, [
    salvando,
    minha,
    showId,
    ep.season,
    ep.episode,
    ep.title,
    showTitle,
    showPoster,
    genre,
    onSaved,
    fault,
  ]);

  return (
    <li className="border-t border-white/[0.06] first:border-t-0">
      {/* O contêiner não é mais um botão: dentro dele há três alvos com três
          destinos, e um botão dentro de outro é HTML inválido antes de ser
          confuso. O realce de linha continua, agora no grupo. */}
      <div className="group flex w-full items-center gap-3 rounded-cell px-2 py-3 transition-colors duration-150 hover:bg-beam/[0.05]">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
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
        </button>

        <div className="flex flex-none items-center gap-2 sm:gap-3">
          {/* O que o clube deu. Cala quando não existe: um zero ali seria a tela
              inventando um veredito. */}
          {media != null ? (
            <span className="hidden flex-col items-end sm:flex">
              <span className="q text-[15px] font-medium text-beam">{fmt(media)}</span>
              <span className="q text-[10px] text-ink-faint">
                {plural(comNota.length, 'nota', 'notas')}
              </span>
            </span>
          ) : null}

          {/* A SUA nota, quando existe. Não é mais o mesmo lugar do check: um
              número não se clica para virar um check. */}
          {minha?.final != null ? <MineNote take={minha} /> : null}

          <SeenCheck on={visto} busy={salvando} onToggle={() => void alternar()} />

          {/* Avaliar tem nome inteiro onde cabe, e no telefone é a estrela: o
              check ao lado dele já é o gesto comum, e dois botões escritos em
              caixa alta numa linha de 360px empurravam o título do episódio
              para fora. */}
          <Key
            tone="flush"
            onClick={onOpen}
            aria-label={minha?.final != null ? 'Mudar sua nota' : 'Avaliar este episódio'}
            className="h-9 px-2.5 py-0 text-[10.5px] tracking-[0.1em] coarse:h-11 coarse:px-3 coarse:text-[11px]"
          >
            <Star className="h-3.5 w-3.5 sm:hidden" strokeWidth={1.8} aria-hidden />
            <span className="hidden sm:inline">Avaliar</span>
          </Key>
        </div>
      </div>
    </li>
  );
}

/* ── o check ──────────────────────────────────────────────────────────────
   Um alternador, e ele diz isso antes de ser tocado: apagado tem a moldura de
   uma caixa vazia e o V só insinuado, e aceso é o latão que carrega estado no
   resto do produto. Sem os dois desenhos, "marcado" e "não marcado" seriam a
   mesma caixa com o mesmo V dentro — que era exatamente o problema. */
function SeenCheck({ on, busy, onToggle }: { on: boolean; busy: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={on ? 'Visto — clique para desmarcar' : 'Marcar como visto'}
      title={on ? 'Visto — clique para desmarcar' : 'Marcar como visto'}
      disabled={busy}
      onClick={onToggle}
      className={cn(
        'flex h-9 w-9 flex-none items-center justify-center rounded-cell ring-1',
        'coarse:h-11 coarse:w-11',
        'transition-[background-color,color,box-shadow] duration-150 active:translate-y-px',
        'disabled:cursor-not-allowed disabled:opacity-50',
        on
          ? 'bg-dye-brass/15 text-dye-brass ring-dye-brass/60 shadow-[inset_0_0_14px_rgba(217,164,65,0.20)]'
          : 'text-ink-faint/45 ring-house-rail hover:bg-beam/[0.06] hover:text-beam hover:ring-beam/50'
      )}
    >
      <Check className="h-4 w-4" strokeWidth={on ? 2.6 : 1.8} />
    </button>
  );
}

/** A sua nota no episódio, quando você deu uma. */
function MineNote({ take }: { take: EpisodeTake }) {
  return (
    <span
      aria-label={`Sua nota: ${fmt(take.final ?? 0)}${take.scores ? ', criteriosa' : ''}`}
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
      <span className="q text-[14px] font-medium">{fmt(take.final ?? 0)}</span>
    </span>
  );
}

/** A data de exibição, curta. Um episódio de 2009 não precisa do dia da semana. */
function whenBR(iso: string) {
  const at = new Date(iso + 'T12:00:00');
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* Abre no estado em que a linha já está: sem ficha, oferece o gesto barato
   primeiro — visto, e uma nota rápida ao lado.

   A criteriosa é uma segunda porta dentro da MESMA folha: ela é a mesma linha
   com mais dito sobre ela, e mandar a pessoa para outra tela para dizer mais
   seria a folha desistindo no meio. As duas notas se substituem, e a rápida não
   é oferecida por cima de uma criteriosa. */
export function EpisodeSheet({
  showId,
  showTitle,
  showPoster,
  genre,
  ep,
  takes,
  meId,
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
  /** Todas as fichas do clube neste episódio, a sua inclusive. */
  takes: EpisodeTake[];
  meId: string;
  criteria: Criterion[] | null;
  onClose: () => void;
  onSaved: () => void;
  fault: (msg: string) => void;
}) {
  const mine = takes.find(t => t.reviewerId === meId) ?? null;
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
          {ep.title || detalhe?.title}
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

        {/* Do episódio que a lista já tinha, ou do detalhe quando ele chega: a
            sessão abre esta folha sabendo só a tripla e o nome, e uma sinopse
            que aparece um instante depois é melhor do que nenhuma. */}
        {ep.overview || detalhe?.overview ? (
          <p className="mt-3 max-w-[66ch] text-[13px] leading-relaxed text-ink-dim">
            {ep.overview || detalhe?.overview}
          </p>
        ) : null}

        {/* ── a nota ──────────────────────────────────────────────────────
            E só a nota: marcar e desmarcar são o check da linha, e repetir o
            gesto aqui dentro era o mesmo estado com dois donos — a folha tinha
            de ser aberta para desfazer o que um toque na lista já desfaz.

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

        <EpisodeVoices
          showId={showId}
          season={ep.season}
          episode={ep.episode}
          takes={takes}
          meId={meId}
        />
      </div>
    </dialog>
  );
}

/* Duas perguntas com uma chave entre elas.

   **Clube** sai de graça: o acervo inteiro já está em memória desde o boot, e a
   folha recebeu as fichas por prop. **Todas** é a rede, e custa uma chamada —
   que é justamente por que não é o padrão; ela também obedece as paredes.

   Ordenada por credibilidade do lado da rede, como todo ranking dali. Do lado
   do clube a ordem é a nota: numa sala de seis, credibilidade não separa
   ninguém e a pergunta real é quem gostou mais. */
function EpisodeVoices({
  showId,
  season,
  episode,
  takes,
  meId,
}: {
  showId: number;
  season: number;
  episode: number;
  takes: EpisodeTake[];
  meId: string;
}) {
  const [alcance, setAlcance] = useState<'clube' | 'todas'>('clube');
  const [rede, setRede] = useState<{ takes: LobbyTake[]; average: number | null; count: number; clubs: number } | null>(null);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    if (alcance !== 'todas' || rede) return;
    let vivo = true;
    setBuscando(true);
    void lobbyApi
      .episode(showId, season, episode)
      .then(r => vivo && setRede(r))
      .catch(() => vivo && setRede({ takes: [], average: null, count: 0, clubs: 0 }))
      .finally(() => vivo && setBuscando(false));
    return () => {
      vivo = false;
    };
  }, [alcance, rede, showId, season, episode]);

  const doClube = [...takes]
    .filter(t => t.final != null)
    .sort((a, b) => (b.final ?? 0) - (a.final ?? 0));

  const media = doClube.length
    ? doClube.reduce((s, t) => s + (t.final ?? 0), 0) / doClube.length
    : null;

  return (
    <section className="mt-6 border-t border-white/[0.07] pt-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="legend mr-1">O que acharam</span>
        <Chip size="sm" on={alcance === 'clube'} onClick={() => setAlcance('clube')}>
          Clube
        </Chip>
        <Chip size="sm" on={alcance === 'todas'} onClick={() => setAlcance('todas')}>
          Todas
        </Chip>
        {(alcance === 'clube' ? media : rede?.average) != null ? (
          <span className="q ml-auto text-[13px] text-beam">
            {fmt((alcance === 'clube' ? media : rede?.average) as number)}
            <span className="text-ink-faint"> /10</span>
          </span>
        ) : null}
      </div>

      {alcance === 'clube' ? (
        !doClube.length ? (
          <p className="mt-4 text-[13px] leading-relaxed text-ink-dim">
            Ninguém do clube avaliou este episódio ainda.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {doClube.map(t => (
              <li key={t.id} className="flex items-baseline gap-2.5">
                <span
                  className={cn(
                    'font-display text-[13px] uppercase tracking-[0.1em]',
                    t.reviewerId === meId ? 'text-dye-brass' : 'text-ink'
                  )}
                >
                  {t.reviewerId === meId ? 'você' : t.reviewerName}
                </span>
                {/* A criteriosa se anuncia: as duas são notas, e a diferença
                    entre elas é quanto se olhou. */}
                {t.scores ? (
                  <span className="legend text-[9px] text-beam-dim">criteriosa</span>
                ) : null}
                <span className="q ml-auto text-[14px] text-beam">{fmt(t.final ?? 0)}</span>
              </li>
            ))}
            {doClube.map(t =>
              t.comment ? (
                <li key={`${t.id}-txt`} className="-mt-1 break-words text-[12.5px] italic leading-relaxed text-ink-dim">
                  “{t.comment}” — {t.reviewerId === meId ? 'você' : t.reviewerName}
                </li>
              ) : null
            )}
          </ul>
        )
      ) : buscando ? (
        <p className="mt-4 text-[13px] text-ink-dim">Perguntando à rede…</p>
      ) : !rede?.takes.length ? (
        <p className="mt-4 text-[13px] leading-relaxed text-ink-dim">
          Nenhum clube que empresta as fichas avaliou este episódio ainda.
        </p>
      ) : (
        <>
          <ul className="mt-4 flex flex-col gap-3.5">
            {rede.takes.map(t => (
              <li key={t.id} className="flex gap-2.5">
                <Reel color={reelColor(t.actor.dot, t.actor.id)} src={t.actor.avatar} size="sm">
                  {initialsOf(t.actor.name)}
                </Reel>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-display text-[13px] uppercase tracking-[0.1em] text-ink">
                      {t.actor.name}
                    </span>
                    <span className="font-display text-[10.5px] uppercase tracking-[0.12em] text-dye-brass">
                      {t.club.name}
                    </span>
                    <span className="q ml-auto text-[14px] text-beam">{fmt(t.final)}</span>
                  </span>
                  {t.excerpt ? (
                    <span className="mt-1 block break-words text-[12.5px] italic leading-relaxed text-ink-dim">
                      “{t.excerpt}”
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="q mt-3 text-[10.5px] text-ink-faint">
            {plural(rede.count, 'avaliação', 'avaliações')} em{' '}
            {plural(rede.clubs, 'clube', 'clubes')} · ordenadas por quem mais avalia
          </p>
        </>
      )}
    </section>
  );
}

/* ══ o acervo, na forma da coisa ══════════════════════════════════════════
   O que o clube guarda aqui não é uma pilha de fichas: é uma SÉRIE, feita de
   temporadas, feitas de episódios — e a pergunta "o que a gente achou da
   terceira?" só tem resposta se a tela tiver essa forma.

   Três níveis, dois fechados: uma série de sessenta episódios abriria sessenta
   linhas para responder uma pergunta sobre uma temporada.

   O filtro é por pessoa porque a segunda pergunta do acervo é "o que ELA
   achou". Ele recorta os três níveis de uma vez, e uma série em que ela não
   avaliou nada some em vez de ficar vazia. */
export function SeriesArchiveScreen({
  takes,
  roster,
  onOpen,
}: {
  takes: EpisodeTake[] | null;
  /** Quem está no clube. A ficha traz o nome e a cor, mas não o retrato. */
  roster: Reviewer[];
  onOpen: (showId: number) => void;
}) {
  const [quem, setQuem] = useState<string | null>(null);
  const [abertas, setAbertas] = useState<ReadonlySet<number>>(() => new Set());
  const [temporadas, setTemporadas] = useState<ReadonlySet<string>>(() => new Set());

  /* Quem já marcou alguma coisa, na ordem em que aparece. Contado do próprio
     acervo e não do elenco do clube: uma tira com seis rostos em que quatro
     levam a uma lista vazia é uma tira que promete o que não tem.

     Com quantos episódios cada um, que é o que transforma a tira de seis botões
     iguais numa resposta a "quem está assistindo" antes de qualquer clique. O
     retrato vem do elenco e o resto da própria ficha: quem saiu do clube
     continua assinando o que assinou, e perde só a foto. */
  const gente = useMemo(() => {
    const mapa = new Map<string, { id: string; name: string; dot: string | null; count: number }>();
    for (const t of takes ?? []) {
      const achado = mapa.get(t.reviewerId);
      if (achado) achado.count += 1;
      else if (t.reviewerName)
        mapa.set(t.reviewerId, {
          id: t.reviewerId,
          name: t.reviewerName,
          dot: t.reviewerDot,
          count: 1,
        });
    }
    return [...mapa.values()].map(p => ({
      ...p,
      avatar: roster.find(r => r.id === p.id)?.avatar ?? null,
    }));
  }, [takes, roster]);

  /* Série > temporada > episódio, montado de uma vez. As médias de cada nível
     saem dos MESMOS episódios listados embaixo dele, então nenhuma delas pode
     contradizer o que se vê ao abrir. */
  const arvore = useMemo(() => {
    const vistos = (takes ?? []).filter(t => !quem || t.reviewerId === quem);
    const series = new Map<
      number,
      {
        id: number;
        title: string;
        poster: string | null;
        seasons: Map<number, Map<number, { title: string | null; takes: EpisodeTake[] }>>;
      }
    >();

    for (const t of vistos) {
      let s = series.get(t.showId);
      if (!s) {
        s = { id: t.showId, title: t.showTitle, poster: t.showPoster, seasons: new Map() };
        series.set(t.showId, s);
      }
      let temp = s.seasons.get(t.season);
      if (!temp) {
        temp = new Map();
        s.seasons.set(t.season, temp);
      }
      let ep = temp.get(t.episode);
      if (!ep) {
        ep = { title: t.episodeTitle, takes: [] };
        temp.set(t.episode, ep);
      }
      if (!ep.title && t.episodeTitle) ep.title = t.episodeTitle;
      ep.takes.push(t);
    }

    /* Nulo e não zero quando ninguém deu nota: um episódio visto e não avaliado
       não entra em média nenhuma, e imprimir 0,0 seria inventar um veredito. */
    const medir = (lista: EpisodeTake[]) => {
      const comNota = lista.filter(x => x.final != null);
      return comNota.length
        ? comNota.reduce((acc, x) => acc + (x.final ?? 0), 0) / comNota.length
        : null;
    };

    return [...series.values()]
      .map(s => {
        const seasons = [...s.seasons.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([numero, eps]) => {
            const episodios = [...eps.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([n, ep]) => ({ numero: n, ...ep, average: medir(ep.takes) }));
            return { numero, episodios, average: medir(episodios.flatMap(e => e.takes)) };
          });
        const todos = seasons.flatMap(t => t.episodios.flatMap(e => e.takes));
        return {
          ...s,
          seasons,
          episodes: seasons.reduce((n, t) => n + t.episodios.length, 0),
          average: medir(todos),
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [takes, quem]);

  if (!takes) {
    return (
      <section>
        <Bill title="Avaliados" note="carregando…" />
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="h-[64px] w-full" />
          ))}
        </div>
      </section>
    );
  }

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

  const comNota = takes.filter(t => t.final != null).length;

  return (
    <section>
      <Bill
        title="Avaliados"
        note={`${plural(takes.length, 'episódio visto', 'episódios vistos')} · ${comNota} com nota`}
      />

      {/* ── a chave de quem avaliou ──────────────────────────────────────
          Retrato, nome e quantos, a mesma da fila de filmes. O retrato é o que
          faz uma sala de seis pessoas ser lida sem soletrar nome nenhum, e o
          número é o que dá à lista uma resposta antes do clique — quem está
          assistindo mais.

          "O clube" e não "Todos", porque aqui a soma é uma leitura de verdade:
          a média de uma temporada com o clube inteiro é o veredito da sala.

          Fica de pé com uma pessoa só, e aí as duas linhas mostram a mesma
          lista. Não é redundância à toa: é a sala dizendo que ainda é de um. A
          alternativa era o filtro brotar do nada no dia em que a segunda
          pessoa marcasse um episódio, que é pior — um acervo que muda de forma
          sozinho é um acervo em que não se confia. */}
      {gente.length ? (
        <div className="mb-6">
          <ReelPicker
            title="Quem avaliou"
            value={quem}
            onPick={setQuem}
            choices={[
              {
                id: null,
                label: 'O clube',
                count: takes.length,
                hint: 'Ver o acervo do clube inteiro',
              },
              ...gente.map(p => ({
                id: p.id,
                label: p.name,
                count: p.count,
                hint: `Ver só o que ${p.name} marcou`,
                reel: (
                  <Reel color={reelColor(p.dot, p.id)} src={p.avatar} size="md">
                    {initialsOf(p.name)}
                  </Reel>
                ),
              })),
            ]}
          />
        </div>
      ) : null}

      {!arvore.length ? (
        <Blank title="Nada marcado por essa pessoa ainda">
          Escolha <span className="text-ink">O clube</span> para ver o acervo inteiro.
        </Blank>
      ) : (
        <ul className="flex flex-col">
          {arvore.map(serie => {
            const aberta = abertas.has(serie.id);
            return (
              <li key={serie.id} className="border-t border-white/[0.06] first:border-t-0">
                <div className="flex items-center gap-3 px-2 transition-colors hover:bg-beam/[0.05]">
                  <button
                    type="button"
                    aria-expanded={aberta}
                    onClick={() =>
                      setAbertas(prev => {
                        const next = new Set(prev);
                        if (next.has(serie.id)) next.delete(serie.id);
                        else next.add(serie.id);
                        return next;
                      })
                    }
                    className="group flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
                  >
                    <Poster src={serie.poster} className="h-[52px] w-[35px] flex-none" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] text-ink transition-colors group-hover:text-beam">
                        {serie.title}
                      </span>
                      <span className="q block text-[11px] text-ink-dim">
                        {plural(serie.seasons.length, 'temporada', 'temporadas')} ·{' '}
                        {plural(serie.episodes, 'episódio', 'episódios')}
                      </span>
                    </span>
                    {serie.average != null ? (
                      <span className="q flex-none text-[17px] text-beam">{fmt(serie.average)}</span>
                    ) : null}
                  </button>
                  {/* A porta para a série continua existindo, e fora do botão que
                      desdobra: são duas perguntas na mesma linha, e um controle
                      não se aninha em outro. */}
                  <IconKey aria-label={`Abrir ${serie.title}`} onClick={() => onOpen(serie.id)}>
                    <ChevronLeft className="h-4 w-4 rotate-180" strokeWidth={1.8} />
                  </IconKey>
                </div>

                <Drawer open={aberta}>
                  <ul className="flex flex-col pb-2 pl-6">
                    {serie.seasons.map(temp => {
                      const chave = `${serie.id}x${temp.numero}`;
                      const abertaT = temporadas.has(chave);
                      return (
                        <li key={chave} className="border-t border-white/[0.05]">
                          <button
                            type="button"
                            aria-expanded={abertaT}
                            onClick={() =>
                              setTemporadas(prev => {
                                const next = new Set(prev);
                                if (next.has(chave)) next.delete(chave);
                                else next.add(chave);
                                return next;
                              })
                            }
                            className="group flex w-full items-center gap-3 py-2.5 pr-2 text-left transition-colors hover:bg-beam/[0.04]"
                          >
                            <span className="font-display text-[13px] uppercase tracking-[0.1em] text-ink transition-colors group-hover:text-beam">
                              Temporada {temp.numero}
                            </span>
                            <span className="q text-[11px] text-ink-faint">
                              {plural(temp.episodios.length, 'episódio', 'episódios')}
                            </span>
                            {temp.average != null ? (
                              <span className="q ml-auto text-[14px] text-beam">
                                {fmt(temp.average)}
                              </span>
                            ) : null}
                          </button>

                          <Drawer open={abertaT}>
                            <ul className="flex flex-col pb-2 pl-4">
                              {temp.episodios.map(ep => (
                                <ArchiveEpisode
                                  key={ep.numero}
                                  numero={ep.numero}
                                  title={ep.title}
                                  takes={ep.takes}
                                />
                              ))}
                            </ul>
                          </Drawer>
                        </li>
                      );
                    })}
                  </ul>
                </Drawer>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ── um episódio no acervo ────────────────────────────────────────────────
   Era uma linha morta: número, título, e "Vinicius —" repetido em cada episódio
   marcado sem avaliar. Ela dizia o NOME de quem não tinha dito nada, e não
   dizia nada de quem tinha. Agora são dois desenhos:

   · **quem só viu** aparece como retrato, sem número e sem nome — um traço ao
     lado de um nome fingia que havia uma nota ausente ali.
   · **quem avaliou** vira uma pastilha com a nota, e ela ABRE.

   A pastilha é o gesto, e não a linha inteira: numa sala de seis, abrir "o
   episódio" abriria as seis fichas de uma vez. */
function ArchiveEpisode({
  numero,
  title,
  takes,
}: {
  numero: number;
  title: string | null;
  takes: EpisodeTake[];
}) {
  const world = useWorld();
  /** Qual ficha está aberta. Uma de cada vez: são fichas do MESMO episódio. */
  const [aberta, setAberta] = useState<string | null>(null);
  /* Montada só depois de pedida e nunca desmontada — o mesmo par de gavetas do
     feed: desmontar ao fechar faria a gaveta recolher de altura zero. */
  const [tocada, setTocada] = useState(false);

  const comNota = takes.filter(t => t.final != null);
  const soVistos = takes.filter(t => t.final == null);

  return (
    <li className="border-t border-white/[0.04]">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 py-2 pr-2">
        <span className="q flex-none text-[11px] text-ink-dim">
          E{String(numero).padStart(2, '0')}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
          {title || 'sem título'}
        </span>

        {/* Quem viu e não disse nada. Retratos e mais nada: o nome escrito ao
            lado de um traço era o produto anunciando uma nota que ninguém deu. */}
        {soVistos.length ? (
          <span
            className="flex flex-none items-center gap-1 opacity-60"
            title={`Visto por ${soVistos.map(t => t.reviewerName ?? 'alguém').join(', ')}, sem nota`}
          >
            <Check className="h-3.5 w-3.5 flex-none text-ink-faint" strokeWidth={2} aria-hidden />
            {soVistos.map(t => (
              <Reel key={t.id} color={reelColor(t.reviewerDot, t.reviewerId)} src={world.avatarOf(t.reviewerId)} size="sm">
                {initialsOf(t.reviewerName ?? '?')}
              </Reel>
            ))}
          </span>
        ) : null}

        {/* E quem avaliou. A divergência é o assunto deste produto, então é
            uma pastilha por pessoa e não uma média. */}
        {comNota.map(t => {
          const on = aberta === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-expanded={on}
              aria-label={`${on ? 'Fechar' : 'Abrir'} a ficha de ${t.reviewerName ?? 'alguém'} — nota ${fmt(t.final ?? 0)}`}
              onClick={() => {
                setAberta(v => (v === t.id ? null : t.id));
                setTocada(true);
              }}
              className={cn(
                'flex flex-none items-center gap-1.5 rounded-cell px-1.5 py-1 ring-1 transition-colors duration-150',
                on
                  ? 'text-dye-brass ring-dye-brass/60 shadow-[inset_0_0_14px_rgba(217,164,65,0.18)]'
                  : 'text-ink-dim ring-house-rail hover:text-beam hover:ring-white/25'
              )}
            >
              <Reel color={reelColor(t.reviewerDot, t.reviewerId)} src={world.avatarOf(t.reviewerId)} size="sm">
                {initialsOf(t.reviewerName ?? '?')}
              </Reel>
              {/* Creme na criteriosa e tinta na rápida: as duas são notas, e a
                  diferença entre elas é quanto se olhou. */}
              <span className={cn('q text-[12.5px] font-medium', t.scores ? 'text-beam' : undefined)}>
                {fmt(t.final ?? 0)}
              </span>
            </button>
          );
        })}
      </div>

      <Drawer open={aberta !== null}>
        {tocada ? (
          <div className="pb-3 pr-2">
            {comNota
              .filter(t => t.id === aberta)
              .map(t => (
                <TakeCard key={t.id} take={t} />
              ))}
          </div>
        ) : null}
      </Drawer>
    </li>
  );
}

/* ══ o mural do universo de séries ═════════════════════════════════════════
   Irmão de screens/Feed.tsx, desenhando as MESMAS peças. O que muda é o que
   este universo tem para contar, em três tipos de linha:

   · **avaliado** ganha placa, porque é o assunto — carrega onde a pessoa se
     entusiasmou e onde se decepcionou.
   · **visto** é uma linha, agrupada pelo servidor: "viu 6 episódios de Fringe"
     e não seis linhas. Uma maratona é um acontecimento.
   · **comentado** abre a ficha embaixo de si com o texto anunciado já aceso. */
const FEED_POLL_MS = 120_000;

export function SeriesFeedScreen({
  takes,
  onOpenShow,
  onAimComment,
}: {
  /** O acervo que o clube já tem em memória: é dele que sai a ficha de cada linha. */
  takes: EpisodeTake[] | null;
  onOpenShow: (showId: number) => void;
  onAimComment: (commentId: string) => void;
}) {
  const [items, setItems] = useState<ShowFeedEvent[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const got = await showsSocial.feed();
      setItems(got.items);
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const tick = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const id = window.setInterval(tick, FEED_POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  /* A linha nasce na tela de todo mundo no instante em que alguém marca ou
     escreve. O relógio acima é a rede de baixo, para quando a conexão ao vivo
     cair. */
  useLive(kinds => {
    if (kinds.has('shows') || kinds.has('social')) void load();
  });

  if (erro && !items) {
    return (
      <section>
        <Bill title="Feed" />
        <div className="max-w-[60ch]">
          <Fault detail={erro}>Não foi possível carregar o feed.</Fault>
        </div>
      </section>
    );
  }

  if (!items) {
    return (
      <section>
        <Bill title="Feed" note="carregando…" />
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="plate flex gap-4 p-4">
              <Skeleton className="aspect-[2/3] w-[54px] flex-none" />
              <div className="flex-1 space-y-2.5 pt-1">
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-2.5 w-full" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (!items.length) {
    return (
      <section>
        <Bill title="Feed" />
        <Blank title="O clube ainda não fez nada">
          Quando alguém marcar um episódio, der uma nota ou comentar uma ficha, aparece aqui — do
          mais recente para o mais antigo.
        </Blank>
      </section>
    );
  }

  /* Agrupado na renderização e não no estado: guardado, este valor fica velho à
     meia-noite. */
  let ultimoDia = '';

  return (
    <section>
      <Bill
        title="Feed"
        note={`${plural(items.length, 'acontecimento', 'acontecimentos')} no clube`}
      />

      <div className="max-w-[760px]">
        {runsOf(items).map(bloco => {
          const primeiro = bloco[0];
          const dia = dayOf(primeiro.at);
          const abreDia = dia !== ultimoDia;
          ultimoDia = dia;
          return (
            <div key={primeiro.id}>
              {abreDia ? <p className="legend mb-3 mt-7 first:mt-0">{dia}</p> : null}
              {primeiro.kind === 'take' ? (
                bloco.length > 1 ? (
                  <FeedRatedRun events={bloco} takes={takes} onOpenShow={onOpenShow} />
                ) : (
                  <FeedRated e={primeiro} takes={takes} onOpenShow={onOpenShow} />
                )
              ) : primeiro.kind === 'seen' ? (
                <FeedSeen e={primeiro} onOpenShow={onOpenShow} />
              ) : (
                <FeedAside e={primeiro} takes={takes} onAimComment={onAimComment} />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** `T1E05` sem o zero perdido, que é como um episódio é chamado por gente. */
const epTag = (season?: number, episode?: number) =>
  `T${season ?? 0}E${String(episode ?? 0).padStart(2, '0')}`;

/* ── uma maratona é um acontecimento, e não seis ──────────────────────────
   Ver quatro episódios seguidos e avaliar os quatro enchia o mural com quatro
   placas do mesmo pôster, do mesmo nome e da mesma noite: o mural virava a
   lista de episódios de uma série só, e o resto do clube sumia debaixo dela.

   Juntado aqui e não no servidor, ao contrário do "viu": lá o agrupamento é a
   linha inteira — seis vistos viram uma frase e nada se perde. Aqui cada ficha
   continua sendo uma ficha, com a nota dela, a conversa dela e o polegar dela;
   o que se junta é a MOLDURA. Um agrupamento que apagasse isso apagaria o
   assunto.

   Três condições, e cada uma é um jeito de a junção mentir:

   · **Encostadas no mural.** Uma ficha de terça e uma de sexta com coisas do
     clube entre elas não são uma sessão, e passar por cima do que aconteceu no
     meio é reescrever a ordem dos fatos.
   · **Do mesmo dia.** O mural já separa por dia, e um bloco atravessando a
     virada ficaria pendurado sob a data errada.
   · **Da mesma pessoa e da mesma série**, que é o que "avaliou do T1E04 ao
     T1E06" quer dizer. */
function runsOf(items: ShowFeedEvent[]) {
  const blocos: ShowFeedEvent[][] = [];
  for (const e of items) {
    const atual = blocos[blocos.length - 1];
    const cabe =
      atual &&
      e.kind === 'take' &&
      atual[0].kind === 'take' &&
      atual[0].actor.id === e.actor.id &&
      atual[0].showId === e.showId &&
      dayOf(atual[0].at) === dayOf(e.at);
    if (cabe) atual.push(e);
    else blocos.push([e]);
  }
  return blocos;
}

/** Do primeiro episódio ao último, que é a ordem em que foram vistos. */
const inOrder = (events: ShowFeedEvent[]) =>
  [...events].sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));

/* A placa: o mesmo empilhamento do mural de filmes — corpo que desdobra,
   detalhamento, barra de ação, conversa. Um `<button>` dentro de outro não é
   coisa que o navegador monte, e é por isso que a barra é irmã do corpo e não
   filha dele. */
function FeedRated({
  e,
  takes,
  onOpenShow,
}: {
  e: ShowFeedEvent;
  takes: EpisodeTake[] | null;
  onOpenShow: (showId: number) => void;
}) {
  const world = useWorld();
  /* Do acervo que já está em memória — nada é buscado. Nula só entre alguém
     desmarcar um episódio e o mural recarregar; aí a barra some, porque
     oferecer um polegar para uma ficha morta é prometer um 404. */
  const take = takes?.find(t => t.id === e.takeId) ?? null;
  const quem = take
    ? { id: take.id, reviewerId: take.reviewerId, reviewerName: take.reviewerName ?? 'alguém' }
    : null;
  const conversa = world.comments.filter(c => c.takeId === e.takeId).length;
  const hora = clockOf(e.at);

  const [conversando, setConversando] = useState(false);
  const [tocada, setTocada] = useState(false);
  const [aberta, setAberta] = useState(false);
  const [desdobrada, setDesdobrada] = useState(false);

  /* A placa já mostra o que a pessoa escreveu, cortado em 120 caracteres. O
     detalhamento recebe o texto exatamente quando o resumo não é ele — senão é
     a mesma frase duas vezes. */
  const escrito = take?.comment?.replace(/\s+/g, ' ').trim() ?? '';
  const cortado = !!escrito && escrito !== (e.excerpt ?? '');

  return (
    <div className="plate mb-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-4">
        <PersonReel person={e.actor} size="sm" />
        <PersonName
          person={e.actor}
          className="font-display text-[13px] uppercase tracking-[0.1em] text-ink"
        />
        <span className="text-[12.5px] text-ink-dim">avaliou</span>
        {hora ? <span className="q ml-auto text-[10.5px] text-ink-faint">{hora}</span> : null}
      </div>

      <button
        type="button"
        onClick={() => {
          if (!take) {
            onOpenShow(e.showId);
            return;
          }
          setAberta(v => !v);
          setDesdobrada(true);
        }}
        aria-expanded={take ? aberta : undefined}
        aria-label={
          take
            ? `${aberta ? 'Fechar' : 'Abrir'} a ficha de ${epTag(e.season, e.episode)} de ${e.showTitle} por ${e.actor.name}`
            : `Abrir ${e.showTitle}`
        }
        className="group flex w-full gap-4 px-4 pb-4 pt-2.5 text-left transition-colors duration-150 hover:bg-house-seat"
      >
        <Poster src={e.showPoster} className="aspect-[2/3] w-[54px] flex-none sm:w-[62px]" />

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-display text-[22px] leading-none tracking-[0.02em] text-beam transition-colors group-hover:text-beam-hot">
              {e.showTitle}
            </span>
            <span className="q text-[11.5px] text-ink-dim">{epTag(e.season, e.episode)}</span>
          </span>
          {/* O nome do episódio embaixo do da série: é dele que a ficha fala, e
              "T1E05" sozinho não é o nome de nada. */}
          {e.episodeTitle ? (
            <span className="mt-1 block truncate text-[13px] text-ink-dim">{e.episodeTitle}</span>
          ) : null}

          <span className="mt-2.5 flex items-center gap-3">
            <Strip value={e.final ?? 0} cells={10} className="h-[6px] w-[120px] flex-none" />
            <span className="q text-[15px] font-medium text-beam">{fmt(e.final ?? 0)}</span>
            <span className="q text-[11px] text-ink-faint">/10</span>
          </span>

          {/* Ausente numa nota rápida e numa ficha sem distância entre o alto e
              o baixo: apontar extremos ali seria inventar uma opinião. */}
          {e.ends ? (
            <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
              <span className="flex items-center gap-1.5 text-ink-dim">
                <ThumbsUp className="h-3 w-3 flex-none text-ink-faint" strokeWidth={1.9} aria-hidden />
                {e.ends.high.name}
                <span className="q text-beam">{fmt(e.ends.high.value)}</span>
              </span>
              <span className="flex items-center gap-1.5 text-ink-dim">
                <ThumbsDown className="h-3 w-3 flex-none text-ink-faint" strokeWidth={1.9} aria-hidden />
                {e.ends.low.name}
                <span className="q text-ink">{fmt(e.ends.low.value)}</span>
              </span>
            </span>
          ) : null}

          {e.excerpt ? (
            <span className="mt-2.5 block break-words text-[13px] italic leading-relaxed text-ink-dim">
              “{e.excerpt}”
            </span>
          ) : null}
        </span>

        {take ? (
          <ChevronDown
            aria-hidden
            className={cn(
              'mt-1 h-4 w-4 flex-none text-ink-faint transition-transform duration-200 group-hover:text-ink-dim',
              aberta && 'rotate-180'
            )}
            strokeWidth={1.7}
          />
        ) : null}
      </button>

      <Drawer open={aberta}>
        {desdobrada && take ? (
          <div className="px-4 pb-4">
            <Breakdown r={take} comment={cortado ? take.comment ?? undefined : undefined} />
          </div>
        ) : null}
      </Drawer>

      {quem ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-4 py-2.5">
          <TakeVotes take={quem} labelled />

          <button
            type="button"
            aria-expanded={conversando}
            aria-label={
              `${conversando ? 'Fechar' : 'Abrir'} a conversa da ficha de ${e.actor.name}` +
              (conversa ? `, ${plural(conversa, 'resposta', 'respostas')}` : '')
            }
            title={conversando ? 'Fechar a conversa' : 'Comentar esta ficha'}
            onClick={() => {
              setConversando(v => !v);
              setTocada(true);
            }}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-cell px-2.5 ring-1 transition-colors duration-150',
              conversando
                ? 'text-dye-brass ring-dye-brass/60 shadow-[inset_0_0_14px_rgba(217,164,65,0.18)]'
                : 'text-ink-dim ring-house-rail hover:text-beam hover:ring-white/25'
            )}
          >
            <MessageSquare className="h-3.5 w-3.5 flex-none" strokeWidth={1.9} aria-hidden />
            <span className="hidden font-display text-[11px] uppercase leading-none tracking-[0.12em] sm:inline">
              {conversando ? 'Fechar' : 'Comentar'}
            </span>
            {conversa ? (
              <span className="q text-[10.5px] leading-none opacity-80">{conversa}</span>
            ) : null}
          </button>

          {/* A série como escolha, no fim da barra: lá o episódio aparece entre
              os outros da temporada, que é a única coisa que o mural não mostra. */}
          <button
            type="button"
            onClick={() => onOpenShow(e.showId)}
            title="Abrir a série, na lista de episódios"
            aria-label={`Abrir ${e.showTitle}`}
            className="ml-auto flex h-7 items-center rounded-cell px-1.5 text-ink-faint transition-colors duration-150 hover:text-beam"
          >
            <ArrowUpRight className="h-4 w-4 flex-none" strokeWidth={1.8} aria-hidden />
          </button>
        </div>
      ) : null}

      <Drawer open={conversando}>
        {tocada && quem ? (
          <div className="px-4 pb-4">
            <Conversation take={quem} ruled={false} />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

/* ── a noite inteira numa placa só ────────────────────────────────────────
   Uma moldura, um pôster, um nome de série — e dentro dela uma linha por
   episódio, cada uma com a nota, o polegar e a conversa que seriam dela numa
   placa própria. O que a junção economiza é repetição; o que ela não pode
   economizar é o que cada ficha diz. */
function FeedRatedRun({
  events,
  takes,
  onOpenShow,
}: {
  events: ShowFeedEvent[];
  takes: EpisodeTake[] | null;
  onOpenShow: (showId: number) => void;
}) {
  const emOrdem = inOrder(events);
  const primeiro = emOrdem[0];
  const ultimo = emOrdem[emOrdem.length - 1];
  // O relógio é o do acontecimento mais recente, que é como o mural se ordena.
  const hora = clockOf(events[0].at);

  return (
    <div className="plate mb-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-4">
        <PersonReel person={events[0].actor} size="sm" />
        <PersonName
          person={events[0].actor}
          className="font-display text-[13px] uppercase tracking-[0.1em] text-ink"
        />
        <span className="text-[12.5px] text-ink-dim">
          avaliou {plural(events.length, 'episódio', 'episódios')}
        </span>
        {hora ? <span className="q ml-auto text-[11px] text-ink-faint">{hora}</span> : null}
      </div>

      <button
        type="button"
        onClick={() => onOpenShow(events[0].showId)}
        aria-label={`Abrir ${events[0].showTitle}`}
        className="group flex w-full gap-4 px-4 pb-3 pt-2.5 text-left transition-colors duration-150 hover:bg-house-seat"
      >
        <Poster src={events[0].showPoster} className="aspect-[2/3] w-[54px] flex-none sm:w-[62px]" />
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[22px] leading-none tracking-[0.02em] text-beam transition-colors group-hover:text-beam-hot">
            {events[0].showTitle}
          </span>
          {/* O trecho, dito como o clube diz: do primeiro ao último. É o que
              substitui o `T1E05` que cada placa carregava sozinha. */}
          <span className="q mt-1.5 block text-[12px] text-ink-dim">
            do {epTag(primeiro.season, primeiro.episode)} ao {epTag(ultimo.season, ultimo.episode)}
          </span>
        </span>
        <ArrowUpRight
          aria-hidden
          className="mt-1 h-4 w-4 flex-none text-ink-faint transition-colors group-hover:text-beam"
          strokeWidth={1.8}
        />
      </button>

      <ul>
        {emOrdem.map(e => (
          <RunEpisode key={e.id} e={e} takes={takes} />
        ))}
      </ul>
    </div>
  );
}

/* Uma ficha dentro do bloco. Tudo o que a placa solta tem, menos o que a
   moldura já disse: sem pôster, sem nome de série e sem retrato de quem
   escreveu — são os mesmos três em todas as linhas daqui. */
function RunEpisode({ e, takes }: { e: ShowFeedEvent; takes: EpisodeTake[] | null }) {
  const world = useWorld();
  const take = takes?.find(t => t.id === e.takeId) ?? null;
  const quem = take
    ? { id: take.id, reviewerId: take.reviewerId, reviewerName: take.reviewerName ?? 'alguém' }
    : null;
  const conversa = world.comments.filter(c => c.takeId === e.takeId).length;

  const [aberta, setAberta] = useState(false);
  const [desdobrada, setDesdobrada] = useState(false);
  const [conversando, setConversando] = useState(false);
  const [tocada, setTocada] = useState(false);

  const escrito = take?.comment?.replace(/\s+/g, ' ').trim() ?? '';
  const cortado = !!escrito && escrito !== (e.excerpt ?? '');

  return (
    <li className="border-t border-white/[0.06]">
      <button
        type="button"
        disabled={!take}
        onClick={() => {
          setAberta(v => !v);
          setDesdobrada(true);
        }}
        aria-expanded={take ? aberta : undefined}
        aria-label={`${aberta ? 'Fechar' : 'Abrir'} a ficha de ${epTag(e.season, e.episode)}`}
        className="group flex w-full items-baseline gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-house-seat disabled:hover:bg-transparent"
      >
        <span className="q w-[52px] flex-none text-[12px] text-ink-dim">
          {epTag(e.season, e.episode)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-ink transition-colors group-hover:text-beam">
            {e.episodeTitle || '—'}
          </span>
          {e.excerpt ? (
            <span className="mt-1 block break-words text-[12.5px] italic leading-relaxed text-ink-dim">
              “{e.excerpt}”
            </span>
          ) : null}
        </span>
        <span className="flex flex-none items-center gap-2">
          <Strip value={e.final ?? 0} cells={10} className="hidden h-[5px] w-[70px] sm:block" />
          <span className="q text-[13px] font-medium text-beam">{fmt(e.final ?? 0)}</span>
        </span>
        {take ? (
          <ChevronDown
            aria-hidden
            className={cn(
              'h-4 w-4 flex-none self-center text-ink-faint transition-transform duration-200 group-hover:text-ink-dim',
              aberta && 'rotate-180'
            )}
            strokeWidth={1.7}
          />
        ) : null}
      </button>

      <Drawer open={aberta}>
        {desdobrada && take ? (
          <div className="px-4 pb-4">
            <Breakdown r={take} comment={cortado ? take.comment ?? undefined : undefined} />
          </div>
        ) : null}
      </Drawer>

      {quem ? (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2.5">
          <TakeVotes take={quem} />
          <button
            type="button"
            aria-expanded={conversando}
            aria-label={
              `${conversando ? 'Fechar' : 'Abrir'} a conversa de ${epTag(e.season, e.episode)}` +
              (conversa ? `, ${plural(conversa, 'resposta', 'respostas')}` : '')
            }
            title={conversando ? 'Fechar a conversa' : 'Comentar esta ficha'}
            onClick={() => {
              setConversando(v => !v);
              setTocada(true);
            }}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-cell px-2.5 ring-1 transition-colors duration-150',
              conversando
                ? 'text-dye-brass ring-dye-brass/60 shadow-[inset_0_0_14px_rgba(217,164,65,0.18)]'
                : 'text-ink-dim ring-house-rail hover:text-beam hover:ring-white/25'
            )}
          >
            <MessageSquare className="h-3.5 w-3.5 flex-none" strokeWidth={1.9} aria-hidden />
            {conversa ? (
              <span className="q text-[10.5px] leading-none opacity-80">{conversa}</span>
            ) : null}
          </button>
        </div>
      ) : null}

      <Drawer open={conversando}>
        {tocada && quem ? (
          <div className="px-4 pb-4">
            <Conversation take={quem} ruled={false} />
          </div>
        ) : null}
      </Drawer>
    </li>
  );
}

/* ── uma sessão de sofá ───────────────────────────────────────────────────
   A linha que o outro universo não tem. Sem placa e sem gaveta: marcar visto é
   o gesto barato deste mundo, e dar a ele a mesma superfície de uma ficha faria
   o mural inteiro pesar igual — que é o mesmo argumento que tirou o voto em
   critério do mural de filmes.

   O agrupamento vem do servidor (ver routes/showsFeed.js). Aqui só se lê: um
   episódio é chamado pelo nome, seis são chamados de trecho. */
function FeedSeen({ e, onOpenShow }: { e: ShowFeedEvent; onOpenShow: (showId: number) => void }) {
  const hora = clockOf(e.at);
  const varios = (e.count ?? 1) > 1;
  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => onOpenShow(e.showId)}
        className="group flex w-full items-start gap-3 rounded-cell px-3 py-2.5 text-left transition-colors duration-150 hover:bg-beam/[0.05]"
      >
        <Check className="mt-[3px] h-3.5 w-3.5 flex-none text-ink-faint" strokeWidth={2} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] leading-snug text-ink-dim">
            <span className="font-display uppercase tracking-[0.08em] text-ink">{e.actor.name}</span>{' '}
            {varios ? (
              <>
                viu {plural(e.count ?? 0, 'episódio', 'episódios')} de{' '}
                <span className="text-ink transition-colors group-hover:text-beam">{e.showTitle}</span>
                {e.from && e.to ? (
                  <span className="q text-ink-faint">
                    {' '}
                    · {epTag(e.from.season, e.from.episode)} a {epTag(e.to.season, e.to.episode)}
                  </span>
                ) : null}
              </>
            ) : (
              <>
                viu <span className="q text-ink-faint">{epTag(e.to?.season, e.to?.episode)}</span> de{' '}
                <span className="text-ink transition-colors group-hover:text-beam">{e.showTitle}</span>
                {e.to?.title ? <span className="text-ink-faint"> — {e.to.title}</span> : null}
              </>
            )}
          </span>
        </span>
        {hora ? <span className="q mt-0.5 flex-none text-[10.5px] text-ink-faint">{hora}</span> : null}
      </button>
    </div>
  );
}

/* A linha de conversa, e ela abre a ficha embaixo de si com o texto anunciado
   já aceso — `onAimComment` diz qual é, e a conversa cresce até ele, rola e o
   acende. Mesmo mecanismo do mural de filmes. */
function FeedAside({
  e,
  takes,
  onAimComment,
}: {
  e: ShowFeedEvent;
  takes: EpisodeTake[] | null;
  onAimComment: (commentId: string) => void;
}) {
  const world = useWorld();
  const hora = clockOf(e.at);
  const take = takes?.find(t => t.id === e.takeId) ?? null;
  const [aberta, setAberta] = useState(false);
  const [desdobrada, setDesdobrada] = useState(false);

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => {
          if (!take) return;
          const proximo = !aberta;
          setAberta(proximo);
          setDesdobrada(true);
          /* Só ao ABRIR: reapontar ao fechar faria a conversa rolar atrás de um
             texto que acabou de sair da tela. */
          if (proximo && e.commentId) onAimComment(e.commentId);
        }}
        aria-expanded={take ? aberta : undefined}
        className="group flex w-full items-start gap-3 rounded-cell px-3 py-2.5 text-left transition-colors duration-150 hover:bg-beam/[0.05]"
      >
        <MessageSquare
          className="mt-[3px] h-3.5 w-3.5 flex-none text-ink-faint"
          strokeWidth={1.9}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] leading-snug text-ink-dim">
            <span className="font-display uppercase tracking-[0.08em] text-ink">{e.actor.name}</span>{' '}
            {e.parentId ? 'respondeu um comentário na ficha de ' : 'comentou a ficha de '}
            {e.owner?.id === world.me.id ? (
              <span className="text-dye-brass">você</span>
            ) : (
              <span className="text-ink">{e.owner?.name ?? 'alguém'}</span>
            )}{' '}
            em{' '}
            <span className="text-ink transition-colors group-hover:text-beam">
              {e.showTitle} {epTag(e.season, e.episode)}
            </span>
          </span>
          {e.excerpt ? (
            <span className="mt-0.5 block break-words text-[12px] italic leading-snug text-ink-faint">
              “{e.excerpt}”
            </span>
          ) : null}
        </span>
        {hora ? <span className="q mt-0.5 flex-none text-[10.5px] text-ink-faint">{hora}</span> : null}
        {take ? (
          <ChevronDown
            aria-hidden
            className={cn(
              'mt-[1px] h-3.5 w-3.5 flex-none text-ink-faint transition-transform duration-200',
              aberta && 'rotate-180'
            )}
            strokeWidth={1.7}
          />
        ) : null}
      </button>

      {/* Sobre uma superfície própria: a linha não tem placa, e sem uma caixa em
          volta a ficha flutuaria solta entre duas linhas sem dizer de qual é. */}
      <Drawer open={aberta}>
        {desdobrada && take ? (
          <div className="mb-2 ml-6 mr-1 mt-1">
            <TakeCard take={take} />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

/* Os nove critérios, o que a pessoa escreveu, o voto do clube e a conversa —
   nesta ordem, que é a do acervo de filmes: primeiro o que a ficha DIZ, depois
   o que se faz com ela.

   Nenhuma destas peças é daqui: são as mesmas do outro universo, com as mesmas
   regras. O dia em que uma delas mudar, muda nos dois. */
function TakeCard({ take }: { take: EpisodeTake }) {
  const quem = { id: take.id, reviewerId: take.reviewerId, reviewerName: take.reviewerName ?? 'alguém' };
  return (
    <div className="rounded-cell bg-house-seat/55 p-3 ring-1 ring-inset ring-white/[0.06]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PersonReel
          person={{ id: take.reviewerId, name: take.reviewerName ?? 'alguém', dot: take.reviewerDot }}
          size="sm"
        />
        <PersonName
          person={{ id: take.reviewerId, name: take.reviewerName ?? 'alguém', dot: take.reviewerDot }}
          className="font-display text-[12.5px] uppercase tracking-[0.1em] text-ink"
        />
        <span className="q text-[10.5px] text-ink-faint" title={take.ratedAt ?? take.watchedAt}>
          {whenOf(take.ratedAt ?? take.watchedAt)}
        </span>
        <span className="ml-auto flex items-center gap-2.5">
          <Strip value={take.final ?? 0} cells={10} className="hidden h-[5px] w-[80px] flex-none sm:block" />
          <span className="q text-[16px] font-medium leading-none text-beam">{fmt(take.final ?? 0)}</span>
        </span>
        <TakeVotes take={quem} />
      </div>

      {/* A nota rápida não tem carta: ela é um número e mais nada, e o
          `Breakdown` cala sozinho quando não há critério nem texto. */}
      <div className="mt-3">
        <Breakdown r={take} comment={take.comment ?? undefined} />
      </div>

      <Conversation take={quem} />
    </div>
  );
}

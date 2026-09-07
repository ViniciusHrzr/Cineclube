import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Check, ChevronLeft, Layers, Play, Plus, Star, Trash2, X } from 'lucide-react';
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
  SearchField,
  Skeleton,
  Strip,
} from '@/components/bits';
import { Channels, Gauge } from '@/components/channels';
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

/* ── o cartaz de uma série ────────────────────────────────────────────────
   A MESMA peça do catálogo de filmes, e não uma parecida: a célula de celuloide
   que tomba na direção da mão e cujas camadas se separam. Isso não é enfeite
   aqui — é o que faz um cartaz de série se comportar como um cartaz neste
   produto, e um catálogo com duas físicas diferentes é o app dizendo que são
   dois apps.

   A tarja que sobe diz o que o clique entrega, e ela muda de texto porque o
   destino é outro: num filme abre a folha de leitura, aqui abrem as temporadas.
   Prometer "sinopse e trailer" e entregar uma lista de episódios seria a tarja
   mentindo pela metade.

   Os controles moram na fileira de baixo, e não sobre o cartaz. Era um `+`
   flutuando no canto do pôster — ele funcionava e brigava com as camadas em
   relevo e com a tarja, e a fileira é onde este produto já põe as ações de uma
   célula.

   Sem ponteiro fino, `CardContainer` não constrói nada: nem perspectiva, nem
   contexto 3D, nem manipuladores. No dedo isto é um cartão comum. */
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
        note={`${plural(shows.length, 'série', 'séries')} que o clube acompanha`}
      />
      {/* A MESMA célula do catálogo, com a tesoura no lugar do marcador. É o que
          o universo de filmes já faz — a fila e o catálogo desenham o mesmo
          `FilmCell` —, e duas células parecidas para a mesma coisa divergem na
          terceira mexida. */}
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {shows.map(s => (
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

/* ── uma linha de episódio ────────────────────────────────────────────────
   O quadro, o número, o título, e o que o clube já disse.

   A linha tem dois gestos, e são de tamanhos diferentes. **Marcar que viu** é
   o de toda semana, e por isso o check é o próprio controle: clicar nele
   marca, clicar de novo desmarca, e nada abre. Ele era um símbolo do estado —
   parecia um check e não era —, e mudar de estado obrigava a abrir a folha,
   ler nove critérios e achar um botão lá dentro para dizer uma coisa que o
   dedo já estava em cima de dizer.

   **Avaliar** é o gesto raro, e é um botão com nome ao lado do check: quem
   quer dar nota pede a folha, e quem só viu o episódio nunca precisa dela. */
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

/* ══ o que os outros acharam deste episódio ═══════════════════════════════
   Duas perguntas com uma chave entre elas.

   **Clube** é quem estava na sala com você, e sai de graça: o acervo inteiro já
   está em memória desde o boot, e a folha recebeu as fichas deste episódio por
   prop. Não há requisição nenhuma para desenhar isto.

   **Todas** é a rede, e essa custa uma chamada — que é justamente por que ela
   não é o padrão. Ela também obedece as paredes: só aparece quem emprestou as
   fichas assinadas, o que é a mesma regra da avaliação em destaque do saguão.

   Ordenada por credibilidade do lado da rede, como todo ranking daquele lado.
   Do lado do clube a ordem é a nota, porque numa sala de seis pessoas
   credibilidade não separa ninguém e a pergunta real é quem gostou mais. */
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
   Uma lista corrida de episódios era a forma errada. O que o clube guarda aqui
   não é uma pilha de fichas: é uma SÉRIE, feita de temporadas, feitas de
   episódios — e a pergunta que se faz ao acervo ("o que a gente achou da
   terceira?") só tem resposta se a tela tiver essa forma.

   Três níveis, dois deles fechados. Uma série de sessenta episódios abriria
   sessenta linhas para responder uma pergunta sobre uma temporada, e um acervo
   que se lê rolando é um acervo que não se lê.

   ── e o filtro é por pessoa ─────────────────────────────────────────────
   Porque a segunda pergunta do acervo é "o que ELA achou". Filtrar por avaliador
   recorta os três níveis de uma vez: a média da temporada passa a ser a dela, e
   uma série em que ela não avaliou nada some em vez de ficar vazia. Uma linha
   que existe para dizer que não tem nada dentro é uma linha a rolar. */
export function SeriesArchiveScreen({
  takes,
  onOpen,
}: {
  takes: EpisodeTake[] | null;
  onOpen: (showId: number) => void;
}) {
  const [quem, setQuem] = useState<string | null>(null);
  const [abertas, setAbertas] = useState<ReadonlySet<number>>(() => new Set());
  const [temporadas, setTemporadas] = useState<ReadonlySet<string>>(() => new Set());

  /* Quem já marcou alguma coisa, na ordem em que aparece. Contado do próprio
     acervo e não do elenco do clube: uma tira com seis rostos em que quatro
     levam a uma lista vazia é uma tira que promete o que não tem. */
  const gente = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const t of takes ?? []) {
      if (t.reviewerName && !mapa.has(t.reviewerId)) mapa.set(t.reviewerId, t.reviewerName);
    }
    return [...mapa].map(([id, name]) => ({ id, name }));
  }, [takes]);

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

      {gente.length > 1 ? (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Chip size="sm" on={quem === null} onClick={() => setQuem(null)}>
            O clube
          </Chip>
          {gente.map(p => (
            <Chip key={p.id} size="sm" on={quem === p.id} onClick={() => setQuem(p.id)}>
              {p.name}
            </Chip>
          ))}
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
                                <li
                                  key={ep.numero}
                                  className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-t border-white/[0.04] py-2 pr-2"
                                >
                                  <span className="q flex-none text-[11px] text-ink-dim">
                                    E{String(ep.numero).padStart(2, '0')}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                                    {ep.title || 'sem título'}
                                  </span>
                                  {/* Quem deu o quê, e não só a média: a
                                      divergência é o assunto deste produto, e
                                      uma média esconde exatamente isso. */}
                                  <span className="flex flex-none flex-wrap items-baseline gap-x-2.5">
                                    {ep.takes.map(t => (
                                      <span key={t.id} className="q text-[11px] text-ink-faint">
                                        {t.reviewerName?.split(' ')[0] ?? '—'}{' '}
                                        <span className={t.scores ? 'text-beam' : 'text-ink'}>
                                          {t.final != null ? fmt(t.final) : '—'}
                                        </span>
                                      </span>
                                    ))}
                                  </span>
                                </li>
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

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Clock, MessageSquare, Play, Plus, ShieldCheck, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { Blank, Fault, IconKey, Key, Poster, Reel, SearchField, Strip } from '@/components/bits';
import { HolographicWall } from '@/components/ui/holographic-wall-shadcnui';
import { Notices } from '@/components/notices';
import { PortraitGate } from '@/components/portrait';
import {
  api,
  clubs,
  fmt,
  initialsOf,
  lobby as lobbyApi,
  reelColor,
  type Club,
  type LobbyClub,
  type LobbyFeature,
  type LobbyFilm,
  type LobbyLive,
  type LobbyMovie,
  type LobbyPodiumMovie,
  type LobbySnapshot,
  type LobbyTake,
  type Movie,
  type SessionUser,
} from '@/lib/api';
import { cn, named, norm, plural, useFinePointer, whenOf } from '@/lib/utils';

/* ══════════════════════════════════════════════════════════════════════════
   O saguão.

   Um cinema tem mais de uma sala, e até agora este produto tinha uma. O saguão é
   o lugar de onde se vê o que está passando em cada uma antes de entrar — e é a
   primeira tela da rede, a que responde "onde eu vou".

   ── o que ele era, e por que não bastava ──────────────────────────────────
   Duas grades de retângulos iguais: `mine`, o chaveiro de quem já chegou, e
   `open`, a vitrine de quem está olhando. As duas listas continuam aqui e
   continuam respondendo perguntas diferentes — um clube em que você já está
   nunca aparece nas duas, porque uma sala listada duas vezes na mesma tela é a
   tela dizendo que não sabe quem você é.

   O que faltava não era mais uma lista. Era o produto: este app guarda centenas
   de pôsteres, milhares de notas e salas assistindo juntas neste segundo, e a
   porta de entrada não mostrava nenhuma delas. Um app sobre imagem em movimento
   abria sem uma única imagem.

   Então o saguão passou a ter uma parede de cartazes — os filmes que a rede
   avaliou, andando devagar como cartaz em foyer anda: nunca de volta —, um
   trilho de sessões acontecendo agora, o pódio da rede, as salas em atividade e
   uma ficha inteira em destaque.

   ── a ordem é uma decisão ─────────────────────────────────────────────────
   A parede é uma FAIXA e não uma tela cheia. Quem chega pela primeira vez tem a
   chegada cinematográfica; quem volta todo dia continua vendo o próprio chaveiro
   sem rolar a página. Um saguão que cobra um rolar de quem só quer entrar na
   própria sala está cobrando pedágio pela decoração.

   ── e tudo aqui pode não existir ──────────────────────────────────────────
   Toda seção desta tela se cala sozinha quando não tem o que dizer. É a mesma
   regra que a contagem de votos segue na ficha — um zero não é um dado —, em
   escala de seção: uma rede com dois clubes e quarenta fichas debaixo de seis
   rankings lê como estádio vazio, e um estádio vazio é pior que um saguão
   simples.
   ══════════════════════════════════════════════════════════════════════════ */

/* De quanto em quanto tempo o saguão relê. Mais lento que o sino (90s) e igual
   ao mural: o que muda aqui é o que a REDE fez, e chegar dois minutos atrasado
   numa parede não custa nada. Pausa com a aba escondida — este app fica aberto
   do lado do Discord por horas, e um cronômetro batendo numa aba esquecida é
   trabalho constante contra uma instância que dorme por falta dele. */
const POLL_MS = 120_000;

export function Lobby({
  me,
  onEnter,
  onSignOut,
  onOpenSelf,
}: {
  me: SessionUser;
  /** Entrar numa sala, e opcionalmente num lugar dentro dela (`reviews/<id>`). */
  onEnter: (slug: string, rest?: string) => void;
  onSignOut: () => void;
  onOpenSelf: () => void;
}) {
  const [mine, setMine] = useState<Club[] | null>(null);
  const [open, setOpen] = useState<Club[]>([]);
  const [net, setNet] = useState<LobbySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [founding, setFounding] = useState(false);

  /* As duas leituras vão juntas e falham separadas. A lista de clubes é o que
     sustenta a tela: sem ela não há saguão, e o erro é dito. O que a rede andou
     fazendo é enfeite caro — se ele não vier, a tela é a de antes e ninguém
     precisa saber por quê. */
  const load = useCallback(async () => {
    const [salas, rede] = await Promise.allSettled([clubs.all(), lobbyApi.get()]);
    if (salas.status === 'fulfilled') {
      setMine(salas.value.mine);
      setOpen(salas.value.open);
      setError(null);
    } else {
      setError((salas.reason as Error).message);
      setMine(current => current ?? []);
    }
    if (rede.status === 'fulfilled') setNet(rede.value);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* O trilho de "em cartaz" é a única coisa desta tela que envelhece rápido: uma
     sessão termina e a linha continua anunciando um filme que ninguém está mais
     assistindo. Volta a ler ao reaparecer, e não só no próximo intervalo — quem
     acabou de trocar de aba está olhando agora. */
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) void load();
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  /* Em quais salas você já está — pelo slug, que é o que as linhas da rede
     carregam. Decide se uma sessão ao vivo ou uma sala em atividade é uma porta
     ou só uma notícia: um clube fechado de que você não é abre 403, e oferecer o
     clique é oferecer um erro. */
  const held = useMemo(() => new Set((mine ?? []).map(c => c.slug)), [mine]);
  const canEnter = useCallback(
    (club: { slug: string; visibility: 'public' | 'private' }) =>
      club.visibility === 'public' || held.has(club.slug),
    [held]
  );

  const wall = net?.wall ?? [];
  const live = net?.live ?? [];
  const podium = net?.podium ?? [];
  const active = net?.active ?? [];
  const feature = net?.feature ?? null;
  /* Abaixo de quatro cartazes não existe parede: existem três filmes numa faixa
     larga, e a faixa passa a parecer uma coisa que não terminou de carregar. A
     rede que ainda não viu quatro filmes não tem uma parede para mostrar, e a
     tela volta a ser a de antes — que é o certo, e não um estado degradado. */
  const hasWall = wall.length >= 4;

  /* ── quando a rede inteira está no escuro ──────────────────────────────
     Toda seção desta tela se cala quando não tem o que dizer, e há um caso em
     que essa regra produz uma tela que MENTE: uma rede em que os clubes existem
     e avaliam, e nenhum deles emprestou nada. O saguão fica idêntico ao de
     antes, e quem administra a sala não tem como saber que existe um
     interruptor — muito menos que ele é a razão de a tela estar vazia.

     Um estado vazio que não diz por que está vazio é um defeito, e este é
     especialmente caro porque a pessoa que pode consertá-lo é exatamente a que
     está olhando para ele. Então: se não há NADA da rede e você administra uma
     sala fechada que não empresta, a tela diz isso e aponta o caminho.

     Só para o ADM, e só sobre as salas dele: emprestar o acervo é uma decisão
     de quem manda na sala, e cutucar um membro comum sobre uma escolha que ele
     não pode tomar seria pedir que ele fosse cobrar de outra pessoa. */
  const darkNetwork =
    net !== null && !hasWall && !podium.length && !active.length && !live.length && !feature;
  const lendable = (mine ?? []).filter(
    c => c.role === 'admin' && c.visibility === 'private' && !c.showCharts
  );

  /* Uma ação, dois desfechos, e quem decide qual é a porta do clube: num clube
     aberto você entra e a tela vai junto; num fechado vira um pedido e você
     continua no saguão. O servidor diz qual aconteceu — a tela não adivinha
     pela visibilidade, porque ela pode ter mudado entre a lista e o clique. */
  async function ask(slug: string) {
    try {
      const out = await clubs.join(slug);
      if (out.joined) {
        onEnter(slug);
        return;
      }
      setOpen(list => list.map(c => (c.slug === slug ? { ...c, requested: true } : c)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function unask(slug: string) {
    try {
      await clubs.unjoin(slug);
      setOpen(list => list.map(c => (c.slug === slug ? { ...c, requested: false } : c)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="relative flex min-h-[calc(100dvh/var(--ui-zoom))] flex-col">
      <HolographicWall asBackdrop />

      {/* Presa no topo, como a marquise de dentro de um clube — mesmas classes,
          e é a mesma coisa: a barra é a porta de saída (o rosto, o sino, sair) e
          uma porta que sobe com a página é uma porta que se perde justamente
          quando alguém rolou longe o bastante para querer usá-la.

          Sem desfoque de fundo, pela razão escrita na marquise: a barra fica
          sobre a parede de celuloide, que nunca para de andar — desfocar uma
          faixa de largura inteira sobre um fundo vivo é refazer o borrão a cada
          quadro, rolando ou não. Uma barra mais opaca lê quase igual e custa
          zero. */}
      <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-house/95">
        <div className="mx-auto flex max-w-[1240px] items-center gap-x-6 px-4 py-3 sm:px-6">
          <span className="mr-auto font-display text-[26px] leading-none tracking-[0.14em] text-beam">
            CINECLUBE
          </span>
          {/* O mesmo sino da marquise de dentro do clube, e é o ponto: ele é da
              REDE. Junta as salas todas e diz de qual veio cada linha, o que faz
              desta tela — a primeira depois de entrar — o lugar onde "o que
              aconteceu enquanto eu não estava?" tem resposta. */}
          <Notices />
          <button
            type="button"
            onClick={onOpenSelf}
            title="Minha conta"
            className="flex items-center gap-2 rounded-cell px-1 py-1 transition-colors hover:[&>span]:text-ink"
          >
            <Reel color={reelColor(me.dot, me.id)} src={me.avatar} size="lg">
              {initialsOf(me.name)}
            </Reel>
            <span className="hidden text-[13px] text-ink-dim transition-colors sm:inline">{me.name}</span>
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-cell px-2 py-1.5 font-display text-[12px] uppercase tracking-[0.12em] text-ink-dim transition-colors hover:text-dye-red-lit"
          >
            Sair
          </button>
        </div>
      </header>

      {hasWall ? <PosterWall films={wall} counts={net!.counts} /> : null}
      {live.length ? <NowPlaying sessions={live} canEnter={canEnter} onEnter={onEnter} /> : null}

      <main className="relative mx-auto w-full max-w-[1240px] flex-1 px-4 pb-20 pt-8 sm:px-6 sm:pt-12">
        {error ? (
          <div className="mb-6 max-w-[60ch]">
            <Fault>{error}</Fault>
          </div>
        ) : null}

        <Rooms
          level={hasWall ? 2 : 1}
          mine={mine}
          open={open}
          onEnter={onEnter}
          onFound={() => setFounding(true)}
          onAsk={c => (c.requested ? void unask(c.slug) : void ask(c.slug))}
        />

        {darkNetwork && lendable.length ? (
          <DarkNetwork clubs={lendable} onOpen={slug => onEnter(slug, 'ajustes')} />
        ) : null}

        {podium.length ? (
          <Region
            className="mt-16"
            title="Os mais bem avaliados"
            note="A média de todos os clubes."
          >
            <div className="mt-7 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-6">
              {podium.map((film, i) => (
                <PodiumFilm key={film.id} film={film} rank={i + 1} index={i} />
              ))}
            </div>
          </Region>
        ) : null}

        {active.length ? (
          <Region
            className="mt-16"
            title="Salas em atividade"
            note={`Fichas dos últimos ${net?.windowDays ?? 30} dias.`}
          >
            <ul className="mt-6">
              {active.map((club, i) => (
                <ActiveClub
                  key={club.slug}
                  club={club}
                  rank={i + 1}
                  enterable={canEnter(club)}
                  onOpen={() => onEnter(club.slug)}
                />
              ))}
            </ul>
          </Region>
        ) : null}

        {feature ? (
          <Region
            className="mt-16"
            title="A ficha em destaque"
            note={`A avaliação que mais moveu a rede nos últimos ${net?.windowDays ?? 30} dias.`}
          >
            <FeatureTake take={feature} onOpen={() => onEnter(feature.club.slug, `reviews/${feature.id}`)} />
          </Region>
        ) : null}

      </main>

      {founding ? (
        <FoundClub
          onClose={() => setFounding(false)}
          onFounded={slug => {
            setFounding(false);
            onEnter(slug);
          }}
        />
      ) : null}
    </div>
  );
}

/* ── uma região do saguão ─────────────────────────────────────────────────
   Título, uma linha explicando o que a lista é, e o fio de luz correndo do
   lettering até a beirada do deck — o mesmo desenho do cabeçalho das cinco
   telas de dentro de um clube (ver `Bill`), num corpo menor porque aqui são
   seis regiões numa página e não uma tela inteira.

   Sempre `h2`: o `h1` desta tela é o da parede de cartazes, e quando ela não
   existe — rede sem nenhuma ficha — quem assume é o seletor de salas, que é a
   primeira coisa da página. Nenhuma destas regiões é a primeira. */
function Region({
  title,
  note,
  action,
  className,
  children,
}: {
  title: string;
  note?: React.ReactNode;
  /** O que fica na linha do título, na outra ponta. */
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-[26px] leading-none tracking-[0.04em] text-beam sm:text-[30px]">
          {title}
        </h2>
        {action}
      </div>
      {note ? (
        <p className="mt-3 max-w-[68ch] text-[13px] leading-relaxed text-ink-dim">{note}</p>
      ) : null}
      <span
        aria-hidden
        className="mt-4 block h-px w-full bg-gradient-to-r from-beam/25 via-beam/[0.07] to-transparent"
      />
      {children}
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   A FOLHA DE UM FILME, VISTO PELA REDE.

   Abre ao clicar num cartaz da parede, e é deliberadamente MENOR que a folha de
   projeção de dentro de um clube. Lá a folha é uma sala de espera antes de
   avaliar: elenco, equipe, onde assistir, o botão de gravar. Aqui não há sala,
   não há o que gravar, e quem clicou num cartaz de uma parede que anda fez uma
   pergunta curta — "que filme é esse, e o que acharam?".

   Então são três coisas: o que o filme é (sinopse e trailer), o que a rede
   achou (a média), e quem achou (as cinco fichas).

   ── de onde vem cada metade ───────────────────────────────────────────────
   Sinopse e trailer são do TMDB, pela rota do catálogo, que é pública e tem
   cache. As fichas são nossas, por `/api/lobby/film/:id`. Duas chamadas em
   paralelo e não uma no servidor: juntá-las lá seria pagar a requisição ao TMDB
   de novo, do lado errado do cache do navegador.

   ── e a folha abre com o que já se sabe ───────────────────────────────────
   Título, ano, cartaz e nota vêm do cartaz que foi clicado — a parede já os
   tinha. A folha nasce completa naquilo e preenche o resto quando chega, em vez
   de mostrar um esqueleto do que já estava na tela um segundo atrás.

   Um `<dialog>` nativo, como a folha de projeção, e pelo mesmo motivo: a
   plataforma dá a armadilha de foco, o Escape e a inércia do fundo de graça.
   ══════════════════════════════════════════════════════════════════════════ */
function FilmPeek({ film, onClose }: { film: LobbyMovie; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [detalhe, setDetalhe] = useState<Movie | null>(null);
  const [rede, setRede] = useState<LobbyFilm | null>(null);
  const [faltou, setFaltou] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  /* O Escape passa pelo mesmo caminho do botão: sem isto o `<dialog>` fecha
     sozinho e o React continua achando que ele está aberto. */
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
    let vivo = true;
    void Promise.allSettled([
      api<Movie>(`/api/catalog/movie/${film.id}`),
      lobbyApi.film(film.id),
    ]).then(([tmdb, nossas]) => {
      if (!vivo) return;
      if (tmdb.status === 'fulfilled') setDetalhe(tmdb.value);
      else setFaltou(true);
      if (nossas.status === 'fulfilled') setRede(nossas.value);
    });
    return () => {
      vivo = false;
    };
  }, [film.id]);

  return (
    <dialog
      ref={ref}
      aria-label={`Sobre ${film.title}`}
      onClick={e => {
        if (e.target === ref.current) onClose();
      }}
      className="w-full max-w-[720px] bg-transparent p-2 text-ink backdrop:bg-house-deep/80 backdrop:backdrop-blur-sm open:animate-beam-in sm:p-4"
    >
      <div className="plate relative max-h-[calc(100dvh-1rem)] overflow-y-auto p-5 sm:p-6">
        <IconKey aria-label="Fechar" onClick={onClose} className="absolute right-3 top-3 z-10">
          <X className="h-4 w-4" strokeWidth={1.8} />
        </IconKey>

        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <Poster
            src={film.poster}
            alt={`Pôster de ${film.title}`}
            className="aspect-[2/3] w-[110px] flex-none sm:w-[150px]"
          />

          <div className="min-w-0 flex-1">
            <h2 className="pr-10 font-display text-[26px] leading-none tracking-[0.03em] text-beam sm:text-[30px]">
              {film.title}
            </h2>
            <p className="q mt-2 text-[12px] text-ink-dim">
              {[film.year ?? '—', detalhe?.genre].filter(Boolean).join(' · ')}
            </p>

            {/* A conta da rede, na régua de sempre — uma nota é reconhecível
                como nota antes de ser lida. */}
            <div className="mt-4 flex items-center gap-3">
              <Strip value={rede?.average ?? film.average} cells={10} className="h-[6px] w-[120px] flex-none" />
              <span className="q text-[15px] font-medium text-beam">
                {fmt(rede?.average ?? film.average)}
              </span>
              <span className="q text-[11px] text-ink-faint">/10</span>
              <span className="q text-[11px] text-ink-dim">
                {plural(rede?.count ?? film.takes, 'ficha', 'fichas')}
              </span>
            </div>

            <p className="mt-4 max-w-[66ch] text-[13px] leading-relaxed text-ink-dim">
              {detalhe
                ? detalhe.overview || 'Sem sinopse disponível no TMDB.'
                : faltou
                  ? 'Não foi possível falar com o TMDB agora.'
                  : 'Carregando a sinopse…'}
            </p>

            {detalhe?.trailerUrl ? (
              <a
                href={detalhe.trailerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 font-display text-[12px] uppercase leading-none tracking-[0.12em] text-dye-red-lit transition-colors hover:text-dye-red-glow"
              >
                <Play className="h-3.5 w-3.5 fill-current" strokeWidth={0} aria-hidden />
                Ver o trailer
              </a>
            ) : null}
          </div>
        </div>

        {/* ── quem já viu ──────────────────────────────────────────────────
            A legenda diz a regra da ordem. Um ranking cuja regra não está à
            vista parece arbitrário, e este tem uma boa: quem enfrentou os onze
            critérios mais vezes carrega uma régua mais aferida. */}
        {rede?.takes.length ? (
          <section className="mt-7 border-t border-white/[0.07] pt-5">
            <span className="legend">
              {rede.takes.length === 1 ? 'Quem já viu' : `As ${rede.takes.length} de quem mais avalia`}
            </span>
            <ul className="mt-4 flex flex-col gap-4">
              {rede.takes.map(take => (
                <PeekTake key={take.id} take={take} />
              ))}
            </ul>
          </section>
        ) : rede ? (
          <p className="mt-7 border-t border-white/[0.07] pt-5 text-[13px] leading-relaxed text-ink-dim">
            Nenhuma sala que empresta o acervo avaliou este filme ainda.
          </p>
        ) : null}
      </div>
    </dialog>
  );
}

function PeekTake({ take }: { take: LobbyTake }) {
  return (
    <li className="flex gap-3">
      <Reel color={reelColor(take.actor.dot, take.actor.id)} src={take.actor.avatar} size="md">
        {initialsOf(take.actor.name)}
      </Reel>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-display text-[13px] uppercase tracking-[0.1em] text-ink">
            {take.actor.name}
          </span>
          <span className="font-display text-[10.5px] uppercase tracking-[0.12em] text-dye-brass">
            {take.club.name}
          </span>
          <span className="q ml-auto text-[15px] font-medium text-beam">{fmt(take.final)}</span>
        </div>

        {take.ends ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
            <span className="flex items-center gap-1.5 text-ink-dim">
              <ThumbsUp className="h-3 w-3 flex-none text-ink-faint" strokeWidth={1.9} aria-hidden />
              {take.ends.high.name}
              <span className="q text-beam">{fmt(take.ends.high.value)}</span>
            </span>
            <span className="flex items-center gap-1.5 text-ink-dim">
              <ThumbsDown className="h-3 w-3 flex-none text-ink-faint" strokeWidth={1.9} aria-hidden />
              {take.ends.low.name}
              <span className="q text-ink">{fmt(take.ends.low.value)}</span>
            </span>
          </div>
        ) : null}

        {take.excerpt ? (
          <p className="mt-2 break-words text-[13px] italic leading-relaxed text-ink-dim">
            “{take.excerpt}”
          </p>
        ) : null}
      </div>
    </li>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   AS SALAS, NUM LUGAR SÓ.

   Eram duas seções empilhadas, e a de baixo — a vitrine — vivia depois de um
   pódio, de uma lista de atividade e de uma ficha inteira. Quem quisesse
   procurar um clube para entrar rolava a página inteira até achar, e quem já
   tinha salas nunca via que existiam outras.

   As duas respondem perguntas diferentes e continuam respondendo: `Suas salas` é
   o chaveiro de quem já chegou, `Outras salas` é a vitrine de quem está
   olhando. Mas as duas são A MESMA COISA — uma lista de clubes — e a pergunta
   que separa as duas ("já sou de lá?") é uma escolha, não uma posição na
   página. Escolha é o que um seletor faz.

   ── o sublinhado vermelho ─────────────────────────────────────────────────
   O mesmo tratamento da marquise de dentro de um clube, e pela mesma regra
   escrita no DESIGN.md: vermelho marca ONDE VOCÊ ESTÁ, latão marca o que você
   escolheu. Isto é uma seção em que se está, não um filtro que se liga, então é
   vermelho — e é o que faz o seletor ser reconhecível como navegação antes de
   ser lido, porque o produto já usa essa forma na barra de cima.

   ── a contagem ao lado do nome ────────────────────────────────────────────
   Existe para a aba fechada não ser uma caixa preta. Sem o número, "Outras
   salas" é um convite a clicar para descobrir se há algo lá; com ele, a pessoa
   decide sem trocar de aba — e num saguão com uma sala só, decide não clicar.
   ══════════════════════════════════════════════════════════════════════════ */

/** A partir de quantas salas uma busca deixa de ser mobília e vira ferramenta. */
const SEARCH_FROM = 5;

function Rooms({
  level,
  mine,
  open,
  onEnter,
  onFound,
  onAsk,
}: {
  level: 1 | 2;
  /** Null enquanto a lista não chegou — que é diferente de estar vazia. */
  mine: Club[] | null;
  open: Club[];
  onEnter: (slug: string) => void;
  onFound: () => void;
  onAsk: (club: Club) => void;
}) {
  const [tab, setTab] = useState<'mine' | 'open'>('mine');
  const [query, setQuery] = useState('');

  const lista = tab === 'mine' ? (mine ?? []) : open;
  /* Filtra por nome e pela linha de descrição, sem acento e sem caixa — ver
     `norm` e `named`. Buscar só pelo nome erraria "os que gostam de terror",
     que é exatamente o tipo de coisa que faz alguém querer entrar numa sala. */
  const q = norm(query.trim());
  const vistos = q ? lista.filter(c => named(q, c.name, c.tagline)) : lista;

  /* A busca aparece pelo total das duas listas, e não pela da aba aberta:
     medida por aba, ela apareceria e sumiria ao alternar, o que faz a linha
     inteira pular debaixo do cursor. */
  const buscavel = (mine?.length ?? 0) + open.length >= SEARCH_FROM;

  const Heading = level === 1 ? 'h1' : 'h2';

  return (
    <section>
      {/* O título da região não é desenhado: os nomes das duas abas SÃO o
          título, e um "Salas" por cima deles seria a mesma palavra duas vezes
          em dois tamanhos. O `h1`/`h2` fica na aba ativa, que é o que um leitor
          de tela precisa ouvir para saber onde está. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex items-end gap-6" role="tablist" aria-label="Salas">
          <RoomTab
            id="mine"
            on={tab === 'mine'}
            onPick={() => setTab('mine')}
            count={mine?.length ?? null}
            as={tab === 'mine' ? Heading : 'span'}
          >
            Suas salas
          </RoomTab>
          <RoomTab
            id="open"
            on={tab === 'open'}
            onPick={() => setTab('open')}
            count={open.length}
            as={tab === 'open' ? Heading : 'span'}
          >
            Outras salas
          </RoomTab>
        </div>

        <Key onClick={onFound}>
          <Plus className="h-[15px] w-[15px]" strokeWidth={2} />
          Fundar um clube
        </Key>
      </div>

      <span
        aria-hidden
        className="mt-4 block h-px w-full bg-gradient-to-r from-beam/25 via-beam/[0.07] to-transparent"
      />

      {/* A frase da vitrine só existe na vitrine: ela explica a diferença entre
          aberta e fechada, que é uma pergunta que ninguém faz sobre uma sala em
          que já está. */}
      {tab === 'open' ? (
        <p className="mt-4 max-w-[68ch] text-[13px] leading-relaxed text-ink-dim">
          Nas <span className="text-ink">abertas</span> você entra e já pode
          avaliar. Nas <span className="text-ink">fechadas</span> dá para ver de
          que clube se trata, e entrar depende de quem administra aceitar.
        </p>
      ) : null}

      {buscavel ? (
        <div className="mt-5 max-w-[380px]">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={tab === 'mine' ? 'Buscar nas suas salas' : 'Buscar uma sala'}
          />
        </div>
      ) : null}

      {mine === null ? (
        <p className="legend animate-flicker mt-8">Acendendo o projetor</p>
      ) : vistos.length ? (
        <div
          role="tabpanel"
          id="salas-painel"
          /* Apontado para a aba ativa. Um `tabpanel` sem dono é a metade da
             promessa que `role="tab"` faz: o leitor de tela anuncia a região e
             não sabe dizer de qual das duas abas ela é. */
          aria-labelledby={`salas-${tab}`}
          className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {vistos.map((c, i) => (
            <ClubPanel
              key={c.id}
              club={c}
              index={i}
              onOpen={() => onEnter(c.slug)}
              onAsk={tab === 'open' ? () => onAsk(c) : undefined}
            />
          ))}
        </div>
      ) : (
        <div className="mt-8">
          {/* Três vazios diferentes, e dizer a mesma frase nos três seria a tela
              não saber o que aconteceu. Uma busca sem resultado não é a mesma
              coisa que uma rede sem salas. */}
          {q ? (
            <Blank title="Nenhuma sala com esse nome">
              Tente outro pedaço do nome, ou o que o clube diz sobre si.
            </Blank>
          ) : tab === 'mine' ? (
            <Blank title="Você ainda não está em nenhum clube">
              Funde o seu, ou veja em <span className="text-ink">Outras salas</span> os
              que já existem.
            </Blank>
          ) : (
            <Blank title="Não há outras salas por enquanto">
              Toda sala da rede é uma que alguém fundou. A próxima pode ser a sua.
            </Blank>
          )}
        </div>
      )}
    </section>
  );
}

function RoomTab({
  id,
  on,
  onPick,
  count,
  as: As,
  children,
}: {
  id: string;
  on: boolean;
  onPick: () => void;
  /** Null enquanto a lista não chegou: um zero ali seria uma afirmação falsa. */
  count: number | null;
  as: 'h1' | 'h2' | 'span';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`salas-${id}`}
      aria-selected={on}
      aria-controls="salas-painel"
      onClick={onPick}
      className="group relative pb-2.5"
    >
      <As
        className={cn(
          'flex items-baseline gap-2 font-display text-[26px] leading-none tracking-[0.04em] transition-colors duration-150 sm:text-[30px]',
          on ? 'text-beam' : 'text-ink-dim group-hover:text-ink'
        )}
      >
        {children}
        {count !== null ? (
          <span className={cn('q text-[13px] font-medium', on ? 'text-ink-dim' : 'text-ink-faint')}>
            {count}
          </span>
        ) : null}
      </As>
      {/* Pregado na borda de baixo do botão, como na marquise. Sempre montado e
          só trocando de opacidade: aparecer e sumir do fluxo mudaria a altura da
          linha a cada troca de aba. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-x-0 bottom-0 h-[2px] bg-dye-red transition-opacity duration-150',
          on ? 'opacity-100' : 'opacity-0'
        )}
      />
    </button>
  );
}

/* ── a rede no escuro ─────────────────────────────────────────────────────
   O convite que aparece quando o saguão não tem nada da rede para mostrar e
   quem está olhando é a pessoa que pode mudar isso.

   Não é um aviso de erro e não usa a chapa vermelha: nada quebrou, e o clube
   estar fechado para a rede é uma escolha legítima que pode continuar sendo a
   escolha. É um texto e uma porta, do tamanho de um estado vazio — porque é
   isso que ele é.

   Diz o que se ganha e o que NÃO se dá, nesta ordem, porque a segunda metade é
   a que decide: emprestar uma média não é publicar o que alguém escreveu, e a
   pessoa precisa saber disso antes de apertar e não depois. */
function DarkNetwork({
  clubs,
  onOpen,
}: {
  clubs: Club[];
  onOpen: (slug: string) => void;
}) {
  const one = clubs.length === 1 ? clubs[0] : null;
  return (
    <section className="mt-14 max-w-[62ch]">
      <h2 className="font-display text-[22px] leading-none tracking-[0.04em] text-ink-dim">
        A rede ainda está no escuro
      </h2>
      <p className="mt-3.5 text-[13px] leading-relaxed text-ink-dim">
        O saguão mostra a parede de cartazes, os filmes mais bem avaliados e as
        salas em atividade a partir do que cada clube <span className="text-ink">empresta</span> —
        e {one ? <span className="text-ink">{one.name}</span> : 'nenhuma das salas que você administra'} ainda
        não empresta nada.
      </p>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-dim">
        O que se empresta é número: a média entra nas contas da rede e o pôster
        entra na parede. <span className="text-ink">Quem deu a nota e o que escreveu continuam
        aqui dentro</span>, a não ser que você ligue “Mostrar avaliações” também.
      </p>
      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-faint">
        {one ? 'O interruptor está em' : 'Os interruptores estão em'} Ajustes do clube,
        em “O que o clube empresta à rede”.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {clubs.map(c => (
          <Key key={c.id} onClick={() => onOpen(c.slug)}>
            {clubs.length === 1 ? 'Abrir os ajustes' : c.name}
          </Key>
        ))}
      </div>
    </section>
  );
}

/** Uma contagem com o separador de milhar em português, e o plural resolvido. */
const tally = (n: number, one: string, many: string) =>
  `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;

/* ══════════════════════════════════════════════════════════════════════════
   A PAREDE DE CARTAZES

   As caixas de cartaz do foyer, com o que a rede andou vendo dentro delas. É a
   única imagem de filme que a porta de entrada deste produto já teve, e ela não
   custou nada: o pôster de cada ficha está gravado na própria ficha desde
   sempre, então a parede continua de pé com o TMDB fora do ar.

   Três decisões:

   1. **Ela anda, e nunca volta.** Mesmo princípio da parede de celuloide atrás
      de tudo: cartaz em foyer não oscila. A pista carrega a lista duas vezes e
      viaja metade dela, então a emenda cai sobre a cópia — ver poster-rail no
      index.css, onde está por que a folga é `margin` e não `gap`.

   2. **Os cartazes estão no escuro, e acendem sob o ponteiro.** As luzes da
      casa estão baixas, que é o estado deste produto inteiro; o que o ponteiro
      faz é chegar perto de uma caixa e ler o que tem nela. É a única recompensa
      interativa desta faixa, e ela entrega informação de verdade — o nome do
      filme e o que a rede deu.

   3. **O lettering fica ABAIXO da parede, não em cima dela.** Título sobre
      imagem exige um véu escuro por baixo, e um véu sobre a coisa que a faixa
      existe para mostrar é a faixa se anulando. Neste sistema só uma coisa
      escreve sobre foto — o nome do clube no painel dele —, e lá é necessário.

   A faixa é `aria-hidden`: são até 56 imagens sem ação nenhuma, e o que elas
   dizem em texto está logo abaixo, na contagem, e mais adiante no pódio, que
   nomeia os filmes por escrito. Uma parede de cartazes é para ser vista.
   ══════════════════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════════════════
   A PAREDE QUE SE PEGA COM A MÃO.

   A faixa andava por uma animação CSS e, onde a animação não podia rodar, virava
   uma caixa de rolagem com barra — e uma barra de rolagem cinza atravessada
   debaixo dos cartazes é a única peça de interface deste produto que não foi
   desenhada por ninguém.

   Agora é um modelo só, e ele é melhor do que os dois que substitui: a pista
   deriva sozinha, a mão pega, arrasta e ARREMESSA, e o arremesso desacelera de
   volta para a deriva. É a mesma coisa que um cartaz preso num trilho faz quando
   alguém o empurra.

   ── por que a rolagem e não um transform ──────────────────────────────────
   Porque arrastar é rolar. Um `translateX` guardado em estado obrigaria a
   reimplementar a captura do ponteiro, o limite e o toque; `scrollLeft` já é
   tudo isso, e no telefone o dedo continua sendo o dedo — o navegador dá inércia
   melhor do que qualquer laço escrito aqui, então lá este arquivo não faz nada.

   ── uma fórmula, dois comportamentos ──────────────────────────────────────
   A velocidade persegue um alvo, e o alvo é a deriva. Com deriva, um arremesso
   desacelera até virar o passo de repouso; sem ela (movimento reduzido), o alvo
   é zero e a mesma linha vira inércia que para. Não há dois caminhos no código
   porque não há duas ideias.
   ══════════════════════════════════════════════════════════════════════════ */

/** px de rolagem por quadro em repouso. ~27px/s: um passo de quem passeia. */
const DRIFT = 0.45;
/** Quanto da distância até o alvo a velocidade fecha por quadro. */
const SETTLE = 0.045;
/** Abaixo disto a diferença não se vê: encosta no alvo e para de calcular. */
const SNAP = 0.02;
/* Teto do arremesso. Um mouse pode reportar um salto de centenas de pixels num
   quadro — uma janela que perdeu o foco e voltou, um evento coalescido — e sem
   isto a parede sairia em disparada por um movimento que ninguém fez. */
const MAX_THROW = 42;

/* ── a última linha do cartaz não pode ser uma linha ──────────────────────
   Esta máscara tem um trabalho pequeno e um só: tirar o corte reto da borda de
   baixo. Quem escurece o pé da faixa é o véu de sombra, mais abaixo; aqui o
   assunto é só a aresta.

   Foi uma dissolução de um terço da altura por um dia, e era demais — os
   cartazes sumiam em vez de terminarem. O tamanho certo é o de uma borda: os
   últimos vinte e quatro pixels, e nada antes disso.

   Em PIXELS e não em porcentagem, e é a diferença que faz a coisa parecer a
   mesma nos dois tamanhos: a faixa tem 132px no telefone e 176px no computador,
   e uma borda de 15% seria vinte pixels lá e vinte e seis aqui — a mesma
   intenção com duas espessuras. Uma aresta suave tem uma espessura só. */
const POSTER_FADE = 'linear-gradient(to bottom, #000 calc(100% - 24px), transparent 100%)';

/* Lido uma vez, como o `data-render` da parede de celuloide. O que esta
   preferência desliga é o movimento que começa SOZINHO; arrastar continua,
   porque é resposta a um gesto e não uma performance. */
const REDUCED =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function usePosterRail(live: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    /* No telefone este laço não existe: o dedo já rola, e o navegador dá uma
       inércia melhor do que a daqui. Duas fontes escrevendo `scrollLeft` no
       mesmo elemento brigariam entre si a cada quadro. */
    if (!el || !live) return;

    const target = REDUCED ? 0 : DRIFT;
    let velocity = target;
    let dragging = false;
    let lastX = 0;
    let lastT = 0;
    let raf = 0;

    /* A página inteira tem `zoom`, então o pixel do ponteiro e o pixel do
       layout são unidades diferentes. Medido aqui e não dentro do `move`: um
       rect e um offsetWidth são dois layouts forçados, e um mouse dispara
       centenas de eventos por segundo. Ver a mesma nota em holographic-wall. */
    let k = 1;
    const measure = () => {
      k = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);

    /* ── o laço, sem começo e sem fim ───────────────────────────────────
       A pista carrega a lista um número PAR de vezes, então metade dela é um
       conjunto inteiro de cópias: recuar meia pista cai exatamente sobre a
       mesma imagem. O salto é dado ANTES de a rolagem chegar na borda, porque
       o navegador prende `scrollLeft` em zero — deixar ele bater é o que
       transformaria a volta num tranco. */
    const step = (dx: number) => {
      const half = el.scrollWidth / 2;
      if (half <= 0) return;
      let next = el.scrollLeft + dx;
      if (next < 0) next += half;
      else if (next >= half) next -= half;
      el.scrollLeft = next;
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (dragging) return;
      const gap = target - velocity;
      velocity = Math.abs(gap) < SNAP ? target : velocity + gap * SETTLE;
      if (velocity) step(velocity);
    };

    /* ── puxar não é clicar ─────────────────────────────────────────────
       Cada cartaz abre uma folha, e a mesma superfície é o que se agarra para
       arrastar a parede. Sem isto, todo arremesso terminaria abrindo o filme
       que estava debaixo do dedo quando a mão soltou.

       A distância percorrida é o que separa os dois gestos, e o corte é baixo:
       quatro pixels é mais do que o tremor de uma mão parada e menos do que
       qualquer intenção de puxar. */
    const SLOP = 4;
    let travel = 0;

    /* ── nem captura de ponteiro, nem preventDefault ────────────────────
       As duas coisas estavam aqui e as duas matavam o clique nos cartazes.

       `preventDefault` num `pointerdown` cancela os eventos de mouse de
       compatibilidade que vêm depois — e o `click` é um deles. Ele estava aqui
       para impedir o arrasto nativo da imagem, trabalho que o `draggable={false}`
       de cada cartaz já faz, e que o `dragstart` abaixo garante.

       `setPointerCapture` redireciona os eventos para o elemento que capturou,
       e o `click` vai junto: ele passava a nascer na FAIXA em vez de no cartaz,
       então o botão nunca era avisado. A captura existia para não perder o
       ponteiro ao sair da faixa no meio de um arrasto — e ouvir no `window`
       resolve isso sem retarget nenhum.

       O preço é lembrar de tirar os dois ouvintes do window ao soltar, o que a
       limpeza abaixo faz. */
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      /* ── uma recusa que sobrou ────────────────────────────────────────
         A recusa de clique é armada com `once`, e `once` só desarma quando o
         evento chega. Um arrasto que termina FORA da faixa não gera clique
         nenhum — e a recusa ficava lá, esperando, para engolir o próximo
         clique de verdade.

         Aqui é o lugar de limpar: um clique sempre vem logo depois do
         `pointerup` do mesmo gesto, então qualquer recusa que ainda exista
         quando um gesto NOVO começa é de um gesto que já acabou. */
      el.removeEventListener('click', swallow, { capture: true });
      dragging = true;
      travel = 0;
      velocity = 0;
      lastX = e.clientX;
      lastT = e.timeStamp;
      el.dataset.grabbing = 'true';
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    };

    /* O arrasto nativo de imagem, pelo caminho que não custa o clique. */
    const noDrag = (e: DragEvent) => e.preventDefault();

    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = (e.clientX - lastX) / k;
      const dt = Math.max(1, e.timeStamp - lastT);
      lastX = e.clientX;
      lastT = e.timeStamp;
      travel += Math.abs(dx);
      step(-dx);
      /* Em px por quadro, e suavizado: um único evento com um salto grande não
         pode virar sozinho um arremesso que a mão não deu. */
      velocity = velocity * 0.7 + ((-dx * 16.7) / dt) * 0.3;
    };

    /* Engolido na CAPTURA, antes de chegar ao cartaz. Um clique só nasce depois
       do `pointerup`, então basta armar a recusa aqui e desarmá-la sozinha —
       `once` — para que o clique seguinte, o de verdade, passe. */
    const swallow = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const up = () => {
      if (!dragging) return;
      dragging = false;
      delete el.dataset.grabbing;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      velocity = Math.max(-MAX_THROW, Math.min(MAX_THROW, velocity));
      if (travel > SLOP) el.addEventListener('click', swallow, { capture: true, once: true });
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('dragstart', noDrag);

    /* ── e nada roda com a parede fora da tela ───────────────────────────
       Um laço perpétuo por uma faixa que já saiu de vista é trabalho contra
       uma instância que dorme por falta dele. O `requestAnimationFrame` já
       para com a aba escondida; isto cuida do outro caso, que é a pessoa ter
       rolado a página para baixo. */
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !raf) raf = requestAnimationFrame(frame);
        else if (!entry.isIntersecting && raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      },
      { threshold: 0 }
    );
    io.observe(el);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('dragstart', noDrag);
      el.removeEventListener('click', swallow, { capture: true });
      /* Desmontar no meio de um arrasto deixaria dois ouvintes no window
         mexendo num elemento que já saiu da árvore. */
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [live]);

  return ref;
}

function PosterWall({
  films,
  counts,
}: {
  films: LobbyMovie[];
  counts: LobbySnapshot['counts'];
}) {
  /* Qual cartaz está aberto. Guardado aqui e não no saguão inteiro porque a
     folha é da parede: nada mais nesta tela abre um filme. */
  const [aberto, setAberto] = useState<LobbyMovie | null>(null);
  /* ── quantas vezes a lista se repete ───────────────────────────────────
     A metade da pista precisa ser mais larga que qualquer tela, ou o laço mostra
     o fim da fileira e volta com um pulo. Com vinte e oito cartazes uma cópia já
     passa disso; com seis, não — e aí a lista se repete até passar.

     O número de cópias é sempre PAR, e isso não é estética: a pista viaja
     exatamente metade de si mesma, então a emenda só cai sobre uma cópia inteira
     se houver o mesmo tanto dos dois lados. */
  const CASE_PX = 125;
  const HALF_PX = 1800;
  const copies = Math.max(2, 2 * Math.ceil(HALF_PX / CASE_PX / films.length));

  /* O laço só é montado onde há ponteiro fino. No telefone o dedo já rola e o
     navegador já dá inércia — melhor do que a daqui, e de graça. */
  const rail = usePosterRail(useFinePointer());

  return (
    <section className="relative">
      {/* ══════════════════════════════════════════════════════════════════
          A MOLDURA, e por que ela existe.

          Os véus — as duas pontas e a dissolução de baixo — moravam dentro da
          faixa. Enquanto ela era `overflow: hidden` isso funcionava; no dia em
          que virou uma caixa de ROLAGEM, parou, e de um jeito que só aparece
          esperando: um elemento absoluto dentro de um container que rola faz
          parte do conteúdo rolável dele. Os véus foram desenhados na posição
          zero e saíram deslizando junto com os cartazes. Depois de alguns
          segundos a parede não tinha véu nenhum.

          Então há duas camadas agora: esta moldura, que não rola e segura os
          véus, e a faixa lá dentro, que rola. Os véus ficam parados porque o
          pai deles ficou parado.

          Sem borda embaixo: uma linha dura ali fazia a parede TERMINAR, e o
          letreiro começava do zero num bloco separado. O que os liga é a
          dissolução — os cartazes viram sala, e o texto fica dentro disso.

          ── e a dissolução é de DUAS naturezas ─────────────────────────────
          Uma escurece e a outra apaga, e cada uma tem um tamanho de trabalho
          bem diferente.

          O véu escuro (mais abaixo) faz o percurso longo: pinta a cor da sala
          por cima do cartaz ao longo do pé inteiro da faixa. É ele que apaga a
          imagem e abre espaço para o letreiro.

          A máscara é alfa e tem um trabalho pequeno: tirar o corte reto da
          borda de baixo, e nada além disso. Ela chegou a dissolver um terço da
          altura e era demais — os cartazes sumiam em vez de terminarem. O que
          ela faz agora é o que uma aresta suave faz, na espessura de uma
          aresta.

          Onde ela apaga, quem aparece é o que estava atrás — a parede de
          celuloide, com o feixe correndo nela. É a diferença entre um cartaz
          que termina contra um fundo e um que termina na sala.

          Na moldura e não na faixa, de propósito. Uma máscara na caixa que rola
          seria pintada no espaço dela e ficaria parada — funciona —, mas aqui
          ela precisa alcançar também os véus das pontas, que são irmãos da
          faixa e não filhos dela. Aplicada no pai, alcança tudo de uma vez.

          `-webkit-` junto: o Safari ainda pede o prefixo, e sem ele a faixa
          termina num corte reto em metade dos telefones. */}
      <div
        className="relative h-[132px] sm:h-[176px]"
        style={{
          maskImage: POSTER_FADE,
          WebkitMaskImage: POSTER_FADE,
        }}
      >
      {/* ── a faixa deixou de ser só imagem ────────────────────────────────
          Cada cartaz abre a folha do filme, então ela não pode mais ser
          `aria-hidden`: esconder do leitor de tela uma região que contém
          botões é escondê-los de quem depende dele.

          Só que a lista é REPETIDA — é o que faz o laço não ter emenda — e
          cinquenta e seis botões para vinte e oito filmes seriam cinquenta e
          seis paradas de tabulação para vinte e oito destinos. Então a primeira
          cópia é a de verdade e as outras são decoração: `aria-hidden` e fora
          da ordem de foco, uma por uma. Quem enxerga vê uma parede contínua;
          quem tabula percorre cada filme uma vez. */}
      <div ref={rail} className="poster-rail absolute inset-0 bg-house-deep/40">
        <div className="flex h-full w-max">
          {Array.from({ length: copies }).flatMap((_, copy) =>
            films.map(film => (
              <button
                type="button"
                key={`${copy}:${film.id}`}
                onClick={() => setAberto(film)}
                aria-hidden={copy > 0 || undefined}
                tabIndex={copy > 0 ? -1 : undefined}
                aria-label={`${film.title} — ${fmt(film.average)} em ${plural(film.takes, 'ficha', 'fichas')}`}
                className="group relative mr-2 h-full w-[88px] flex-none overflow-hidden bg-house-deep sm:w-[117px]"
              >
                <img
                  src={film.poster ?? undefined}
                  alt=""
                  loading="lazy"
                  /* O arrasto nativo de imagem sai: sem isto, puxar a parede
                     leva um fantasma do cartaz junto do cursor. */
                  draggable={false}
                  className="h-full w-full object-cover opacity-[0.38] saturate-[0.85] transition duration-300 ease-beam group-hover:opacity-100 group-hover:saturate-100"
                />
                <span className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-house-deep/95 via-house-deep/75 to-transparent px-2 pb-6 pt-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <span className="block truncate font-display text-[12px] leading-none tracking-[0.05em] text-beam">
                    {film.title}
                  </span>
                  <span className="q mt-1.5 block text-[10.5px] text-ink-dim">
                    {fmt(film.average)} · {plural(film.takes, 'ficha', 'fichas')}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>

        {/* As pontas da parede caem para dentro da sala, em vez de serem cortadas
            pela beirada da janela. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-14 bg-gradient-to-r from-house to-transparent sm:w-28"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-14 bg-gradient-to-l from-house to-transparent sm:w-28"
        />

        {/* ── a parede se apaga para baixo ────────────────────────────────
            Os cartazes escurecem até a cor da sala, então a faixa não tem fim —
            ela vira sala. É o que permite o letreiro subir para dentro dela sem
            disputar legibilidade com imagem nenhuma.

            Começa cedo e quase invisível: aos 40% da queda ainda são 20% de
            escuro, e é isso que faz ler como um apagar e não como uma tampa. O
            trecho que importa é o fim — sólido aos 88%, porque os últimos trinta
            e poucos pixels são onde o topo do título encosta, e ali não pode
            haver cartaz brigando com a palavra.

            As paradas são 40% e 90% porque a escala de posição do Tailwind anda
            de cinco em cinco: `to-88%` não existe, não vira classe nenhuma, e
            sai da folha em silêncio — o véu terminaria só no fim do próprio
            corpo, que é justamente onde ele não pode terminar. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[70%] bg-gradient-to-b from-transparent via-house/20 via-40% to-house to-90%"
        />
      </div>

      {/* Houve aqui uma mancha de luz — a claridade que uma vitrine acesa jogaria
          no chão à frente dela. Foi construída, vista e removida pelo dono: numa
          tela escura, uma nuvem larga e clara não lê como luz, lê como uma
          mancha. Registrado para não voltar. O que amarra a parede ao letreiro é
          a dissolução acima e a sobreposição abaixo, e as duas bastam. */}

      {/* Sobe para DENTRO da faixa: o topo do letreiro fica onde os cartazes já
          se apagaram, e é isso que faz um referenciar o outro em vez de dois
          blocos empilhados. Sem o negativo havia trinta e seis pixels de nada
          entre a parede e o que ela é. */}
      <div className="relative mx-auto -mt-7 w-full max-w-[1240px] px-4 sm:-mt-9 sm:px-6">
        <h1 className="font-display text-[38px] leading-none tracking-[0.04em] text-beam sm:text-[46px]">
          O que a rede andou vendo
        </h1>
        {/* Três números medidos, e não três cartões de estatística: é uma frase,
            e ela é a legenda da parede acima. */}
        <p className="q mt-3 text-[13px] text-ink-dim">
          {tally(counts.reviews, 'ficha', 'fichas')} · {tally(counts.movies, 'filme', 'filmes')} ·{' '}
          {tally(counts.clubs, 'sala', 'salas')}
        </p>
      </div>

      {/* Montada só quando há filme aberto: um `<dialog>` fechado no ar ainda é
          um nó com um `showModal` esperando, e a folha busca duas coisas ao
          nascer. Remontar por filme também é o que garante que ela nunca mostre
          a sinopse do cartaz anterior por um quadro. */}
      {aberto ? (
        <FilmPeek key={aberto.id} film={aberto} onClose={() => setAberto(null)} />
      ) : null}
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   EM CARTAZ AGORA

   O trilho embaixo da marquise, que num cinema é onde ficam as sessões do dia. A
   diferença é que estas estão acontecendo neste segundo: uma sala aberta com um
   filme dentro é gente assistindo junto agora, e este produto sabe disso sem
   consultar nada — a sala ao vivo mora em memória.

   É a coisa mais urgente que esta tela pode dizer, e é a mais rara: quase sempre
   não há nenhuma, e aí ela não existe. Por isso é uma FAIXA FINA e não uma
   seção — quando aparece, empurra o chaveiro alguns pixels para baixo, e não
   uma tela inteira.

   Só é porta quando dá para atravessá-la: um clube fechado de que você não é
   responde 403, e um clique que leva a um erro é a tela prometendo o que não
   pode cumprir. Sem porta, continua sendo notícia — que é o que ela é.
   ══════════════════════════════════════════════════════════════════════════ */
function NowPlaying({
  sessions,
  canEnter,
  onEnter,
}: {
  sessions: LobbyLive[];
  canEnter: (club: { slug: string; visibility: 'public' | 'private' }) => boolean;
  onEnter: (slug: string) => void;
}) {
  return (
    <div className="relative border-b border-white/[0.06] bg-house-deep/70">
      <div className="mx-auto flex max-w-[1240px] items-center gap-4 px-4 py-2.5 sm:px-6">
        <span className="flex flex-none items-center gap-2">
          {/* A lâmpada de gravação, que neste produto é o que quer dizer "está
              acontecendo". Respira; nunca apaga. */}
          <span
            aria-hidden
            className="h-1.5 w-1.5 animate-lamp rounded-full bg-dye-red-lit shadow-[0_0_10px_rgba(242,86,74,0.85)]"
          />
          <span className="legend text-[10.5px] text-dye-red-lit">Em cartaz</span>
        </span>

        <ul className="flex min-w-0 flex-1 gap-6 overflow-x-auto">
          {sessions.map(session => {
            const inner = (
              <>
                <Poster
                  src={session.movie.poster}
                  className="h-[34px] w-[23px] flex-none"
                />
                <span className="min-w-0">
                  <span className="block truncate font-display text-[13px] leading-none tracking-[0.04em] text-beam transition-colors group-hover:text-beam-hot">
                    {session.movie.title}
                  </span>
                  <span className="q mt-1 block truncate text-[10.5px] text-ink-dim">
                    {session.club.name}
                    {session.watching ? ` · ${session.watching} na sala` : ''}
                    {session.status === 'paused' ? ' · pausado' : ''}
                  </span>
                </span>
              </>
            );
            return (
              <li key={session.club.slug} className="flex-none">
                {canEnter(session.club) ? (
                  <button
                    type="button"
                    onClick={() => onEnter(session.club.slug)}
                    className="group flex items-center gap-2.5 text-left"
                  >
                    {inner}
                  </button>
                ) : (
                  <span className="flex items-center gap-2.5">{inner}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/* ── o pódio ──────────────────────────────────────────────────────────────
   O cartaz, o lugar, o nome, a régua e a média — e o número de fichas, sempre,
   porque uma média sem o tamanho da amostra é meia informação. O piso de três
   está escrito na linha da região; ele é o que impede o pódio de ser a lista de
   quem foi avaliado uma vez por alguém entusiasmado.

   A posição é um número que se lê, então ela é Poppins com `.q` e não display:
   a face de letreiro não tem algarismo tabular, e uma coluna de posições que se
   desloca é uma coluna quebrada. É a mesma regra que vale para toda nota. */
function PodiumFilm({
  film,
  rank,
  index,
}: {
  film: LobbyPodiumMovie;
  rank: number;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1], delay: Math.min(index, 9) * 0.045 }}
    >
      <Poster src={film.poster} alt={film.title} className="aspect-[2/3] w-full" />
      <div className="mt-3 flex items-baseline gap-2">
        <span className="q flex-none text-[15px] font-semibold leading-none text-ink-dim">
          {rank}
        </span>
        <span className="line-clamp-2 min-w-0 font-display text-[16px] leading-[1.12] tracking-[0.03em] text-beam">
          {film.title}
        </span>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <Strip value={film.average} cells={10} className="h-[5px] min-w-0 flex-1" />
        <span className="q flex-none text-[13px] font-medium text-beam">{fmt(film.average)}</span>
      </div>
      <p className="q mt-1.5 text-[10.5px] text-ink-dim">
        {plural(film.takes, 'ficha', 'fichas')}
        {film.clubs > 1 ? ` · ${plural(film.clubs, 'sala', 'salas')}` : ''}
      </p>
    </motion.div>
  );
}

/** A marca de um clube: a foto dele, ou a inicial sobre a cor dele. */
function ClubMark({
  club,
  className,
}: {
  club: { id: string; name: string; photo: string | null };
  className?: string;
}) {
  if (club.photo) {
    return (
      <img
        src={club.photo}
        alt=""
        loading="lazy"
        className={cn('flex-none rounded-cell object-cover ring-1 ring-white/[0.08]', className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'flex flex-none items-center justify-center rounded-cell font-display leading-none text-house-deep',
        className
      )}
      style={{ background: reelColor(null, club.id) }}
    >
      {initialsOf(club.name)}
    </span>
  );
}

/* ── uma sala em atividade ────────────────────────────────────────────────
   Uma LINHA, e não mais um cartão. A tela já tem duas grades de painéis de
   clube, e uma terceira grade da mesma coisa em outra ordem seria a página
   repetindo o formato até ele parar de significar. A pergunta aqui é outra —
   onde está acontecendo alguma coisa — e o formato responde: uma lista curta,
   ordenada, com o número que a ordenou impresso na ponta.

   Uma sala fechada de que você não é aparece na lista e não é porta: ela é
   informação sobre a rede, e a maneira de entrar nela está na vitrine, embaixo,
   onde o botão diz o que vai acontecer. */
function ActiveClub({
  club,
  rank,
  enterable,
  onOpen,
}: {
  club: LobbyClub;
  rank: number;
  enterable: boolean;
  onOpen: () => void;
}) {
  const inner = (
    <>
      <span className="q w-4 flex-none text-[13px] font-semibold text-ink-dim">{rank}</span>
      <ClubMark club={club} className="h-10 w-10 text-[15px]" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate font-display text-[17px] leading-none tracking-[0.04em] text-beam transition-colors group-hover:text-beam-hot">
            {club.name}
          </span>
          {club.visibility === 'private' ? (
            <span className="legend flex-none text-[9.5px] text-ink-dim">Fechado</span>
          ) : null}
        </span>
        {club.tagline ? (
          <span className="mt-1.5 block truncate text-[12px] text-ink-dim">{club.tagline}</span>
        ) : null}
      </span>
      <span className="flex flex-none flex-col items-end">
        <span className="q text-[13px] text-beam">{plural(club.recent, 'ficha', 'fichas')}</span>
        <span className="q mt-1 text-[10.5px] text-ink-dim">
          {plural(club.members, 'pessoa', 'pessoas')}
        </span>
      </span>
    </>
  );

  return (
    <li className="border-b border-white/[0.06] last:border-0">
      {enterable ? (
        <button
          type="button"
          onClick={onOpen}
          className="group -mx-2 flex w-[calc(100%+1rem)] items-center gap-3.5 rounded-cell px-2 py-3 text-left transition-colors duration-150 hover:bg-house-seat sm:gap-4"
        >
          {inner}
        </button>
      ) : (
        <div className="flex w-full items-center gap-3.5 px-0 py-3 sm:gap-4">{inner}</div>
      )}
    </li>
  );
}

/* ── a ficha em destaque ──────────────────────────────────────────────────
   A única coisa deste saguão com voz humana. Todo o resto é cartaz e número; se
   a tela parasse aí, ela seria um painel de estatística sobre um produto cujo
   assunto é o que as pessoas acharam.

   É a mesma placa do mural de dentro de um clube, de propósito: quem já usou o
   app reconhece a forma antes de ler, e o par alto/baixo é o que separa isto do
   feed de qualquer app de filme — onze critérios dizem onde a pessoa se
   entusiasmou e onde se decepcionou, e "fulano avaliou Parasita — 8,5" não diz.

   A placa inteira é o botão. Um título clicável dentro de um cartão inerte faz
   a pessoa mirar em quatro palavras quando a superfície toda quer dizer a mesma
   coisa. E ela leva à ficha, não ao clube: quem clica está buscando um texto. */
function FeatureTake({ take, onOpen }: { take: LobbyFeature; onOpen: () => void }) {
  const reactions = take.replies + take.agrees + take.disagrees;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="plate group mt-6 block w-full max-w-[760px] text-left transition-colors duration-150 hover:bg-house-rail/40"
    >
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-4">
        <Reel color={reelColor(take.actor.dot, take.actor.id)} src={take.actor.avatar} size="sm">
          {initialsOf(take.actor.name)}
        </Reel>
        <span className="font-display text-[13px] uppercase tracking-[0.1em] text-ink">
          {take.actor.name}
        </span>
        <span className="text-[12.5px] text-ink-dim">avaliou, no</span>
        {/* O nome da sala em latão: é escolha e lugar, não ação. */}
        <span className="font-display text-[13px] uppercase tracking-[0.1em] text-dye-brass">
          {take.club.name}
        </span>
        <span className="q ml-auto text-[10.5px] text-ink-faint">{whenOf(take.at)}</span>
      </span>

      <span className="flex gap-4 px-4 pb-4 pt-2.5">
        <Poster src={take.moviePoster} className="aspect-[2/3] w-[62px] flex-none sm:w-[74px]" />

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-display text-[24px] leading-none tracking-[0.02em] text-beam transition-colors group-hover:text-beam-hot">
              {take.movieTitle}
            </span>
            <span className="q text-[11.5px] text-ink-dim">{take.genre}</span>
          </span>

          <span className="mt-2.5 flex items-center gap-3">
            <Strip value={take.final} cells={10} className="h-[6px] w-[120px] flex-none" />
            <span className="q text-[15px] font-medium text-beam">{fmt(take.final)}</span>
            <span className="q text-[11px] text-ink-faint">/10</span>
          </span>

          {take.ends ? (
            <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
              <span className="flex items-center gap-1.5 text-ink-dim">
                <ThumbsUp className="h-3 w-3 flex-none text-ink-faint" strokeWidth={1.9} aria-hidden />
                {take.ends.high.name}
                <span className="q text-beam">{fmt(take.ends.high.value)}</span>
              </span>
              <span className="flex items-center gap-1.5 text-ink-dim">
                <ThumbsDown className="h-3 w-3 flex-none text-ink-faint" strokeWidth={1.9} aria-hidden />
                {take.ends.low.name}
                <span className="q text-ink">{fmt(take.ends.low.value)}</span>
              </span>
            </span>
          ) : null}

          {take.excerpt ? (
            <span className="mt-2.5 block break-words text-[13px] italic leading-relaxed text-ink-dim">
              “{take.excerpt}”
            </span>
          ) : null}

          {/* Cada contagem se cala em zero, e concordância e discordância nunca
              viram um número só: uma ficha com três discordâncias anunciando
              "3" debaixo de um polegar para cima é a contagem tomando partido
              pelos dois lados. */}
          {reactions ? (
            <span className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              {take.replies ? (
                <span className="q flex items-center gap-1.5 text-[11px] text-ink-dim">
                  <MessageSquare className="h-3 w-3 text-ink-faint" strokeWidth={1.9} aria-hidden />
                  {take.replies}
                </span>
              ) : null}
              {take.agrees ? (
                <span className="q flex items-center gap-1.5 text-[11px] text-ink-dim">
                  <ThumbsUp className="h-3 w-3 text-ink-faint" strokeWidth={1.9} aria-hidden />
                  {take.agrees}
                </span>
              ) : null}
              {take.disagrees ? (
                <span className="q flex items-center gap-1.5 text-[11px] text-ink-dim">
                  <ThumbsDown className="h-3 w-3 text-ink-faint" strokeWidth={1.9} aria-hidden />
                  {take.disagrees}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

/* ── um painel de marquise ────────────────────────────────────────────────
   A foto do clube atrás do vidro, o nome em Bebas, e embaixo o que ele é. A
   proporção é a de um cartaz na entrada de uma sala, não a de um cartão de
   dashboard: retrato, e não a fileira de retângulos iguais que toda grade de
   cards vira.

   Sem foto, o painel não fica vazio — fica com a inicial do nome em corpo
   grande sobre a cor do clube. Um lugar sem cartaz ainda é um lugar. */
function ClubPanel({
  club,
  index,
  onOpen,
  onAsk,
}: {
  club: Club;
  index: number;
  onOpen: () => void;
  onAsk?: () => void;
}) {
  const mine = club.isMember;
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1], delay: Math.min(index, 8) * 0.045 }}
      className="flex flex-col overflow-hidden rounded-plate bg-house-seat ring-1 ring-white/[0.07]"
    >
      <button
        type="button"
        onClick={onOpen}
        className="group relative block aspect-[4/3] w-full overflow-hidden bg-house-deep text-left"
      >
        {club.photo ? (
          <img
            src={club.photo}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 ease-beam group-hover:scale-[1.03]"
          />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center font-display text-[56px] leading-none tracking-[0.06em] text-house-deep transition-transform duration-300 ease-beam group-hover:scale-[1.03]"
            style={{ background: reelColor(null, club.id) }}
          >
            {initialsOf(club.name)}
          </span>
        )}
        {/* O nome sobre a foto, com a sala escurecendo por baixo dele: um título
            branco sobre uma imagem qualquer é ilegível em metade das imagens. */}
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-house-deep via-house-deep/80 to-transparent px-4 pb-3 pt-10">
          <span className="block font-display text-[22px] leading-none tracking-[0.06em] text-beam">
            {club.name}
          </span>
        </span>
        {club.visibility === 'private' ? (
          <span className="legend absolute right-3 top-3 rounded-cell bg-house-deep/80 px-2 py-1 text-[9.5px] text-ink-dim">
            Fechado
          </span>
        ) : null}
      </button>

      <div className="flex flex-1 flex-col gap-3 px-4 py-3.5">
        {club.tagline ? (
          <p className="text-[13px] leading-relaxed text-ink-dim">{club.tagline}</p>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-3">
          <span className="q text-[12px] text-ink-faint">
            {typeof club.members === 'number'
              ? plural(club.members, 'pessoa', 'pessoas')
              : club.role === 'admin'
                ? 'Você administra'
                : ''}
          </span>

          {mine ? (
            <span className="flex items-center gap-3">
              {club.role === 'admin' ? (
                <span className="flex items-center gap-1 font-display text-[10.5px] uppercase tracking-[0.12em] text-dye-brass">
                  <ShieldCheck className="h-[13px] w-[13px]" strokeWidth={1.8} />
                  ADM
                </span>
              ) : null}
              <Key tone="ghost" onClick={onOpen}>
                Entrar
              </Key>
            </span>
          ) : club.requested ? (
            /* "Pedido enviado" é um estado, não uma confirmação que some: quem
               volta ao saguão amanhã precisa ver que já pediu, e o mesmo botão
               desfaz — desistir de um pedido não merece uma segunda tela. */
            <button
              type="button"
              onClick={onAsk}
              title="Desistir do pedido"
              className="flex items-center gap-1.5 rounded-cell px-2 py-1.5 font-display text-[11px] uppercase leading-none tracking-[0.12em] text-dye-brass transition-colors hover:text-ink-dim"
            >
              <Clock className="h-[13px] w-[13px]" strokeWidth={1.8} />
              Pedido enviado
            </button>
          ) : (
            /* O rótulo diz o que vai acontecer, e não o que a sala é: numa
               aberta o clique põe você dentro, numa fechada ele começa uma
               espera. Um botão só que faz duas coisas diferentes com o mesmo
               nome é o botão mentindo para metade das pessoas. */
            <Key onClick={onAsk}>
              {club.visibility === 'public' ? 'Entrar' : 'Pedir para entrar'}
            </Key>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ── fundar ───────────────────────────────────────────────────────────────
   Quem cria é ADM, e isso não é uma opção em lugar nenhum: uma sala sem ninguém
   que possa aprovar uma entrada nasce trancada.

   Nasce privada quando não se diz nada, e a folha diz isso em vez de esconder
   num padrão: o erro caro tem um lado só. */
function FoundClub({ onClose, onFounded }: { onClose: () => void; onFounded: (slug: string) => void }) {
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [photo, setPhoto] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { club } = await clubs.create({
        name: name.trim(),
        tagline: tagline.trim(),
        visibility,
        photo,
      });
      onFounded(club.slug);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-house-deep/80 backdrop-blur-sm sm:items-center">
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="plate max-h-[92dvh] w-full max-w-[460px] overflow-y-auto p-5 sm:p-6"
      >
        <h2 className="font-display text-[26px] leading-none tracking-[0.04em] text-beam">
          Fundar um clube
        </h2>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-dim">
          Você será o ADM: é quem aprova quem entra e quem muda o que a sala é.
        </p>

        <div className="mt-6 flex flex-col gap-4">
          <LobbyField
            ref={first}
            label="Nome"
            value={name}
            onChange={setName}
            maxLength={40}
            hint="Único na rede — não dá para haver dois clubes com o mesmo nome."
          />
          <LobbyField
            label="Uma linha sobre ele"
            value={tagline}
            onChange={setTagline}
            maxLength={140}
            hint="Opcional. É o que aparece embaixo do nome na vitrine."
          />

          <div className="flex flex-col gap-2">
            <span className="legend text-[10px]">Foto</span>
            <div className="flex items-center gap-3">
              <span className="flex h-[64px] w-[64px] flex-none items-center justify-center overflow-hidden rounded-plate bg-house-deep ring-1 ring-house-rail">
                {photo ? (
                  <img src={photo} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="font-display text-[24px] text-ink-faint">
                    {name.trim() ? initialsOf(name) : '—'}
                  </span>
                )}
              </span>
              <label className="cursor-pointer rounded-cell px-3 py-2 font-display text-[12px] uppercase leading-none tracking-[0.14em] text-ink-dim ring-1 ring-house-rail transition-colors hover:text-beam hover:ring-beam/70">
                {photo ? 'Trocar' : 'Escolher'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) setFile(f);
                    e.target.value = '';
                  }}
                />
              </label>
              {photo ? (
                <Key tone="ghost" onClick={() => setPhoto(null)}>
                  Tirar
                </Key>
              ) : null}
            </div>
          </div>

          {/* A escolha é sobre a PORTA, não sobre a fachada: os dois aparecem no
              saguão com nome e foto. O que muda é como se entra, e é isso que as
              duas frases dizem. */}
          <fieldset className="flex flex-col gap-2">
            <span className="legend text-[10px]">Como se entra</span>
            <div className="flex gap-2">
              <Choice
                on={visibility === 'public'}
                onClick={() => setVisibility('public')}
                title="Aberto"
                line="Qualquer pessoa entra e já pode avaliar. Sem pedido, sem espera."
              />
              <Choice
                on={visibility === 'private'}
                onClick={() => setVisibility('private')}
                title="Fechado"
                line="Aparece no saguão, mas entrar depende de você aprovar. O acervo é só de quem é do clube."
              />
            </div>
          </fieldset>

          {error ? <Fault>{error}</Fault> : null}
        </div>

        <div className="mt-6 flex items-center gap-2">
          <Key tone="commit" type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Fundando' : 'Fundar'}
          </Key>
          <Key tone="ghost" onClick={onClose}>
            Cancelar
          </Key>
        </div>
      </motion.form>

      {file ? (
        <PortraitGate
          file={file}
          onCancel={() => setFile(null)}
          onDone={url => {
            setPhoto(url);
            setFile(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Choice({
  on,
  onClick,
  title,
  line,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  line: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'flex-1 rounded-cell px-3 py-2.5 text-left ring-1 transition-colors',
        on ? 'bg-dye-brass/10 ring-dye-brass' : 'ring-house-rail hover:ring-white/20'
      )}
    >
      <span
        className={cn(
          'flex items-center gap-1.5 font-display text-[12px] uppercase leading-none tracking-[0.12em]',
          on ? 'text-dye-brass' : 'text-ink'
        )}
      >
        {on ? <Check className="h-[13px] w-[13px]" strokeWidth={2.2} /> : null}
        {title}
      </span>
      <span className="mt-1.5 block text-[12px] leading-snug text-ink-dim">{line}</span>
    </button>
  );
}

type LobbyFieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>;

const LobbyField = forwardRef<HTMLInputElement, LobbyFieldProps>(function LobbyField(
  { label, value, onChange, hint, ...rest },
  ref
) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="legend text-[10px]">{label}</span>
      <input
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-cell bg-house-deep px-3 py-2.5 text-[14px] text-ink caret-dye-red ring-1 ring-house-rail transition-shadow placeholder:text-ink-dim focus-visible:outline-none focus-visible:ring-dye-brass"
        {...rest}
      />
      {hint ? <span className="text-[12px] text-ink-faint">{hint}</span> : null}
    </label>
  );
});

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Clock, MessageSquare, Plus, ShieldCheck, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { Blank, Fault, IconKey, Key, Poster, Reel, SearchField, Strip, TrailerKey } from '@/components/bits';
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
  seriesApi,
  type Club,
  type LobbyClub,
  type LobbyFeature,
  type LobbyFilm,
  type LobbyLive,
  type LobbyMovie,
  type LobbyPodiumMovie,
  type LobbyShow,
  type LobbySnapshot,
  type LobbyTake,
  type Movie,
  type SessionUser,
  type Universe,
} from '@/lib/api';
import { cn, named, norm, plural, useFinePointer, whenOf } from '@/lib/utils';

/* ── o saguão ─────────────────────────────────────────────────────────────
   A primeira tela da rede, a que responde "onde eu vou". Duas listas de clubes
   que respondem perguntas diferentes — `mine` é o chaveiro de quem já chegou,
   `open` a vitrine de quem está olhando —, mais uma parede de cartazes, um
   trilho de sessões ao vivo, o pódio da rede, as salas em atividade e uma ficha
   em destaque.

   A parede é uma FAIXA e não uma tela cheia: quem volta todo dia continua vendo
   o próprio chaveiro sem rolar a página.

   Toda seção se cala sozinha quando não tem o que dizer. Mesma regra da
   contagem de votos numa ficha — um zero não é um dado —, em escala de seção:
   seis rankings vazios leem como estádio vazio. */

/* Mais lento que o sino (90s): o que muda aqui é o que a REDE fez, e chegar
   dois minutos atrasado numa parede não custa nada. Pausa com a aba escondida —
   este app fica aberto por horas, e um cronômetro numa aba esquecida é trabalho
   constante contra uma instância que dorme por falta dele. */
const POLL_MS = 120_000;

export function Lobby({
  me,
  universe,
  onUniverse,
  onEnter,
  onSignOut,
  onOpenSelf,
}: {
  me: SessionUser;
  /* Qual acervo esta tela está contando. Os CLUBES são os mesmos nos dois: um
     clube é um clube, com a mesma gente e o mesmo ADM. O que a lente troca é o
     que a rede fez — a parede, o pódio, a atividade, o destaque. */
  universe: Universe;
  onUniverse: (u: Universe) => void;
  /** Entrar numa sala, e opcionalmente num lugar dentro dela (`reviews/<id>`). */
  onEnter: (slug: string, rest?: string, universe?: Universe) => void;
  onSignOut: () => void;
  onOpenSelf: () => void;
}) {
  const [mine, setMine] = useState<Club[] | null>(null);
  const [open, setOpen] = useState<Club[]>([]);
  const [net, setNet] = useState<LobbySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [founding, setFounding] = useState(false);

  /* Vão juntas e falham separadas. A lista de clubes sustenta a tela: sem ela
     não há saguão, e o erro é dito. O que a rede andou fazendo é enfeite caro —
     se não vier, a tela é a de antes e ninguém precisa saber por quê. */
  const load = useCallback(async () => {
    const [salas, rede] = await Promise.allSettled([
      clubs.all(),
      universe === 'series' ? lobbyApi.series() : lobbyApi.get(),
    ]);
    if (salas.status === 'fulfilled') {
      setMine(salas.value.mine);
      setOpen(salas.value.open);
      setError(null);
    } else {
      setError((salas.reason as Error).message);
      setMine(current => current ?? []);
    }
    if (rede.status === 'fulfilled') setNet(rede.value);
  }, [universe]);

  /* Trocar de lente joga fora o que a outra tinha contado, e isso é diferente de
     a busca falhar: uma falha mantém a tela de antes (ver acima), uma troca não
     pode — o pódio de filmes ficaria na tela até a resposta de séries chegar, e
     por um instante o saguão de séries anunciaria um filme. */
  useEffect(() => {
    setNet(null);
  }, [universe]);

  useEffect(() => {
    void load();
  }, [load]);

  /* "Em cartaz" é o que envelhece rápido aqui: a sessão termina e a linha
     continua anunciando um filme que ninguém assiste. Relê ao reaparecer, e não
     só no próximo intervalo — quem trocou de aba está olhando agora. */
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

  /* Em quais salas você já está, pelo slug. Decide se uma sessão ao vivo é uma
     porta ou só uma notícia: um clube fechado de que você não é abre 403, e
     oferecer o clique é oferecer um erro. */
  const held = useMemo(() => new Set((mine ?? []).map(c => c.slug)), [mine]);
  const canEnter = useCallback(
    (club: { slug: string; visibility: 'public' | 'private' }) =>
      club.visibility === 'public' || held.has(club.slug),
    [held]
  );

  /* Toda porta desta tela leva para a lente em que se está. Um embrulho, e não o
     `onEnter` cru em oito lugares: um deles esqueceria o argumento, e o defeito
     seria silencioso — a pessoa clica no saguão de séries e cai no acervo de
     filmes do mesmo clube. */
  const go = useCallback(
    (slug: string, rest?: string) => onEnter(slug, rest, universe),
    [onEnter, universe]
  );

  const daRede = net?.wall ?? [];
  const live = net?.live ?? [];
  const podium = net?.podium ?? [];
  const active = net?.active ?? [];
  const feature = net?.feature ?? null;
  /* Abaixo de quatro cartazes não há parede: há três filmes numa faixa larga,
     que passa a parecer coisa que não terminou de carregar. */
  const redeTemParede = daRede.length >= 4;

  /* ── e a parede de séries cai no TMDB quando a rede ainda não enche ─────
     O universo de séries enche muito mais devagar que o de filmes, e isso não é
     um estado inicial que passa: um clube avalia um filme numa NOITE e uma série
     leva semanas. Toda seção deste saguão é derivada do que a rede avaliou, e
     com essa cadência a porta de entrada de séries ficaria vazia por meses.

     Então a parede — e só ela — tem um segundo dono. Sem quatro séries avaliadas
     na rede, ela mostra as populares do TMDB.

     Duas coisas que fazem isso não ser mentira: a legenda diz de onde os cartazes
     vieram, e a troca é por tudo ou nada. Misturar as duas fontes na mesma faixa
     seria pendurar o que a rede achou ao lado do que ela nunca viu, sem nada
     dizendo qual é qual.

     O resto do saguão continua calado quando não sabe. O TMDB tem uma lista de
     populares; ele não tem opinião do clube, e um pódio ou um destaque saídos
     dali seriam este produto citando outro como se fosse ele. */
  const [populares, setPopulares] = useState<LobbyMovie[] | null>(null);
  const precisaTmdb = universe === 'series' && net !== null && !redeTemParede;

  useEffect(() => {
    if (!precisaTmdb || populares) return;
    let vivo = true;
    void seriesApi
      .popular()
      .then(r => {
        if (!vivo) return;
        setPopulares(
          r.results
            .filter(s => s.poster)
            /* `average` e `takes` em zero, e a parede sabe ler isso: a tarja de
               hover cala a nota quando não há nenhuma, em vez de anunciar 0,0
               como se a rede tivesse detestado. */
            .map(s => ({ id: s.id, title: s.title, year: s.year, poster: s.poster, average: 0, takes: 0 }))
        );
      })
      .catch(() => vivo && setPopulares([]));
    return () => {
      vivo = false;
    };
  }, [precisaTmdb, populares]);

  const doTmdb = precisaTmdb && (populares?.length ?? 0) >= 4;
  const wall = doTmdb ? (populares as LobbyMovie[]) : daRede;
  const hasWall = wall.length >= 4;

  /* A regra de se calar produz um caso em que a tela MENTE: clubes existem e
     avaliam, e nenhum emprestou nada. O saguão fica idêntico ao de antes, e
     quem administra não tem como saber que existe um interruptor — muito menos
     que ele é a razão da tela vazia. Então, sem NADA da rede e administrando
     uma sala fechada que não empresta, a tela diz isso e aponta o caminho.

     Só para o ADM: emprestar o acervo é decisão de quem manda na sala, e
     cutucar um membro comum seria pedir que ele fosse cobrar de outra pessoa.

     Medido contra o que a REDE tem, e não contra a parede desenhada: com a
     parede caindo no TMDB, olhar para ela diria que há conteúdo quando o que
     existe é uma lista emprestada de fora. */
  const darkNetwork =
    net !== null && !redeTemParede && !podium.length && !active.length && !live.length && !feature;
  const lendable = (mine ?? []).filter(
    c => c.role === 'admin' && c.visibility === 'private' && !c.showCharts
  );

  /* Uma ação, dois desfechos: num clube aberto você entra, num fechado vira
     pedido. O servidor diz qual aconteceu — a tela não adivinha pela
     visibilidade, que pode ter mudado entre a lista e o clique. */
  async function ask(slug: string) {
    try {
      const out = await clubs.join(slug);
      if (out.joined) {
        go(slug);
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
    /* A mesma moldura do app dentro de um clube: no telefone a página não rola,
       quem rola é o conteúdo. Com a página rolando, o Android recolhia a barra
       de endereço a cada gesto, arrastava o cabeçalho preso no topo e obrigava
       a parede de celuloide a se refazer. O porquê inteiro está em App.tsx. */
    <div className="relative flex min-h-[calc(100dvh/var(--ui-zoom))] flex-col coarse:h-full coarse:min-h-0 coarse:overflow-hidden">
      <HolographicWall asBackdrop />

      {/* Presa no topo, como a marquise de dentro de um clube: a barra é a porta
          de saída, e uma porta que sobe com a página se perde justamente quando
          alguém rolou longe o bastante para querer usá-la. Sem desfoque de
          fundo, pela razão escrita na marquise. */}
      <header className="sticky top-0 z-30 flex-none border-b border-white/[0.07] bg-house/95">
        {/* ── a barra num telefone ────────────────────────────────────────
            Ela era uma fileira de quatro peças de largura fixa numa linha que
            não quebra, somando mais do que 412px de tela: o nome da casa, as
            duas lentes, o sino, o retrato e a saída. Nada ali podia encolher, e
            o que sobra de uma linha assim não é uma barra apertada — é uma
            barra SOBREPOSTA: o sino caía em cima de "Séries".

            Duas regras resolvem, e as duas dizem a mesma coisa. A direita —
            avisos, conta, saída — é um bloco que não cede: são alvos de dedo, e
            um alvo de dedo espremido é um alvo errado. A esquerda cede, e cede
            pela ordem certa: as lentes ficam inteiras (é a navegação da tela) e
            quem encolhe é o nome da casa, que já vem menor no telefone e, no
            aperto, corta com reticências em vez de invadir o vizinho. */}
        <div className="mx-auto flex max-w-[1240px] items-center gap-x-2 px-4 py-3 sm:gap-x-6 sm:px-6">
          <div className="mr-auto flex min-w-0 items-center gap-x-2 sm:gap-x-5">
            <span className="min-w-0 truncate font-display text-[18px] leading-none tracking-[0.1em] text-beam sm:text-[26px] sm:tracking-[0.14em]">
              CINECLUBE
            </span>
            <Lens on={universe} onPick={onUniverse} />
          </div>
          <div className="flex flex-none items-center gap-x-1 sm:gap-x-4">
            {/* O mesmo sino da marquise, e é o ponto: ele é da REDE. Junta
                todas as salas e diz de qual veio cada linha. */}
            <Notices />
            <button
              type="button"
              onClick={onOpenSelf}
              title="Minha conta"
              className="flex flex-none items-center gap-2 rounded-cell px-1 py-1 transition-colors hover:[&>span]:text-ink"
            >
              <Reel color={reelColor(me.dot, me.id)} src={me.avatar} size="lg">
                {initialsOf(me.name)}
              </Reel>
              <span className="hidden text-[13px] text-ink-dim transition-colors sm:inline">{me.name}</span>
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="flex-none rounded-cell px-2 py-1.5 font-display text-[12px] uppercase tracking-[0.12em] text-ink-dim transition-colors hover:text-dye-red-lit"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      {/* O envelope que rola. No clube não era preciso — lá tudo que rola já
          mora no `main`. Aqui a parede e o trilho ficam FORA dele, e deixar só o
          `main` rolar prenderia a parede no alto para sempre, comendo um terço
          da tela. No computador esta camada não faz nada. */}
      <div className="flex flex-1 flex-col coarse:min-h-0 coarse:overflow-y-auto coarse:overscroll-contain">
        {hasWall ? (
          <PosterWall films={wall} counts={net!.counts} universe={universe} fromTmdb={doTmdb} />
        ) : null}
        {live.length ? <NowPlaying sessions={live} canEnter={canEnter} onEnter={go} /> : null}

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
          onEnter={go}
          onFound={() => setFounding(true)}
          onAsk={c => (c.requested ? void unask(c.slug) : void ask(c.slug))}
        />

        {darkNetwork && lendable.length ? (
          <DarkNetwork clubs={lendable} onOpen={slug => go(slug, 'ajustes')} />
        ) : null}

        {podium.length ? (
          <Region
            className="mt-16"
            title="Melhores avaliados"
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
            title="Clubes em atividade"
            /* Sem legenda no universo de séries. Lá a atividade conta EPISÓDIO
               mexido — visto ou avaliado —, e dizer isso era descrever o motor e
               não a lista: quem olha uma fileira de clubes ordenada já entendeu
               que os de cima são os que andaram. */
            note={
              universe === 'series'
                ? undefined
                : `Avaliações dos últimos ${net?.windowDays ?? 30} dias.`
            }
          >
            <ul className="mt-6">
              {active.map((club, i) => (
                <ActiveClub
                  key={club.slug}
                  club={club}
                  rank={i + 1}
                  enterable={canEnter(club)}
                  onOpen={() => go(club.slug)}
                />
              ))}
            </ul>
          </Region>
        ) : null}

        {feature ? (
          <Region
            className="mt-16"
            title="Avaliação em destaque"
            /* Sem legenda no universo de séries. Do lado de filmes a linha diz
               um critério — "a que mais moveu a rede" —, e é por isso que ela
               existe: sem ela ninguém sabe por que é AQUELA ficha. Ali a ordem
               ainda não é por reação, então a legenda não teria critério para
               dizer, e sobrava explicando a própria ficha logo acima dela. */
            note={
              universe === 'series'
                ? undefined
                : `A avaliação que mais moveu a rede nos últimos ${net?.windowDays ?? 30} dias.`
            }
          >
            <FeatureTake
              take={feature}
              /* No universo de séries a ficha ainda não tem endereço próprio: as
                 abas do clube são de filme. Até elas existirem, a porta leva ao
                 clube e não a uma tela que não está lá. */
              onOpen={() =>
                universe === 'series'
                  ? go(feature.club.slug)
                  : go(feature.club.slug, `reviews/${feature.id}`)
              }
            />
          </Region>
        ) : null}
        </main>
      </div>

      {founding ? (
        <FoundClub
          onClose={() => setFounding(false)}
          onFounded={slug => {
            setFounding(false);
            go(slug);
          }}
        />
      ) : null}
    </div>
  );
}

/* ── a lente ──────────────────────────────────────────────────────────────
   A escolha mais externa do produto, e por isso a mais alta na tela: ela vem
   antes do clube, e o clube já é o segundo nível.

   Sublinhado vermelho e não uma chapa de latão. Pela regra do DESIGN.md,
   vermelho marca ONDE VOCÊ ESTÁ e latão marca o que você escolheu — e isto é um
   lugar em que se está, igual às seções da marquise e ao seletor de salas logo
   abaixo. Usar outra forma aqui daria ao produto dois jeitos de dizer "aqui". */
const LENSES: { id: Universe; label: string }[] = [
  { id: 'filmes', label: 'Filmes' },
  { id: 'series', label: 'Séries' },
];

function Lens({ on, onPick }: { on: Universe; onPick: (u: Universe) => void }) {
  return (
    <div className="flex flex-none items-center gap-0.5" role="tablist" aria-label="Universo">
      {LENSES.map(o => {
        const here = on === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={here}
            onClick={() => onPick(o.id)}
            className={cn(
              'relative px-1.5 pb-1.5 pt-1 font-display text-[13px] uppercase leading-none sm:px-2',
              'tracking-[0.12em] transition-colors duration-150 coarse:min-h-[38px]',
              here ? 'text-beam' : 'text-ink-dim hover:text-ink'
            )}
          >
            {o.label}
            {/* Sempre montado, só trocando de opacidade: aparecer e sumir do
                fluxo mudaria a altura da barra a cada troca. */}
            <span
              aria-hidden
              className={cn(
                'absolute inset-x-1 bottom-0 h-[2px] bg-dye-red transition-opacity duration-150',
                here ? 'opacity-100' : 'opacity-0'
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

/* Título, uma linha explicando a lista, e o fio de luz — o mesmo desenho do
   cabeçalho das telas de dentro de um clube (ver `Bill`), em corpo menor.

   Sempre `h2`: o `h1` desta tela é o da parede de cartazes, e sem ela quem
   assume é o seletor de salas. Nenhuma destas regiões é a primeira. */
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

/* ── a folha de um filme, visto pela rede ─────────────────────────────────
   Abre ao clicar num cartaz da parede, e é MENOR que a folha de projeção de
   dentro de um clube de propósito: lá ela é a sala de espera antes de avaliar,
   aqui a pergunta é curta — "que filme é esse, e o que acharam?". Três coisas:
   o que o filme é, o que a rede achou, e quem achou.

   Sinopse e trailer vêm do TMDB pela rota do catálogo (pública, com cache); as
   fichas por `/api/lobby/film/:id`. Duas chamadas em paralelo e não uma no
   servidor: juntá-las lá pagaria o TMDB de novo, do lado errado do cache.

   A folha abre com o que já se sabe — título, ano, cartaz e nota vêm do cartaz
   clicado — e preenche o resto quando chega, em vez de mostrar um esqueleto do
   que já estava na tela. `<dialog>` nativo pela armadilha de foco e o Escape. */
/* Uma folha para os dois universos, e não duas. O que muda são as duas rotas
   que ela chama e uma seção a mais na de séries — a curva por temporada, que é
   a leitura que só aquele universo tem. Tudo o resto é a mesma pergunta com o
   mesmo desenho, e duas cópias divergiriam na terceira mexida. */
type PeekDetail = {
  genre?: string;
  overview?: string | null;
  trailerUrl?: string | null;
};

function FilmPeek({
  film,
  universe,
  onClose,
}: {
  film: LobbyMovie;
  universe: Universe;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [detalhe, setDetalhe] = useState<PeekDetail | null>(null);
  const [rede, setRede] = useState<LobbyFilm | LobbyShow | null>(null);
  const [faltou, setFaltou] = useState(false);
  const serie = universe === 'series';

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
      serie
        /* O detalhe de uma série vem embrulhado em `{ show }`, e o de um filme
           vem cru. Desembrulhado aqui para o resto da folha ler um objeto só. */
        ? api<{ show: PeekDetail }>(`/api/series/${film.id}`).then(r => r.show)
        : api<Movie>(`/api/catalog/movie/${film.id}`),
      serie ? lobbyApi.show(film.id) : lobbyApi.film(film.id),
    ]).then(([tmdb, nossas]) => {
      if (!vivo) return;
      if (tmdb.status === 'fulfilled') setDetalhe(tmdb.value);
      else setFaltou(true);
      if (nossas.status === 'fulfilled') setRede(nossas.value);
    });
    return () => {
      vivo = false;
    };
  }, [film.id, serie]);

  return (
    <dialog
      ref={ref}
      aria-label={`Sobre ${film.title}`}
      onClick={e => {
        if (e.target === ref.current) onClose();
      }}
      /* Um rolador só, e o fundo sem desfoque — os dois porquês estão em
         components/film.tsx. */
      className="w-full max-w-[720px] max-h-[calc(100dvh/var(--ui-zoom))] overflow-hidden bg-transparent p-2 text-ink backdrop:bg-house-deep/95 open:animate-beam-in sm:p-4"
    >
      <div className="plate relative max-h-[calc(100dvh/var(--ui-zoom)-1rem)] overflow-y-auto overscroll-contain p-5 sm:max-h-[calc(100dvh/var(--ui-zoom)-2rem)] sm:p-6">
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

            {/* Na régua de sempre: uma nota é reconhecível como nota antes de
                ser lida. */}
            <div className="mt-4 flex items-center gap-3">
              <Strip value={rede?.average ?? film.average} cells={10} className="h-[6px] w-[120px] flex-none" />
              <span className="q text-[15px] font-medium text-beam">
                {fmt(rede?.average ?? film.average)}
              </span>
              <span className="q text-[11px] text-ink-faint">/10</span>
              <span className="q text-[11px] text-ink-dim">
                {plural(rede?.count ?? film.takes, 'avaliação', 'avaliações')}
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
              <TrailerKey
                url={detalhe.trailerUrl}
                title={film.title}
                className="mt-3 tracking-[0.12em]"
              >
                Ver o trailer
              </TrailerKey>
            ) : null}
          </div>
        </div>

        {/* ── a curva por temporada ────────────────────────────────────────
            Só no universo de séries, porque só ele tem a leitura: uma série não
            é uma nota, é uma curva. Derivada dos mesmos episódios que produzem
            a média lá em cima, então as duas nunca se contradizem. */}
        {serie && (rede as LobbyShow | null)?.seasons?.length ? (
          <section className="mt-7 border-t border-white/[0.07] pt-5">
            <span className="legend">Por temporada</span>
            <ul className="mt-4 flex flex-col gap-2.5">
              {(rede as LobbyShow).seasons.map(s => (
                <li key={s.season} className="flex items-center gap-3">
                  <span className="q w-[52px] flex-none text-[11.5px] text-ink-dim">
                    T{s.season}
                  </span>
                  <Strip value={s.average} cells={10} className="h-[5px] min-w-0 flex-1" />
                  <span className="q w-[34px] flex-none text-right text-[13px] text-beam">
                    {fmt(s.average)}
                  </span>
                  <span className="q w-[66px] flex-none text-right text-[10.5px] text-ink-faint">
                    {plural(s.episodes, 'episódio', 'episódios')}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* A legenda diz a regra da ordem: um ranking cuja regra não está à
            vista parece arbitrário. Quem enfrentou os critérios mais vezes
            carrega uma régua mais aferida. */}
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
            {serie
              ? 'Nenhum clube que empresta o acervo avaliou um episódio desta série ainda.'
              : 'Nenhum clube que empresta o acervo avaliou este filme ainda.'}
          </p>
        ) : null}
      </div>
    </dialog>
  );
}

function PeekTake({
  take,
}: {
  take: LobbyTake & { season?: number; episode?: number; episodeTitle?: string | null };
}) {
  /* Numa série a ficha é de um EPISÓDIO, e sem dizer qual a linha vira uma nota
     sem objeto: cinco pessoas "avaliaram a série" com números diferentes que na
     verdade são sobre cinco episódios diferentes. */
  const onde =
    take.season != null && take.episode != null
      ? `T${take.season}E${String(take.episode).padStart(2, '0')}`
      : null;

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
          {onde ? (
            <span className="q text-[11px] text-ink-dim">
              {onde}
              {take.episodeTitle ? ` · ${take.episodeTitle}` : ''}
            </span>
          ) : null}
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

/* ── as salas, num lugar só ───────────────────────────────────────────────
   Eram duas seções empilhadas, e a vitrine vivia depois de um pódio, de uma
   lista de atividade e de uma ficha inteira. As duas são A MESMA COISA — uma
   lista de clubes —, e a pergunta que as separa ("já sou de lá?") é uma
   escolha, não uma posição na página. Escolha é o que um seletor faz.

   Sublinhado vermelho pela regra do DESIGN.md: vermelho marca ONDE VOCÊ ESTÁ,
   latão marca o que você escolheu. Isto é seção, não filtro.

   A contagem ao lado do nome existe para a aba fechada não ser caixa preta: com
   o número, decide-se sem trocar de aba. */

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
  /* Nome e linha de descrição, sem acento e sem caixa (ver `norm` e `named`).
     Só pelo nome erraria "os que gostam de terror", que é o tipo de coisa que
     faz alguém querer entrar numa sala. */
  const q = norm(query.trim());
  const vistos = q ? lista.filter(c => named(q, c.name, c.tagline)) : lista;

  /* Pelo total das duas listas e não pela aba aberta: medida por aba, a busca
     apareceria e sumiria ao alternar, fazendo a linha pular sob o cursor. */
  const buscavel = (mine?.length ?? 0) + open.length >= SEARCH_FROM;

  const Heading = level === 1 ? 'h1' : 'h2';

  return (
    <section>
      {/* Sem título de região: os nomes das abas SÃO o título, e um "Salas" por
          cima seria a mesma palavra duas vezes. O `h1`/`h2` fica na aba ativa,
          que é o que um leitor de tela precisa ouvir. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex items-end gap-6" role="tablist" aria-label="Clubes">
          <RoomTab
            id="mine"
            on={tab === 'mine'}
            onPick={() => setTab('mine')}
            count={mine?.length ?? null}
            as={tab === 'mine' ? Heading : 'span'}
          >
            Seus clubes
          </RoomTab>
          <RoomTab
            id="open"
            on={tab === 'open'}
            onPick={() => setTab('open')}
            count={open.length}
            as={tab === 'open' ? Heading : 'span'}
          >
            Outros clubes
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

      {/* Só na vitrine: explica a diferença entre aberta e fechada, pergunta que
          ninguém faz sobre uma sala em que já está. */}
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
            placeholder={tab === 'mine' ? 'Buscar nos seus clubes' : 'Buscar um clube'}
          />
        </div>
      ) : null}

      {mine === null ? (
        <p className="legend animate-flicker mt-8">Acendendo o projetor</p>
      ) : vistos.length ? (
        <div
          role="tabpanel"
          id="salas-painel"
          /* Apontado para a aba ativa: um `tabpanel` sem dono faz o leitor de
             tela anunciar a região sem saber de qual das duas abas ela é. */
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
          {/* Três vazios diferentes: uma busca sem resultado não é a mesma coisa
              que uma rede sem clubes. */}
          {q ? (
            <Blank title="Nenhum clube com esse nome">
              Tente outro pedaço do nome, ou o que o clube diz sobre si.
            </Blank>
          ) : tab === 'mine' ? (
            <Blank title="Você ainda não está em nenhum clube">
              Funde o seu, ou veja em <span className="text-ink">Outros clubes</span> os
              que já existem.
            </Blank>
          ) : (
            <Blank title="Não há outros clubes por enquanto">
              Todo clube da rede é um que alguém fundou. O próximo pode ser o seu.
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
      {/* Sempre montado, só trocando de opacidade: aparecer e sumir do fluxo
          mudaria a altura da linha a cada troca de aba. */}
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

/* O convite que aparece quando o saguão não tem nada da rede e quem olha é quem
   pode mudar isso. Não é aviso de erro nem usa a chapa vermelha: nada quebrou, e
   ficar fechado é uma escolha legítima.

   Diz o que se ganha e o que NÃO se dá, nesta ordem: emprestar uma média não é
   publicar o que alguém escreveu, e isso se sabe antes de apertar. */
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
        O saguão mostra a parede de cartazes, os filmes mais bem avaliados e os
        clubes em atividade a partir do que cada clube <span className="text-ink">empresta</span> —
        e {one ? <span className="text-ink">{one.name}</span> : 'nenhum dos clubes que você administra'} ainda
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

/* ── a parede de cartazes ─────────────────────────────────────────────────
   As caixas de cartaz do foyer com o que a rede andou vendo. Não custa nada: o
   pôster está gravado em cada ficha, então a parede fica de pé com o TMDB fora.

   Ela anda e nunca volta, como a parede de celuloide atrás de tudo — cartaz em
   foyer não oscila. No ponteiro os cartazes ficam no escuro e acendem sob ele;
   no dedo já chegam acesos, com o título à vista, porque lá não existe passar
   por cima. O letreiro da seção fica ABAIXO da faixa: título sobre imagem
   exigiria um véu escuro por cima da coisa que a faixa existe para mostrar.

   ── e a pista se pega com a mão ──────────────────────────────────────────
   Andava por animação CSS e, onde a animação não podia rodar, virava caixa de
   rolagem com barra — a única peça de interface daqui que ninguém desenhou.
   Agora deriva sozinha, e a mão pega, arrasta e ARREMESSA, com o arremesso
   desacelerando de volta para a deriva.

   Rolagem e não `transform` porque arrastar é rolar: `scrollLeft` já traz o
   limite e o toque prontos, e no telefone o navegador dá inércia melhor do que
   qualquer laço escrito aqui — lá este arquivo não faz nada.

   A velocidade persegue um alvo, e o alvo é a deriva. Sem deriva (movimento
   reduzido) o alvo é zero e a mesma linha vira inércia que para: uma fórmula,
   dois comportamentos, um caminho só no código. */

/* ── a velocidade da deriva ───────────────────────────────────────────────
   Andava a ~27px/s, que é o passo de quem passeia, e chegou como reclamação:
   "a parede está andando sozinha". Ela ANDA sozinha de propósito — cartaz em
   foyer não fica parado —, mas 27px/s num campo de visão periférico é a única
   coisa se mexendo numa tela escura, e o olho vai atrás.

   Dez pixels por segundo é a metade da história. A outra é que a velocidade
   era contada POR QUADRO: num monitor de 120Hz a mesma parede andava ao dobro,
   e é por isso que a queixa vinha de umas pessoas e não de todas. Agora tudo
   aqui é contado por quadro de 60Hz e esticado pelo tempo que o quadro
   realmente levou — a parede anda igual em qualquer tela. */
/** px de rolagem por quadro de 60Hz em repouso. ~10px/s: quase parada. */
const DRIFT = 0.17;
/** O quadro de referência das velocidades daqui, em ms. */
const TICK = 1000 / 60;
/* Teto do passo de tempo. Uma aba que volta do fundo, ou um quadro perdido numa
   máquina ocupada, entrega um intervalo enorme; sem isto a parede daria um
   pulo para "recuperar" um tempo em que ninguém estava olhando. */
const MAX_STEP = 3;
/** Quanto da distância até o alvo a velocidade fecha por quadro. */
const SETTLE = 0.045;
/** Abaixo disto a diferença não se vê: encosta no alvo e para de calcular. */
const SNAP = 0.02;
/* Teto do arremesso. Um mouse pode reportar um salto de centenas de pixels num
   quadro — janela que perdeu o foco e voltou, evento coalescido — e sem isto a
   parede sairia em disparada por um movimento que ninguém fez. */
const MAX_THROW = 42;

/* Tira o corte reto da borda de baixo, e nada além disso — quem escurece o pé da
   faixa é o véu de sombra, mais abaixo. Chegou a dissolver um terço da altura e
   era demais: os cartazes sumiam em vez de terminarem.

   Em PIXELS e não em porcentagem: a faixa tem 132px no telefone e 176px no
   computador, e 15% seriam vinte pixels lá e vinte e seis aqui. Uma aresta suave
   tem uma espessura só. */
const POSTER_FADE = 'linear-gradient(to bottom, #000 calc(100% - 24px), transparent 100%)';

/* Lido uma vez, como o `data-render` da parede de celuloide. Desliga o movimento
   que começa SOZINHO; arrastar continua, que é resposta a um gesto. */
const REDUCED =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function usePosterRail(live: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    /* No telefone este laço não existe: duas fontes escrevendo `scrollLeft` no
       mesmo elemento brigariam a cada quadro. */
    if (!el || !live) return;

    const target = REDUCED ? 0 : DRIFT;
    let velocity = target;
    let dragging = false;
    let lastX = 0;
    let lastT = 0;
    let raf = 0;

    /* A página tem `zoom`, então o pixel do ponteiro e o do layout são unidades
       diferentes. Medido aqui e não dentro do `move`: um rect e um offsetWidth
       são dois layouts forçados, e o mouse dispara centenas de eventos por
       segundo. Mesma nota em holographic-wall. */
    let k = 1;
    const measure = () => {
      k = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);

    /* A pista carrega a lista um número PAR de vezes, então recuar meia pista
       cai exatamente sobre a mesma imagem. O salto é dado ANTES de a rolagem
       chegar na borda: o navegador prende `scrollLeft` em zero, e deixar bater
       transformaria a volta num tranco. */
    const step = (dx: number) => {
      const half = el.scrollWidth / 2;
      if (half <= 0) return;
      let next = el.scrollLeft + dx;
      if (next < 0) next += half;
      else if (next >= half) next -= half;
      el.scrollLeft = next;
    };

    /* `span` é quantos quadros de 60Hz couberam no quadro que acabou de passar:
       1 numa tela de 60Hz, 0,5 numa de 120Hz. Tanto o passo quanto a
       aproximação do alvo são esticados por ele, então a parede anda na mesma
       velocidade e o arremesso desacelera no mesmo tempo em qualquer tela. */
    let last = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const span = last ? Math.min(MAX_STEP, (now - last) / TICK) : 1;
      last = now;
      if (dragging) return;
      const gap = target - velocity;
      velocity =
        Math.abs(gap) < SNAP ? target : velocity + gap * (1 - Math.pow(1 - SETTLE, span));
      if (velocity) step(velocity * span);
    };

    /* Puxar não é clicar: cada cartaz abre uma folha, e a mesma superfície é o
       que se agarra para arrastar. Sem isto, todo arremesso terminaria abrindo
       o filme que estava sob o dedo. Quatro pixels é mais que o tremor de uma
       mão parada e menos que qualquer intenção de puxar. */
    const SLOP = 4;
    let travel = 0;

    /* Nem `setPointerCapture`, nem `preventDefault`: as duas coisas estavam aqui
       e as duas matavam o clique nos cartazes.

       `preventDefault` num `pointerdown` cancela os eventos de mouse de
       compatibilidade que vêm depois, e o `click` é um deles — o arrasto nativo
       da imagem já é impedido pelo `draggable={false}` e pelo `dragstart`.

       `setPointerCapture` retarget os eventos para quem capturou, e o `click`
       vai junto: ele nascia na FAIXA em vez de no cartaz. A captura existia para
       não perder o ponteiro ao sair da faixa, e ouvir no `window` resolve isso
       sem retarget — ao preço de tirar os ouvintes ao soltar. */
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      /* A recusa de clique é armada com `once`, e `once` só desarma quando o
         evento chega — um arrasto que termina FORA da faixa não gera clique, e a
         recusa ficava esperando para engolir o próximo clique de verdade. Um
         clique sempre vem logo depois do `pointerup` do mesmo gesto, então
         qualquer recusa viva quando um gesto NOVO começa é de um gesto morto. */
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
      /* Em px por quadro e suavizado: um evento com salto grande não pode virar
         sozinho um arremesso que a mão não deu. */
      velocity = velocity * 0.7 + ((-dx * TICK) / dt) * 0.3;
    };

    /* Engolido na CAPTURA, antes de chegar ao cartaz. `once` desarma sozinho,
       para que o clique seguinte — o de verdade — passe. */
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

    /* O `requestAnimationFrame` já para com a aba escondida; isto cuida do outro
       caso, que é a pessoa ter rolado a página para baixo. */
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !raf) {
          /* O relógio recomeça: entre a parada e a volta pode ter passado meia
             hora, e o primeiro quadro do laço não pode andar meia hora. */
          last = 0;
          raf = requestAnimationFrame(frame);
        } else if (!entry.isIntersecting && raf) {
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
      /* Desmontar no meio de um arrasto deixaria ouvintes no window mexendo num
         elemento que já saiu da árvore. */
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
  universe,
  fromTmdb,
}: {
  films: LobbyMovie[];
  counts: LobbySnapshot['counts'] & { episodes?: number };
  universe: Universe;
  /** A parede está emprestada do TMDB porque a rede ainda não encheu a dela. */
  fromTmdb?: boolean;
}) {
  /* Aqui e não no saguão inteiro porque a folha é da parede: nada mais nesta
     tela abre um filme. */
  const [aberto, setAberto] = useState<LobbyMovie | null>(null);
  /* A metade da pista precisa ser mais larga que qualquer tela, ou o laço mostra
     o fim da fileira e volta com um pulo. O número de cópias é sempre PAR: a
     pista viaja metade de si mesma, e a emenda só cai sobre uma cópia inteira se
     houver o mesmo tanto dos dois lados. */
  const CASE_PX = 125;
  const HALF_PX = 1800;
  const copies = Math.max(2, 2 * Math.ceil(HALF_PX / CASE_PX / films.length));

  /* O laço só é montado onde há ponteiro fino. No telefone o dedo já rola e o
     navegador já dá inércia — melhor do que a daqui, e de graça. */
  const rail = usePosterRail(useFinePointer());

  return (
    <section className="relative">
      {/* ── a moldura ──────────────────────────────────────────────────────
          Os véus moravam dentro da faixa, e funcionava enquanto ela era
          `overflow: hidden`. Virou caixa de ROLAGEM e parou: um elemento
          absoluto dentro de um container que rola faz parte do conteúdo rolável
          dele, então os véus saíram deslizando junto com os cartazes. Duas
          camadas agora — esta moldura, que não rola e segura os véus, e a faixa
          lá dentro, que rola.

          Sem borda embaixo: uma linha dura fazia a parede TERMINAR e o letreiro
          começar do zero num bloco separado. O que liga os dois é a dissolução.

          E ela é de duas naturezas. O véu escuro (mais abaixo) faz o percurso
          longo: pinta a cor da sala sobre o cartaz e abre espaço para o
          letreiro. A máscara é alfa e só tira o corte reto da borda — onde ela
          apaga, aparece a parede de celuloide atrás, que é a diferença entre um
          cartaz que termina contra um fundo e um que termina na sala.

          Na moldura e não na faixa porque precisa alcançar também os véus das
          pontas, que são irmãos da faixa e não filhos dela. `-webkit-` junto: o
          Safari ainda pede o prefixo. */}
      <div
        className="relative h-[132px] sm:h-[176px]"
        style={{
          maskImage: POSTER_FADE,
          WebkitMaskImage: POSTER_FADE,
        }}
      >
      {/* Cada cartaz abre a folha do filme, então a faixa não pode ser
          `aria-hidden`. Mas a lista é REPETIDA — é o que faz o laço não ter
          emenda —, e isso seriam duas paradas de tabulação por destino. Então a
          primeira cópia é a de verdade e as outras são decoração: `aria-hidden`
          e fora da ordem de foco, uma por uma. */}
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
                /* Sem nota quando não há nenhuma: um cartaz emprestado do TMDB
                   anunciado como "0,0 em 0 avaliações" seria a rede dizendo que
                   detestou uma série que ela nunca viu. */
                aria-label={
                  film.takes
                    ? `${film.title} — ${fmt(film.average)} em ${plural(film.takes, 'avaliação', 'avaliações')}`
                    : film.title
                }
                className="group relative mr-2 h-full w-[88px] flex-none overflow-hidden bg-house-deep sm:w-[117px]"
              >
                <img
                  src={film.poster ?? undefined}
                  alt=""
                  loading="lazy"
                  /* Sem isto, puxar a parede leva um fantasma do cartaz junto
                     do cursor. */
                  draggable={false}
                  /* ── no dedo os cartazes já chegam acesos ─────────────────
                     O escuro existia para o ponteiro ter o que acender: passar
                     por cima é que revelava a arte e o título. No telefone não
                     há por cima, então aquele estado de repouso era o estado
                     ÚNICO — vinte e oito capas a 38% de opacidade, que é a
                     faixa inteira parecendo apagada em vez de discreta.

                     Setenta e dois por cento, e não cem: a faixa continua sendo
                     fundo, e o letreiro que sobe para dentro dela continua
                     ganhando do que está atrás. */
                  className="h-full w-full object-cover opacity-[0.38] saturate-[0.85] transition duration-300 ease-beam coarse:opacity-[0.72] coarse:saturate-100 group-hover:opacity-100 group-hover:saturate-100"
                />
                {/* E o título fica sempre aceso no dedo, pelo mesmo motivo: sem
                    ponteiro, `group-hover` é uma promessa que nunca vem, e o
                    nome do filme era a única coisa que ela guardava. */}
                <span className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-house-deep/95 via-house-deep/75 to-transparent px-2 pb-6 pt-2 opacity-0 transition-opacity duration-200 coarse:opacity-100 group-hover:opacity-100">
                  <span className="block truncate font-display text-[12px] leading-none tracking-[0.05em] text-beam">
                    {film.title}
                  </span>
                  {film.takes ? (
                    <span className="q mt-1.5 block text-[10.5px] text-ink-dim">
                      {fmt(film.average)} · {plural(film.takes, 'avaliação', 'avaliações')}
                    </span>
                  ) : null}
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

        {/* Os cartazes escurecem até a cor da sala, então a faixa não tem fim:
            ela vira sala, e o letreiro sobe para dentro dela sem disputar
            legibilidade com imagem nenhuma. Começa cedo e quase invisível, o
            que faz ler como apagar e não como tampa; o que importa é o fim, que
            é onde o topo do título encosta.

            As paradas são 40% e 90% porque a escala do Tailwind anda de cinco em
            cinco: `to-88%` não vira classe nenhuma e sai da folha em silêncio. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[70%] bg-gradient-to-b from-transparent via-house/20 via-40% to-house to-90%"
        />
      </div>

      {/* Houve aqui uma mancha de luz, a claridade que uma vitrine jogaria no
          chão. Construída, vista e removida pelo dono: numa tela escura, uma
          nuvem larga e clara não lê como luz, lê como mancha. */}

      {/* Sobe para DENTRO da faixa: o topo do letreiro fica onde os cartazes já
          se apagaram, e é isso que faz um referenciar o outro em vez de dois
          blocos empilhados. */}
      <div className="relative mx-auto -mt-7 w-full max-w-[1240px] px-4 sm:-mt-9 sm:px-6">
        <h1 className="font-display text-[38px] leading-none tracking-[0.04em] text-beam sm:text-[46px]">
          {universe === 'series' ? 'Séries populares' : 'Filmes populares'}
        </h1>
        {/* Uma frase e não três cartões de estatística: é a legenda da parede.
            Com os cartazes emprestados do TMDB não há legenda nenhuma — a
            contagem da rede ali leria como se fossem os números daqueles
            cartazes, e o título já é verdade nos dois casos. O que garante que
            nada minta é a parede emprestada não anunciar nota (ver a tarja
            abaixo): nada nela reivindica um veredito do clube. */}
        {fromTmdb ? null : (
          <p className="q mt-3 text-[13px] text-ink-dim">
            {tally(counts.reviews, 'avaliação', 'avaliações')} ·{' '}
            {universe === 'series'
              ? `${tally(counts.movies, 'série', 'séries')} · ${tally(counts.episodes ?? 0, 'episódio', 'episódios')}`
              : `${tally(counts.movies, 'filme', 'filmes')} · ${tally(counts.clubs, 'clube', 'clubes')}`}
          </p>
        )}
      </div>

      {/* Montada só quando há filme aberto, e remontada por filme: garante que
          ela nunca mostre a sinopse do cartaz anterior por um quadro. */}
      {aberto ? (
        <FilmPeek
          key={aberto.id}
          film={aberto}
          universe={universe}
          onClose={() => setAberto(null)}
        />
      ) : null}
    </section>
  );
}

/* ── em cartaz agora ──────────────────────────────────────────────────────
   As sessões acontecendo neste segundo. O produto sabe disso sem consultar
   nada: a sala ao vivo mora em memória.

   É a coisa mais urgente que esta tela diz e a mais rara — quase sempre não há
   nenhuma. Por isso é uma FAIXA FINA e não uma seção: quando aparece, empurra o
   chaveiro alguns pixels, não uma tela inteira.

   Só é porta quando dá para atravessá-la: um clube fechado de que você não é
   responde 403. Sem porta, continua sendo notícia. */
function NowPlaying({
  sessions,
  canEnter,
  onEnter,
}: {
  sessions: LobbyLive[];
  canEnter: (club: { slug: string; visibility: 'public' | 'private' }) => boolean;
  /** Com destino: daqui a porta é a sala de projeção, não o mural. */
  onEnter: (slug: string, rest?: string) => void;
}) {
  return (
    <div className="relative border-b border-white/[0.06] bg-house-deep/70">
      <div className="mx-auto flex max-w-[1240px] items-center gap-4 px-4 py-2.5 sm:px-6">
        <span className="flex flex-none items-center gap-2">
          {/* A lâmpada de gravação, que aqui quer dizer "está acontecendo". */}
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
                    /* Direto na Sessão. Esta linha anuncia um filme rodando
                       agora, e largar quem clicou no mural é fazer a pessoa
                       procurar de novo o que ela acabou de apontar. */
                    onClick={() => onEnter(session.club.slug, 'screening')}
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

/* O número de fichas vem sempre: média sem tamanho da amostra é meia informação.
   O piso de três impede o pódio de ser a lista de quem foi avaliado uma vez por
   alguém entusiasmado.

   A posição é Poppins com `.q` e não display: a face de letreiro não tem
   algarismo tabular, e uma coluna de posições que se desloca é uma coluna
   quebrada. Mesma regra de toda nota. */
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
        {plural(film.takes, 'avaliação', 'avaliações')}
        {film.clubs > 1 ? ` · ${plural(film.clubs, 'clube', 'clubes')}` : ''}
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

/* Uma LINHA e não um cartão: a tela já tem duas grades de painéis de clube, e
   uma terceira em outra ordem seria a página repetindo o formato até ele parar
   de significar. A pergunta aqui é outra — onde está acontecendo alguma coisa —
   e uma lista ordenada com o número na ponta responde.

   Sala fechada de que você não é aparece e não é porta: é informação sobre a
   rede, e a maneira de entrar está na vitrine, onde o botão diz o que faz. */
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
        <span className="q text-[13px] text-beam">
          {plural(club.recent, 'avaliação', 'avaliações')}
        </span>
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

/* A única coisa deste saguão com voz humana: todo o resto é cartaz e número, e
   sem ela a tela seria um painel de estatística sobre um produto cujo assunto é
   o que as pessoas acharam.

   Mesma placa do mural de dentro de um clube, de propósito. O par alto/baixo é
   o que separa isto do feed de qualquer app de filme: onze critérios dizem onde
   a pessoa se entusiasmou e onde se decepcionou.

   A placa inteira é o botão, e leva à ficha e não ao clube: quem clica está
   buscando um texto. */
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
              viram um número só: três discordâncias anunciadas debaixo de um
              polegar para cima é a contagem tomando partido pelos dois lados. */}
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

/* A proporção é a de um cartaz na entrada de uma sala, não a de um cartão de
   dashboard. Sem foto, o painel fica com a inicial em corpo grande sobre a cor
   do clube: um lugar sem cartaz ainda é um lugar. */
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
        {/* Com a sala escurecendo por baixo: título branco sobre imagem qualquer
            é ilegível em metade das imagens. */}
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
            /* Um estado e não uma confirmação que some: quem volta amanhã
               precisa ver que já pediu. O mesmo botão desfaz. */
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
            /* O rótulo diz o que vai acontecer e não o que a sala é: numa aberta
               o clique põe você dentro, numa fechada começa uma espera. */
            <Key onClick={onAsk}>
              {club.visibility === 'public' ? 'Entrar' : 'Pedir para entrar'}
            </Key>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* Quem cria é ADM, e isso não é opção: uma sala sem ninguém que possa aprovar
   uma entrada nasce trancada. */
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
    /* Sem desfoque, pela razão em components/film.tsx: a parede atrás nunca para
       de andar, e um borrão sobre ela é refeito a cada quadro. */
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-house-deep/95 sm:items-center">
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="plate max-h-[calc(92dvh/var(--ui-zoom))] w-full max-w-[460px] overflow-y-auto p-5 sm:p-6"
      >
        <h2 className="font-display text-[26px] leading-none tracking-[0.04em] text-beam">
          Fundar um clube
        </h2>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-dim">
          Você será o ADM: é quem aprova quem entra e quem muda o que o clube é.
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

          {/* A escolha é sobre a PORTA e não sobre a fachada: os dois aparecem no
              saguão com nome e foto. */}
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

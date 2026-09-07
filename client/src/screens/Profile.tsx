import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Plus,
  Settings,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { Blank, Drawer, Key, Poster, Reel, Strip } from '@/components/bits';
/* As mesmas peças do acervo e do feed: a ficha abre nesta página (ver `Takes`) e
   não pode ser uma segunda versão do que o acervo mostra. */
import { Breakdown } from '@/components/take';
import { Conversation, TakeVotes } from '@/components/social';
import {
  fmt,
  initialsOf,
  reelColor,
  type Review,
  type Reviewer,
  type WatchItem,
} from '@/lib/api';
import {
  affinityOf,
  clashesOf,
  crowdGapOf,
  endsOf,
  FLOOR,
  genresOf,
  memberSince,
  spreadOf,
  takesOf,
} from '@/lib/taste';
import { cn, plural } from '@/lib/utils';
import { useClub } from '@/App';

/* ── o perfil ─────────────────────────────────────────────────────────────
   `#perfil/<id>`, e chega-se por um rosto: o seu na marquise, o de quem avaliou
   no feed, o de quem comentou. Substituiu a tela *Avaliadores*, que era um
   painel de formulários com nome de seção — aquilo foi para trás de uma
   engrenagem (ver components/settings.tsx).

   Ele não abre com uma contagem. "45 filmes · média 7,4" qualquer produto de
   cinema sabe escrever; o que só este clube sabe é onde a pessoa se entusiasmou,
   onde se decepcionou, o quanto se afasta do público e com quem costuma brigar.

   > A ficha do gosto saiu em 30/08/2026, por decisão do dono. O cálculo foi
   > junto (ver lib/taste.ts); o histórico tem a implementação inteira.

   Todo módulo aqui pode não aparecer, e essa é a decisão de desenho mais
   importante do arquivo: uma média tirada de duas fichas não é um gosto, e
   desenhada com a firmeza da de quem tem cinquenta seria indistinguível. Os
   pisos moram em lib/taste.ts, um por pergunta. O que sobra no silêncio nunca é
   vazio — é o que a pessoa já fez, com quantas faltam para o resto acender. */

export function ProfileScreen() {
  const club = useClub();

  /* Aqui e não dentro da lista: quatro lugares desta página apontam para uma
     ficha — os extremos, a maior distância do TMDB, uma faixa da régua e a
     própria lista — e os quatro têm de abrir a MESMA gaveta. */
  const [openTake, setOpenTake] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  /* `start` e não `center` porque a gaveta cresce PARA BAIXO: centrada, a fileira
     seria empurrada para fora da tela pelo conteúdo que acabou de abrir. Os 60ms
     são o commit do React e não a animação — a fileira precisa existir no DOM
     antes de alguém rolar até ela. */
  const showTake = useCallback((id: string) => {
    setOpenTake(id);
    const gentle = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    timers.current.push(
      window.setTimeout(() => {
        document
          .getElementById(`ficha-${id}`)
          ?.scrollIntoView({ behavior: gentle ? 'auto' : 'smooth', block: 'start' });
      }, 60)
    );
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(window.clearTimeout);
      pending.length = 0;
    };
  }, []);

  /* Trocar de pessoa fecha o que estava aberto: senão o id de outra lista fica
     no estado, mentindo sobre o que está na tela. */
  const personKey = club.personId ?? club.me.id;
  const seeded = useRef(personKey);
  if (seeded.current !== personKey) {
    seeded.current = personKey;
    setOpenTake(null);
  }

  /* Sem id no endereço, o perfil é o seu. Resolvido aqui e não na rota porque
     só a sessão sabe quem é você, e ela não existe quando o endereço é lido. */
  const id = club.personId ?? club.me.id;
  const person = club.reviewers.find(p => p.id === id) ?? null;
  const mine = person?.id === club.me.id;

  /* Alguém que saiu do clube depois de o link ser colado. Nem tela em branco nem
     erro: nada quebrou, a pessoa é que não está mais aqui. */
  if (!person) {
    return (
      <section>
        <Blank title="Essa pessoa não está mais no clube">
          O perfil existia quando este link foi feito. O que ela avaliou saiu junto com a conta —
          é assim que uma saída funciona aqui.
        </Blank>
        <Key tone="flush" className="mt-2" onClick={() => club.goPerson()}>
          Ir para o meu perfil
        </Key>
      </section>
    );
  }

  return (
    <section>
      <Header person={person} mine={mine} onSettings={club.openClubSettings} />

      {/* A ordem: primeiro o que a pessoa achou dos filmes, depois o que ela é EM
          RELAÇÃO ao clube. Afinidade e gêneros vinham antes das fichas e o dono
          os mandou para baixo — quem abre um perfil pergunta "o que essa pessoa
          viu e achou", e "com quem ela concorda" só ocorre depois. */}
      <div className="mt-8 flex flex-col gap-8">
        <Ends person={person} onOpenTake={showTake} />
        <Crowd person={person} mine={mine} onOpenTake={showTake} />
        <Ruler person={person} onOpenTake={showTake} />
        <Queued person={person} />
        <Takes
          person={person}
          mine={mine}
          open={openTake}
          onToggle={id => setOpenTake(o => (o === id ? null : id))}
        />
        <Affinities person={person} mine={mine} />
        <Genres person={person} />
      </div>

    </section>
  );
}

/* Legenda, régua fina, conteúdo. Sem placa: sete placas empilhadas seriam sete
   caixas iguais fazendo o papel de estrutura, e o olho leria a moldura em vez do
   que está dentro. Cada módulo tem a forma do que diz — os extremos são dois
   pôsteres, a régua é uma pilha de células.

   Títulos são substantivos secos, por decisão do dono em 30/08/2026: o artigo é
   uma sílaba de cortesia em versalete tracked de 13px. Os dois que continuam
   sendo frase — "Contra o público", "Com quem concorda" — continuam porque são a
   pergunta que a seção responde, não o rótulo de uma coisa. */
function Region({
  title,
  note,
  children,
}: {
  title: string;
  /** Um número, um piso, uma ressalva. Sempre curto. */
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4 flex items-baseline gap-3">
        <span className="legend flex-none">{title}</span>
        <span
          aria-hidden
          className="h-px min-w-[1rem] flex-1 bg-gradient-to-r from-beam/20 via-beam/[0.06] to-transparent"
        />
        {note ? <span className="q flex-none text-[11px] text-ink-dim">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

/* A marquise da pessoa: os pôsteres do que ela mais gostou atrás do retrato.

   A capa é feita de conteúdo real e nada mais. Um gradiente decorativo seria a
   única coisa desta interface que não veio da sala, e havia material à mão — as
   maiores notas de alguém são, literalmente, a resposta para "o que essa pessoa
   gosta". Sem fichas não há capa: fica a parede de película, que é melhor do que
   um retângulo cinza esperando conteúdo. */
function Header({
  person,
  mine,
  onSettings,
}: {
  person: Reviewer;
  mine: boolean;
  onSettings: () => void;
}) {
  const club = useClub();
  const takes = takesOf(club.reviews, person.id);
  const since = memberSince(person.createdAt);

  /* Os de maior nota, com pôster. Catorze é o que atravessa uma tela larga na
     proporção real do cartaz; quem tem menos ocupa o que ocupar, e a máscara da
     direita cuida do resto. */
  const cover = useMemo(
    () =>
      [...takes]
        .filter(r => r.moviePoster)
        .sort((a, b) => b.final - a.final)
        .slice(0, 14),
    [takes]
  );

  const avg = takes.length ? takes.reduce((s, r) => s + r.final, 0) / takes.length : null;

  return (
    <header className="relative">
      {cover.length ? (
        /* ── a capa ──────────────────────────────────────────────────────
            Nada é recortado: a altura manda e a largura segue (`h-full w-auto`),
            então a proporção do cartaz é a de sempre. Era `flex-1` com
            `object-cover`, o que dava uma tira horizontal do meio de cada arte
            com os títulos cortados na metade.

            Duas máscaras, uma por eixo. A vertical desmancha as bordas retas em
            cima e embaixo — sem ela a faixa é uma tira colada sobre a página. A
            horizontal mora no elemento de dentro para evitar `mask-composite`, e
            existe para o caso de a fileira não chegar à borda: a capa se apaga em
            vez de parar no meio do nada.

            `aria-hidden` porque a página já diz o mesmo por escrito logo abaixo,
            e narrar catorze títulos antes do nome da pessoa é fazer quem ouve
            esperar pelo assunto. */
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[172px] overflow-hidden rounded-plate"
          style={{
            maskImage:
              'linear-gradient(to bottom, transparent 0, rgba(0,0,0,0.92) 20px, rgba(0,0,0,0.92) 48%, transparent 97%)',
            WebkitMaskImage:
              'linear-gradient(to bottom, transparent 0, rgba(0,0,0,0.92) 20px, rgba(0,0,0,0.92) 48%, transparent 97%)',
          }}
        >
          <div
            className="flex h-full gap-[2px]"
            style={{
              maskImage: 'linear-gradient(to right, black 0, black 74%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to right, black 0, black 74%, transparent 100%)',
            }}
          >
            {cover.map(r => (
              <img
                key={r.id}
                src={r.moviePoster as string}
                alt=""
                loading="lazy"
                /* `max-w-none` porque o preflight do Tailwind põe
                   `max-width: 100%` em toda imagem, e aqui a largura sai da
                   altura — sem isto o pôster volta a ser espremido. */
                className="h-full w-auto max-w-none flex-none opacity-[0.24]"
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Empurrado para baixo da capa quando ela existe, e sobe quando não: um
          espaçador fixo abriria um perfil sem fichas com um palmo de nada. */}
      <div className={cn('relative', cover.length && 'pt-[104px]')}>
        <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
          {/* Um anel da cor da sala em volta: sobre a capa, é o que separa a
              pessoa dos filmes atrás dela. */}
          <Reel
            color={reelColor(person.dot, person.id)}
            src={person.avatar}
            className={cn(
              'h-[92px] w-[92px] flex-none text-[30px] ring-2 ring-house',
              !person.avatar && 'min-w-0'
            )}
          >
            {initialsOf(person.name)}
          </Reel>

          <div className="min-w-[220px] flex-1">
            <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 font-display text-[38px] leading-none tracking-[0.04em] text-beam sm:text-[46px]">
              {person.name}
              {person.isAdmin ? (
                <span className="inline-flex items-center gap-1 self-center text-[11px] tracking-[0.14em] text-dye-brass">
                  <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  ADM
                </span>
              ) : null}
            </h1>
            {/* Latão: um `@` é uma pessoa apontada, e apontar alguém já é latão
                em toda a conversa deste produto. */}
            <p className="q mt-2 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-dim">
              {person.handle ? <span className="text-dye-brass">@{person.handle}</span> : null}
              {person.handle && since ? <span aria-hidden>·</span> : null}
              {since ? <span>no clube desde {since}</span> : null}
            </p>
          </div>

          {mine ? (
            <Key tone="flush" className="flex-none" onClick={onSettings}>
              <Settings className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
              Ajustes
            </Key>
          ) : null}
        </div>

        {person.bio ? (
          <p className="mt-4 max-w-[62ch] text-[14px] leading-relaxed text-ink">{person.bio}</p>
        ) : null}

        {/* Havia mais quatro números aqui — comentários, concordâncias,
            discordâncias e curtidas recebidas — e o dono os cortou em
            30/08/2026: um placar de reação abaixo do nome vira boletim de
            popularidade. A reação fica ao lado da ficha que a recebeu. */}
        <p className="q mt-5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-ink-dim">
          <span>
            <span className="text-ink">{takes.length}</span>{' '}
            {takes.length === 1 ? 'filme avaliado' : 'filmes avaliados'}
          </span>
          {avg != null ? (
            <>
              <span aria-hidden>·</span>
              <span>
                média <span className="text-ink">{fmt(avg)}</span>
              </span>
            </>
          ) : null}
        </p>
      </div>
    </header>
  );
}

/* Lado a lado e do mesmo tamanho: o filme que alguém odiou é tão informativo
   quanto o que amou. */
function Ends({ person, onOpenTake }: { person: Reviewer; onOpenTake: (id: string) => void }) {
  const club = useClub();
  const ends = endsOf(club.reviews, person.id);
  if (!ends) return null;

  return (
    <Region title="Extremos">
      <div className="grid gap-3 sm:grid-cols-2">
        <EndCard review={ends.best} label="O que mais gostou" onOpen={onOpenTake} />
        <EndCard review={ends.worst} label="O que menos gostou" onOpen={onOpenTake} />
      </div>
    </Region>
  );
}

function EndCard({
  review,
  label,
  onOpen,
}: {
  review: Review;
  label: string;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(review.id)}
      aria-label={`Abrir a avaliação de ${review.movieTitle}`}
      className="plate group flex gap-4 p-4 text-left transition-colors duration-150 hover:bg-house-seat"
    >
      <Poster src={review.moviePoster} className="aspect-[2/3] w-[58px] flex-none" />
      <span className="min-w-0 flex-1">
        <span className="legend block">{label}</span>
        <span className="mt-1.5 block font-display text-[20px] leading-tight tracking-[0.02em] text-beam transition-colors group-hover:text-beam-hot">
          {review.movieTitle}
        </span>
        <span className="q mt-1 block text-[11px] text-ink-dim">{review.movieGenre}</span>
        <span className="mt-2.5 flex items-center gap-2.5">
          <Strip value={review.final} cells={10} className="h-[6px] w-[92px] flex-none" />
          <span className="q text-[15px] font-medium text-beam">{fmt(review.final)}</span>
        </span>
      </span>
    </button>
  );
}

/* A única régua externa que este produto tem, e sai de graça: a nota do TMDB já
   viaja em toda ficha. Frase e não painel — e carrega o filme onde a distância
   foi maior, porque número sem exemplo é estatística. */
function Crowd({
  person,
  mine,
  onOpenTake,
}: {
  person: Reviewer;
  mine: boolean;
  onOpenTake: (id: string) => void;
}) {
  const club = useClub();
  const crowd = crowdGapOf(club.reviews, person.id);
  if (!crowd) return null;

  /* Um perfil que fala de você na terceira pessoa é um dossiê sobre você. */
  const subject = mine ? 'você' : person.name.split(' ')[0];
  /* Meio ponto é o passo do controle de nota: menos que isso não é "mais
     generoso", é a mesma opinião com ruído de arredondamento em volta. */
  const aligned = Math.abs(crowd.gap) < 0.5;
  const leaning = crowd.gap > 0 ? 'generoso' : 'severo';

  return (
    <Region title="Contra o público" note={`${plural(crowd.n, 'filme', 'filmes')} com nota do TMDB`}>
      <p className="max-w-[62ch] text-[14px] leading-relaxed text-ink-dim">
        {aligned ? (
          <>
            Na média, {subject} dá praticamente a mesma nota que o público do TMDB — a distância é
            de <span className="q text-beam">{fmt(Math.abs(crowd.gap))}</span>.
          </>
        ) : (
          <>
            Na média, {subject} é <span className="q text-beam">{fmt(Math.abs(crowd.gap))}</span>{' '}
            {Math.abs(crowd.gap) === 1 ? 'ponto' : 'pontos'} mais {leaning} que o público do TMDB.
          </>
        )}{' '}
        A maior distância foi em{' '}
        <button
          type="button"
          onClick={() => onOpenTake(crowd.widest.id)}
          className="text-ink underline decoration-white/20 underline-offset-4 transition-colors hover:text-beam hover:decoration-beam/50"
        >
          {crowd.widest.movieTitle}
        </button>
        : <span className="q text-ink">{fmt(crowd.widest.final)}</span> contra{' '}
        <span className="q text-ink">{fmt(crowd.widest.crowd?.score ?? 0)}</span> lá fora.
      </p>
    </Region>
  );
}

/* A distribuição das notas em dez faixas: responde o que a média esconde — duas
   pessoas com média 7,4 podem ser opostas.

   A altura é uma pilha de células, uma por filme, e não um bloco proporcional:
   a contagem se lê contando, que é exato, em vez de se estimar por comprimento.
   Passar o mouse mostra os filmes da faixa; clicar prende, que é o que faz isto
   funcionar no dedo. Faixa vazia não é botão. */
function Ruler({ person, onOpenTake }: { person: Reviewer; onOpenTake: (id: string) => void }) {
  const club = useClub();
  const spread = spreadOf(club.reviews, person.id);
  /* O `??` deixa o ponteiro pré-visualizar sem tirar do lugar o que foi
     prendido no clique. */
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  if (!spread || spread.n < FLOOR.ends) return null;

  const active = hover ?? pinned;
  const band = active != null ? spread.bands[active] : null;

  return (
    <Region
      title="Régua"
      note={
        band && active != null ? (
          <>
            <span className="text-ink">{band.length}</span>{' '}
            {band.length === 1 ? 'filme' : 'filmes'} entre{' '}
            <span className="text-ink">{active}</span> e{' '}
            <span className="text-ink">{active + 1}</span>
          </>
        ) : (
          <>
            de <span className="text-ink">{fmt(spread.low)}</span> a{' '}
            <span className="text-ink">{fmt(spread.high)}</span>
          </>
        )
      }
    >
      <div className="plate px-3 py-4 sm:px-4">
        <ul
          className="flex items-end gap-[3px]"
          onMouseLeave={() => setHover(null)}
        >
          {spread.bands.map((films, i) => {
            const on = active === i;
            const label = films.length
              ? `${plural(films.length, 'filme', 'filmes')} entre ${i} e ${i + 1}`
              : `nenhum filme entre ${i} e ${i + 1}`;
            return (
              <li key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                {films.length ? (
                  <button
                    type="button"
                    aria-pressed={pinned === i}
                    aria-label={label}
                    title={label}
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    onClick={() => setPinned(p => (p === i ? null : i))}
                    className="flex w-full flex-col-reverse gap-[2px] rounded-[1px] pt-4"
                  >
                    {/* Doze pixels: contável de relance, e baixo o bastante para
                        quinze fichas numa faixa não estourarem a placa. */}
                    {films.map(r => (
                      <span
                        key={r.id}
                        className={cn(
                          'h-[12px] w-full rounded-[1px] transition-colors duration-150',
                          on ? 'bg-beam' : 'bg-beam/45'
                        )}
                      />
                    ))}
                  </button>
                ) : (
                  /* Uma célula apagada, e não nada: é onde essa pessoa nunca pôs
                     nota, e o buraco precisa ter forma. */
                  <span
                    aria-label={label}
                    title={label}
                    className="mt-4 h-[12px] w-full rounded-[1px] bg-white/[0.05]"
                  />
                )}
                <span
                  className={cn(
                    'q text-[10px] leading-none transition-colors duration-150',
                    on ? 'text-beam' : 'text-ink-dim'
                  )}
                >
                  {i}
                </span>
              </li>
            );
          })}
        </ul>

        {/* Na própria placa: uma gaveta empurraria a página inteira a cada
            passagem de mouse. A lista troca de conteúdo, e a placa cresce uma
            vez só. */}
        {band?.length ? (
          <ul className="mt-4 flex flex-col gap-1 border-t border-white/[0.06] pt-3">
            {band.map(r => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onOpenTake(r.id)}
                  aria-label={`Abrir a avaliação de ${r.movieTitle}`}
                  className="group flex w-full items-center gap-3 rounded-cell px-1 py-1.5 text-left transition-colors hover:bg-beam/[0.05]"
                >
                  <Poster src={r.moviePoster} className="h-[34px] w-[23px] flex-none" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink transition-colors group-hover:text-beam">
                    {r.movieTitle}
                  </span>
                  <span className="q flex-none text-[13px] text-beam">{fmt(r.final)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {/* Só enquanto ninguém apontou: uma linha explicando um gesto já feito é
            ruído. */}
        {active == null ? (
          <p className="q mt-3 text-[10.5px] text-ink-dim">
            aponte uma faixa para ver os filmes dela
          </p>
        ) : null}
      </div>
    </Region>
  );
}

/* Uma rede medida em gosto e não em quem segue quem: a distância média entre as
   notas de duas pessoas nos filmes que ambas viram, e o filme onde brigaram
   mais. Cada linha é uma porta para o perfil daquela pessoa — é por aqui que se
   navega o clube. */
function Affinities({ person, mine }: { person: Reviewer; mine: boolean }) {
  const club = useClub();
  const list = affinityOf(club.reviews, club.reviewers, person.id);
  if (!list.length) return null;

  return (
    <Region title={mine ? 'Com quem você concorda' : 'Com quem concorda'}>
      <ul className="flex flex-col">
        {list.map((a, i) => (
          <li key={a.person.id} className={cn(i > 0 && 'border-t border-white/[0.06]')}>
            <button
              type="button"
              onClick={() => club.goPerson(a.person.id)}
              aria-label={`Abrir o perfil de ${a.person.name}`}
              className="group flex w-full items-center gap-3 rounded-cell px-2 py-3 text-left transition-colors duration-150 hover:bg-beam/[0.05]"
            >
              <Reel color={reelColor(a.person.dot, a.person.id)} src={a.person.avatar} size="md">
                {initialsOf(a.person.name)}
              </Reel>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] text-ink transition-colors group-hover:text-beam">
                  {a.person.name}
                </span>
                <span className="q block text-[11px] text-ink-dim">
                  {plural(a.shared, 'filme em comum', 'filmes em comum')}
                  {a.clash ? ` · brigaram em ${a.clash.title}` : ''}
                </span>
              </span>
              {/* A régua enche da DIREITA para a esquerda: acordo é distância
                  zero, e a barra mais cheia tem de ser o par mais parecido.
                  Escala de cinco pontos e não dez — cinco de diferença média já
                  é o teto real, e dez espremeria todo mundo no primeiro terço. */}
              <span className="flex flex-none items-center gap-2.5">
                <Strip
                  value={Math.max(0, 10 - Math.min(5, a.gap) * 2)}
                  cells={10}
                  className="hidden h-[6px] w-[80px] sm:flex"
                />
                <span className="q w-[30px] text-right text-[12.5px] text-ink">{fmt(a.gap)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="q mt-3 text-[10.5px] text-ink-dim">
        distância média entre as duas notas, só nos filmes que os dois avaliaram — perto de zero é
        acordo
      </p>
      {!mine ? <Compare person={person} /> : null}
    </Region>
  );
}

/* A afinidade diz quanto; isto diz onde. Do maior desacordo para o menor, porque
   ninguém abre isto para descobrir onde concordou. Não existe no seu próprio
   perfil: comparar você com você é uma coluna de zeros. */
function Compare({ person }: { person: Reviewer }) {
  const club = useClub();
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const rows = useMemo(
    () => clashesOf(club.reviews, club.me.id, person.id),
    [club.reviews, club.me.id, person.id]
  );
  if (!rows.length) return null;

  const first = person.name.split(' ')[0];

  return (
    <div className="mt-4 border-t border-white/[0.06] pt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(v => !v);
          setTouched(true);
        }}
        className="flex items-center gap-2 font-display text-[12.5px] uppercase leading-none tracking-[0.12em] text-ink-dim transition-colors hover:text-beam"
      >
        <ChevronDown
          className={cn('h-4 w-4 flex-none transition-transform duration-200', open && 'rotate-180')}
          strokeWidth={1.7}
          aria-hidden
        />
        {open ? 'Fechar a comparação' : `Comparar com você (${rows.length})`}
      </button>

      <Drawer open={open}>
        {touched ? (
          <div className="pt-4">
            {/* Sem ele, as duas notas de cada linha são números sem dono. */}
            <div className="flex items-center gap-3 pb-2">
              <span className="min-w-0 flex-1" />
              <span className="legend w-[46px] flex-none text-center text-[10px]">Você</span>
              <span className="legend w-[46px] flex-none truncate text-center text-[10px]">
                {first}
              </span>
              <span className="legend w-[38px] flex-none text-right text-[10px]">Δ</span>
            </div>
            <ul className="flex flex-col">
              {rows.map(c => {
                /* O mesmo limiar da divergência no acervo: dois pontos. */
                const loud = c.gap >= 2;
                return (
                  <li key={c.movieId} className="border-t border-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => club.openSheet(c.movieId)}
                      aria-label={`Abrir ${c.title}`}
                      className="group flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-beam/[0.04]"
                    >
                      <Poster src={c.poster} className="h-[38px] w-[26px] flex-none" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink transition-colors group-hover:text-beam">
                        {c.title}
                      </span>
                      <span className="q w-[46px] flex-none text-center text-[13px] text-ink">
                        {fmt(c.mine)}
                      </span>
                      <span className="q w-[46px] flex-none text-center text-[13px] text-ink">
                        {fmt(c.theirs)}
                      </span>
                      <span
                        className={cn(
                          'q w-[38px] flex-none text-right text-[12.5px]',
                          loud ? 'text-beam' : 'text-ink-dim'
                        )}
                      >
                        {fmt(c.gap)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

/* Sem piso, ao contrário do resto da página: contar filmes não afirma nada sobre
   gosto, e "três de terror" é verdade absoluta mesmo com três fichas no total. */
function Genres({ person }: { person: Reviewer }) {
  const club = useClub();
  const list = genresOf(club.reviews, person.id);
  if (list.length < 2) return null;

  return (
    <Region title="Gêneros">
      <ul className="flex flex-wrap gap-2">
        {list.map(g => (
          <li
            key={g.genre}
            className="flex items-baseline gap-2 rounded-cell bg-house-seat/70 px-3 py-1.5 ring-1 ring-house-rail"
          >
            <span className="font-display text-[12.5px] uppercase leading-none tracking-[0.12em] text-ink">
              {g.genre}
            </span>
            <span className="q text-[11px] leading-none text-ink-dim">
              {g.n} · {fmt(g.avg)}
            </span>
          </li>
        ))}
      </ul>
    </Region>
  );
}

/* Um trilho e não uma grade: era uma grade que crescia para baixo, e numa fila
   de trinta filmes ela empurrava o resto da página para fora da tela — a seção
   menos importante ocupando mais espaço que qualquer outra.

   `scrollBy({ behavior: 'smooth' })` é a rolagem animada do próprio navegador:
   composta fora da thread principal, interrompível pelo dedo, e já obediente a
   `prefers-reduced-motion`. À mão só o que o navegador não dá — as máscaras das
   bordas e a gaveta do "ver todos". */
function Queued({ person }: { person: Reviewer }) {
  const club = useClub();
  const items = club.watchlist.filter(w => w.addedBy === person.id);
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const rail = useRef<HTMLUListElement>(null);
  /* Medido, nunca deduzido da contagem: quantos pôsteres cabem depende da
     largura da janela, do zoom e do tamanho da fonte. */
  const [edge, setEdge] = useState({ start: true, end: true, over: false });

  /* `passive` porque isto nunca cancela o gesto. A folga de 2px absorve o
     arredondamento subpixel: em zoom fracionário `scrollLeft + clientWidth` fica
     milésimos abaixo de `scrollWidth`, e a máscara da direita nunca apagaria. */
  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdge({ start: el.scrollLeft <= 2, end: el.scrollLeft >= max - 2, over: max > 2 });
  }, []);

  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // As crianças também: um pôster que chega troca a largura do conteúdo sem
    // trocar a do trilho.
    for (const child of Array.from(el.children)) ro.observe(child);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, [measure, items.length, open]);

  if (!items.length) return null;

  /* Oitenta por cento da largura visível e não uma contagem de pôsteres: uma
     seta que anda "três filmes" anda distâncias diferentes em cada tela. Os
     vinte por cento que sobram são a âncora do que estava à vista. */
  const nudge = (dir: 1 | -1) => {
    const el = rail.current;
    if (!el) return;
    const gentle = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: gentle ? 'auto' : 'smooth' });
  };

  return (
    <Region
      title="Na fila"
      note={
        /* Só quando há o que abrir: com tudo à vista, "ver todos" seria um botão
           que não faz nada visível. */
        edge.over || open ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => {
              setOpen(v => !v);
              setTouched(true);
            }}
            className="font-display text-[11px] uppercase leading-none tracking-[0.12em] text-ink-dim transition-colors hover:text-beam"
          >
            {open ? 'Recolher' : `Ver todos (${items.length})`}
          </button>
        ) : (
          plural(items.length, 'filme', 'filmes')
        )
      }
    >
      {/* Recolhe quando a grade abre, e as duas transições correm juntas: a
          seção nunca salta de tamanho no meio da troca. */}
      <Drawer open={!open}>
        <div className="relative">
          <ul
            ref={rail}
            /* `scroll-px-11` são os mesmos 44px da máscara, e é a peça de
               teclado desta lista: sem o recuo, o Tab rolaria o pôster focado até
               a borda, que é onde a máscara o apaga e a seta o cobre. */
            className="flex gap-3 overflow-x-auto scroll-px-11 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{
              /* Só do lado em que há mais: apagar uma ponta que já acabou seria
                 dizer que existe conteúdo ali. */
              maskImage: `linear-gradient(to right, ${
                edge.start ? 'black 0' : 'transparent 0, black 44px'
              }, ${edge.end ? 'black 100%' : 'black calc(100% - 44px), transparent 100%'})`,
              WebkitMaskImage: `linear-gradient(to right, ${
                edge.start ? 'black 0' : 'transparent 0, black 44px'
              }, ${edge.end ? 'black 100%' : 'black calc(100% - 44px), transparent 100%'})`,
            }}
          >
            {items.map(w => (
              <li key={w.id} className="w-[84px] flex-none">
                <QueuedPoster item={w} onOpen={() => club.openSheet(w.id)} />
              </li>
            ))}
          </ul>

          {/* Fora do `<ul>` porque a máscara as apagaria junto com os pôsteres, e
              escondidas do leitor de tela porque o trilho já é percorrível pelo
              teclado. */}
          <RailKey side="left" show={!edge.start} onClick={() => nudge(-1)} />
          <RailKey side="right" show={!edge.end} onClick={() => nudge(1)} />
        </div>
      </Drawer>

      {/* Montada só depois do primeiro "ver todos": as duas formas desenham os
          mesmos filmes, e montar as duas de saída seriam duas imagens por filme
          numa seção que a maioria nunca abre. Depois de aberta ela fica, senão o
          recolher animaria de altura zero para altura zero. */}
      <Drawer open={open}>
        {touched ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-3 pb-1">
            {items.map(w => (
              <li key={w.id}>
                <QueuedPoster item={w} onOpen={() => club.openSheet(w.id)} />
              </li>
            ))}
          </ul>
        ) : null}
      </Drawer>
    </Region>
  );
}

function QueuedPoster({ item, onOpen }: { item: WatchItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Abrir ${item.title}`}
      className="group block w-full text-left"
    >
      <Poster
        src={item.poster}
        className="aspect-[2/3] w-full transition-[box-shadow] duration-150 group-hover:ring-white/25"
      />
      <span className="mt-1.5 block truncate text-[11.5px] text-ink-dim transition-colors group-hover:text-beam">
        {item.title}
      </span>
    </button>
  );
}

/* Some por opacidade e não sai do DOM: um controle que desaparece ao ser
   apertado tira o foco de baixo do dedo no fim do gesto. `pointer-events`
   acompanham, para a seta apagada não interceptar o clique do pôster. */
function RailKey({
  side,
  show,
  onClick,
}: {
  side: 'left' | 'right';
  show: boolean;
  onClick: () => void;
}) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-hidden
      tabIndex={-1}
      onClick={onClick}
      /* 63px é metade da altura do pôster (84px de largura em 2:3 dão 126px).
         Centrada no PÔSTER e não na fileira, que inclui o título embaixo. */
      className={cn(
        'absolute top-[63px] flex h-8 w-8 -translate-y-1/2 items-center justify-center',
        'rounded-cell bg-house/85 text-ink-dim ring-1 ring-house-rail',
        'transition-[opacity,color] duration-200 hover:text-beam',
        side === 'left' ? 'left-0' : 'right-0',
        show ? 'opacity-100' : 'pointer-events-none opacity-0'
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={1.8} />
    </button>
  );
}

/* A ficha abre AQUI, e não no acervo: cada linha levava para outra aba e quem
   estava percorrendo doze fichas de uma pessoa não voltava. As peças são as
   MESMAS do acervo e do feed (`Breakdown`, `TakeVotes`, `Conversation`), que é
   o motivo de o detalhamento ter saído de screens/ e virado componente.

   Uma de cada vez, ao contrário do acervo: lá a tela existe para COMPARAR duas
   fichas do mesmo filme; aqui são todas da mesma pessoa. */
function Takes({
  person,
  mine,
  open,
  onToggle,
}: {
  person: Reviewer;
  mine: boolean;
  /** Vem de cima porque quatro lugares da página abrem uma. */
  open: string | null;
  onToggle: (id: string) => void;
}) {
  const club = useClub();
  const takes = takesOf(club.reviews, person.id);
  const [all, setAll] = useState(false);

  if (!takes.length) {
    return (
      <Region title="Fichas">
        <Blank title={mine ? 'Você ainda não avaliou nada' : `${person.name.split(' ')[0]} ainda não avaliou nada`}>
          {mine
            ? 'Escolha um filme no catálogo ou na fila e responda as onze perguntas. Da terceira ficha em diante esta página começa a ter o que dizer sobre você.'
            : 'Quando essa pessoa gravar a primeira ficha, ela aparece aqui.'}
        </Blank>
        {mine ? (
          <Key tone="flush" onClick={() => club.goTab('catalog')}>
            <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            Ir para o catálogo
          </Key>
        ) : null}
      </Region>
    );
  }

  /* Uma ficha aberta nunca fica escondida atrás do "ver as outras". */
  const openIndex = open ? takes.findIndex(r => r.id === open) : -1;
  const shown = all || openIndex >= 12 ? takes : takes.slice(0, 12);
  const hidden = takes.length - shown.length;

  return (
    <Region title="Fichas" note={plural(takes.length, 'avaliação', 'avaliações')}>
      <ul className="flex flex-col">
        {shown.map(r => (
          <li key={r.id} className="border-t border-white/[0.06] first:border-t-0">
            <TakeLine review={r} open={open === r.id} onToggle={() => onToggle(r.id)} />
          </li>
        ))}
      </ul>
      {hidden ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-4 font-display text-[11px] uppercase leading-none tracking-[0.12em] text-ink-dim transition-colors hover:text-beam"
        >
          Ver as outras {hidden}
        </button>
      ) : null}
    </Region>
  );
}

function TakeLine({
  review,
  open,
  onToggle,
}: {
  review: Review;
  open: boolean;
  onToggle: () => void;
}) {
  const club = useClub();
  /* Cada contagem se cala em zero: uma fileira de zeros embaixo de cada linha é
     ruído com formato de dado. */
  const cast = club.votes.filter(v => v.reviewId === review.id);
  const up = cast.filter(v => v.value === 1).length;
  const down = cast.filter(v => v.value === -1).length;
  const talk = club.comments.filter(c => c.reviewId === review.id).length;

  /* Aberta uma vez, montada para sempre: montar as doze de saída seriam doze
     conversas e doze detalhamentos que ninguém pediu, e desmontar ao fechar
     faria a gaveta recolher de altura zero para altura zero. */
  const [touched, setTouched] = useState(open);
  if (open && !touched) setTouched(true);

  return (
    <div id={`ficha-${review.id}`} className="scroll-mt-24">
      {/* Os contadores só aparecem com a gaveta FECHADA: abertos, os controles de
          verdade estão logo abaixo com os mesmos números dentro. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`ficha-corpo-${review.id}`}
        className="group flex w-full items-center gap-3 rounded-cell px-2 py-2.5 text-left transition-colors duration-150 hover:bg-beam/[0.05]"
      >
      <Poster src={review.moviePoster} className="h-[52px] w-[35px] flex-none" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] text-ink transition-colors group-hover:text-beam">
          {review.movieTitle}
        </span>
        <span className="q block text-[11px] text-ink-dim">
          {[review.movieYear ?? '—', review.movieGenre].filter(Boolean).join(' · ')}
        </span>
        {!open && (talk || up || down) ? (
          <span className="mt-1 flex items-center gap-3 text-ink-faint">
            {talk ? (
              <span className="flex items-center gap-1" title={plural(talk, 'resposta', 'respostas')}>
                <MessageSquare className="h-3 w-3" strokeWidth={1.9} aria-hidden />
                <span className="q text-[10.5px] text-ink-dim">{talk}</span>
              </span>
            ) : null}
            {up ? (
              <span className="flex items-center gap-1" title={`${up} ${up === 1 ? 'concorda' : 'concordam'}`}>
                <ThumbsUp className="h-3 w-3" strokeWidth={1.9} aria-hidden />
                <span className="q text-[10.5px] text-ink-dim">{up}</span>
              </span>
            ) : null}
            {down ? (
              <span
                className="flex items-center gap-1"
                title={`${down} ${down === 1 ? 'discorda' : 'discordam'}`}
              >
                <ThumbsDown className="h-3 w-3" strokeWidth={1.9} aria-hidden />
                <span className="q text-[10.5px] text-ink-dim">{down}</span>
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
      <span className="flex flex-none items-center gap-2.5">
        <Strip value={review.final} cells={10} className="hidden h-[6px] w-[80px] sm:flex" />
        <span className="q w-[34px] text-right text-[16px] text-beam">{fmt(review.final)}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 flex-none text-ink-dim transition-transform duration-200',
            open && 'rotate-180'
          )}
          strokeWidth={1.7}
          aria-hidden
        />
      </span>
      </button>

      <Drawer open={open}>
        {touched ? (
          <div id={`ficha-corpo-${review.id}`} className="px-2 pb-4 pt-1">
            <Breakdown r={review} comment={review.comment} />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <TakeVotes review={review} labelled />
              {/* O caminho para o acervo continua existindo, como uma saída e
                  não como o gesto principal: lá a ficha aparece ao lado das dos
                  outros sobre o mesmo filme, que é a única coisa que esta
                  página não sabe mostrar. */}
              <button
                type="button"
                onClick={() => club.goReview(review.id)}
                className="font-display text-[11px] uppercase leading-none tracking-[0.12em] text-ink-dim transition-colors hover:text-beam"
              >
                Ver no acervo
              </button>
            </div>
            <Conversation review={review} />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

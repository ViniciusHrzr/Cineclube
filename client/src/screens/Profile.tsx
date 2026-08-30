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
/* As mesmas peças que o acervo e o feed usam. A ficha abre nesta página agora —
   ver a nota em `Takes` — e o que ela mostra não pode ser uma segunda versão do
   que o acervo mostra. */
import { Breakdown } from '@/components/take';
import { Conversation, TakeVotes } from '@/components/social';
import { SettingsSheet } from '@/components/settings';
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

/* ══════════════════════════════════════════════════════════════════════════
   O PERFIL

   A página sobre uma pessoa, e a peça que faltava para este produto ser um
   lugar onde um clube se encontra em vez de um formulário onde ele arquiva.

   O que existia aqui chamava-se *Avaliadores* e era um painel de configuração
   com nome de seção: meu nome, meu PIN, cadastrar, remover. Quatro placas de
   formulário ocupando uma rota inteira para responder perguntas que alguém faz
   duas vezes por ano — e ocupando exatamente o lugar da página que o produto
   não tinha. Aquilo foi inteiro para trás de uma engrenagem (ver
   components/settings.tsx) e isto tomou o cômodo.

   ── por que este perfil não é o perfil de qualquer app de filme ──────────
   Porque ele não abre com uma contagem. "45 filmes · média 7,4" é uma frase que
   qualquer produto de cinema sabe escrever; o que só este clube sabe é onde uma
   pessoa se entusiasmou, onde ela se decepcionou, o quanto ela se afasta do
   público lá fora e com quem ela costuma brigar. São todas perguntas sobre
   relação — com um filme, com o mundo, com as outras cinco pessoas —, e é isso
   que uma página sobre alguém deveria responder.

   > **A ficha do gosto saiu em 30/08/2026, por decisão do dono.** Ela abria a
   > página: os onze critérios com a média da pessoa na régua de células e a
   > média do clube marcada por cima, ordenados pela distância entre as duas.
   > Era o módulo com o argumento mais forte no papel e o dono o cortou depois
   > de ver na tela. O cálculo foi junto — ver lib/taste.ts. Se alguém quiser
   > ressuscitá-lo, o histórico tem a implementação inteira, e o motivo de ela
   > ter saído não está registrado aqui porque não foi dito: bastou não gostar.

   ── a página se cala quando não sabe ────────────────────────────────────
   Todo módulo aqui pode não aparecer, e essa é a decisão de desenho mais
   importante do arquivo. Uma média tirada de duas fichas não é um gosto, é um
   acidente com formato de dado — e desenhada com a mesma firmeza da de quem tem
   cinquenta, ela seria indistinguível. Os pisos moram em lib/taste.ts, um por
   pergunta, e um `null` de lá significa "esta página ainda não tem o que dizer
   sobre isso".

   O que sobra no silêncio nunca é um vazio: é o que a pessoa já fez. Um perfil
   novo mostra as fichas que tem e diz quantas faltam para o resto acender —
   que é um convite, e o único deste produto que se justifica.

   ── é de todo mundo ─────────────────────────────────────────────────────
   `#perfil/<id>`. Chega-se por um rosto, e todo rosto do app é um: o seu na
   marquise, o de quem avaliou no feed, o de quem comentou na conversa. O que
   faltava nunca foi a página — era o clube ser feito de gente clicável.
   ══════════════════════════════════════════════════════════════════════════ */

export function ProfileScreen() {
  const club = useClub();
  const [settings, setSettings] = useState(false);

  /* ── qual ficha está aberta ─────────────────────────────────────────────
     Mora aqui e não dentro da lista porque quatro lugares desta página apontam
     para uma ficha — os extremos, a maior distância do TMDB, uma faixa da régua
     e a própria lista — e todos os quatro têm de abrir a MESMA gaveta. Guardado
     na lista, cada um deles teria de mandar a pessoa para outro lugar de novo,
     que é exatamente o que esta mudança veio desfazer. */
  const [openTake, setOpenTake] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  /* Abre a ficha na lista e leva a página até ela. `start` e não `center`
     porque a gaveta cresce PARA BAIXO: alinhada pelo topo, a fileira fica onde
     parou e o conteúdo se abre embaixo dela; centrada, ela seria empurrada para
     fora da tela pelo próprio conteúdo que acabou de abrir.

     Os 60ms são o commit do React, não a animação: a fileira precisa existir no
     DOM — a lista pode ter acabado de crescer para além das doze — antes de
     alguém poder rolar até ela. */
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

  /* Trocar de pessoa fecha o que estava aberto. Sem isto, ir de um perfil a
     outro carregaria um id que não pertence a esta lista — inofensivo, porque
     nada casa com ele, e ainda assim um estado mentindo sobre o que está na
     tela. */
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

  /* Uma pessoa que saiu do clube depois de alguém colar o link. O endereço fica,
     a página abre, e ela diz o que sobra de honesto — não uma tela em branco e
     não um erro, porque nada quebrou: a pessoa é que não está mais aqui. */
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
      <Header person={person} mine={mine} onSettings={() => setSettings(true)} />

      {/* ── a ordem ──────────────────────────────────────────────────────
          Primeiro o que a pessoa achou dos filmes: os extremos, o quanto ela se
          afasta do público, como ela distribui as notas, o que quer ver, e
          então o arquivo inteiro. Só depois disso o que ela é EM RELAÇÃO ao
          clube — com quem concorda e em que gêneros vive.

          Afinidade e gêneros vinham antes das fichas e o dono os mandou para
          baixo. Está certo: os dois são leitura de segunda passagem. Quem abre o
          perfil de alguém está perguntando "o que essa pessoa viu e achou", e
          "com quem ela concorda" é uma pergunta que só ocorre depois de a
          primeira ter sido respondida. */}
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

      {mine ? <SettingsSheet open={settings} onClose={() => setSettings(false)} /> : null}
    </section>
  );
}

/* ── uma região da página ─────────────────────────────────────────────────
   Legenda, régua fina, conteúdo. Sem placa: sete placas empilhadas seriam sete
   caixas do mesmo tamanho fazendo o papel de estrutura, que é o jeito preguiçoso
   de dividir uma página — o olho lê a moldura e não o que está dentro. Cada
   módulo aqui tem a forma do que ele diz: os extremos são dois pôsteres, a
   régua é uma pilha de células, a comparação são duas colunas.

   Os títulos são substantivos secos — Extremos, Régua, Fichas, Gêneros — por
   decisão do dono em 30/08/2026. Tinham artigo ("As fichas", "A régua"), e o
   artigo é uma sílaba de cortesia em versalete tracked de 13px: ele alarga a
   legenda sem dizer nada. Os dois títulos que continuam sendo frase — "Contra
   o público" e "Com quem concorda" — continuam porque não são rótulos de uma
   coisa, são a pergunta que a seção responde.

   A linha ao lado do título repete o gesto do cabeçalho de seção do produto
   (ver `Bill` em bits.tsx): a luz escorrendo da lettering e se apagando pela
   linha. Aqui em escala menor, porque isto é uma região e não uma tela. */
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

/* ══ o cabeçalho ══════════════════════════════════════════════════════════
   A marquise da pessoa: os pôsteres do que ela mais gostou correndo atrás do
   retrato dela.

   A capa é feita de conteúdo real e de nada mais. Um gradiente decorativo ali
   seria a única coisa desta interface que não veio da sala — e havia material
   à mão: as fichas com as maiores notas dessa pessoa são, literalmente, a
   resposta para "o que essa pessoa gosta". Escurecidas e dissolvidas para baixo,
   elas viram atmosfera sem deixar de ser informação, e quem reconhece um pôster
   ali já sabe alguma coisa antes de ler uma palavra.

   Sem fichas não há capa. O que fica é a parede de película que já está atrás
   de tudo — que é melhor do que um retângulo cinza esperando conteúdo. */
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

  /* Os oito de maior nota, com pôster. Oito porque é o que atravessa uma tela
     larga sem repetir e o que ainda cobre uma estreita sem espremer. */
  const cover = useMemo(
    () =>
      [...takes]
        .filter(r => r.moviePoster)
        .sort((a, b) => b.final - a.final)
        .slice(0, 8),
    [takes]
  );

  const avg = takes.length ? takes.reduce((s, r) => s + r.final, 0) / takes.length : null;

  return (
    <header className="relative">
      {cover.length ? (
        /* ── a capa ──────────────────────────────────────────────────────
            Recortada em `overflow-hidden` e mascarada para transparente na
            base: sem a máscara ela termina numa borda reta, e uma borda reta
            no alto de uma página é uma faixa colada em cima do conteúdo. Com
            ela, a fileira se apaga dentro da sala.

            `aria-hidden` porque isto é o mesmo dado que a página inteira já
            diz por escrito logo abaixo, e narrar oito títulos de filme antes
            do nome da pessoa é fazer quem ouve esperar pelo assunto. */
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[172px] overflow-hidden rounded-plate"
          style={{
            maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.9) 0%, transparent 92%)',
            WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.9) 0%, transparent 92%)',
          }}
        >
          <div className="flex h-full gap-[2px]">
            {cover.map(r => (
              <div key={r.id} className="h-full min-w-0 flex-1">
                <img
                  src={r.moviePoster as string}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover opacity-[0.22]"
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* O conteúdo é empurrado para baixo da capa quando ela existe, e sobe
          quando não existe. Um espaçador de altura fixa deixaria um perfil sem
          fichas abrindo com um palmo de nada. */}
      <div className={cn('relative', cover.length && 'pt-[104px]')}>
        <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
          {/* O retrato no tamanho em que vale a pena olhar, no mesmo quadro
              quadrado que o pequeno usa em todo lugar. Um anel do próprio
              fundo da sala em volta: sobre a capa ele é o que separa a pessoa
              dos filmes atrás dela. */}
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
            {/* O apelido em latão porque um `@` é uma pessoa apontada, e apontar
                uma pessoa já é latão em toda a conversa deste produto. */}
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

        {/* A bio: a única coisa nesta página que a pessoa afirma sobre si.
            Ausente é o estado normal — todo o resto aqui é derivado do que ela
            fez, e derivado é mais honesto. */}
        {person.bio ? (
          <p className="mt-4 max-w-[62ch] text-[14px] leading-relaxed text-ink">{person.bio}</p>
        ) : null}

        {/* ── os dois números que interessam ──────────────────────────────
            Quantos filmes e a média. Uma frase tabular e não uma fileira de
            cartões: caixas com um número grande e um rótulo pequeno gastam um
            quarto da tela para dizer o que cabe numa linha. Os números são
            `ink` e as palavras são `ink-dim`, então o olho pega os números
            primeiro e o resto se lê como texto.

            Havia mais quatro aqui — comentários escritos, concordâncias,
            discordâncias e curtidas recebidas — e o dono os cortou em
            30/08/2026. Estavam medindo a coisa errada no lugar errado: um
            perfil abre dizendo o que a pessoa VIU, e um placar de reação
            recebida logo abaixo do nome transforma isso num boletim de
            popularidade. A reação continua onde ela significa alguma coisa,
            que é ao lado da ficha que a recebeu. */}
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

/* ══ o que ela mais amou e o que mais detestou ════════════════════════════
   Duas fichas, dois pôsteres, e nenhuma média. É o módulo mais barato da
   página e um dos que mais dizem: extremos são o que qualquer pessoa conta
   primeiro quando explica o próprio gosto para outra.

   Lado a lado e do mesmo tamanho, de propósito. O de cima em destaque e o de
   baixo pequeno seria a página opinando sobre qual dos dois vale mais — e o
   filme que alguém odiou é tão informativo quanto o que amou. */
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

/* ══ ela contra o público ═════════════════════════════════════════════════
   A única régua externa que este produto tem, e ela sai de graça: a nota do
   TMDB já viaja em toda ficha.

   Escrito como frase e não como painel. É um fato único com um número dentro,
   e um fato único num cartão com rótulo em versalete é um número procurando
   parecer um relatório. A frase carrega o caso junto — o filme onde a distância
   foi maior — porque um número sem exemplo é estatística e com exemplo é
   argumento. */
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

  /* A frase muda de pessoa gramatical no seu próprio perfil. Um perfil que só
     fala de você na terceira pessoa é um dossiê sobre você. */
  const subject = mine ? 'você' : person.name.split(' ')[0];
  /* Meio ponto é o passo do controle de nota. Uma diferença menor que isso não é
     "mais generoso", é a mesma opinião com ruído de arredondamento em volta. */
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

/* ══ a régua dela ═════════════════════════════════════════════════════════
   A distribuição das notas em dez faixas. Responde o que a média esconde: duas
   pessoas com média 7,4 podem ser opostas — uma que dá 7 e 8 em tudo, outra que
   dá 3 e 10 —, e a segunda é muito mais interessante de ter no clube.

   Feito das mesmas células de película do resto do produto, empilhadas em vez
   de enfileiradas. Não é um gráfico de barras emprestado de um painel: é a
   mesma matéria, virada de lado. */
/* ── uma faixa se aponta, e ela responde ──────────────────────────────────
   A primeira versão eram dez blocos de altura proporcional, e ela falhava em
   duas coisas de uma vez. Não dava para LER — quatro colunas de alturas
   parecidas não dizem se são duas ou três fichas, e a faixa vazia virava um
   fiapo indistinguível do eixo. E não respondia a pergunta que ela mesma
   provoca: alguém que vê três filmes entre 7 e 8 quer saber quais.

   A altura agora é uma pilha de células, uma por filme. A contagem se lê
   contando, que é exato, em vez de se estimar por comprimento, que não é. E é
   a mesma matéria do resto do produto — a régua de nota é uma fileira de
   células, esta é a mesma coisa virada de lado.

   Apontar uma faixa acende ela em facho e derrama os filmes dela embaixo.
   Passar o mouse mostra; clicar prende, e é o que faz isto funcionar no dedo,
   onde não existe passar por cima. Uma faixa vazia não é botão: não há o que
   ela possa mostrar, e um alvo que não responde é pior do que nenhum. */
function Ruler({ person, onOpenTake }: { person: Reviewer; onOpenTake: (id: string) => void }) {
  const club = useClub();
  const spread = spreadOf(club.reviews, person.id);
  /* Duas fontes para o mesmo destaque: a passagem do mouse, que é efêmera, e o
     clique, que fica. O `??` é o que deixa o ponteiro pré-visualizar sem tirar
     do lugar o que alguém prendeu. */
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
                    {/* Uma célula por filme, empilhada de baixo para cima. Doze
                        pixels de altura: o bastante para se contar de relance e
                        pouco o bastante para uma pessoa com quinze fichas numa
                        faixa não estourar a placa. */}
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
                  /* A faixa vazia é o dado mais fácil de perder e um dos mais
                     interessantes: é onde essa pessoa nunca pôs uma nota. Fica
                     como uma célula apagada, da altura de uma só, para o buraco
                     ter forma em vez de virar um fiapo colado no eixo. */
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

        {/* Os filmes da faixa apontada, na própria placa. Uma gaveta aqui seria
            um painel que empurra a página inteira a cada passagem de mouse; a
            lista só troca de conteúdo, e a placa cresce uma vez. */}
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

        {/* A instrução aparece só enquanto ninguém apontou nada. Depois disso a
            pessoa já sabe, e uma linha permanente explicando um gesto que já foi
            feito é ruído. */}
        {active == null ? (
          <p className="q mt-3 text-[10.5px] text-ink-dim">
            aponte uma faixa para ver os filmes dela
          </p>
        ) : null}
      </div>
    </Region>
  );
}

/* ══ com quem ela concorda ════════════════════════════════════════════════
   O módulo mais social da página, e ele não existe em nenhum outro app de
   filme: é uma rede medida em gosto, não em quem segue quem.

   Cada linha é uma pessoa, a distância média entre as notas das duas nos filmes
   que ambas viram, e — quando existe — o filme onde elas mais brigaram. A
   distância é desenhada como comprimento, porque "1,8" precisa ser convertido
   e um comprimento não.

   Cada linha é uma porta para o perfil daquela pessoa. É por aqui que se navega
   o clube: você chega em alguém pelo feed, vê com quem ela discorda, e vai. */
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
              {/* A distância como comprimento e como número. A régua enche da
                  DIREITA para a esquerda: acordo é distância zero, e uma barra
                  que cresce com a discordância deixa o par mais parecido com a
                  barra mais curta — que é a leitura certa e a intuitiva.

                  Cinco pontos de escala e não dez: dois amigos que discordam
                  cinco pontos em média já é o teto real da coisa, e usar dez
                  espremeria todas as linhas do clube no primeiro terço. */}
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

/* ══ você e ela, ficha por ficha ══════════════════════════════════════════
   A afinidade diz *quanto*; isto diz *onde*. Duas colunas, os filmes que vocês
   dois viram, do maior desacordo para o menor — porque ninguém abre isto para
   descobrir onde concordou.

   Numa gaveta e não numa rota: quem aperta está no meio de ler um perfil, e
   trocar de página para ver uma comparação e voltar é perder o lugar. Fechada
   ao chegar, porque a página já é longa e isto é uma segunda pergunta.

   Não existe no seu próprio perfil: comparar você com você é uma coluna de
   zeros. */
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
            {/* O cabeçalho das colunas, uma vez. Sem ele as duas notas de cada
                linha são dois números sem dono. */}
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
                /* O mesmo limiar da régua de divergência do acervo: a partir de
                   dois pontos a diferença acende em facho, porque discordar é
                   informação e não defeito. */
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

/* ══ em que gêneros ela vive ══════════════════════════════════════════════
   Quantas fichas e a média em cada gênero. Sem piso: contar filmes não afirma
   nada sobre gosto, e "três de terror" é verdade absoluta mesmo com três fichas
   no total.

   Uma linha corrida de fatias e não uma lista. É informação de contorno — dá o
   feitio do que a pessoa assiste sem pedir leitura linha a linha. */
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

/* ══ o que ela pôs na fila ════════════════════════════════════════════════
   A fila é do clube, mas cada filme nela foi ideia de alguém — e o que uma
   pessoa quer ver é tão revelador quanto o que ela já viu. É a única coisa
   neste perfil que fala do futuro.

   ── um trilho, não uma parede ───────────────────────────────────────────
   Era uma grade que crescia para baixo, e numa fila de trinta filmes ela
   empurrava tudo o que vem depois para fora da tela: quem estava lendo o perfil
   de alguém passava a rolar um mural de pôsteres de filmes que ninguém viu
   ainda. A fila é a seção menos importante da página e estava ocupando mais
   espaço que qualquer outra.

   Uma linha só, que corre para o lado. O que sobra da tela continua sendo da
   página, e a fila diz o tamanho dela sem tomar a altura.

   ── por que sem biblioteca de animação ──────────────────────────────────
   Porque `scrollBy({ behavior: 'smooth' })` é a rolagem animada do próprio
   navegador: composta fora da thread principal, interrompível pelo dedo no meio
   do movimento, e já obediente a `prefers-reduced-motion` sem ninguém pedir.
   Qualquer animação escrita à mão aqui seria uma reimplementação pior — e o
   projeto teria de carregar um segundo pacote de animação para isso.

   O que é animado à mão é o que o navegador não dá: as máscaras das bordas, que
   acendem só do lado em que ainda há filme, e a gaveta do "ver todos", que é a
   mesma transição de `grid-template-rows` que o resto do produto usa. */
function Queued({ person }: { person: Reviewer }) {
  const club = useClub();
  const items = club.watchlist.filter(w => w.addedBy === person.id);
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const rail = useRef<HTMLUListElement>(null);
  /* O que a régua de rolagem sabe sobre si mesma. Medido, nunca deduzido da
     contagem: quantos pôsteres cabem depende da largura da janela, do zoom da
     interface e do tamanho da fonte, e chutar isso erra em metade das telas. */
  const [edge, setEdge] = useState({ start: true, end: true, over: false });

  /* Uma medição só, chamada pela rolagem, pelo redimensionamento e pela troca
     de conteúdo. `passive` porque isto nunca cancela o gesto — segurar a
     rolagem para decidir se uma máscara acende é exatamente o defeito que essa
     bandeira existe para evitar.

     A folga de 2px absorve o arredondamento subpixel: em zoom fracionário
     `scrollLeft + clientWidth` fica dezenas de milésimos abaixo de
     `scrollWidth`, e sem ela a máscara da direita nunca apagaria. */
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
    // trocar a do trilho, e só o observador do trilho não veria isso.
    for (const child of Array.from(el.children)) ro.observe(child);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, [measure, items.length, open]);

  if (!items.length) return null;

  /* Oitenta por cento da largura visível, e não uma contagem de pôsteres: uma
     seta que anda "três filmes" anda distâncias diferentes em cada tela. O
     resto de vinte por cento é a âncora — sobra sempre um pôster do que estava
     à vista, e é ele que diz que a fileira andou em vez de ter trocado. */
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
        /* A opção de abrir tudo só existe quando há o que abrir. Com seis
           pôsteres numa tela larga nada está escondido, e um "ver todos" ali
           seria um botão que não faz nada visível. */
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
      {/* ── o trilho ───────────────────────────────────────────────────────
          Recolhe quando a grade abre, e as duas transições correm juntas: a
          altura do trilho fecha no mesmo tempo em que a da grade abre, então a
          seção nunca salta de tamanho no meio da troca. */}
      <Drawer open={!open}>
        <div className="relative">
          <ul
            ref={rail}
            /* `scroll-px-11` são os mesmos 44px da máscara, e ele é a peça de
               teclado desta lista: cada pôster é um botão, então o Tab já
               percorre o trilho e o navegador rola sozinho até o que recebeu
               foco — mas rolaria até encostá-lo na borda, que é justamente onde
               a máscara o apaga e a seta o cobre. Com o recuo, o pôster focado
               para dentro do claro.

               A barra de rolagem some porque mora sobre a fileira e a corta; as
               setas e as máscaras é que dizem que há mais. */
            className="flex gap-3 overflow-x-auto scroll-px-11 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{
              /* A máscara é o gesto: a fileira não termina numa borda reta, ela
                 se apaga onde continua. Só do lado em que há mais — apagar uma
                 ponta que já acabou seria dizer que existe conteúdo ali.

                 Escrita em duas paradas por lado para que os lados possam ser
                 ligados e desligados de forma independente. */
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

          {/* As setas, uma por lado, e só a que tem para onde ir. Ficam fora do
              `<ul>` porque a máscara as apagaria junto com os pôsteres, e
              escondidas do leitor de tela porque um trilho de rolagem já é
              percorrível pelo teclado — para quem lê por áudio elas seriam dois
              controles a mais oferecendo o que a lista já faz. */}
          <RailKey side="left" show={!edge.start} onClick={() => nudge(-1)} />
          <RailKey side="right" show={!edge.end} onClick={() => nudge(1)} />
        </div>
      </Drawer>

      {/* A grade inteira, com a mesma medida de pôster do trilho, para que
          expandir seja a mesma fileira quebrando em linhas e não um segundo
          desenho da mesma coisa.

          Montada só depois do primeiro "ver todos": as duas formas desenham os
          mesmos filmes, e montá-las juntas de saída seria pedir ao navegador
          duas imagens por filme numa seção que a maioria das pessoas nunca vai
          abrir. Depois de aberta ela fica, senão o recolher animaria de altura
          zero para altura zero. */}
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

/** Um pôster da fila. O mesmo nas duas formas — o trilho e a grade. */
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

/* A seta que empurra o trilho. Aparece e some com uma opacidade — some, e não
   deixa de ser desenhada, porque um controle que salta para fora do DOM ao ser
   apertado tira o foco de baixo do dedo no fim do gesto. `pointer-events`
   acompanham a opacidade para que a seta apagada não intercepte o clique do
   pôster que está embaixo dela. */
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
      /* 63px é a metade da altura de um pôster: 84px de largura na proporção
         2:3 dão 126px. Centrada no PÔSTER e não na fileira, porque a fileira
         inclui a linha do título embaixo e a seta desceria para o meio do
         texto. Um valor fixo funciona porque a largura do item também é fixa. */
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

/* ══ tudo o que ela avaliou ═══════════════════════════════════════════════
   O arquivo dela, do mais recente para o mais antigo — a única lista da página
   em ordem de tempo, porque é a única que responde "o que andou vendo".

   ── a ficha abre AQUI ───────────────────────────────────────────────────
   Cada linha levava ao acervo, e isso estava errado de um jeito que só aparece
   usando: quem está percorrendo doze fichas de uma pessoa clica numa, é jogado
   para outra aba, e não volta. O perfil virava um índice de saída em vez de um
   lugar onde se explora alguém — e explorar era a coisa toda.

   Agora a linha desdobra na própria lista: os onze critérios, o que a pessoa
   escreveu, o par de polegares e a conversa inteira. Não é uma cópia de nada —
   são as MESMAS peças do acervo e do feed (`Breakdown`, `TakeVotes`,
   `Conversation`), que é o motivo de o detalhamento ter saído de screens/
   e virado componente.

   Uma de cada vez, e essa é a diferença deliberada para o acervo, onde várias
   ficam abertas juntas. Lá a tela existe para COMPARAR — duas fichas do mesmo
   filme lado a lado é a pergunta que ela responde. Aqui todas as fichas são da
   mesma pessoa, não há nada para comparar entre elas, e doze gavetas abertas
   fariam a página perder o pé. */
function Takes({
  person,
  mine,
  open,
  onToggle,
}: {
  person: Reviewer;
  mine: boolean;
  /* Qual ficha está aberta. Vem de cima porque quatro lugares da página abrem
     uma — ver a nota em `ProfileScreen`. */
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

  /* Uma ficha aberta nunca fica escondida atrás do "ver as outras": abrir uma
     coisa e ela não aparecer é o botão mentindo. */
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
  /* A reação que a ficha juntou, contada do que o clube já carregou. Muda no
     zero, como em todo lugar: uma fileira de zeros embaixo de cada linha conta
     que ninguém falou nada, que é ruído com formato de dado. */
  const cast = club.votes.filter(v => v.reviewId === review.id);
  const up = cast.filter(v => v.value === 1).length;
  const down = cast.filter(v => v.value === -1).length;
  const talk = club.comments.filter(c => c.reviewId === review.id).length;

  /* Aberta uma vez, montada para sempre — enquanto a fileira viver. Montar as
     doze de saída seria uma tela inteira de trabalho, com doze conversas e doze
     detalhamentos, pelo que ninguém pediu ainda; e desmontar ao fechar faria a
     gaveta recolher de altura zero para altura zero, um sumiço seco no lugar da
     animação. Mesma decisão que a conversa do feed já tinha tomado. */
  const [touched, setTouched] = useState(open);
  if (open && !touched) setTouched(true);

  return (
    <div id={`ficha-${review.id}`} className="scroll-mt-24">
      {/* Os contadores de reação só aparecem com a gaveta FECHADA. Abertos, os
          controles de verdade estão logo abaixo com os mesmos números dentro —
          e o mesmo par de números duas vezes na mesma fileira faz o olho parar
          para procurar a diferença entre eles. */}
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

      {/* ── a ficha aberta ────────────────────────────────────────────────
          As mesmas peças do acervo e do feed, montadas aqui. `Breakdown` traz
          os onze critérios e o que a pessoa escreveu; `TakeVotes` traz o par de
          polegares com as mesmas regras de sempre (na própria ficha os botões
          somem e sobra o placar); `Conversation` traz o fio inteiro, com
          resposta, menção e curtida. */}
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

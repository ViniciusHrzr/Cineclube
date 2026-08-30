import { useMemo, useState } from 'react';
import {
  ChevronDown,
  MessageSquare,
  Plus,
  Settings,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { Blank, Drawer, Key, Poster, Reel, Strip } from '@/components/bits';
import { WithMentions } from '@/components/mention';
import { SettingsSheet } from '@/components/settings';
import { fmt, initialsOf, reelColor, type Review, type Reviewer } from '@/lib/api';
import {
  affinityOf,
  clashesOf,
  crowdGapOf,
  endsOf,
  FLOOR,
  genresOf,
  memberSince,
  reactionsOf,
  spreadOf,
  takesOf,
} from '@/lib/taste';
import { cn, plural, whenOf } from '@/lib/utils';
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

      <div className="mt-8 flex flex-col gap-8">
        <Ends person={person} />
        <Crowd person={person} mine={mine} />
        <Ruler person={person} />
        <Affinities person={person} mine={mine} />
        <Genres person={person} />
        <Written person={person} />
        <Queued person={person} mine={mine} />
        <Takes person={person} mine={mine} />
      </div>

      {mine ? <SettingsSheet open={settings} onClose={() => setSettings(false)} /> : null}
    </section>
  );
}

/* ── uma região da página ─────────────────────────────────────────────────
   Legenda, régua fina, conteúdo. Sem placa: nove placas empilhadas seriam nove
   caixas do mesmo tamanho fazendo o papel de estrutura, que é o jeito preguiçoso
   de dividir uma página — o olho lê a moldura e não o que está dentro. Cada
   módulo aqui tem a forma do que ele diz: a ficha do gosto é uma pilha de
   réguas, os extremos são dois pôsteres, a comparação são duas colunas.

   A régua repete o gesto do cabeçalho de seção do produto (ver `Bill` em
   bits.tsx): a luz escorrendo da lettering e se apagando pela linha. Aqui em
   escala menor, porque isto é uma região e não uma tela. */
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
  const got = reactionsOf(club.votes, club.commentLikes, club.comments, club.reviews, person.id);

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

        {/* ── os números, numa linha ──────────────────────────────────────
            Uma frase tabular e não uma fileira de cartões. Quatro caixas com um
            número grande e um rótulo pequeno é o gabarito que todo painel usa,
            e ele gasta um quarto da tela para dizer o que cabe numa linha —
            além de dar a quatro fatos de importâncias diferentes exatamente o
            mesmo peso. Aqui os números são `ink` e as palavras são `ink-dim`,
            então o olho pega os números primeiro e o resto se lê como texto.

            Silencioso no zero, item por item: "0 comentários" num perfil novo é
            ruído com formato de dado, e são três deles. */}
        <p className="q mt-5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-ink-dim">
          <Stat n={takes.length} one="filme avaliado" many="filmes avaliados" always />
          {avg != null ? (
            <>
              <span aria-hidden>·</span>
              <span>
                média <span className="text-ink">{fmt(avg)}</span>
              </span>
            </>
          ) : null}
          <Stat n={got.wrote} one="comentário" many="comentários" />
          <Stat n={got.agree} one="concordância" many="concordâncias" />
          <Stat n={got.differ} one="discordância" many="discordâncias" />
          <Stat n={got.likes} one="curtida" many="curtidas" />
        </p>
      </div>
    </header>
  );
}

/** Um número da linha do cabeçalho. Cala no zero, a não ser que seja o primeiro. */
function Stat({
  n,
  one,
  many,
  always,
}: {
  n: number;
  one: string;
  many: string;
  /** O total de fichas aparece mesmo em zero: é o assunto da página. */
  always?: boolean;
}) {
  if (!n && !always) return null;
  return (
    <>
      {always ? null : <span aria-hidden>·</span>}
      <span>
        <span className="text-ink">{n}</span> {n === 1 ? one : many}
      </span>
    </>
  );
}

/* ══ o que ela mais amou e o que mais detestou ════════════════════════════
   Duas fichas, dois pôsteres, e nenhuma média. É o módulo mais barato da
   página e um dos que mais dizem: extremos são o que qualquer pessoa conta
   primeiro quando explica o próprio gosto para outra.

   Lado a lado e do mesmo tamanho, de propósito. O de cima em destaque e o de
   baixo pequeno seria a página opinando sobre qual dos dois vale mais — e o
   filme que alguém odiou é tão informativo quanto o que amou. */
function Ends({ person }: { person: Reviewer }) {
  const club = useClub();
  const ends = endsOf(club.reviews, person.id);
  if (!ends) return null;

  return (
    <Region title="Os extremos">
      <div className="grid gap-3 sm:grid-cols-2">
        <EndCard review={ends.best} label="O que mais gostou" />
        <EndCard review={ends.worst} label="O que menos gostou" />
      </div>
    </Region>
  );
}

function EndCard({ review, label }: { review: Review; label: string }) {
  const club = useClub();
  return (
    <button
      type="button"
      onClick={() => club.goReview(review.id)}
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
function Crowd({ person, mine }: { person: Reviewer; mine: boolean }) {
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
          onClick={() => club.goReview(crowd.widest.id)}
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
function Ruler({ person }: { person: Reviewer }) {
  const club = useClub();
  const spread = spreadOf(club.reviews, person.id);
  if (!spread || spread.n < FLOOR.ends) return null;

  return (
    <Region
      title="A régua"
      note={
        <>
          de <span className="text-ink">{fmt(spread.low)}</span> a{' '}
          <span className="text-ink">{fmt(spread.high)}</span>
        </>
      }
    >
      <div className="plate px-4 py-4">
        <div className="flex items-end gap-[3px]" role="img" aria-label={rulerLabel(spread.bins)}>
          {spread.bins.map((n, i) => (
            <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              {/* Altura pela contagem, com um mínimo visível na faixa vazia: uma
                  coluna de altura zero some, e o buraco é justamente o dado —
                  é onde essa pessoa nunca pôs uma nota. */}
              <div
                className={cn(
                  'w-full rounded-[1px]',
                  n ? 'bg-beam/45' : 'bg-white/[0.06]'
                )}
                style={{ height: n ? `${12 + (n / spread.peak) * 56}px` : '4px' }}
              />
              {/* O número da faixa é lido — é ele que diz de que nota a coluna
                  fala —, então ele carrega a tinta do piso legível e não a das
                  perfurações. */}
              <span className="q text-[10px] leading-none text-ink-dim">{i}</span>
            </div>
          ))}
        </div>
      </div>
    </Region>
  );
}

function rulerLabel(bins: number[]) {
  const said = bins
    .map((n, i) => (n ? `${n} entre ${i} e ${i + 1}` : null))
    .filter(Boolean)
    .join(', ');
  return said ? `Distribuição das notas: ${said}.` : 'Nenhuma nota.';
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
    <Region title="Os gêneros">
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

/* ══ o que ela escreveu ═══════════════════════════════════════════════════
   Os textos, num lugar só. Duas origens que o produto sempre tratou como coisas
   diferentes e que, para quem lê uma pessoa, são a mesma: o que ela escreveu na
   própria ficha e o que ela escreveu na dos outros.

   As duas juntas em ordem de tempo, com a origem dita em uma linha acima do
   texto. Separá-las em duas listas obrigaria quem lê a alternar entre elas para
   remontar a cronologia que já existia. */
type Wrote =
  | { kind: 'take'; at: string; body: string; review: Review }
  | { kind: 'comment'; at: string; body: string; reviewId: string; commentId: string; title: string };

function Written({ person }: { person: Reviewer }) {
  const club = useClub();

  const items = useMemo<Wrote[]>(() => {
    const out: Wrote[] = [];
    for (const r of takesOf(club.reviews, person.id)) {
      if (r.comment?.trim()) out.push({ kind: 'take', at: r.date, body: r.comment, review: r });
    }
    const titles = new Map(club.reviews.map(r => [r.id, r.movieTitle]));
    for (const c of club.comments) {
      if (c.reviewerId !== person.id) continue;
      out.push({
        kind: 'comment',
        at: c.createdAt,
        body: c.body,
        reviewId: c.reviewId,
        commentId: c.id,
        title: titles.get(c.reviewId) ?? 'uma ficha',
      });
    }
    return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }, [club.reviews, club.comments, person.id]);

  const [all, setAll] = useState(false);
  if (!items.length) return null;
  /* Cinco e o resto atrás de um botão, como a conversa faz com três: uma pessoa
     que escreve muito não pode empurrar o resto do perfil para fora da tela. */
  const shown = all ? items : items.slice(0, 5);
  const hidden = items.length - shown.length;

  return (
    <Region title="O que escreveu" note={plural(items.length, 'texto', 'textos')}>
      <ul className="flex flex-col gap-4">
        {shown.map(w => (
          <li key={w.kind === 'take' ? `t:${w.review.id}` : `c:${w.commentId}`}>
            <button
              type="button"
              onClick={() =>
                w.kind === 'take' ? club.goReview(w.review.id) : club.goReview(w.reviewId, w.commentId)
              }
              className="group block w-full rounded-cell border-l border-white/[0.09] py-0.5 pl-3.5 text-left transition-colors hover:border-beam/40"
            >
              <span className="q flex flex-wrap items-center gap-x-2 text-[11px] text-ink-dim">
                <MessageSquare className="h-3 w-3 flex-none text-ink-faint" strokeWidth={1.9} aria-hidden />
                {w.kind === 'take' ? (
                  <>
                    na própria ficha de{' '}
                    <span className="text-ink transition-colors group-hover:text-beam">
                      {w.review.movieTitle}
                    </span>
                  </>
                ) : (
                  <>
                    numa conversa em{' '}
                    <span className="text-ink transition-colors group-hover:text-beam">{w.title}</span>
                  </>
                )}
                <span aria-hidden>·</span>
                <span title={w.at}>{whenOf(w.at)}</span>
              </span>
              <span className="mt-1 block whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-ink-dim">
                <WithMentions text={w.body} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hidden ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-4 font-display text-[11px] uppercase leading-none tracking-[0.12em] text-ink-dim transition-colors hover:text-beam"
        >
          Ver os outros {hidden}
        </button>
      ) : null}
    </Region>
  );
}

/* ══ o que ela pôs na fila ════════════════════════════════════════════════
   A fila é do clube, mas cada filme nela foi ideia de alguém — e o que uma
   pessoa quer ver é tão revelador quanto o que ela já viu. É a única coisa
   neste perfil que fala do futuro. */
function Queued({ person, mine }: { person: Reviewer; mine: boolean }) {
  const club = useClub();
  const items = club.watchlist.filter(w => w.addedBy === person.id);
  if (!items.length) return null;

  return (
    <Region
      title={mine ? 'O que você pôs na fila' : 'O que pôs na fila'}
      note={plural(items.length, 'filme', 'filmes')}
    >
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-3">
        {items.map(w => (
          <li key={w.id}>
            <button
              type="button"
              onClick={() => club.openSheet(w.id)}
              aria-label={`Abrir ${w.title}`}
              className="group block w-full text-left"
            >
              <Poster
                src={w.poster}
                className="aspect-[2/3] w-full transition-[box-shadow] group-hover:ring-white/25"
              />
              <span className="mt-1.5 block truncate text-[11.5px] text-ink-dim transition-colors group-hover:text-beam">
                {w.title}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Region>
  );
}

/* ══ tudo o que ela avaliou ═══════════════════════════════════════════════
   O arquivo dela, do mais recente para o mais antigo — a única lista da página
   em ordem de tempo, porque é a única que responde "o que andou vendo".

   Cada linha leva à ficha no acervo, onde estão os onze critérios e a conversa.
   Este perfil não redesenha nada disso: repetir a ficha aqui seria um segundo
   lugar onde a mesma coisa pode ficar diferente. */
function Takes({ person, mine }: { person: Reviewer; mine: boolean }) {
  const club = useClub();
  const takes = takesOf(club.reviews, person.id);
  const [all, setAll] = useState(false);

  if (!takes.length) {
    return (
      <Region title="As fichas">
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

  const shown = all ? takes : takes.slice(0, 12);
  const hidden = takes.length - shown.length;

  return (
    <Region title="As fichas" note={plural(takes.length, 'avaliação', 'avaliações')}>
      <ul className="flex flex-col">
        {shown.map(r => (
          <li key={r.id} className="border-t border-white/[0.06] first:border-t-0">
            <TakeLine review={r} />
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

function TakeLine({ review }: { review: Review }) {
  const club = useClub();
  /* A reação que a ficha juntou, contada do que o clube já carregou. Muda no
     zero, como em todo lugar: uma fileira de zeros embaixo de cada linha conta
     que ninguém falou nada, que é ruído com formato de dado. */
  const cast = club.votes.filter(v => v.reviewId === review.id);
  const up = cast.filter(v => v.value === 1).length;
  const down = cast.filter(v => v.value === -1).length;
  const talk = club.comments.filter(c => c.reviewId === review.id).length;

  return (
    <button
      type="button"
      onClick={() => club.goReview(review.id)}
      aria-label={`Abrir a avaliação de ${review.movieTitle}`}
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
        {talk || up || down ? (
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
      </span>
    </button>
  );
}

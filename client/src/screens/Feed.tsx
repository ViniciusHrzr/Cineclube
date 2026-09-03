import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, ChevronDown, MessageSquare, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Bill, Blank, Drawer, Fault, Poster, Skeleton, Strip } from '@/components/bits';
/* As mesmas peças que o acervo usa, e não uma cópia compacta delas: são as
   mesmas regras de voto e de conversa, e regras escritas duas vezes são regras
   que divergem na terceira. Ver a nota de abertura em components/social.tsx. */
import { Conversation, TakeVotes } from '@/components/social';
/* E o mesmo detalhamento, pelo mesmo motivo: são os onze critérios, com a mesma
   grade e as mesmas regras de leitura do acervo e do perfil. Ver a nota de
   abertura em components/take.tsx. */
import { Breakdown } from '@/components/take';
import { PersonName, PersonReel } from '@/components/person';
import { capi, fmt, type FeedEvent, type Review } from '@/lib/api';
import { useLive } from '@/lib/live';
import { cn, plural } from '@/lib/utils';
import { useClub } from '@/App';

/* ══════════════════════════════════════════════════════════════════════════
   O FEED

   Chamou-se Mural por um dia. O nome caiu por colidir: "wall" neste projeto já
   é a parede de celuloide que fica atrás de tudo, e o servidor sempre disse
   feed — `/api/feed`, routes/feed.js. Três nomes para duas coisas viravam dois
   nomes para duas coisas.

   O clube tinha três coisas que produzem sinal social — comentário, curtida,
   aviso — e nenhuma que o mostrasse junto. O sino é privado: se a Beren avaliou
   ontem à noite e o Leonardo discordou da montagem dela, os dois sabem e mais
   ninguém. Esta é a tela que faltava, e o princípio que ela serve já estava
   escrito: *o grupo é visível*.

   ── por que isto não é o feed de qualquer produto ───────────────────────
   Porque a linha da avaliação carrega os onze critérios. Um feed que dissesse
   "fulano avaliou Parasita — 8,5" seria intercambiável com qualquer app de
   filme; este diz onde a pessoa se entusiasmou e onde se decepcionou, na mesma
   linha, e é disso que sai conversa. A régua de células ao lado é a mesma que o
   arquivo usa, então uma nota é reconhecível como nota antes de ser lida.

   ── a densidade é o desenho ─────────────────────────────────────────────
   Dois tipos de acontecimento, e eles não pesam o mesmo. A avaliação é o
   assunto — pôster, nota, régua, os dois extremos, o que a pessoa escreveu. O
   comentário é a conversa em cima dela: uma linha, sem pôster, com o filme dito
   por escrito.

   Um feed em que tudo tem o mesmo tamanho é uma lista, e uma lista é lida do
   começo ao fim ou não é lida. Este é feito para ser varrido: o olho cai nas
   fichas e as linhas menores preenchem o entre.

   Eram quatro tipos. O voto em critério e o filme posto na fila saíram no dia
   seguinte — ver routes/feed.js: um voto acontece até onze vezes por ficha por
   pessoa, e uma noite de discussão enterrava a ficha embaixo das linhas sobre
   ela. O voto continua na tela como contagem na própria ficha, que é onde ele
   significa alguma coisa.

   ── e agora se responde daqui ───────────────────────────────────────────
   Por um tempo esta tela só CONTAVA a reação: três respostas, duas
   concordâncias, uma discordância, em ícones mudos no pé da placa. Reagir era
   outra viagem — abrir o acervo, achar o filme, abrir a carta, abrir a ficha,
   abrir a gaveta —, e no fim disso a conversa já era sobre outra coisa.

   Um feed que mostra o placar e não deixa mexer nele é um boletim. O clube
   avalia à noite, com esta aba aberta ao lado do Discord, e o instante em que
   se quer discordar da montagem de alguém é o instante em que a linha aparece.
   Então a placa ganhou uma barra de ação — concordo, discordo, e a conversa
   inteira numa gaveta —, e a contagem muda virou o controle que produz o
   número que ela mostrava.

   Os controles são os MESMOS do acervo, importados e não copiados: as regras
   são as mesmas (não se vota na própria ficha, o contador cala no zero, a
   resposta para em um nível) e a linha do feed é a mesma avaliação. Duas
   implementações da mesma regra é a regra divergindo na terceira.

   ── e a ficha abre aqui ─────────────────────────────────────────────────
   Faltava a metade que sobrou. Reagir já se fazia na linha, mas LER a avaliação
   inteira — os onze critérios, o texto sem corte — ainda mandava a pessoa para o
   acervo: a aba trocava por baixo dela, o feed se desmontava, e voltar era rolar
   de novo até onde se estava. Um feed que troca de tela para mostrar a coisa que
   ele está anunciando não é um feed, é um índice.

   Então a placa desdobra. O corpo dela deixou de navegar e virou o que a fileira
   do acervo sempre foi: uma gaveta com o detalhamento dentro. A linha de
   conversa faz o mesmo — ela abre a ficha em que se comentou, embaixo de si
   mesma, com o texto anunciado já aceso (ver `aimComment` no App).

   O acervo não some do caminho: uma seta discreta na barra de ação continua
   levando até lá, para quem quer a ficha entre as outras do mesmo filme. A
   diferença é que agora isso é uma escolha e não o pedágio.

   O detalhamento é importado de components/take.tsx pelo motivo de sempre — é a
   mesma grade que o acervo e o perfil desenham.
   ══════════════════════════════════════════════════════════════════════════ */

/* De dois minutos, e só com a aba à vista — a mesma regra do sino, pelo mesmo
   motivo: o clube deixa isto aberto ao lado do Discord por horas. Mais lento
   que o sino porque um aviso é sobre você e um feed é sobre todo mundo: chegar
   dois minutos atrasado a um feed não custa nada. */
const POLL_MS = 120_000;

/* ── o dia como cabeçalho ─────────────────────────────────────────────────
   Um feed sem quebra de dia é uma coluna de horas soltas, e "14:22" não diz
   nada sem saber de quando. Hoje e ontem por extenso porque é assim que se fala
   deles; o resto por data, com o ano só quando não é este — um clube com dois
   anos de arquivo precisa da diferença, e um com dois meses não. */
function dayOf(iso: string) {
  const at = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(at.getTime())) return '—';
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(new Date()) - midnight(at)) / 86400000);
  if (days <= 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  return at.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: at.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

/** Só a hora na linha: o dia já foi dito no cabeçalho acima dela. */
function clockOf(iso: string) {
  const at = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(at.getTime())) return '';
  // Uma ficha antiga só tem a data, sem hora — ver `recorded_at` em db.js. Aí
  // a hora seria meia-noite inventada, e é melhor não dizer nada.
  if (!/\d\d:\d\d/.test(iso)) return '';
  return at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function FeedScreen() {
  const [items, setItems] = useState<FeedEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const got = await capi<{ items: FeedEvent[] }>('/feed');
      setItems(got.items);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const tick = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  /* Um feed que chega dois minutos atrasado não custava nada quando o clube não
     tinha outro jeito de saber. Agora tem: a linha nasce na tela de todo mundo
     no instante em que alguém escreve, e esta é a tela em que isso mais se
     nota — é a única aberta enquanto se conversa no Discord. A volta do relógio
     acima continua sendo a rede de baixo, para quando a conexão ao vivo cair. */
  useLive(kinds => {
    if (kinds.has('social') || kinds.has('reviews')) void load();
  });

  if (error && !items) {
    return (
      <section>
        <Bill title="Feed" />
        <div className="max-w-[60ch]">
          <Fault detail={error}>Não foi possível carregar o feed.</Fault>
        </div>
      </section>
    );
  }

  if (!items) {
    return (
      <section>
        <Bill title="Feed" note="carregando…" />
        {/* No formato do que vai chegar, e não um spinner: a página não muda de
            forma quando o conteúdo pousa. */}
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
          Quando alguém avaliar um filme ou comentar uma ficha, aparece aqui — do mais recente para
          o mais antigo.
        </Blank>
      </section>
    );
  }

  /* Agrupado na renderização e não no estado: o dia de um acontecimento é uma
     função da hora dele, e guardar isso em paralelo seria um segundo lugar onde
     a mesma verdade pode ficar velha à meia-noite. */
  let lastDay = '';

  return (
    <section>
      <Bill
        title="Feed"
        note={`${plural(items.length, 'acontecimento', 'acontecimentos')} no clube`}
      />

      <div className="max-w-[760px]">
        {items.map(e => {
          const day = dayOf(e.at);
          const opensDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={e.id}>
              {opensDay ? (
                /* Grudado no que vem depois e afastado do que veio antes: um
                   cabeçalho a igual distância dos dois lados pertence a ambos e
                   a nenhum. */
                <p className="legend mb-3 mt-7 first:mt-0">{day}</p>
              ) : null}
              {/* As duas linhas abrem a mesma ficha, cada uma embaixo de si
                  mesma: o comentário é sobre ela. Onde ir buscá-la é assunto de
                  cada uma — as duas leem do acervo que o clube já tem em memória
                  desde o boot, e nenhuma delas troca de tela para isso. */}
              {e.kind === 'review' ? <Rated e={e} /> : <Aside e={e} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ── a ficha, que é o assunto ─────────────────────────────────────────────
   A única linha do feed que ganha uma placa, e ela ganha porque é a única que
   tem conteúdo próprio: uma nota, uma régua, dois critérios e, quando existe,
   o que a pessoa escreveu. As outras são sobre esta.

   ── a placa deixou de ser um botão só ───────────────────────────────────
   Ela era um botão inteiro, e a nota que justificava isso dizia "nada dentro é
   clicável, então não há controle dentro de controle". Isso continua verdade —
   um `<button>` dentro de outro não é uma coisa que o navegador monte —, mas a
   premissa mudou: agora há o que apertar dentro da placa, e por isso ela virou
   quatro coisas empilhadas.

   Em cima, o corpo, que continua sendo um botão largo: a alternativa é um título
   clicável dentro de um cartão inerte, que faz a pessoa mirar em quatro palavras
   quando a placa toda quer dizer o mesmo. O que ele faz é que mudou — ele
   DESDOBRA em vez de navegar. Levava ao acervo, e o preço disso era a tela
   inteira: a aba trocava, o feed se desmontava, e quem tinha rolado quarenta
   acontecimentos para chegar ali voltava para o topo.

   Logo abaixo, o detalhamento, na gaveta que o corpo abre. É a mesma peça do
   acervo e do perfil, e ela pousa entre o corpo e a barra de ação porque é isso
   que ela é: mais da ficha, e não mais uma ação sobre ela.

   Depois, uma barra com os controles, separada por uma régua. A régua não é
   decoração: é o que diz que dali para baixo o clique faz outra coisa que não
   abrir — sem ela, dois polegares soltos dentro de uma superfície clicável
   pareceriam parte dela.

   E, quando pedida, a conversa, numa gaveta que empurra o resto do feed para
   baixo em vez de abrir por cima dele. Um painel sobreposto tiraria da tela
   exatamente o contexto que faz alguém querer responder.

   Duas gavetas na mesma placa e não uma só, porque são duas perguntas: "o que
   ela achou de cada coisa" e "o que o clube disse disso". Juntá-las obrigaria
   quem quer responder a passar por onze números, e quem quer os onze números a
   carregar a conversa inteira embaixo deles. */
function Rated({ e }: { e: FeedEvent }) {
  const club = useClub();
  /* A avaliação inteira, e não só o que a linha do feed carrega: os controles
     precisam de quem assinou a ficha para saber se é a sua, e o clube tem o
     acervo em memória desde o boot — nada é buscado para isto.

     Nula só no intervalo entre alguém apagar uma avaliação e o feed ser buscado
     de novo. Aí a placa continua legível e a barra some: oferecer um polegar
     para uma ficha que não existe mais é prometer um 404. */
  const review = club.reviews.find(r => r.id === e.reviewId) ?? null;
  const talk = club.comments.filter(c => c.reviewId === e.reviewId).length;
  const clock = clockOf(e.at);

  /* Fechada ao chegar, e é o padrão certo: oitenta conversas abertas não é um
     feed, é um arquivo. */
  const [talking, setTalking] = useState(false);
  /* Aberta uma vez, montada para sempre — enquanto a placa viver. Desmontar ao
     fechar faria a gaveta recolher de altura zero para altura zero, um sumiço
     seco no lugar da animação; e montar as oitenta de saída gastaria uma tela
     inteira de trabalho para o que ninguém pediu ainda. */
  const [touched, setTouched] = useState(false);
  /* O mesmo par para o detalhamento, pelos mesmos dois motivos. */
  const [open, setOpen] = useState(false);
  const [unfolded, setUnfolded] = useState(false);

  /* ── o texto sem corte, e só quando ele foi cortado ────────────────────
     A placa já mostra o que a pessoa escreveu, em até 120 caracteres (ver
     `excerpt` em routes/feed.js). Repetir isso dentro da gaveta seria a mesma
     frase duas vezes na mesma placa; escondê-lo quando o corte existe seria o
     feed anunciar um texto e não ter onde entregá-lo inteiro. Então o
     detalhamento recebe o comentário exatamente quando o resumo não é ele. */
  const written = review?.comment?.replace(/\s+/g, ' ').trim() ?? '';
  const clipped = !!written && written !== (e.excerpt ?? '');

  return (
    <div className="plate mb-3">
      {/* ── quem avaliou, fora do botão ─────────────────────────────────
          Esta linha morava dentro do botão que abre a ficha, e o rosto dentro
          dela era pixel morto — um `<button>` dentro de outro não é uma coisa
          que o navegador monte, então o nome não tinha como levar a lugar
          nenhum. Puxada para fora, ela vira o que sempre deveria ter sido: a
          assinatura da placa, com uma porta para quem assinou.

          O `px-4 pt-4` daqui e o `pt-2.5` do botão abaixo somam o mesmo respiro
          que o `p-4` de antes dava: a placa não mudou de forma, só de esqueleto.

          O `hover` do botão para no botão, e isso é deliberado: a assinatura
          continua sendo assinatura quando o resto da placa acende, porque ela
          responde a outra coisa. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-4">
        <PersonReel person={e.actor} size="sm" />
        <PersonName
          person={e.actor}
          className="font-display text-[13px] uppercase tracking-[0.1em] text-ink"
        />
        <span className="text-[12.5px] text-ink-dim">avaliou</span>
        {clock ? <span className="q ml-auto text-[10.5px] text-ink-faint">{clock}</span> : null}
      </div>

      {/* ── o corpo desdobra a ficha ────────────────────────────────────
          `aria-expanded` e não um rótulo de navegação: o que este botão faz
          agora é abrir uma gaveta logo abaixo dele, e anunciá-lo como uma porta
          seria prometer uma tela que não vai vir.

          Sem a ficha em memória ele cai na folha do filme, que é uma sobreposta
          e também não tira ninguém do feed. É a janela entre alguém apagar uma
          avaliação e o feed ser buscado de novo — a linha continua legível e o
          clique continua fazendo a coisa mais próxima do que prometia. */}
      <button
        type="button"
        onClick={() => {
          if (!review) {
            club.openSheet(e.movieId);
            return;
          }
          setOpen(v => !v);
          setUnfolded(true);
        }}
        aria-expanded={review ? open : undefined}
        aria-label={
          review
            ? `${open ? 'Fechar' : 'Abrir'} a avaliação de ${e.movieTitle} por ${e.actor.name}`
            : `Abrir a ficha de ${e.movieTitle}`
        }
        className="group flex w-full gap-4 px-4 pb-4 pt-2.5 text-left transition-colors duration-150 hover:bg-house-seat"
      >
        <Poster src={e.moviePoster} className="aspect-[2/3] w-[54px] flex-none sm:w-[62px]" />

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-display text-[22px] leading-none tracking-[0.02em] text-beam transition-colors group-hover:text-beam-hot">
              {e.movieTitle}
            </span>
            <span className="q text-[11.5px] text-ink-dim">{e.genre}</span>
          </span>

          {/* A nota como número e como comprimento, do mesmo jeito que o arquivo
              a mostra: a régua é o que deixa duas fichas comparáveis com o olho,
              sem ler os dois números. */}
          <span className="mt-2.5 flex items-center gap-3">
            <Strip value={e.final ?? 0} cells={10} className="h-[6px] w-[120px] flex-none" />
            <span className="q text-[15px] font-medium text-beam">{fmt(e.final ?? 0)}</span>
            <span className="q text-[11px] text-ink-faint">/10</span>
          </span>

          {/* ── onde ela se entusiasmou e onde se decepcionou ───────────────
              O que só este produto sabe dizer. Ausente quando a ficha não tem
              distância entre o alto e o baixo — ver `endsOf` no servidor: onze
              notas iguais não têm extremos, e apontá-los seria inventar uma
              opinião que ninguém teve. */}
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

        {/* A seta é o que diz que a placa desdobra em vez de levar embora, e ela
            só aparece quando há o que desdobrar. Muda de altura junto com o
            título, e não com o bloco inteiro: é dele que ela é a promessa. */}
        {review ? (
          <ChevronDown
            aria-hidden
            className={cn(
              'mt-1 h-4 w-4 flex-none text-ink-faint transition-transform duration-200 group-hover:text-ink-dim',
              open && 'rotate-180'
            )}
            strokeWidth={1.7}
          />
        ) : null}
      </button>

      {/* ── os onze critérios, no lugar ──────────────────────────────────
          A gaveta que substituiu a viagem. Ela vem antes da barra de ação
          porque é mais da ficha e não mais uma ação: quem abriu quer ler, e o
          par de polegares continua onde estava, embaixo do que agora se pode
          ler inteiro. */}
      <Drawer open={open}>
        {unfolded && review ? (
          <div className="px-4 pb-4">
            <Breakdown r={review} comment={clipped ? review.comment : undefined} />
          </div>
        ) : null}
      </Drawer>

      {/* ── a barra de ação ──────────────────────────────────────────────
          Onde ficava a fileira de contadores mudos. Os números não sumiram:
          eles moram dentro dos próprios controles agora, que é o desenho
          inteiro desta mudança — o polegar que diz "duas pessoas concordaram"
          é o mesmo que se aperta para ser a terceira.

          Some junto com a ficha, e não fica vazia: uma régua com nada embaixo
          seria a placa anunciando um rodapé que não existe. */}
      {review ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-4 py-2.5">
          <TakeVotes review={review} labelled />

          {/* Abre a conversa AQUI, e não leva para o acervo. A viagem — abrir a
              aba, achar o filme, abrir a carta, abrir a ficha, abrir a gaveta —
              é longa o bastante para que, ao chegar, já se esteja falando de
              outro filme. O corpo da placa abre os onze critérios, que é a
              outra pergunta; isto é para quem quer só responder. */}
          <button
            type="button"
            aria-expanded={talking}
            aria-label={
              `${talking ? 'Fechar' : 'Abrir'} a conversa da avaliação de ${e.actor.name}` +
              (talk ? `, ${plural(talk, 'resposta', 'respostas')}` : '')
            }
            title={talking ? 'Fechar a conversa' : 'Comentar esta avaliação'}
            onClick={() => {
              setTalking(v => !v);
              setTouched(true);
            }}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-cell px-2.5 ring-1 transition-colors duration-150',
              talking
                ? 'text-dye-brass ring-dye-brass/60 shadow-[inset_0_0_14px_rgba(217,164,65,0.18)]'
                : 'text-ink-dim ring-house-rail hover:text-beam hover:ring-white/25'
            )}
          >
            <MessageSquare className="h-3.5 w-3.5 flex-none" strokeWidth={1.9} aria-hidden />
            {/* A palavra cai antes do número em tela estreita, como no par de
                polegares: sem rótulo sobra um balão, que se entende; sem número
                sobra um placar que mente por omissão. */}
            <span className="hidden font-display text-[11px] uppercase leading-none tracking-[0.12em] sm:inline">
              {talking ? 'Fechar' : 'Comentar'}
            </span>
            {talk ? <span className="q text-[10.5px] leading-none opacity-80">{talk}</span> : null}
          </button>

          {/* ── o acervo, para quem quiser ───────────────────────────────
              A viagem que deixou de ser obrigatória, guardada como escolha e
              empurrada para o fim da barra. Lá a ficha aparece entre as outras
              do mesmo filme, que é a única coisa que o feed não sabe mostrar —
              e é o endereço que se copia para o Discord.

              Sem rótulo escrito: a barra já tem três palavras em versalete, e
              uma quarta faria a linha quebrar antes do tablet. */}
          <button
            type="button"
            onClick={() => club.goReview(review.id)}
            title="Abrir no acervo, junto das outras avaliações deste filme"
            aria-label={`Abrir no acervo a avaliação de ${e.movieTitle} por ${e.actor.name}`}
            className="ml-auto flex h-7 items-center rounded-cell px-1.5 text-ink-faint transition-colors duration-150 hover:text-beam"
          >
            <ArrowUpRight className="h-4 w-4 flex-none" strokeWidth={1.8} aria-hidden />
          </button>
        </div>
      ) : null}

      <Drawer open={talking}>
        {touched && review ? (
          /* Sem a régua e sem o título "Conversa": aqui a gaveta não contém
             mais nada além dela, e nomear a única coisa dentro de uma caixa é
             falar duas vezes. No acervo ela abre embaixo do detalhamento, e lá
             a régua é o que separa os onze números do que se disse deles. */
          <div className="px-4 pb-4">
            <Conversation review={review} ruled={false} />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

/* ── a conversa em cima da ficha ──────────────────────────────────────────
   Uma linha, sem placa e sem pôster. É acontecimento real e não merece sumir,
   mas dar a ela a mesma superfície da ficha faria o feed inteiro pesar igual —
   e um feed que pesa igual é uma lista.

   O ícone à esquerda é a coluna que deixa o feed ser varrido: uma forma fixa
   numa posição fixa, e o olho aprende a pular ou a parar sem ler.

   ── ela também abre a ficha, embaixo de si ──────────────────────────────
   Uma linha que anuncia um texto tem de conseguir mostrá-lo. Ela mandava para o
   acervo com o comentário no endereço, e isso funcionava — só que ao preço da
   tela inteira: o feed se desmontava, e voltar era rolar de novo até aqui.

   Agora ela desdobra a avaliação em que se comentou — a ficha, os onze
   critérios e a conversa —, e o texto anunciado chega aceso: `aimComment` diz
   qual é, a conversa cresce até ele, rola e o acende, exatamente como o link do
   sino já fazia (ver `focusComment` em components/social.tsx). O que se perde é
   a viagem; o que se ganha é o lugar. */
function Aside({ e }: { e: FeedEvent }) {
  const club = useClub();
  const clock = clockOf(e.at);
  /* A ficha comentada, do acervo que o clube tem em memória desde o boot. Nula
     se ela foi apagada entre a busca do feed e a do acervo — aí a linha ainda
     abre alguma coisa, a folha do filme, que também não tira ninguém daqui. */
  const review = club.reviews.find(r => r.id === e.reviewId) ?? null;
  const [open, setOpen] = useState(false);
  /* Montada só depois de pedida, e nunca desmontada depois disso — o mesmo par
     das gavetas da placa, pelos mesmos dois motivos. */
  const [unfolded, setUnfolded] = useState(false);
  const { aimComment } = club;

  function press() {
    if (!review) {
      club.openSheet(e.movieId);
      return;
    }
    const next = !open;
    setOpen(next);
    setUnfolded(true);
    /* Só ao ABRIR: reapontar o alvo ao fechar faria a conversa rolar atrás de um
       texto que acabou de sair da tela. */
    if (next && e.commentId) aimComment(e.commentId);
  }

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={press}
        aria-expanded={review ? open : undefined}
        className="group flex w-full items-start gap-3 rounded-cell px-3 py-2.5 text-left transition-colors duration-150 hover:bg-beam/[0.05]"
      >
        <MessageSquare
          className="mt-[3px] h-3.5 w-3.5 flex-none text-ink-faint"
          strokeWidth={1.9}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          {/* A frase é montada aqui, e não no servidor como no sino. Lá ela é
              sobre você, na segunda pessoa; aqui é sobre duas outras pessoas, o
              nome de quem agiu já está desenhado ao lado, e o que sobra é curto
              demais para valer uma viagem pela rede. */}
          <span className="block text-[12.5px] leading-snug text-ink-dim">
            <span className="font-display uppercase tracking-[0.08em] text-ink">{e.actor.name}</span>{' '}
            {/* Responder é outro gesto que comentar, e a linha diz qual foi: um
                texto pendurado em outro texto anunciado como "comentou a ficha"
                faz quem chega procurar, na conversa, um comentário de primeiro
                nível que não existe. */}
            {e.parentId ? 'respondeu um comentário na ficha de ' : 'comentou a ficha de '}
            <Who name={e.owner?.name} me={e.owner?.id === club.me.id} /> em{' '}
            <span className="text-ink transition-colors group-hover:text-beam">{e.movieTitle}</span>
          </span>
          {e.excerpt ? (
            <span className="mt-0.5 block break-words text-[12px] italic leading-snug text-ink-faint">
              “{e.excerpt}”
            </span>
          ) : null}
        </span>
        {clock ? (
          <span className="q mt-0.5 flex-none text-[10.5px] text-ink-faint">{clock}</span>
        ) : null}
        {review ? (
          <ChevronDown
            aria-hidden
            className={cn(
              'mt-[1px] h-3.5 w-3.5 flex-none text-ink-faint transition-transform duration-200',
              open && 'rotate-180'
            )}
            strokeWidth={1.7}
          />
        ) : null}
      </button>

      {/* Recuada até a coluna do texto e sobre uma superfície própria: a linha
          não tem placa, e a ficha que ela abre tem — sem uma caixa em volta, o
          detalhamento e a conversa flutuariam soltos entre duas linhas do feed
          sem dizer de qual das duas são. */}
      <Drawer open={open}>
        {unfolded && review ? (
          <div className="ml-6 mr-1 mb-2 mt-1 rounded-cell bg-house-seat/55 p-3 ring-1 ring-inset ring-white/[0.06]">
            <TakeHead review={review} />
            <div className="mt-3">
              <Breakdown r={review} comment={review.comment} />
            </div>
            <Conversation review={review} />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

/* ── de quem é a ficha que acabou de abrir ────────────────────────────────
   Só a linha de conversa precisa disto. A placa já diz filme, rosto, nome e
   nota antes de desdobrar; aqui a linha diz "fulano comentou a ficha de sicrana
   em Parasita" e mais nada — abrir o detalhamento embaixo dela sem o cabeçalho
   seria entregar onze números sem dizer de quem são nem qual a nota final.

   O par de polegares vem junto porque, uma vez lida, a ficha se responde: era o
   argumento inteiro da barra de ação da placa, e ele não muda de valor por a
   ficha ter sido alcançada por outra porta. */
function TakeHead({ review }: { review: Review }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Poster src={review.moviePoster} className="aspect-[2/3] w-[40px] flex-none" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[17px] leading-none tracking-[0.02em] text-beam">
          {review.movieTitle}
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-dim">
          <PersonReel
            person={{ id: review.reviewerId, name: review.reviewerName, dot: review.reviewerDot }}
            size="sm"
          />
          <PersonName
            person={{ id: review.reviewerId, name: review.reviewerName, dot: review.reviewerDot }}
            className="font-display text-[12.5px] uppercase tracking-[0.1em] text-ink"
          />
        </p>
      </div>
      <span className="flex flex-none items-center gap-2.5">
        <Strip value={review.final} cells={10} className="hidden h-[6px] w-[90px] flex-none sm:block" />
        <span className="q font-display text-[20px] leading-none text-beam">{fmt(review.final)}</span>
      </span>
      <TakeVotes review={review} />
    </div>
  );
}

/* "a ficha de Beren" e "a sua ficha". A segunda pessoa é o que faz o feed
   parar de ser um boletim sobre estranhos: quando o acontecimento é sobre você,
   ele diz isso. */
function Who({ name, me }: { name?: string; me?: boolean }) {
  if (me) return <span className="text-dye-brass">você</span>;
  return <span className="text-ink">{name ?? 'alguém'}</span>;
}


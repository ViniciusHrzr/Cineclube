import { useEffect, useRef, useState } from 'react';
import { ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { Key, Reel } from '@/components/bits';
import { MentionField, WithMentions } from '@/components/mention';
import { initialsOf, reelColor, type Review, type ReviewComment } from '@/lib/api';
import { cn, plural, whenOf } from '@/lib/utils';
import { useClub } from '@/App';

/* ══════════════════════════════════════════════════════════════════════════
   A REAÇÃO A UMA FICHA

   Concordar, discordar, escrever embaixo, curtir o que alguém escreveu. Isto
   morava inteiro dentro da tela de avaliados, porque por um tempo o acervo era
   o único lugar onde uma ficha aparecia por inteiro.

   Deixou de ser: o feed é a porta de entrada do clube e é lá que a ficha é
   lida pela primeira vez — no minuto em que ela acontece, com todo mundo
   olhando. Uma conversa que só existe a dois cliques de distância, numa aba
   que se abre para procurar um filme antigo, é uma conversa que não acontece.

   Uma cópia compacta destes controles no feed teria sido o caminho curto e o
   errado: são as MESMAS regras — não votar na própria ficha, contador mudo no
   zero, latão para o que é seu, profundidade um na resposta —, e regras
   escritas duas vezes são regras que divergem na terceira. Então elas mudaram
   de casa em vez de se multiplicar, e as duas telas leem daqui.
   ══════════════════════════════════════════════════════════════════════════ */

/** O mesmo teto que routes/social.js aplica. Espelhado, nunca decidido aqui. */
export const MAX_COMMENT = 1000;

/* ── concordar com a ficha de alguém ──────────────────────────────────────
   O voto era por critério, e o argumento era bom no papel: concordar com uma
   pessoa inteira é raro, concordar com o 9 dela em fotografia e achar o 4 em
   roteiro absurdo é o que acontece de verdade.

   Na tela, virou outra coisa. Onze polegares por ficha por pessoa não é uma
   opinião, é um formulário — e o detalhamento, que existe para se ler onze
   números de uma vez, passou a ter uma coluna de controles ao lado de cada um
   deles, larga o bastante para expulsar a segunda coluna da grade em telas
   pequenas. O que o clube diz de verdade é sobre o take: "boa avaliação",
   "achei alto demais". É um voto.

   Mudo, e na fileira. O par teve rótulos escritos enquanto morava dentro da
   gaveta, onde havia largura sobrando; agora ele fica na linha da ficha, ao lado
   da nota, que é onde a pessoa está olhando quando forma a opinião — e ali a
   linha já carrega pôster, título, ficha técnica, nota e o TMDB. Duas palavras
   em versalete a mais empurrariam o título para fora antes do tablet.

   O polegar sozinho não é um enigma: para cima e para baixo é a convenção mais
   estabelecida que existe numa tela, o `title` diz a palavra a quem parar em
   cima, e o `aria-label` diz a frase inteira a quem lê por áudio.

   O resto das regras não mudou:

   · Sem verde e sem vermelho. O que separa concordar de discordar é a palavra e
     a direção do ícone; o que marca o SEU voto é latão, a cor de estado deste
     sistema. Um placar que fica verde quando é positivo estaria pintando um
     limiar, que é a outra coisa que este mundo não faz.
   · Contador só quando existe. Um zero em cada lado de cada ficha é ruído com
     formato de dado.
   · Na própria ficha os botões somem e só o placar fica. Não é regra moral, é
     aritmética: um placar em que o autor pode se somar não mede mais
     concordância do clube. O servidor recusa de qualquer jeito; o que a tela
     faz é não oferecer o que vai ser negado. */
export function TakeVotes({
  review,
  className,
  /* No feed o par ganha o rótulo escrito que o acervo não tem espaço para dar.
     Lá a fileira já carrega pôster, título, ficha técnica, nota e o TMDB numa
     linha só; aqui a barra de ação existe SÓ para os controles, e a placa é
     larga. E é a diferença que importa: no acervo a pessoa abriu a ficha
     procurando o que achar dela, e no feed ela está passando o olho — a palavra
     é o que faz o polegar ser notado por quem não veio procurá-lo. */
  labelled = false,
}: {
  review: Review;
  className?: string;
  labelled?: boolean;
}) {
  const club = useClub();
  const [busy, setBusy] = useState(false);

  const cast = club.votes.filter(v => v.reviewId === review.id);
  const up = cast.filter(v => v.value === 1).length;
  const down = cast.filter(v => v.value === -1).length;
  const mine = cast.find(v => v.reviewerId === club.me.id)?.value ?? 0;
  const own = review.reviewerId === club.me.id;

  async function press(value: 1 | -1) {
    if (busy) return;
    setBusy(true);
    try {
      // Pressing the vote you already cast takes it back — the same key does
      // both, which is the only way a toggle can be undone without a second one.
      await club.voteOn(review.id, mine === value ? 0 : value);
    } catch (e) {
      club.fault('Não foi possível registrar o voto: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /* Na própria ficha: o placar, sem os controles. Silencioso enquanto ninguém
     reagiu — e presente no instante em que alguém reage, porque o autor tem de
     ficar sabendo. */
  if (own) {
    if (!up && !down) return null;
    return (
      <div className={cn('flex flex-none items-center gap-2.5 text-ink-faint', className)}>
        {up ? (
          <span
            className="flex items-center gap-1"
            title={up === 1 ? '1 concorda' : `${up} concordam`}
          >
            <ThumbsUp className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
            <span className="q text-[11px] leading-none text-ink-dim">{up}</span>
          </span>
        ) : null}
        {down ? (
          <span
            className="flex items-center gap-1"
            title={down === 1 ? '1 discorda' : `${down} discordam`}
          >
            <ThumbsDown className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
            <span className="q text-[11px] leading-none text-ink-dim">{down}</span>
          </span>
        ) : null}
      </div>
    );
  }

  const key = (side: 1 | -1, n: number) => {
    const on = mine === side;
    const Icon = side === 1 ? ThumbsUp : ThumbsDown;
    const word = side === 1 ? 'Concordo' : 'Discordo';
    return (
      <button
        type="button"
        disabled={busy}
        aria-pressed={on}
        aria-label={
          `${on ? 'Tirar seu voto: ' : ''}${word} com a avaliação de ${review.reviewerName}` +
          (n ? `, ${n} até agora` : '')
        }
        title={on ? `${word} — clique para tirar seu voto` : word}
        onClick={() => void press(side)}
        /* Altura de 28px e um mínimo de largura mesmo sem contador: sem o
           rótulo o botão encolheria para o tamanho do ícone, e um alvo de
           14px não é um alvo de dedo. */
        className={cn(
          'flex h-7 min-w-[30px] items-center justify-center gap-1 rounded-cell px-1.5 ring-1 transition-colors duration-150',
          'disabled:opacity-40',
          labelled && 'px-2.5',
          on
            ? 'text-dye-brass ring-dye-brass/60 shadow-[inset_0_0_14px_rgba(217,164,65,0.18)]'
            : 'text-ink-dim ring-house-rail hover:text-beam hover:ring-white/25'
        )}
      >
        <Icon className="h-3.5 w-3.5 flex-none" strokeWidth={1.9} aria-hidden />
        {/* A palavra some antes do contador em telas estreitas: perder o rótulo
            deixa um polegar, que ainda se entende; perder o número deixa um
            placar que mente por omissão. */}
        {labelled ? (
          <span className="hidden font-display text-[11px] uppercase leading-none tracking-[0.12em] sm:inline">
            {word}
          </span>
        ) : null}
        {n ? <span className="q text-[10.5px] leading-none opacity-80">{n}</span> : null}
      </button>
    );
  };

  return (
    <div className={cn('flex flex-none items-center gap-1.5', className)}>
      {key(1, up)}
      {key(-1, down)}
    </div>
  );
}

/* ── curtir o que alguém escreveu ─────────────────────────────────────────
   Um botão só, e não o par de polegares que a nota tem. Lá o par existe porque
   se concorda ou se discorda de um número; aqui o contrário de curtir não é a
   mesma informação com o sinal trocado — é outra coisa, e num clube de seis
   amigos que se falam por voz ela custa mais do que informa.

   Segue as mesmas regras do voto na ficha, porque é o mesmo tipo de gesto:
   latão quando é seu, contador só quando existe, e no que você mesmo escreveu
   sobra o placar sem o botão. */
export function CommentLikes({ comment }: { comment: ReviewComment }) {
  const club = useClub();
  const [busy, setBusy] = useState(false);

  const likes = club.commentLikes.filter(l => l.commentId === comment.id);
  const mine = likes.some(l => l.reviewerId === club.me.id);
  const own = comment.reviewerId === club.me.id;

  async function press() {
    if (busy) return;
    setBusy(true);
    try {
      await club.likeComment(comment.id, !mine);
    } catch (e) {
      club.fault('Não foi possível curtir: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (own) {
    if (!likes.length) return null;
    return (
      <span
        className="flex items-center gap-1 text-ink-faint"
        title={`${likes.length} ${likes.length === 1 ? 'curtida' : 'curtidas'}`}
      >
        <ThumbsUp className="h-3 w-3" strokeWidth={1.9} aria-hidden />
        <span className="q text-[10.5px] leading-none text-ink-dim">{likes.length}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      aria-pressed={mine}
      aria-label={`${mine ? 'Descurtir' : 'Curtir'} o comentário de ${comment.reviewerName}${
        likes.length ? `, ${likes.length} até agora` : ''
      }`}
      onClick={() => void press()}
      className={cn(
        'flex h-6 min-w-[24px] items-center justify-center gap-1 rounded-cell transition-colors duration-150',
        'disabled:opacity-40',
        mine ? 'text-dye-brass' : 'text-ink-faint hover:text-beam'
      )}
    >
      <ThumbsUp className="h-3 w-3 flex-none" strokeWidth={1.9} aria-hidden />
      {likes.length ? (
        <span className="q text-[10.5px] leading-none text-ink-dim">{likes.length}</span>
      ) : null}
    </button>
  );
}

/** Quantos comentários a conversa mostra antes de pedir licença. */
const FIRST_PAGE = 3;

/* ── um comentário e o que veio dele ──────────────────────────────────────
   O comentário, as respostas dele e o campo para responder — tudo dentro de uma
   unidade, porque é assim que se lê: ninguém lê "a terceira resposta da segunda
   conversa", lê-se um argumento e o que disseram sobre ele.

   As respostas ficam recolhidas atrás de "ver N respostas", como no Instagram e
   no Facebook, e pela razão que fez os dois chegarem lá: uma discussão longa
   dentro de um fio empurra os OUTROS fios para fora da tela, e quem abriu a
   gaveta queria ver a conversa inteira, não uma dela.

   A exceção é chegar por link: aí não se está folheando, se está indo buscar um
   texto específico — ver `arrived`. */
function Comment({
  c,
  replies,
  review,
  lit,
  arrived,
  onRemove,
}: {
  c: ReviewComment;
  replies: ReviewComment[];
  review: Review;
  /** O texto que um aviso apontou, aceso por alguns segundos. */
  lit: string | null;
  /* O mesmo texto, no valor que NÃO apaga. É ele que abre as respostas, e a
     separação é a mesma que a ficha já fazia: um brilho tem de acabar, uma
     gaveta aberta não. Ligar a abertura ao brilho fecharia tudo sozinho dois
     segundos e meio depois de chegar. */
  arrived: string | null;
  onRemove: (id: string) => void;
}) {
  const club = useClub();
  /* ── recolhidas ao folhear, abertas ao chegar por link ──────────────────
     Recolhido é o padrão certo para quem está lendo o acervo: as respostas de
     um fio pertencem a ele, não à varredura, e abri-las todas empurra os outros
     comentários para fora da tela.

     Mas quem clica em "respondeu você" no sino não está folheando — está indo
     buscar uma resposta específica, e chegar num botão que a esconde é o aviso
     não ter terminado de avisar. Então o link abre, e só o link. */
  const [open, setOpen] = useState(false);
  const [writing, setWriting] = useState(false);

  /* Uma vez, quando o alvo é este comentário ou uma resposta dele. Depois disso
     a gaveta é de quem está lendo, inclusive para fechar. */
  const targeted = !!arrived && (arrived === c.id || replies.some(r => r.id === arrived));
  useEffect(() => {
    if (targeted) setOpen(true);
  }, [targeted]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const mine = c.reviewerId === club.me.id;

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await club.comment(review.id, body, c.id);
      setDraft('');
      setWriting(false);
      // Responder é querer ver: a resposta recém-escrita não pode nascer
      // escondida atrás do botão que a esconderia.
      setOpen(true);
    } catch (e) {
      club.fault('Não foi possível responder: ' + (e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <li
      id={`comment-${c.id}`}
      /* `scroll-mt-24` pela marquise fixa, igual às fichas. O acender é a mesma
         folha de facho por trás, e some sozinho. */
      className={cn(
        'flex scroll-mt-24 gap-2.5 rounded-cell transition-colors duration-700',
        lit === c.id && 'bg-beam/[0.07]'
      )}
    >
      <Reel color={reelColor(c.reviewerDot, c.reviewerId)} src={club.avatarOf(c.reviewerId)} size="sm">
        {initialsOf(c.reviewerName)}
      </Reel>
      <div className="min-w-0 flex-1">
        {/* A curtida fica na linha do nome e da hora, empurrada para o fim: é
            sobre o comentário inteiro, e uma linha de ação própria embaixo de
            cada um somaria uma altura por comentário numa gaveta que já é a
            mais alta da tela. */}
        <p className="flex flex-wrap items-center gap-x-2">
          <span className="font-display text-[13px] uppercase tracking-[0.1em] text-ink">
            {c.reviewerName}
          </span>
          <span className="q text-[10.5px] text-ink-dim" title={c.createdAt}>
            {whenOf(c.createdAt)}
          </span>
          <span className="ml-auto flex items-center gap-2 pl-2">
            <CommentLikes comment={c} />
            {mine || club.me.isAdmin ? (
              <button
                type="button"
                onClick={() => onRemove(c.id)}
                aria-label={mine ? 'Apagar seu comentário' : `Apagar o comentário de ${c.reviewerName}`}
                className="rounded-cell p-1 text-ink-faint transition-colors hover:text-dye-red-lit"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            ) : null}
          </span>
        </p>
        {/* `break-words` porque um link colado sem espaço é uma palavra de
            duzentos caracteres, e ela empurraria a gaveta para fora da carta. */}
        <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-dim">
          <WithMentions text={c.body} />
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setWriting(v => !v);
              setOpen(true);
            }}
            className="font-display text-[11px] uppercase leading-none tracking-[0.12em] text-ink-faint transition-colors hover:text-beam"
          >
            Responder
          </button>
          {replies.length ? (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen(v => !v)}
              className="q text-[11px] leading-none text-ink-dim transition-colors hover:text-beam"
            >
              {open ? 'ocultar respostas' : `ver ${plural(replies.length, 'resposta', 'respostas')}`}
            </button>
          ) : null}
        </div>

        {open && (replies.length || writing) ? (
          /* Uma régua à esquerda em vez de recuo puro: a coluna já é estreita,
             e uma segunda margem tiraria dez caracteres de cada linha. A linha
             diz "isto pende daquilo" sem gastar largura. */
          <ul className="mt-2.5 flex flex-col gap-2.5 border-l border-white/[0.07] pl-3">
            {replies.map(r => {
              const own = r.reviewerId === club.me.id;
              return (
                <li
                  key={r.id}
                  id={`comment-${r.id}`}
                  className={cn(
                    'flex scroll-mt-24 gap-2 rounded-cell transition-colors duration-700',
                    lit === r.id && 'bg-beam/[0.07]'
                  )}
                >
                  <Reel color={reelColor(r.reviewerDot, r.reviewerId)} src={club.avatarOf(r.reviewerId)} size="sm">
                    {initialsOf(r.reviewerName)}
                  </Reel>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2">
                      <span className="font-display text-[12px] uppercase tracking-[0.1em] text-ink">
                        {r.reviewerName}
                      </span>
                      <span className="q text-[10px] text-ink-dim" title={r.createdAt}>
                        {whenOf(r.createdAt)}
                      </span>
                      <span className="ml-auto flex items-center gap-2 pl-2">
                        <CommentLikes comment={r} />
                        {own || club.me.isAdmin ? (
                          <button
                            type="button"
                            onClick={() => onRemove(r.id)}
                            aria-label={own ? 'Apagar sua resposta' : `Apagar a resposta de ${r.reviewerName}`}
                            className="rounded-cell p-1 text-ink-faint transition-colors hover:text-dye-red-lit"
                          >
                            <X className="h-3 w-3" strokeWidth={1.8} />
                          </button>
                        ) : null}
                      </span>
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-ink-dim">
                      <WithMentions text={r.body} />
                    </p>
                  </div>
                </li>
              );
            })}

            {writing ? (
              <li className="flex flex-wrap items-end gap-2 pt-0.5">
                <MentionField
                  className="min-w-[14ch] flex-1"
                  label={`Responder ${c.reviewerName}`}
                  value={draft}
                  onChange={setDraft}
                  onSubmit={() => void send()}
                  maxLength={MAX_COMMENT}
                  rows={2}
                  placeholder={`Responder ${c.reviewerName.split(' ')[0]}…`}
                />
                <Key tone="flush" disabled={!draft.trim() || sending} onClick={() => void send()}>
                  {sending ? 'Enviando…' : 'Responder'}
                </Key>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

/* ── a conversa em cima de uma ficha ──────────────────────────────────────
   O clube discute por voz e a discussão morre com a chamada. Isto é a primeira
   coisa no produto que guarda alguma parte dela.

   Pendurada na avaliação e não no filme, de propósito: o que se discute é a
   ficha de alguém — "teu 9 em fotografia" — e é a mesma unidade em que se vota
   logo acima. Um fio por filme juntaria as quatro conversas numa e descolaria a
   resposta de quem foi respondido.

   Não tem chave commit vermelha. A regra da lâmpada vale: no máximo uma
   superfície vermelha por tela, e uma tela pode ter seis conversas abertas ao
   mesmo tempo. */
export function Conversation({
  review,
  /* O acervo abre a conversa dentro de uma gaveta que já tem o detalhamento em
     cima, e a régua separa os dois. No feed a conversa é a única coisa que a
     gaveta contém, e uma linha no topo dela desenharia a borda de uma caixa
     que não existe. */
  ruled = true,
}: {
  review: Review;
  ruled?: boolean;
}) {
  const club = useClub();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  /* Quantos comentários a lista está mostrando. Cresce de três em três e nunca
     encolhe: recolher sozinho o que a pessoa acabou de pedir para ver seria a
     tela discordando dela. */
  const [showing, setShowing] = useState(FIRST_PAGE);
  /* Na sua própria ficha você está respondendo quem te respondeu; na dos outros
     você está comentando. O campo e a chave dizem o mesmo verbo — um botão que
     diz "Comentar" embaixo de um campo que diz "Responder" faz a pessoa parar
     para conferir se são duas coisas. */
  const own = review.reviewerId === club.me.id;

  const here = club.comments.filter(c => c.reviewId === review.id);
  /* Só os de primeiro nível entram na paginação; uma resposta pertence ao pai e
     conta dentro dele. Contar respostas aqui faria "carregar mais" aparecer numa
     conversa de dois comentários só porque um deles rendeu. */
  const roots = here
    .filter(c => !c.parentId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const repliesOf = (id: string) =>
    here.filter(c => c.parentId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  /* Os mais NOVOS ficam à vista e os antigos recuam para trás do botão. Uma
     conversa é lida do começo, mas retomada pelo fim: quem abre a gaveta quer
     saber o que disseram por último. */
  /* ── o texto que um aviso apontou ───────────────────────────────────────
     Chegar aqui pelo sino tem de terminar com o comentário À VISTA, e havia
     dois jeitos de ele não estar: recolhido dentro do pai (resolvido abrindo
     por padrão) ou atrás do "carregar mais", que é este.

     Uma resposta conta pelo pai: é a posição DELE na lista que decide se o par
     está visível. Achado o índice, a lista cresce o quanto for preciso — não
     três, o suficiente. */
  const wanted = club.focusComment;
  const { clearFocusComment } = club;
  /* Dois valores para a mesma chegada, pela razão que a ficha já ensinou: o
     brilho tem de apagar, a abertura não pode. */
  const [flash, setFlash] = useState<string | null>(null);
  const [arrived, setArrived] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (!wanted) return;
    const target = here.find(c => c.id === wanted);
    // De outra ficha, ou já apagado: não é desta conversa e não é problema dela.
    if (!target) return;

    const rootId = target.parentId || target.id;
    const at = roots.findIndex(c => c.id === rootId);
    if (at >= 0) setShowing(n => Math.max(n, roots.length - at));
    setArrived(wanted);
    setFlash(wanted);
    clearFocusComment();

    const gentle = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    /* Guardados em ref e limpos só na desmontagem: este efeito apaga o próprio
       gatilho, então o cleanup dele roda no instante seguinte e cancelaria os
       dois temporizadores que acabaram de ser marcados. Mesma armadilha do foco
       da ficha, mesmo conserto. */
    timers.current.push(
      window.setTimeout(() => {
        document
          .getElementById(`comment-${wanted}`)
          ?.scrollIntoView({ behavior: gentle ? 'auto' : 'smooth', block: 'center' });
      }, 360),
      window.setTimeout(() => setFlash(null), 2600)
    );
  }, [wanted, here, roots, clearFocusComment]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(window.clearTimeout);
      pending.length = 0;
    };
  }, []);

  const hidden = Math.max(0, roots.length - showing);
  const shown = roots.slice(hidden);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await club.comment(review.id, body);
      setDraft('');
    } catch (e) {
      club.fault('Não foi possível comentar: ' + (e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function remove(id: string) {
    try {
      await club.uncomment(id);
    } catch (e) {
      club.fault('Não foi possível apagar o comentário: ' + (e as Error).message);
    }
  }

  return (
    <div className={cn(ruled && 'mt-4 border-t border-white/[0.06] pt-4')}>
      {ruled ? (
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="legend">Conversa</span>
          {here.length ? (
            <span className="q text-[11px] text-ink-dim">
              {plural(here.length, 'resposta', 'respostas')}
            </span>
          ) : null}
        </div>
      ) : null}

      {hidden ? (
        <button
          type="button"
          onClick={() => setShowing(n => n + FIRST_PAGE)}
          className="mt-3 font-display text-[11px] uppercase leading-none tracking-[0.12em] text-ink-dim transition-colors hover:text-beam"
        >
          Carregar mais {hidden > FIRST_PAGE ? `(${hidden})` : ''}
        </button>
      ) : null}

      {shown.length ? (
        <ul className="mt-3 flex flex-col gap-3.5">
          {shown.map(c => (
            <Comment
              key={c.id}
              c={c}
              replies={repliesOf(c.id)}
              review={review}
              lit={flash}
              arrived={arrived}
              onRemove={remove}
            />
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <MentionField
          className="min-w-[16ch] flex-1"
          label={`Comentar a avaliação de ${review.reviewerName}`}
          value={draft}
          onChange={setDraft}
          onSubmit={() => void send()}
          /* O mesmo teto do servidor. Sem isto, quem escrevesse um parágrafo a
             mais só descobria no 400 depois de apertar — o erro chegava como um
             toast vermelho no fim de um texto já escrito, que é a pior hora
             possível para descobrir um limite. */
          maxLength={MAX_COMMENT}
          rows={2}
          placeholder={own ? 'Responder' : 'Comentar'}
        />
        <Key tone="flush" disabled={!draft.trim() || sending} onClick={() => void send()}>
          {sending ? 'Enviando…' : own ? 'Responder' : 'Comentar'}
        </Key>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, MessageSquare, ThumbsDown, ThumbsUp, UserPlus } from 'lucide-react';
import { PersonReel } from '@/components/person';
import { notifications, type Notice } from '@/lib/api';
import { useLive } from '@/lib/live';
import { cn, plural, whenOf } from '@/lib/utils';

/* ══════════════════════════════════════════════════════════════════════════
   O sino: quem reagiu ao que é seu.

   O clube discute por voz e escreve depois, em horas diferentes. Sem isto, uma
   resposta ao seu take existe e ninguém fica sabendo — a única forma de
   descobrir que alguém discordou da sua fotografia era abrir a própria ficha e
   reparar num contador que antes era zero. Este é o caminho de volta.

   ── por que só um sino, e não um centro de notificações ─────────────────
   Porque são três coisas, num clube de seis pessoas, com talvez uma dúzia de
   eventos por semana. O que isso pede é uma lista curta que abre, mostra o que
   houve e fecha. Uma tela própria, uma rota, filtros e estado por item seriam
   máquina para um volume que cabe num painel.

   O feed vem derivado do servidor (routes/notifications.js) e a única coisa
   gravada sobre ele é uma data por pessoa. Abrir o sino é o que move essa data.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── a pergunta periódica, que agora é a rede de baixo ────────────────────
   De um minuto e meio, e só com a aba à vista. Era o único jeito de o sino
   saber de alguma coisa: quem respondesse você às 21h04 acendia o seu sino
   quando desse a próxima volta do relógio, e no meio disso o painel dizia zero
   com toda a confiança do mundo.

   O aviso ao vivo (`useLive`, abaixo) passou a ser o caminho normal, e este
   ficou sendo o que segura o produto quando aquele cai — uma sessão que expirou,
   abas demais, um proxy que fechou a conexão. Ao vivo é mais rápido; isto é o
   que garante que nada fica escondido para sempre.

   `visibilitychange` continua evitando que uma aba esquecida num monitor
   secundário fique batendo no servidor a noite inteira. */
const POLL_MS = 90_000;

/** Quanto tempo o distintivo fica pulando quando chega coisa nova. */
const POP_MS = 700;

function iconOf(kind: Notice['kind'], value?: number) {
  if (kind === 'join') return UserPlus;
  if (kind === 'comment' || kind === 'reply' || kind === 'mention') return MessageSquare;
  if (kind === 'like') return ThumbsUp;
  return value === -1 ? ThumbsDown : ThumbsUp;
}

export function Notices({
  onOpenReview,
  onOpenRequests,
}: {
  onOpenReview: (reviewId: string, commentId?: string | null) => void;
  /** Onde um pedido de entrada leva: a porta do clube, nos ajustes dele. */
  onOpenRequests: () => void;
}) {
  /* O retrato vem do clube, que já carrega a lista de avaliadores, e não do
     aviso: uma foto é um fato sobre a pessoa e não sobre o aviso, e mandá-la em
     cada item repetiria a mesma URL dezenas de vezes na mesma resposta. Quem
     resolve isso agora é `PersonReel`, que faz a mesma consulta ao clube para
     todo rosto do produto. */
  const [items, setItems] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const got = await notifications.all();
      setItems(got.items);
      setUnread(got.unread);
      setFailed(false);
    } catch {
      /* Um sino que não carregou não é um erro que merece um toast por cima da
         tela: a pessoa não pediu nada. Fica quieto e tenta de novo no próximo
         ciclo; só o painel aberto conta o que houve. */
      setFailed(true);
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

  /* ── e agora, na hora ───────────────────────────────────────────────────
     `social` cobre comentário, resposta, curtida e voto; `reviews` cobre a
     menção que alguém escreve no comentário da própria ficha ao avaliar — as
     duas coisas que routes/notifications.js lê. O aviso não diz o que houve,
     só que houve: quem monta a frase é o servidor, e ele a monta na segunda
     pessoa, o que só pode ser feito por quem sabe quem está perguntando.

     Com o painel aberto, chegar é ser visto: o item entra na lista debaixo dos
     olhos de alguém, e um contador subindo para "1" enquanto o "1" está na tela
     é o painel dizendo que não acredita nos próprios olhos. */
  const openRef = useRef(open);
  openRef.current = open;
  useLive(kinds => {
    /* `club` entrou aqui junto com o aviso de pedido de entrada: sem ele, quem
       bate na porta só aparecia no sino na volta da pergunta periódica, até um
       minuto e meio depois. */
    if (!kinds.has('social') && !kinds.has('reviews') && !kinds.has('club')) return;
    void (async () => {
      await load();
      if (!openRef.current) return;
      setUnread(0);
      try {
        await notifications.seen();
      } catch {
        /* a conta volta no próximo carregamento, que é o certo */
      }
    })();
  });

  /* ── o pulo ─────────────────────────────────────────────────────────────
     Um aviso que aparece sem mover nada não aparece: o distintivo é uma
     etiqueta de quinze pixels no canto de um ícone de dezoito, num cabeçalho
     que a pessoa não está olhando — ela está lendo a conversa embaixo. O pulo é
     o que faz o olho subir.

     Só quando SOBE, e nunca na primeira carga. Um sino que chacoalha a cada F5
     está anunciando o carregamento da página, não uma novidade — e o que se
     pediu é que a novidade apareça ao vivo. */
  const [pop, setPop] = useState(false);
  const before = useRef(0);
  const first = useRef(true);
  useEffect(() => {
    const grew = unread > before.current;
    before.current = unread;
    if (first.current) {
      first.current = false;
      return;
    }
    if (!grew) return;
    setPop(true);
    const id = window.setTimeout(() => setPop(false), POP_MS);
    return () => window.clearTimeout(id);
  }, [unread]);

  /* Abrir é ver. A conta zera na hora, sem esperar o servidor, porque a pessoa
     está olhando para a lista enquanto o pedido viaja — e um contador que
     insiste em "3" enquanto os três estão na tela é o painel dizendo que não
     acredita nos próprios olhos. */
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    await load();
    setUnread(0);
    try {
      await notifications.seen();
    } catch {
      /* A marca não subiu: a conta volta no próximo carregamento, o que é o
         comportamento certo — nada foi visto do ponto de vista do servidor. */
    }
  }

  /* A lista some na hora, sem esperar a resposta: quem apertou está olhando
     para ela, e um painel que continua cheio por meio segundo depois do clique
     parece um botão que não funcionou. Se o pedido falhar, o próximo
     carregamento traz tudo de volta, que é a verdade. */
  async function wipe() {
    if (clearing) return;
    setClearing(true);
    const had = items;
    setItems([]);
    setUnread(0);
    try {
      await notifications.clear();
    } catch {
      setItems(had);
    } finally {
      setClearing(false);
    }
  }

  /* Fecha ao clicar fora e no Escape. Um painel que só fecha pelo próprio botão
     obriga a mirar de volta no alvo que acabou de sair do lugar. */
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        aria-label={
          unread ? `Novidades: ${plural(unread, 'aviso novo', 'avisos novos')}` : 'Novidades'
        }
        className={cn(
          'relative flex h-[30px] w-[30px] items-center justify-center rounded-cell transition-colors duration-150',
          open || unread ? 'text-dye-brass' : 'text-ink-dim hover:text-ink'
        )}
      >
        {/* O badalo é curto e não se repete: o sino balança uma vez quando
            chega alguma coisa e volta a ser um ícone. Um chacoalhar em laço
            seria a marquise pedindo atenção o tempo todo, que é a versão de
            interface de alguém falando alto até ser respondido.

            `motion-reduce` aqui, ao contrário das gavetas: uma gaveta que abre
            é a resposta a um clique que a pessoa deu, e isto é movimento que
            começa sozinho no canto do olho — exatamente o que a preferência do
            sistema existe para desligar. O distintivo continua aparecendo. */}
        <Bell
          className={cn('h-[18px] w-[18px]', pop && 'animate-nudge motion-reduce:animate-none')}
          strokeWidth={1.8}
        />
        {/* O contador é latão porque ter avisos por ler é um estado, e o
            vermelho desta sala é reservado para ação e gravação. Um distintivo
            vermelho permanente na marquise competiria com a chave de gravar em
            todas as telas — e a regra da lâmpada diz uma superfície vermelha
            por tela, no máximo. */}
        {unread ? (
          <span
            className={cn(
              'q absolute -right-0.5 -top-0.5 min-w-[15px] rounded-[2px] bg-dye-brass px-[3px] text-[9.5px] font-semibold leading-[15px] text-house-deep',
              pop && 'animate-pop'
            )}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="region"
          aria-label="Novidades"
          /* Ancorado à direita porque o sino mora no fim da marquise: alinhado à
             esquerda, um painel de 340px sairia da tela num celular. */
          className="plate absolute right-0 top-[38px] z-40 max-h-[min(70dvh,520px)] w-[340px] max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
        >
          <div className="sticky top-0 z-10 flex items-baseline justify-between gap-3 border-b border-white/[0.07] bg-house-seat px-4 py-3">
            <span className="legend">Novidades</span>
            {/* Limpar esvazia a sua lista e nada mais: o comentário, o voto e a
                curtida continuam onde estão, para o clube inteiro. Sem confirmar
                — não há o que desfazer porque não há o que se perde, e o que
                chegar depois volta a aparecer. */}
            {items.length ? (
              <button
                type="button"
                disabled={clearing}
                onClick={() => void wipe()}
                className="font-display text-[11px] uppercase leading-none tracking-[0.12em] text-ink-dim transition-colors hover:text-beam disabled:opacity-40"
              >
                {clearing ? 'Limpando…' : 'Limpar'}
              </button>
            ) : null}
          </div>

          {failed && !items.length ? (
            <p className="px-4 py-6 text-[13px] leading-relaxed text-ink-dim">
              Não foi possível carregar as novidades agora.
            </p>
          ) : !items.length ? (
            <p className="px-4 py-6 text-[13px] leading-relaxed text-ink-dim">
              Ninguém reagiu ao que você escreveu ainda. Quando alguém comentar sua ficha, concordar
              com uma nota sua, curtir um comentário seu — ou pedir para entrar no clube — aparece
              aqui.
            </p>
          ) : (
            <ul className="flex flex-col">
              {items.map(n => {
                const Icon = iconOf(n.kind, n.value);
                return (
                  <li
                    key={n.id}
                    className="flex gap-2.5 border-b border-white/[0.05] px-4 py-3 transition-colors last:border-0 hover:bg-beam/[0.05]"
                  >
                    {/* Com o retrato de quem reagiu, e ele leva ao perfil dessa
                        pessoa. Ficou fora do botão da linha porque um controle
                        não se aninha em outro, e porque são dois destinos
                        diferentes: o rosto pergunta "quem é essa pessoa" e o
                        resto da linha responde "o que ela fez".

                        O painel se fecha antes de navegar: ele é ancorado ao
                        sino e ficaria aberto por cima do perfil que acabou de
                        abrir, falando de uma tela que não está mais embaixo. */}
                    <PersonReel
                      person={n.actor}
                      size="sm"
                      solo
                      onNavigate={() => setOpen(false)}
                    />
                    <button
                      type="button"
                      /* Leva à ficha de que o aviso fala, aberta e à vista —
                         não à aba onde ela está em algum lugar. Um aviso que
                         entrega uma lista de quarenta cartas e deixa a busca
                         com o leitor não terminou de avisar. */
                      onClick={() => {
                        setOpen(false);
                        /* Um pedido de entrada não aponta para ficha nenhuma:
                           ele leva à porta, que é onde se aceita ou recusa. */
                        if (n.kind === 'join' || !n.reviewId) {
                          onOpenRequests();
                          return;
                        }
                        onOpenReview(n.reviewId, n.commentId);
                      }}
                      className="flex min-w-0 flex-1 gap-2.5 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] leading-snug text-ink-dim">
                          <span className="font-display uppercase tracking-[0.08em] text-ink">
                            {n.actor.name}
                          </span>{' '}
                          {n.text}
                        </span>
                        {n.excerpt ? (
                          <span className="mt-1 block break-words text-[12px] italic leading-snug text-ink-faint">
                            “{n.excerpt}”
                          </span>
                        ) : null}
                        <span className="q mt-1 block text-[10.5px] text-ink-dim" title={n.at}>
                          {whenOf(n.at)}
                        </span>
                      </span>
                      <Icon
                        className="mt-0.5 h-3.5 w-3.5 flex-none text-ink-faint"
                        strokeWidth={1.9}
                        aria-hidden
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

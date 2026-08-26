import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, MessageSquare, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Reel } from '@/components/bits';
import { initialsOf, notifications, reelColor, type Notice } from '@/lib/api';
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

/* De um minuto e meio, e só com a aba à vista. O clube está no Discord com a
   página aberta ao lado por horas, e uma consulta a cada poucos segundos seria
   trabalho constante numa instância que dorme por falta dele. `visibilitychange`
   é o que evita que uma aba esquecida num monitor secundário fique batendo no
   servidor a noite inteira. */
const POLL_MS = 90_000;

function iconOf(kind: Notice['kind'], value?: number) {
  if (kind === 'comment') return MessageSquare;
  if (kind === 'like') return ThumbsUp;
  return value === -1 ? ThumbsDown : ThumbsUp;
}

export function Notices({ onOpenReview }: { onOpenReview: (reviewId: string) => void }) {
  const [items, setItems] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
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
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.8} />
        {/* O contador é latão porque ter avisos por ler é um estado, e o
            vermelho desta sala é reservado para ação e gravação. Um distintivo
            vermelho permanente na marquise competiria com a chave de gravar em
            todas as telas — e a regra da lâmpada diz uma superfície vermelha
            por tela, no máximo. */}
        {unread ? (
          <span className="q absolute -right-0.5 -top-0.5 min-w-[15px] rounded-[2px] bg-dye-brass px-[3px] text-[9.5px] font-semibold leading-[15px] text-house-deep">
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
            {items.length ? (
              <span className="q text-[11px] text-ink-dim">{items.length}</span>
            ) : null}
          </div>

          {failed && !items.length ? (
            <p className="px-4 py-6 text-[13px] leading-relaxed text-ink-dim">
              Não foi possível carregar as novidades agora.
            </p>
          ) : !items.length ? (
            <p className="px-4 py-6 text-[13px] leading-relaxed text-ink-dim">
              Ninguém reagiu ao que você escreveu ainda. Quando alguém comentar sua ficha, concordar
              com uma nota sua ou curtir um comentário seu, aparece aqui.
            </p>
          ) : (
            <ul className="flex flex-col">
              {items.map(n => {
                const Icon = iconOf(n.kind, n.value);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      /* Leva à ficha de que o aviso fala, aberta e à vista —
                         não à aba onde ela está em algum lugar. Um aviso que
                         entrega uma lista de quarenta cartas e deixa a busca
                         com o leitor não terminou de avisar. */
                      onClick={() => {
                        setOpen(false);
                        onOpenReview(n.reviewId);
                      }}
                      className="flex w-full gap-2.5 border-b border-white/[0.05] px-4 py-3 text-left transition-colors last:border-0 hover:bg-beam/[0.05]"
                    >
                      <Reel color={reelColor(n.actor.dot, n.actor.id)} size="sm">
                        {initialsOf(n.actor.name)}
                      </Reel>
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

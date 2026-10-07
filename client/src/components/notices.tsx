import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CalendarClock, Mail, MessageSquare, ThumbsDown, ThumbsUp, UserPlus } from 'lucide-react';
import { Key, Poster, Reel } from '@/components/bits';
import { auth, initialsOf, notifications, reelColor, type Notice } from '@/lib/api';
import { useLive } from '@/lib/live';
import { cn, plural, whenOf } from '@/lib/utils';

const go = (slug: string, rest: string) =>
  (location.hash = `c/${encodeURIComponent(slug)}/${rest}`);

const goSeries = (slug: string, rest: string) =>
  (location.hash = `series/c/${encodeURIComponent(slug)}/${rest}`);

const POLL_MS = 90_000;

const POP_MS = 700;

function ConfirmNotice() {
  const [state, setState] = useState<'parado' | 'indo' | 'foi' | 'falhou'>('parado');

  async function mandar() {
    setState('indo');
    try {
      const out = await auth.sendVerification();
      setState(out.sent === false ? 'falhou' : 'foi');
    } catch {
      setState('falhou');
    }
  }

  return (
    <div className="flex gap-2.5 border-b border-white/[0.05] px-4 py-3.5">
      <Mail className="mt-0.5 h-4 w-4 flex-none text-dye-brass" strokeWidth={1.8} aria-hidden />
      <div className="min-w-0">
        <p className="font-display text-[13px] uppercase leading-none tracking-[0.1em] text-ink">
          Confirme seu e-mail
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
          Destrava <span className="text-ink">fundar um clube</span> e{' '}
          <span className="text-ink">recuperar a senha</span> se um dia você perder o acesso. O
          resto do Cineclube já funciona.
        </p>

        {state === 'foi' ? (
          <p className="mt-3 text-[12.5px] leading-relaxed text-dye-green-lit">
            Mandamos de novo. Vale por 24 horas — se não chegar, olhe no spam.
          </p>
        ) : state === 'falhou' ? (
          <p className="mt-3 text-[12.5px] leading-relaxed text-dye-red-lit">
            Não conseguimos mandar agora. Tente de novo daqui a pouco.
          </p>
        ) : (
          <div className="mt-3">
            <Key onClick={() => void mandar()} disabled={state === 'indo'}>
              {state === 'indo' ? 'Mandando' : 'Mandar de novo'}
            </Key>
          </div>
        )}
      </div>
    </div>
  );
}

function iconOf(kind: Notice['kind'], value?: number) {
  if (kind === 'airing') return CalendarClock;
  if (kind === 'join') return UserPlus;
  if (kind === 'comment' || kind === 'reply' || kind === 'mention') return MessageSquare;
  if (kind === 'like') return ThumbsUp;
  return value === -1 ? ThumbsDown : ThumbsUp;
}

export function Notices() {
  const [items, setItems] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [verify, setVerify] = useState(false);
  const [clubs, setClubs] = useState(0);
  const [open, setOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const got = await notifications.all();
      setItems(got.items);
      setUnread(got.unread);
      setVerify(!!got.account?.verifyEmail);
      setClubs(got.clubs ?? 0);
      setFailed(false);
    } catch {
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

  const openRef = useRef(open);
  openRef.current = open;
  useLive(kinds => {
    if (!kinds.has('social') && !kinds.has('reviews') && !kinds.has('club')) return;
    void (async () => {
      await load();
      if (!openRef.current) return;
      setUnread(0);
      try {
        await notifications.seen();
      } catch {
      }
    })();
  });

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

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    await load();
    setUnread(0);
    try {
      await notifications.seen();
    } catch {
    }
  }

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
    <div ref={box}>
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        aria-label={
          unread ? `Novidades: ${plural(unread, 'aviso novo', 'avisos novos')}` : 'Novidades'
        }
        className={cn(
          'relative flex h-[30px] w-[30px] coarse:h-11 coarse:w-11 items-center justify-center rounded-cell transition-colors duration-150',
          open || unread ? 'text-dye-brass' : 'text-ink-dim hover:text-ink'
        )}
      >
        {}
        <Bell
          className={cn('h-[18px] w-[18px]', pop && 'animate-nudge motion-reduce:animate-none')}
          strokeWidth={1.8}
        />
        {}
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
          className="plate absolute right-0 top-[calc(100%+8px)] z-40 max-h-[min(calc(70dvh/var(--ui-zoom)),520px)] w-[340px] max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
        >
          <div className="sticky top-0 z-10 flex items-baseline justify-between gap-3 border-b border-white/[0.07] bg-house-seat px-4 py-3">
            <span className="legend">Novidades</span>
            {}
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

          {}
          {verify ? <ConfirmNotice /> : null}

          {failed && !items.length ? (
            <p className="px-4 py-6 text-[13px] leading-relaxed text-ink-dim">
              Não foi possível carregar as novidades agora.
            </p>
          ) : !items.length ? (
            verify ? null : (
              <p className="px-4 py-6 text-[13px] leading-relaxed text-ink-dim">
                Ninguém reagiu ao que você escreveu ainda. Quando alguém comentar sua avaliação,
                concordar com uma nota sua, curtir um comentário seu — ou pedir para entrar num
                clube — aparece aqui. E no dia em que estrear um episódio de uma série que você
                acompanha, ele aparece aqui também.
              </p>
            )
          ) : (
            <ul className="flex flex-col">
              {items.map(n => {
                const Icon = iconOf(n.kind, n.value);
                return (
                  <li
                    key={n.id}
                    className="flex gap-2.5 border-b border-white/[0.05] px-4 py-3 transition-colors last:border-0 hover:bg-beam/[0.05]"
                  >
                    {}
                    {n.kind === 'airing' ? (
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          if (n.club && n.showId) goSeries(n.club.slug, `show/${n.showId}`);
                        }}
                        className="flex min-w-0 flex-1 gap-2.5 text-left"
                      >
                        <Poster src={n.showPoster ?? null} className="h-[38px] w-[26px] flex-none" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] leading-snug text-ink-dim">
                            <span className="font-display uppercase tracking-[0.08em] text-ink">
                              {n.showTitle}
                            </span>{' '}
                            {n.text}
                          </span>
                          {clubs > 1 && n.club ? (
                            <span className="mt-1 block font-display text-[10.5px] uppercase leading-none tracking-[0.12em] text-dye-brass">
                              {n.club.name}
                            </span>
                          ) : null}
                          <span className="q mt-1 block text-[10.5px] text-ink-dim" title={n.at}>
                            hoje
                          </span>
                        </span>
                        <Icon
                          className="mt-0.5 h-3.5 w-3.5 flex-none text-dye-brass"
                          strokeWidth={1.9}
                          aria-hidden
                        />
                      </button>
                    ) : !n.actor ? null : (
                      <>
                    {}
                    <button
                      type="button"
                      aria-label={n.actor.name}
                      onClick={() => {
                        setOpen(false);
                        if (n.club) go(n.club.slug, `perfil/${n.actor!.id}`);
                      }}
                      className="flex-none"
                    >
                      <Reel
                        color={reelColor(n.actor.dot, n.actor.id)}
                        src={n.actor.avatar}
                        size="sm"
                      >
                        {initialsOf(n.actor.name)}
                      </Reel>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        if (!n.club) return;
                        if (n.kind === 'join' || !n.reviewId) {
                          go(n.club.slug, 'ajustes');
                          return;
                        }
                        go(
                          n.club.slug,
                          `reviews/${n.reviewId}` + (n.commentId ? `/${n.commentId}` : '')
                        );
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
                        {}
                        {clubs > 1 && n.club ? (
                          <span className="mt-1 block font-display text-[10.5px] uppercase leading-none tracking-[0.12em] text-dye-brass">
                            {n.club.name}
                          </span>
                        ) : null}
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
                      </>
                    )}
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

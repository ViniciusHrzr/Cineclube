import { useEffect, useRef, useState } from 'react';
import { ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { Key } from '@/components/bits';
import { MentionField, WithMentions } from '@/components/mention';
import { PersonName, PersonReel } from '@/components/person';
import { type TakeComment } from '@/lib/api';
import { cn, plural, whenOf } from '@/lib/utils';
import { useWorld, type TakeRef } from '@/lib/world';

export const MAX_COMMENT = 1000;

export function TakeVotes({
  take,
  className,
  labelled = false,
}: {
  take: TakeRef;
  className?: string;
  labelled?: boolean;
}) {
  const club = useWorld();
  const [busy, setBusy] = useState(false);

  const cast = club.votes.filter(v => v.takeId === take.id);
  const up = cast.filter(v => v.value === 1).length;
  const down = cast.filter(v => v.value === -1).length;
  const mine = cast.find(v => v.reviewerId === club.me.id)?.value ?? 0;
  const own = take.reviewerId === club.me.id;

  async function press(value: 1 | -1) {
    if (busy) return;
    setBusy(true);
    try {
      await club.voteOn(take.id, mine === value ? 0 : value);
    } catch (e) {
      club.fault('Não foi possível registrar o voto: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
          `${on ? 'Tirar seu voto: ' : ''}${word} com a avaliação de ${take.reviewerName}` +
          (n ? `, ${n} até agora` : '')
        }
        title={on ? `${word} — clique para tirar seu voto` : word}
        onClick={() => void press(side)}
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
        {}
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

export function CommentLikes({ comment }: { comment: TakeComment }) {
  const club = useWorld();
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

const FIRST_PAGE = 3;

function Comment({
  c,
  replies,
  take,
  lit,
  arrived,
  onRemove,
}: {
  c: TakeComment;
  replies: TakeComment[];
  take: TakeRef;
  lit: string | null;
  arrived: string | null;
  onRemove: (id: string) => void;
}) {
  const club = useWorld();
  const [open, setOpen] = useState(false);
  const [writing, setWriting] = useState(false);

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
      await club.comment(take.id, body, c.id);
      setDraft('');
      setWriting(false);
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
      className={cn(
        'flex scroll-mt-24 gap-2.5 rounded-cell transition-colors duration-700',
        lit === c.id && 'bg-beam/[0.07]'
      )}
    >
      {}
      <PersonReel person={{ id: c.reviewerId, name: c.reviewerName, dot: c.reviewerDot }} size="sm" />
      <div className="min-w-0 flex-1">
        {}
        <p className="flex flex-wrap items-center gap-x-2">
          <PersonName
            person={{ id: c.reviewerId, name: c.reviewerName, dot: c.reviewerDot }}
            className="font-display text-[13px] uppercase tracking-[0.1em] text-ink"
          />
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
        {}
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
                  <PersonReel
                    person={{ id: r.reviewerId, name: r.reviewerName, dot: r.reviewerDot }}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2">
                      <PersonName
                        person={{ id: r.reviewerId, name: r.reviewerName, dot: r.reviewerDot }}
                        className="font-display text-[12px] uppercase tracking-[0.1em] text-ink"
                      />
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

export function Conversation({
  take,
  ruled = true,
}: {
  take: TakeRef;
  ruled?: boolean;
}) {
  const club = useWorld();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [showing, setShowing] = useState(FIRST_PAGE);
  const own = take.reviewerId === club.me.id;

  const here = club.comments.filter(c => c.takeId === take.id);
  const roots = here
    .filter(c => !c.parentId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const repliesOf = (id: string) =>
    here.filter(c => c.parentId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const wanted = club.focusComment;
  const { clearFocusComment } = club;
  const [flash, setFlash] = useState<string | null>(null);
  const [arrived, setArrived] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (!wanted) return;
    const target = here.find(c => c.id === wanted);
    if (!target) return;

    const rootId = target.parentId || target.id;
    const at = roots.findIndex(c => c.id === rootId);
    if (at >= 0) setShowing(n => Math.max(n, roots.length - at));
    setArrived(wanted);
    setFlash(wanted);
    clearFocusComment();

    const gentle = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
      await club.comment(take.id, body);
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
              take={take}
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
          label={`Comentar a avaliação de ${take.reviewerName}`}
          value={draft}
          onChange={setDraft}
          onSubmit={() => void send()}
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

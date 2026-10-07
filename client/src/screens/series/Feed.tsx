import { useCallback, useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  MessageSquare,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { Bill, Blank, Drawer, Fault, Poster, Skeleton, Strip } from '@/components/bits';
import { PersonName, PersonReel } from '@/components/person';
import { Conversation, TakeVotes } from '@/components/social';
import { Breakdown } from '@/components/take';
import { fmt, type ShowFeedEvent, showsSocial, type ShowTake } from '@/lib/api';
import { useLive } from '@/lib/live';
import { clockOf, cn, dayOf, plural } from '@/lib/utils';
import { useWorld } from '@/lib/world';
import { TakeCard } from './shared';

const FEED_POLL_MS = 120_000;

export function SeriesFeedScreen({
  takes,
  onOpenShow,
  onAimComment,
}: {
  takes: ShowTake[] | null;
  onOpenShow: (showId: number) => void;
  onAimComment: (commentId: string) => void;
}) {
  const [items, setItems] = useState<ShowFeedEvent[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const got = await showsSocial.feed();
      setItems(got.items);
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const tick = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const id = window.setInterval(tick, FEED_POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  useLive(kinds => {
    if (kinds.has('shows') || kinds.has('social')) void load();
  });

  if (erro && !items) {
    return (
      <section>
        <Bill title="Feed" />
        <div className="max-w-[60ch]">
          <Fault detail={erro}>Não foi possível carregar o feed.</Fault>
        </div>
      </section>
    );
  }

  if (!items) {
    return (
      <section>
        <Bill title="Feed" note="carregando…" />
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
          Quando alguém marcar um episódio, der uma nota ou comentar uma ficha, aparece aqui — do
          mais recente para o mais antigo.
        </Blank>
      </section>
    );
  }

  let ultimoDia = '';

  return (
    <section>
      <Bill
        title="Feed"
        note={`${plural(items.length, 'acontecimento', 'acontecimentos')} no clube`}
      />

      <div className="max-w-[760px]">
        {runsOf(items).map(bloco => {
          const primeiro = bloco[0];
          const dia = dayOf(primeiro.at);
          const abreDia = dia !== ultimoDia;
          ultimoDia = dia;
          return (
            <div key={primeiro.id}>
              {abreDia ? <p className="legend mb-3 mt-7 first:mt-0">{dia}</p> : null}
              {primeiro.kind === 'take' ? (
                bloco.length > 1 ? (
                  <FeedRatedRun events={bloco} takes={takes} onOpenShow={onOpenShow} />
                ) : (
                  <FeedRated e={primeiro} takes={takes} onOpenShow={onOpenShow} />
                )
              ) : primeiro.kind === 'seen' ? (
                <FeedSeen e={primeiro} takes={takes} onOpenShow={onOpenShow} />
              ) : (
                <FeedAside e={primeiro} takes={takes} onAimComment={onAimComment} />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const epTag = (season?: number, episode?: number | null) =>
  episode == null ? `T${season ?? 0}` : `T${season ?? 0}E${String(episode).padStart(2, '0')}`;

function runsOf(items: ShowFeedEvent[]) {
  const blocos: ShowFeedEvent[][] = [];
  for (const e of items) {
    const atual = blocos[blocos.length - 1];
    const cabe =
      atual &&
      e.kind === 'take' &&
      atual[0].kind === 'take' &&
      atual[0].actor.id === e.actor.id &&
      atual[0].showId === e.showId &&
      dayOf(atual[0].at) === dayOf(e.at);
    if (cabe) atual.push(e);
    else blocos.push([e]);
  }
  return blocos;
}

const inOrder = (events: ShowFeedEvent[]) =>
  [...events].sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));

function FeedRated({
  e,
  takes,
  onOpenShow,
}: {
  e: ShowFeedEvent;
  takes: ShowTake[] | null;
  onOpenShow: (showId: number) => void;
}) {
  const world = useWorld();
  const take = takes?.find(t => t.id === e.takeId) ?? null;
  const quem = take
    ? { id: take.id, reviewerId: take.reviewerId, reviewerName: take.reviewerName ?? 'alguém' }
    : null;
  const conversa = world.comments.filter(c => c.takeId === e.takeId).length;
  const hora = clockOf(e.at);

  const [conversando, setConversando] = useState(false);
  const [tocada, setTocada] = useState(false);
  const [aberta, setAberta] = useState(false);
  const [desdobrada, setDesdobrada] = useState(false);

  const escrito = take?.comment?.replace(/\s+/g, ' ').trim() ?? '';
  const cortado = !!escrito && escrito !== (e.excerpt ?? '');

  return (
    <div className="plate mb-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-4">
        <PersonReel person={e.actor} size="sm" />
        <PersonName
          person={e.actor}
          className="font-display text-[13px] uppercase tracking-[0.1em] text-ink"
        />
        <span className="text-[12.5px] text-ink-dim">avaliou a temporada</span>
        {hora ? <span className="q ml-auto text-[10.5px] text-ink-faint">{hora}</span> : null}
      </div>

      {}
      <div className="px-4 pb-4 pt-2.5">
        <div className="flex gap-4">
          {}
          <button
            type="button"
            onClick={() => onOpenShow(e.showId)}
            aria-label={`Abrir ${e.showTitle}`}
            className="group/cartaz min-h-[81px] flex-none sm:min-h-[93px]"
          >
            <Poster
              src={e.showPoster}
              className="h-full w-[54px] transition-opacity duration-150 group-hover/cartaz:opacity-80 sm:w-[62px]"
            />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <button
                type="button"
                onClick={() => onOpenShow(e.showId)}
                className="text-left font-display text-[22px] leading-none tracking-[0.02em] text-beam transition-colors duration-150 hover:text-beam-hot"
              >
                {e.showTitle}
              </button>
              <span className="q text-[11.5px] text-ink-dim">{epTag(e.season, e.episode)}</span>
            </div>

            {}
            {e.episodeTitle ? (
              <p className="mt-1 truncate text-[13px] text-ink-dim">{e.episodeTitle}</p>
            ) : null}

            <button
              type="button"
              disabled={!take}
              onClick={() => {
                setAberta(v => !v);
                setDesdobrada(true);
              }}
              aria-expanded={take ? aberta : undefined}
              aria-label={`${aberta ? 'Fechar' : 'Abrir'} o detalhamento da ficha de ${e.actor.name}`}
              className="group/notas mt-2.5 block w-full text-left"
            >
              <span className="flex items-center gap-3">
                <Strip value={e.final ?? 0} cells={10} className="h-[6px] w-[120px] flex-none" />
                <span className="q text-[15px] font-medium text-beam">{fmt(e.final ?? 0)}</span>
                <span className="q text-[11px] text-ink-faint">/10</span>
                {take ? (
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      'ml-auto h-4 w-4 flex-none text-ink-faint transition-transform duration-200 group-hover/notas:text-ink-dim',
                      aberta && 'rotate-180'
                    )}
                    strokeWidth={1.7}
                  />
                ) : null}
              </span>

              {}
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
            </button>
          </div>
        </div>

        {}
        {e.excerpt ? (
          <button
            type="button"
            disabled={!take}
            onClick={() => {
              setAberta(v => !v);
              setDesdobrada(true);
            }}
            title={take ? 'Ver o detalhamento' : undefined}
            className="mt-3 block w-full break-words text-left text-[13px] italic leading-relaxed text-ink-dim"
          >
            “{e.excerpt}”
          </button>
        ) : null}
      </div>

      <Drawer open={aberta}>
        {desdobrada && take ? (
          <div className="px-4 pb-4">
            <Breakdown r={take} comment={cortado ? take.comment ?? undefined : undefined} />
          </div>
        ) : null}
      </Drawer>

      {quem ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-4 py-2.5">
          <TakeVotes take={quem} labelled />

          <button
            type="button"
            aria-expanded={conversando}
            aria-label={
              `${conversando ? 'Fechar' : 'Abrir'} a conversa da ficha de ${e.actor.name}` +
              (conversa ? `, ${plural(conversa, 'resposta', 'respostas')}` : '')
            }
            title={conversando ? 'Fechar a conversa' : 'Comentar esta ficha'}
            onClick={() => {
              setConversando(v => !v);
              setTocada(true);
            }}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-cell px-2.5 ring-1 transition-colors duration-150',
              conversando
                ? 'text-dye-brass ring-dye-brass/60 shadow-[inset_0_0_14px_rgba(217,164,65,0.18)]'
                : 'text-ink-dim ring-house-rail hover:text-beam hover:ring-white/25'
            )}
          >
            <MessageSquare className="h-3.5 w-3.5 flex-none" strokeWidth={1.9} aria-hidden />
            <span className="hidden font-display text-[11px] uppercase leading-none tracking-[0.12em] sm:inline">
              {conversando ? 'Fechar' : 'Comentar'}
            </span>
            {conversa ? (
              <span className="q text-[10.5px] leading-none opacity-80">{conversa}</span>
            ) : null}
          </button>

          {}
          <button
            type="button"
            onClick={() => onOpenShow(e.showId)}
            title="Abrir a série, na lista de episódios"
            aria-label={`Abrir ${e.showTitle}`}
            className="ml-auto flex h-7 items-center rounded-cell px-1.5 text-ink-faint transition-colors duration-150 hover:text-beam"
          >
            <ArrowUpRight className="h-4 w-4 flex-none" strokeWidth={1.8} aria-hidden />
          </button>
        </div>
      ) : null}

      <Drawer open={conversando}>
        {tocada && quem ? (
          <div className="px-4 pb-4">
            <Conversation take={quem} ruled={false} />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function FeedRatedRun({
  events,
  takes,
  onOpenShow,
}: {
  events: ShowFeedEvent[];
  takes: ShowTake[] | null;
  onOpenShow: (showId: number) => void;
}) {
  const emOrdem = inOrder(events);
  const primeiro = emOrdem[0];
  const ultimo = emOrdem[emOrdem.length - 1];
  const hora = clockOf(events[0].at);

  return (
    <div className="plate mb-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-4">
        <PersonReel person={events[0].actor} size="sm" />
        <PersonName
          person={events[0].actor}
          className="font-display text-[13px] uppercase tracking-[0.1em] text-ink"
        />
        <span className="text-[12.5px] text-ink-dim">
          avaliou {plural(events.length, 'temporada', 'temporadas')}
        </span>
        {hora ? <span className="q ml-auto text-[11px] text-ink-faint">{hora}</span> : null}
      </div>

      <button
        type="button"
        onClick={() => onOpenShow(events[0].showId)}
        aria-label={`Abrir ${events[0].showTitle}`}
        className="group flex w-full gap-4 px-4 pb-3 pt-2.5 text-left transition-colors duration-150 hover:bg-house-seat"
      >
        <Poster src={events[0].showPoster} className="aspect-[2/3] w-[54px] flex-none sm:w-[62px]" />
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[22px] leading-none tracking-[0.02em] text-beam transition-colors group-hover:text-beam-hot">
            {events[0].showTitle}
          </span>
          {}
          <span className="q mt-1.5 block text-[12px] text-ink-dim">
            do {epTag(primeiro.season, primeiro.episode)} ao {epTag(ultimo.season, ultimo.episode)}
          </span>
        </span>
        <ArrowUpRight
          aria-hidden
          className="mt-1 h-4 w-4 flex-none text-ink-faint transition-colors group-hover:text-beam"
          strokeWidth={1.8}
        />
      </button>

      <ul>
        {emOrdem.map(e => (
          <RunEpisode key={e.id} e={e} takes={takes} />
        ))}
      </ul>
    </div>
  );
}

function RunEpisode({ e, takes }: { e: ShowFeedEvent; takes: ShowTake[] | null }) {
  const world = useWorld();
  const take = takes?.find(t => t.id === e.takeId) ?? null;
  const quem = take
    ? { id: take.id, reviewerId: take.reviewerId, reviewerName: take.reviewerName ?? 'alguém' }
    : null;
  const conversa = world.comments.filter(c => c.takeId === e.takeId).length;

  const [aberta, setAberta] = useState(false);
  const [desdobrada, setDesdobrada] = useState(false);
  const [conversando, setConversando] = useState(false);
  const [tocada, setTocada] = useState(false);

  const escrito = take?.comment?.replace(/\s+/g, ' ').trim() ?? '';
  const cortado = !!escrito && escrito !== (e.excerpt ?? '');

  return (
    <li className="border-t border-white/[0.06]">
      <button
        type="button"
        disabled={!take}
        onClick={() => {
          setAberta(v => !v);
          setDesdobrada(true);
        }}
        aria-expanded={take ? aberta : undefined}
        aria-label={`${aberta ? 'Fechar' : 'Abrir'} a ficha de ${epTag(e.season, e.episode)}`}
        className="group flex w-full items-baseline gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-house-seat disabled:hover:bg-transparent"
      >
        <span className="q w-[52px] flex-none text-[12px] text-ink-dim">
          {epTag(e.season, e.episode)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-ink transition-colors group-hover:text-beam">
            {e.episodeTitle || '—'}
          </span>
          {e.excerpt ? (
            <span className="mt-1 block break-words text-[12.5px] italic leading-relaxed text-ink-dim">
              “{e.excerpt}”
            </span>
          ) : null}
        </span>
        <span className="flex flex-none items-center gap-2">
          <Strip value={e.final ?? 0} cells={10} className="hidden h-[5px] w-[70px] sm:block" />
          <span className="q text-[13px] font-medium text-beam">{fmt(e.final ?? 0)}</span>
        </span>
        {take ? (
          <ChevronDown
            aria-hidden
            className={cn(
              'h-4 w-4 flex-none self-center text-ink-faint transition-transform duration-200 group-hover:text-ink-dim',
              aberta && 'rotate-180'
            )}
            strokeWidth={1.7}
          />
        ) : null}
      </button>

      <Drawer open={aberta}>
        {desdobrada && take ? (
          <div className="px-4 pb-4">
            <Breakdown r={take} comment={cortado ? take.comment ?? undefined : undefined} />
          </div>
        ) : null}
      </Drawer>

      {quem ? (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2.5">
          <TakeVotes take={quem} />
          <button
            type="button"
            aria-expanded={conversando}
            aria-label={
              `${conversando ? 'Fechar' : 'Abrir'} a conversa de ${epTag(e.season, e.episode)}` +
              (conversa ? `, ${plural(conversa, 'resposta', 'respostas')}` : '')
            }
            title={conversando ? 'Fechar a conversa' : 'Comentar esta ficha'}
            onClick={() => {
              setConversando(v => !v);
              setTocada(true);
            }}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-cell px-2.5 ring-1 transition-colors duration-150',
              conversando
                ? 'text-dye-brass ring-dye-brass/60 shadow-[inset_0_0_14px_rgba(217,164,65,0.18)]'
                : 'text-ink-dim ring-house-rail hover:text-beam hover:ring-white/25'
            )}
          >
            <MessageSquare className="h-3.5 w-3.5 flex-none" strokeWidth={1.9} aria-hidden />
            {conversa ? (
              <span className="q text-[10.5px] leading-none opacity-80">{conversa}</span>
            ) : null}
          </button>
        </div>
      ) : null}

      <Drawer open={conversando}>
        {tocada && quem ? (
          <div className="px-4 pb-4">
            <Conversation take={quem} ruled={false} />
          </div>
        ) : null}
      </Drawer>
    </li>
  );
}

function FeedSeen({
  e,
  takes,
  onOpenShow,
}: {
  e: ShowFeedEvent;
  takes: ShowTake[] | null;
  onOpenShow: (showId: number) => void;
}) {
  const world = useWorld();
  const hora = clockOf(e.at);
  const varios = (e.count ?? 1) > 1;

  const take = takes?.find(t => t.id === e.takeId) ?? null;
  const quem = take
    ? { id: take.id, reviewerId: take.reviewerId, reviewerName: take.reviewerName ?? 'alguém' }
    : null;
  const conversa = world.comments.filter(c => c.takeId === e.takeId).length;

  const [conversando, setConversando] = useState(false);
  const [tocada, setTocada] = useState(false);

  return (
    <div className="plate mb-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-4">
        <PersonReel person={e.actor} size="sm" />
        <PersonName
          person={e.actor}
          className="font-display text-[13px] uppercase tracking-[0.1em] text-ink"
        />
        <span className="text-[12.5px] text-ink-dim">
          {varios ? `viu ${plural(e.count ?? 0, 'episódio', 'episódios')}` : 'viu'}
        </span>
        {hora ? <span className="q ml-auto text-[10.5px] text-ink-faint">{hora}</span> : null}
      </div>

      <div className="px-4 pb-4 pt-2.5">
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => onOpenShow(e.showId)}
            aria-label={`Abrir ${e.showTitle}`}
            className="group/cartaz min-h-[81px] flex-none sm:min-h-[93px]"
          >
            <Poster
              src={e.showPoster}
              className="h-full w-[54px] transition-opacity duration-150 group-hover/cartaz:opacity-80 sm:w-[62px]"
            />
          </button>

          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => onOpenShow(e.showId)}
              className="block text-left font-display text-[22px] leading-none tracking-[0.02em] text-beam transition-colors duration-150 hover:text-beam-hot"
            >
              {e.showTitle}
            </button>

            {}
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-dim">
              <Check className="h-3.5 w-3.5 flex-none text-ink-faint" strokeWidth={2} aria-hidden />
              {varios ? (
                <span className="q text-[12.5px]">
                  {e.from && e.to
                    ? `${epTag(e.from.season, e.from.episode)} a ${epTag(e.to.season, e.to.episode)}`
                    : plural(e.count ?? 0, 'episódio', 'episódios')}
                </span>
              ) : (
                <>
                  <span className="q text-[12.5px] text-ink-faint">
                    {epTag(e.to?.season, e.to?.episode)}
                  </span>
                  {e.to?.title ? <span className="truncate">{e.to.title}</span> : null}
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {quem ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-4 py-2.5">
          <TakeVotes take={quem} labelled />

          <button
            type="button"
            aria-expanded={conversando}
            aria-label={
              `${conversando ? 'Fechar' : 'Abrir'} a conversa sobre o que ${e.actor.name} viu` +
              (conversa ? `, ${plural(conversa, 'resposta', 'respostas')}` : '')
            }
            title={conversando ? 'Fechar a conversa' : 'Comentar'}
            onClick={() => {
              setConversando(v => !v);
              setTocada(true);
            }}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-cell px-2.5 ring-1 transition-colors duration-150',
              conversando
                ? 'text-dye-brass ring-dye-brass/60 shadow-[inset_0_0_14px_rgba(217,164,65,0.18)]'
                : 'text-ink-dim ring-house-rail hover:text-beam hover:ring-white/25'
            )}
          >
            <MessageSquare className="h-3.5 w-3.5 flex-none" strokeWidth={1.9} aria-hidden />
            <span className="hidden font-display text-[11px] uppercase leading-none tracking-[0.12em] sm:inline">
              {conversando ? 'Fechar' : 'Comentar'}
            </span>
            {conversa ? (
              <span className="q text-[10.5px] leading-none opacity-80">{conversa}</span>
            ) : null}
          </button>

          <button
            type="button"
            onClick={() => onOpenShow(e.showId)}
            title="Abrir a série, na lista de episódios"
            aria-label={`Abrir ${e.showTitle}`}
            className="ml-auto flex h-7 items-center rounded-cell px-1.5 text-ink-faint transition-colors duration-150 hover:text-beam"
          >
            <ArrowUpRight className="h-4 w-4 flex-none" strokeWidth={1.8} aria-hidden />
          </button>
        </div>
      ) : null}

      <Drawer open={conversando}>
        {tocada && quem ? (
          <div className="px-4 pb-4">
            <Conversation take={quem} ruled={false} />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function FeedAside({
  e,
  takes,
  onAimComment,
}: {
  e: ShowFeedEvent;
  takes: ShowTake[] | null;
  onAimComment: (commentId: string) => void;
}) {
  const world = useWorld();
  const hora = clockOf(e.at);
  const take = takes?.find(t => t.id === e.takeId) ?? null;
  const [aberta, setAberta] = useState(false);
  const [desdobrada, setDesdobrada] = useState(false);

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => {
          if (!take) return;
          const proximo = !aberta;
          setAberta(proximo);
          setDesdobrada(true);
          if (proximo && e.commentId) onAimComment(e.commentId);
        }}
        aria-expanded={take ? aberta : undefined}
        className="group flex w-full items-start gap-3 rounded-cell px-3 py-2.5 text-left transition-colors duration-150 hover:bg-beam/[0.05]"
      >
        <MessageSquare
          className="mt-[3px] h-3.5 w-3.5 flex-none text-ink-faint"
          strokeWidth={1.9}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] leading-snug text-ink-dim">
            <span className="font-display uppercase tracking-[0.08em] text-ink">{e.actor.name}</span>{' '}
            {e.parentId ? 'respondeu um comentário na ficha de ' : 'comentou a ficha de '}
            {e.owner?.id === world.me.id ? (
              <span className="text-dye-brass">você</span>
            ) : (
              <span className="text-ink">{e.owner?.name ?? 'alguém'}</span>
            )}{' '}
            em{' '}
            <span className="text-ink transition-colors group-hover:text-beam">
              {e.showTitle} {epTag(e.season, e.episode)}
            </span>
          </span>
          {e.excerpt ? (
            <span className="mt-0.5 block break-words text-[12px] italic leading-snug text-ink-faint">
              “{e.excerpt}”
            </span>
          ) : null}
        </span>
        {hora ? <span className="q mt-0.5 flex-none text-[10.5px] text-ink-faint">{hora}</span> : null}
        {take ? (
          <ChevronDown
            aria-hidden
            className={cn(
              'mt-[1px] h-3.5 w-3.5 flex-none text-ink-faint transition-transform duration-200',
              aberta && 'rotate-180'
            )}
            strokeWidth={1.7}
          />
        ) : null}
      </button>

      {}
      <Drawer open={aberta}>
        {desdobrada && take ? (
          <div className="mb-2 ml-6 mr-1 mt-1">
            <TakeCard take={take} />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

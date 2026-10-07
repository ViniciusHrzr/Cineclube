import { Bookmark, Layers, Trash2 } from 'lucide-react';
import { IconKey, Key, Poster, Reel, Strip } from '@/components/bits';
import { OnCell } from '@/components/film';
import { PersonName, PersonReel } from '@/components/person';
import { Conversation, TakeVotes } from '@/components/social';
import { Breakdown } from '@/components/take';
import { CardBody, CardContainer, CardItem } from '@/components/ui/3d-card-effect';
import {
  type EpisodeRef,
  fmt,
  initialsOf,
  reelColor,
  type Reviewer,
  type SeriesItem,
  type ShowTake,
} from '@/lib/api';
import { whenOf } from '@/lib/utils';

export function SeriesCell({
  show,
  inQueue,
  seen,
  average,
  upNext,
  upcoming,
  caughtUp,
  wants,
  onOpen,
  onQueue,
  onRemove,
}: {
  show: SeriesItem;
  inQueue?: boolean;
  seen?: string | null;
  average?: number | null;
  upNext?: EpisodeRef | null;
  upcoming?: EpisodeRef | null;
  caughtUp?: boolean;
  wants?: Reviewer[];
  onOpen: () => void;
  onQueue?: () => void;
  onRemove?: () => void;
}) {
  return (
    <CardContainer containerClassName="block h-full w-full" className="h-full w-full">
      <CardBody className="flex h-full w-full flex-col">
        <CardItem translateZ={60} className="w-full">
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Ver as temporadas de ${show.title}`}
            className="group/cell block w-full text-left"
          >
            {}
            <span className="relative block overflow-hidden rounded-cell">
              <Poster src={show.poster} alt={`Pôster de ${show.title}`} className="aspect-[2/3] w-full" />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 flex translate-y-full items-center justify-center gap-1.5 bg-beam px-2 py-2 font-display text-[11px] uppercase tracking-[0.14em] text-house-deep transition-transform duration-200 ease-beam group-hover/cell:translate-y-0 group-focus-visible/cell:translate-y-0 motion-reduce:transition-none">
                <Layers className="h-3.5 w-3.5" strokeWidth={2} />
                Temporadas
              </span>
              {}
              {wants?.length ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute bottom-1.5 left-1.5 flex items-center gap-[3px] rounded-cell bg-house-deep/90 p-[3px] ring-1 ring-white/10"
                >
                  {wants.slice(0, ROSTOS).map(p => (
                    <Reel key={p.id} color={reelColor(p.dot, p.id)} src={p.avatar ?? null} size="sm">
                      {initialsOf(p.name)}
                    </Reel>
                  ))}
                  {wants.length > ROSTOS ? (
                    <span className="q px-[3px] text-[10px] leading-none text-ink-dim">
                      +{wants.length - ROSTOS}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </span>
          </button>
        </CardItem>

        <CardItem translateZ={30} className="mt-3 w-full">
          <h3 className="text-[14px] font-semibold leading-tight text-ink">{show.title}</h3>
          {show.original ? (
            <p className="q mt-0.5 truncate text-[11px] text-ink-faint" title={show.original}>
              {show.original}
            </p>
          ) : null}
          <p className="q mt-0.5 text-[11.5px] text-ink-dim">
            {show.year ?? '—'} · {show.genre}
          </p>
          {}
          <OnCell watch={show.watch} title={show.title} />
          {}
          {seen ? (
            <div className="mt-2 flex items-center gap-2">
              {average != null ? (
                <>
                  <Strip value={average} cells={10} className="h-[5px] flex-1" />
                  <span className="q text-[11.5px] text-beam">{fmt(average)}</span>
                </>
              ) : (
                <span className="q flex-1 text-[11.5px] text-ink-dim">sem nota ainda</span>
              )}
            </div>
          ) : null}
          {seen ? <p className="q mt-1 text-[11px] text-ink-faint">{seen}</p> : null}
        </CardItem>

        {}
        <CardItem translateZ={18} className="mt-auto flex w-full items-center gap-2 pt-3">
          <Key tone="flush" className="flex-1 px-2" onClick={onOpen}>
            Episódios
          </Key>
          {onQueue ? (
            <IconKey
              active={inQueue}
              aria-pressed={inQueue}
              aria-label={inQueue ? `${show.title} já está na lista` : `Acompanhar ${show.title}`}
              onClick={onQueue}
            >
              <Bookmark
                className="h-4 w-4"
                fill={inQueue ? 'currentColor' : 'none'}
                strokeWidth={1.7}
              />
            </IconKey>
          ) : null}
          {onRemove ? (
            <IconKey aria-label={`Tirar ${show.title} da lista`} onClick={onRemove}>
              <Trash2 className="h-4 w-4" strokeWidth={1.7} />
            </IconKey>
          ) : null}
        </CardItem>

        {}
        <CardItem translateZ={12} className="w-full">
          <UpNext upNext={upNext} upcoming={upcoming} caughtUp={caughtUp} />
        </CardItem>
      </CardBody>
    </CardContainer>
  );
}

function UpNext({
  upNext,
  upcoming,
  caughtUp,
}: {
  upNext?: EpisodeRef | null;
  upcoming?: EpisodeRef | null;
  caughtUp?: boolean;
}) {
  if (upNext) {
    return (
      <Strap>
        <span className="legend text-[9px] text-ink-faint">a seguir</span>{' '}
        <span className="q text-[12.5px] font-medium text-dye-brass">{tag(upNext)}</span>
        {upNext.title ? <span className="text-[12px] text-ink"> {upNext.title}</span> : null}
      </Strap>
    );
  }

  if (upcoming) {
    return (
      <Strap>
        <span className="legend text-[9px] text-ink-faint">estreia</span>{' '}
        <span className="q text-[12.5px] font-medium text-beam">{tag(upcoming)}</span>{' '}
        <span className="q text-[12px] text-ink-dim">
          {upcoming.airDate ? soonBR(upcoming.airDate) : 'sem data'}
        </span>
      </Strap>
    );
  }

  if (caughtUp) {
    return (
      <Strap>
        <span className="q text-[12px] text-ink-faint">você viu tudo</span>
      </Strap>
    );
  }

  return null;
}

function Strap({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 line-clamp-2 min-h-[44px] break-words border-t border-white/[0.07] pt-2.5 text-[12px] leading-snug">
      {children}
    </p>
  );
}

const tag = (ep: EpisodeRef) => `T${ep.season}E${String(ep.episode).padStart(2, '0')}`;

function soonBR(iso: string) {
  const at = new Date(iso + 'T12:00:00');
  if (Number.isNaN(at.getTime())) return iso;
  const hoje = new Date();
  const dias = Math.round((at.getTime() - new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 12).getTime()) / 86400000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'amanhã';
  if (dias <= 14) return `em ${dias} dias`;
  return at.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: at.getFullYear() === hoje.getFullYear() ? undefined : 'numeric',
  });
}

export const ROSTOS = 3;

export function TakeCard({ take }: { take: ShowTake }) {
  const quem = { id: take.id, reviewerId: take.reviewerId, reviewerName: take.reviewerName ?? 'alguém' };
  return (
    <div className="rounded-cell bg-house-seat/55 p-3 ring-1 ring-inset ring-white/[0.06]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PersonReel
          person={{ id: take.reviewerId, name: take.reviewerName ?? 'alguém', dot: take.reviewerDot }}
          size="sm"
        />
        <PersonName
          person={{ id: take.reviewerId, name: take.reviewerName ?? 'alguém', dot: take.reviewerDot }}
          className="font-display text-[12.5px] uppercase tracking-[0.1em] text-ink"
        />
        <span className="q text-[10.5px] text-ink-faint" title={take.ratedAt ?? take.watchedAt}>
          {whenOf(take.ratedAt ?? take.watchedAt)}
        </span>
        {}
        {take.final != null ? (
          <span className="ml-auto flex items-center gap-2.5">
            <Strip value={take.final} cells={10} className="hidden h-[5px] w-[80px] flex-none sm:block" />
            <span className="q text-[16px] font-medium leading-none text-beam">{fmt(take.final)}</span>
          </span>
        ) : null}
        <TakeVotes take={quem} />
      </div>

      {}
      <div className="mt-3">
        <Breakdown r={take} comment={take.comment ?? undefined} />
      </div>

      <Conversation take={quem} />
    </div>
  );
}

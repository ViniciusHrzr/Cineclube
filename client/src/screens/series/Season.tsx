import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import { Chip, IconKey, Key } from '@/components/bits';
import { Channels, Gauge } from '@/components/channels';
import { type Criterion, fmt, type SeasonPatch, shows as showsApi, type ShowTake } from '@/lib/api';

export function SeasonSheet({
  showId,
  showTitle,
  showPoster,
  genre,
  season,
  name,
  overview,
  takes,
  meId,
  criteria,
  onClose,
  onSaved,
  fault,
}: {
  showId: number;
  showTitle: string;
  showPoster: string | null;
  genre: string;
  season: number;
  name: string | null;
  overview: string | null;
  takes: ShowTake[];
  meId: string;
  criteria: Criterion[] | null;
  onClose: () => void;
  onSaved: () => void;
  fault: (msg: string) => void;
}) {
  const mine = takes.find(t => t.reviewerId === meId) ?? null;
  const ref = useRef<HTMLDialogElement>(null);
  const [modo, setModo] = useState<'rapida' | 'criteriosa'>(mine?.scores ? 'criteriosa' : 'rapida');
  const [quick, setQuick] = useState<number>(mine?.quick ?? 7);
  const [scores, setScores] = useState<Record<string, number>>(mine?.scores ?? {});
  const [comment, setComment] = useState(mine?.comment ?? '');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener('cancel', cancel);
    return () => el.removeEventListener('cancel', cancel);
  }, [onClose]);

  const gravar = useCallback(
    async (patch: Partial<SeasonPatch>) => {
      if (salvando) return;
      setSalvando(true);
      try {
        await showsApi.rate(showId, season, { showTitle, showPoster, genre, ...patch });
        onSaved();
      } catch (e) {
        fault('Não foi possível gravar: ' + (e as Error).message);
      } finally {
        setSalvando(false);
      }
    },
    [salvando, showId, season, showTitle, showPoster, genre, onSaved, fault]
  );

  const apagar = useCallback(async () => {
    if (salvando) return;
    if (
      !confirm(
        `Apagar a sua nota da temporada ${season}? Os episódios marcados continuam vistos.`
      )
    ) {
      return;
    }
    setSalvando(true);
    try {
      await showsApi.unrate(showId, season);
      onSaved();
      onClose();
    } catch (e) {
      fault('Não foi possível apagar: ' + (e as Error).message);
    } finally {
      setSalvando(false);
    }
  }, [salvando, showId, season, onSaved, onClose, fault]);

  const media = criteria?.length
    ? criteria.reduce((s, c) => s + (scores[c.key] ?? 5), 0) / criteria.length
    : 0;

  const titulo = `Temporada ${season}`;

  return (
    <dialog
      ref={ref}
      aria-label={`${showTitle} — ${titulo}`}
      onClick={e => {
        if (e.target === ref.current) onClose();
      }}
      className="w-full max-w-[760px] max-h-[calc(100dvh/var(--ui-zoom))] overflow-hidden bg-transparent p-2 text-ink backdrop:bg-house-deep/95 open:animate-beam-in sm:p-4"
    >
      <div className="plate relative max-h-[calc(100dvh/var(--ui-zoom)-1rem)] overflow-y-auto overscroll-contain p-5 sm:max-h-[calc(100dvh/var(--ui-zoom)-2rem)] sm:p-6">
        <IconKey aria-label="Fechar" onClick={onClose} className="absolute right-3 top-3 z-10">
          <X className="h-4 w-4" strokeWidth={1.8} />
        </IconKey>

        <p className="legend">{showTitle}</p>
        <h2 className="mt-2 pr-10 font-display text-[24px] leading-none tracking-[0.03em] text-beam sm:text-[28px]">
          {titulo}
        </h2>
        {name && name !== titulo ? (
          <p className="q mt-2 text-[12.5px] text-beam-dim">{name}</p>
        ) : null}

        {overview ? (
          <p className="mt-3 max-w-[66ch] text-[13px] leading-relaxed text-ink-dim">{overview}</p>
        ) : null}

        <div className="mt-6 border-t border-white/[0.07] pt-5">
          <div className="flex flex-wrap items-center gap-2">
            {}
            <Chip size="sm" on={modo === 'rapida'} onClick={() => setModo('rapida')}>
              Nota rápida
            </Chip>
            <Chip size="sm" on={modo === 'criteriosa'} onClick={() => setModo('criteriosa')}>
              Avaliação criteriosa
            </Chip>
          </div>

          {modo === 'rapida' ? (
            <div className="mt-5">
              <div className="flex items-baseline gap-3">
                <span className="q text-[34px] font-medium leading-none text-beam">{fmt(quick)}</span>
                <span className="q text-[12px] text-ink-faint">/10</span>
              </div>
              {}
              <Gauge value={quick} onChange={setQuick} label="Nota da temporada" className="mt-4" />
              {mine?.scores ? (
                <p className="mt-3 text-[12.5px] leading-relaxed text-dye-brass">
                  Você já avaliou esta temporada pelos nove critérios. Gravar uma nota rápida
                  substitui aquela ficha.
                </p>
              ) : null}
              <Key
                tone="commit"
                className="mt-5"
                disabled={salvando}
                onClick={() => void gravar({ quick, comment: comment.trim() || null })}
              >
                <Check className="h-4 w-4" strokeWidth={2} />
                {salvando ? 'Gravando…' : 'Gravar a nota'}
              </Key>
            </div>
          ) : !criteria ? (
            <p className="mt-5 text-[13px] text-ink-dim">Carregando os critérios…</p>
          ) : (
            <div className="mt-5">
              {}
              <Channels
                criteria={criteria}
                scores={scores}
                still
                onChange={(key, value) => setScores(s => ({ ...s, [key]: value }))}
              />
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <span className="q text-[28px] font-medium leading-none text-beam">{fmt(media)}</span>
                <span className="q text-[11px] text-ink-faint">
                  média dos {criteria.length} critérios
                </span>
              </div>
              <Key
                tone="commit"
                className="mt-4"
                disabled={salvando}
                onClick={() => {
                  const cheio: Record<string, number> = {};
                  for (const c of criteria) cheio[c.key] = scores[c.key] ?? 5;
                  void gravar({ scores: cheio, comment: comment.trim() || null });
                }}
              >
                <Check className="h-4 w-4" strokeWidth={2} />
                {salvando ? 'Gravando…' : 'Gravar a avaliação criteriosa'}
              </Key>
            </div>
          )}

          <label className="mt-5 block">
            <span className="legend mb-1.5 block">O que você achou</span>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Opcional. Fica junto da nota."
              className="w-full resize-y rounded-cell bg-house-deep px-3 py-2.5 text-[14px] text-ink caret-dye-red ring-1 ring-house-rail transition-shadow placeholder:text-ink-dim focus-visible:outline-none focus-visible:ring-dye-brass"
            />
          </label>

          {mine ? (
            <Key tone="ghost" className="mt-5" disabled={salvando} onClick={() => void apagar()}>
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              Apagar a minha nota
            </Key>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}

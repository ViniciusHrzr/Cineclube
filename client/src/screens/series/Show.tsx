import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, Plus, Star } from 'lucide-react';
import {
  Chip,
  Drawer,
  Fault,
  Key,
  Poster,
  Reel,
  Skeleton,
  Strip,
  TrailerKey,
} from '@/components/bits';
import { WatchOn } from '@/components/film';
import { PersonName, PersonReel } from '@/components/person';
import {
  type Criterion,
  type Episode,
  fmt,
  initialsOf,
  reelColor,
  type SeasonDetail,
  seriesApi,
  type ShowDetail,
  shows as showsApi,
  type ShowTake,
} from '@/lib/api';
import { cn, plural, whenOf } from '@/lib/utils';
import { useWorld } from '@/lib/world';
import { SeasonSheet } from './Season';
import { ROSTOS } from './shared';

export function ShowScreen({
  showId,
  takes,
  criteria,
  meId,
  inQueue,
  onQueue,
  onBack,
  onSaved,
  fault,
}: {
  showId: number;
  takes: ShowTake[];
  criteria: Record<string, Criterion[]> | null;
  meId: string;
  inQueue: boolean;
  onQueue: (s: { id: number; title: string; year: number | null; genre: string; poster: string | null }) => void;
  onBack: () => void;
  onSaved: () => void;
  fault: (msg: string) => void;
}) {
  const [show, setShow] = useState<ShowDetail | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [temporada, setTemporada] = useState<SeasonDetail | null>(null);
  const [avaliando, setAvaliando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setShow(null);
    setErro(null);
    void seriesApi
      .show(showId)
      .then(r => {
        if (!vivo) return;
        setShow(r.show);
        setSeason(r.show.seasons?.[0]?.season ?? null);
      })
      .catch(e => vivo && setErro((e as Error).message));
    return () => {
      vivo = false;
    };
  }, [showId]);

  useEffect(() => {
    if (season == null) return;
    let vivo = true;
    setTemporada(null);
    void seriesApi
      .season(showId, season)
      .then(r => vivo && setTemporada(r.season))
      .catch(e => vivo && fault('Não foi possível carregar a temporada: ' + (e as Error).message));
    return () => {
      vivo = false;
    };
  }, [showId, season, fault]);

  const meusVistos = useMemo(
    () =>
      new Set(
        takes
          .filter(t => t.kind === 'episode' && t.reviewerId === meId)
          .map(t => `${t.season}x${t.episode}`)
      ),
    [takes, meId]
  );

  const porEpisodio = useMemo(() => {
    const mapa = new Map<string, ShowTake[]>();
    for (const t of takes) {
      if (t.kind !== 'episode') continue;
      const chave = `${t.season}x${t.episode}`;
      const lista = mapa.get(chave);
      if (lista) lista.push(t);
      else mapa.set(chave, [t]);
    }
    return mapa;
  }, [takes]);

  const daTemporada = useMemo(
    () => takes.filter(t => t.kind === 'season' && t.season === season),
    [takes, season]
  );

  if (erro) {
    return (
      <section>
        <Key tone="flush" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
          Voltar
        </Key>
        <div className="mt-5 max-w-[60ch]">
          <Fault detail={erro}>Não foi possível abrir esta série.</Fault>
        </div>
      </section>
    );
  }

  if (!show) {
    return (
      <section>
        <div className="flex gap-5">
          <Skeleton className="aspect-[2/3] w-[120px] flex-none" />
          <div className="flex-1 space-y-3 pt-2">
            <Skeleton className="h-6 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-2.5 w-full" />
            <Skeleton className="h-2.5 w-5/6" />
          </div>
        </div>
      </section>
    );
  }

  const genero = show.genre;

  return (
    <section>
      <Key tone="flush" onClick={onBack}>
        <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
        Voltar
      </Key>

      <header className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-start">
        <Poster
          src={show.poster}
          alt={`Pôster de ${show.title}`}
          className="aspect-[2/3] w-[120px] flex-none sm:w-[150px]"
        />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[30px] leading-none tracking-[0.03em] text-beam sm:text-[38px]">
            {show.title}
          </h1>
          {show.original ? (
            <p className="q mt-1.5 text-[12.5px] text-ink-dim">{show.original}</p>
          ) : null}
          <p className="q mt-2 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-dim">
            <span>{show.year ?? '—'}</span>
            <span aria-hidden>·</span>
            <span>{show.genre}</span>
            {show.totalEpisodes ? (
              <>
                <span aria-hidden>·</span>
                <span>{plural(show.totalEpisodes, 'episódio', 'episódios')}</span>
              </>
            ) : null}
            {}
            {show.inProduction ? (
              <>
                <span aria-hidden>·</span>
                <span className="text-dye-brass">em exibição</span>
              </>
            ) : null}
          </p>
          {show.creators.length ? (
            <p className="q mt-1.5 text-[12px] text-ink-faint">
              criada por {show.creators.join(' · ')}
            </p>
          ) : null}

          {show.overview ? (
            <p className="mt-4 max-w-[66ch] text-[13px] leading-relaxed text-ink-dim">
              {show.overview}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Key
              tone={inQueue ? 'ghost' : 'flush'}
              disabled={inQueue}
              onClick={() =>
                onQueue({
                  id: show.id,
                  title: show.title,
                  year: show.year,
                  genre: show.genre,
                  poster: show.poster,
                })
              }
            >
              {inQueue ? <Check className="h-3.5 w-3.5" strokeWidth={2.2} /> : <Plus className="h-3.5 w-3.5" strokeWidth={2} />}
              {}
              {inQueue ? 'Você acompanha' : 'Acompanhar'}
            </Key>
            {show.trailerUrl ? (
              <TrailerKey
                url={show.trailerUrl}
                title={show.title}
                className="rounded-cell px-2 py-1.5 tracking-[0.12em]"
              >
                Trailer
              </TrailerKey>
            ) : null}
          </div>

          {}
          <WatchOn watch={show.watch} title={show.title} />

          <ShowRoster takes={takes} />
        </div>
      </header>

      {}
      {show.seasons === null ? (
        <p className="mt-8 text-[13px] leading-relaxed text-ink-dim">
          O TMDB não respondeu agora, então as temporadas não puderam ser lidas. O que o clube
          já gravou continua no acervo.
        </p>
      ) : show.seasons.length ? (
        <>
          <div className="mt-8 flex flex-wrap items-center gap-2">
            {show.seasons.map(s => (
              <Chip key={s.season} size="sm" on={s.season === season} onClick={() => setSeason(s.season)}>
                {`T${s.season}`}
              </Chip>
            ))}
          </div>

          {}
          {season != null ? (
            <SeasonPanel
              season={season}
              name={temporada?.name ?? null}
              takes={daTemporada}
              meId={meId}
              onRate={() => setAvaliando(true)}
            />
          ) : null}

          {!temporada ? (
            <div className="mt-6 flex flex-col gap-2">
              {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[76px] w-full" />)}
            </div>
          ) : (
            <>
              {}
              <div className="mt-6 flex justify-end pr-2">
                <MarkSeason
                  episodes={temporada.episodes}
                  mine={meusVistos}
                  showId={show.id}
                  showTitle={show.title}
                  showPoster={show.poster}
                  genre={genero}
                  onSaved={onSaved}
                  fault={fault}
                />
              </div>

              <ul className="mt-2 flex flex-col">
                {temporada.episodes.map(ep => (
                  <EpisodeRow
                    key={`${ep.season}x${ep.episode}`}
                    ep={ep}
                    takes={porEpisodio.get(`${ep.season}x${ep.episode}`) ?? []}
                    meId={meId}
                    showId={show.id}
                    showTitle={show.title}
                    showPoster={show.poster}
                    genre={genero}
                    onSaved={onSaved}
                    fault={fault}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <p className="mt-8 text-[13px] text-ink-dim">Esta série não tem temporadas listadas no TMDB.</p>
      )}

      {avaliando && season != null ? (
        <SeasonSheet
          key={season}
          showId={show.id}
          showTitle={show.title}
          showPoster={show.poster}
          genre={genero}
          season={season}
          name={temporada?.name ?? null}
          overview={temporada?.overview ?? null}
          takes={daTemporada}
          meId={meId}
          criteria={criteria?.[genero] ?? null}
          onClose={() => setAvaliando(false)}
          onSaved={onSaved}
          fault={fault}
        />
      ) : null}
    </section>
  );
}

function ShowRoster({ takes }: { takes: ShowTake[] }) {
  const gente = useMemo(() => {
    const mapa = new Map<
      string,
      { id: string; nome: string; dot: string | null; vistos: number; notas: number }
    >();
    for (const t of takes) {
      const achado = mapa.get(t.reviewerId) ?? {
        id: t.reviewerId,
        nome: t.reviewerName ?? 'alguém',
        dot: t.reviewerDot ?? null,
        vistos: 0,
        notas: 0,
      };
      if (t.kind === 'season') {
        if (t.final != null) achado.notas += 1;
      } else achado.vistos += 1;
      mapa.set(t.reviewerId, achado);
    }
    return [...mapa.values()].sort((a, b) => b.vistos - a.vistos || b.notas - a.notas);
  }, [takes]);

  if (!gente.length) return null;

  return (
    <div className="mt-5">
      <p className="legend mb-2.5">{plural(gente.length, 'pessoa aqui', 'pessoas aqui')}</p>
      <ul className="flex flex-wrap gap-2">
        {gente.map(p => (
          <li
            key={p.id}
            className="flex items-center gap-2 rounded-cell bg-house-seat/55 py-1 pl-1 pr-2.5 ring-1 ring-inset ring-white/[0.06]"
          >
            <PersonReel person={{ id: p.id, name: p.nome, dot: p.dot }} size="sm" />
            <PersonName
              person={{ id: p.id, name: p.nome, dot: p.dot }}
              className="font-display text-[12px] uppercase tracking-[0.1em] text-ink"
            />
            <span className="q text-[11.5px] text-ink-dim">
              {p.vistos ? `${p.vistos} ep` : null}
              {p.vistos && p.notas ? ' · ' : null}
              {p.notas ? plural(p.notas, 'nota', 'notas') : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const LANES_MARCAR = 4;

function MarkSeason({
  episodes,
  mine,
  showId,
  showTitle,
  showPoster,
  genre,
  onSaved,
  fault,
}: {
  episodes: Episode[];
  mine: Set<string>;
  showId: number;
  showTitle: string;
  showPoster: string | null;
  genre: string;
  onSaved: () => void;
  fault: (msg: string) => void;
}) {
  const [marcando, setMarcando] = useState(false);

  const hoje = new Date().toISOString().slice(0, 10);
  const faltando = episodes.filter(
    e => !mine.has(`${e.season}x${e.episode}`) && (!e.airDate || e.airDate <= hoje)
  );

  if (!faltando.length) return null;

  const marcar = async () => {
    if (marcando) return;
    if (
      !confirm(
        `Marcar ${plural(faltando.length, 'episódio', 'episódios')} desta temporada como assistido?`
      )
    ) {
      return;
    }
    setMarcando(true);
    const fila = [...faltando];
    let falhou = 0;
    try {
      await Promise.all(
        Array.from({ length: Math.min(LANES_MARCAR, fila.length) }, async () => {
          while (fila.length) {
            const ep = fila.shift()!;
            try {
              await showsApi.mark(showId, ep.season, ep.episode, {
                showTitle,
                showPoster,
                episodeTitle: ep.title,
                genre,
              });
            } catch {
              falhou += 1;
            }
          }
        })
      );
    } finally {
      setMarcando(false);
      onSaved();
      if (falhou) fault(`${plural(falhou, 'episódio ficou', 'episódios ficaram')} sem marcar.`);
    }
  };

  return (
    <Key tone="flush" disabled={marcando} onClick={() => void marcar()} className="px-3 py-1.5">
      <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
      {marcando ? 'Marcando…' : `Marcar ${faltando.length}`}
    </Key>
  );
}

function SeasonPanel({
  season,
  name,
  takes,
  meId,
  onRate,
}: {
  season: number;
  name: string | null;
  takes: ShowTake[];
  meId: string;
  onRate: () => void;
}) {
  const minha = takes.find(t => t.reviewerId === meId) ?? null;
  const comNota = takes.filter(t => t.final != null);
  const media = comNota.length
    ? comNota.reduce((acc, t) => acc + (t.final ?? 0), 0) / comNota.length
    : null;

  const titulo = `Temporada ${season}`;

  return (
    <div className="plate mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
      <div className="min-w-0">
        <p className="font-display text-[15px] uppercase tracking-[0.1em] text-ink">{titulo}</p>
        {name && name !== titulo ? (
          <p className="q mt-0.5 truncate text-[11.5px] text-ink-dim">{name}</p>
        ) : null}
      </div>

      {media != null ? (
        <div className="flex items-center gap-2.5">
          <Strip value={media} cells={10} className="hidden h-[6px] w-[110px] flex-none sm:block" />
          <span className="q text-[20px] font-medium leading-none text-beam">{fmt(media)}</span>
          <span className="q text-[11px] text-ink-faint">
            {plural(comNota.length, 'nota', 'notas')} do clube
          </span>
        </div>
      ) : (
        <p className="q text-[12px] text-ink-dim">o clube ainda não avaliou esta temporada</p>
      )}

      <div className="ml-auto flex items-center gap-2">
        {minha?.final != null ? <MineNote take={minha} /> : null}
        <Key tone={minha ? 'flush' : 'commit'} onClick={onRate}>
          <Star className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
          {minha ? 'Mudar sua nota' : 'Avaliar a temporada'}
        </Key>
      </div>

      {}
      {comNota.length ? (
        <ul className="w-full border-t border-white/[0.07] pt-3">
          {[...comNota]
            .sort((a, b) => (b.final ?? 0) - (a.final ?? 0))
            .map(t => (
              <li key={t.id} className="flex items-baseline gap-2.5 py-1">
                <span
                  className={cn(
                    'font-display text-[12.5px] uppercase tracking-[0.1em]',
                    t.reviewerId === meId ? 'text-dye-brass' : 'text-ink'
                  )}
                >
                  {t.reviewerId === meId ? 'você' : t.reviewerName}
                </span>
                {t.scores ? (
                  <span className="legend text-[9px] text-beam-dim">criteriosa</span>
                ) : null}
                {t.comment ? (
                  <span className="min-w-0 flex-1 truncate text-[12px] italic text-ink-dim">
                    “{t.comment}”
                  </span>
                ) : (
                  <span className="flex-1" />
                )}
                <span className="q text-[13.5px] text-beam">{fmt(t.final ?? 0)}</span>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}

function EpisodeRow({
  ep,
  takes,
  meId,
  showId,
  showTitle,
  showPoster,
  genre,
  onSaved,
  fault,
}: {
  ep: Episode;
  takes: ShowTake[];
  meId: string;
  showId: number;
  showTitle: string;
  showPoster: string | null;
  genre: string;
  onSaved: () => void;
  fault: (msg: string) => void;
}) {
  const world = useWorld();
  const minha = takes.find(t => t.reviewerId === meId) ?? null;
  const outros = takes.filter(t => t.reviewerId !== meId);

  const [aberta, setAberta] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [otimista, setOtimista] = useState<boolean | null>(null);
  useEffect(() => {
    setOtimista(null);
  }, [minha]);
  const visto = otimista ?? minha != null;

  const alternar = useCallback(async () => {
    if (salvando) return;
    const marcar = minha == null;
    setSalvando(true);
    setOtimista(marcar);
    try {
      if (marcar) {
        await showsApi.mark(showId, ep.season, ep.episode, {
          showTitle,
          showPoster,
          episodeTitle: ep.title,
          genre,
        });
      } else {
        await showsApi.unmark(showId, ep.season, ep.episode);
      }
      onSaved();
    } catch (e) {
      setOtimista(null);
      fault(
        (marcar ? 'Não foi possível marcar: ' : 'Não foi possível desmarcar: ') +
          (e as Error).message
      );
    } finally {
      setSalvando(false);
    }
  }, [
    salvando,
    minha,
    showId,
    ep.season,
    ep.episode,
    ep.title,
    showTitle,
    showPoster,
    genre,
    onSaved,
    fault,
  ]);

  const vistoPor = [...takes].sort((a, b) => a.watchedAt.localeCompare(b.watchedAt));

  return (
    <li className="border-t border-white/[0.06] first:border-t-0">
      {}
      <div className="group flex w-full items-center gap-3 rounded-cell px-2 py-3 transition-colors duration-150 hover:bg-beam/[0.05]">
        <button
          type="button"
          aria-expanded={aberta}
          aria-label={`${aberta ? 'Fechar' : 'Abrir'} T${ep.season}E${ep.episode} — ${ep.title}`}
          onClick={() => setAberta(v => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {}
          {ep.still ? (
            <img
              src={ep.still}
              alt=""
              loading="lazy"
              className="aspect-video w-[104px] flex-none rounded-cell object-cover ring-1 ring-white/[0.06]"
            />
          ) : (
            <span aria-hidden className="aspect-video w-[104px] flex-none rounded-cell bg-house-deep ring-1 ring-white/[0.06]" />
          )}

          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="q text-[11.5px] text-ink-dim">
                T{ep.season}E{String(ep.episode).padStart(2, '0')}
              </span>
              <span className="truncate text-[14px] text-ink transition-colors group-hover:text-beam">
                {ep.title}
              </span>
              {}
              {ep.kind === 'finale' ? (
                <span className="legend flex-none text-[9px] text-dye-brass">Final</span>
              ) : null}
            </span>
            <span className="q mt-1 block text-[11px] text-ink-faint">
              {[ep.airDate ? whenBR(ep.airDate) : null, ep.runtime ? `${ep.runtime} min` : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
        </button>

        <div className="flex flex-none items-center gap-2 sm:gap-3">
          {}
          {outros.length ? (
            <span
              aria-hidden
              className="hidden items-center gap-[3px] sm:flex"
            >
              {outros.slice(0, ROSTOS).map(t => (
                <Reel
                  key={t.id}
                  color={reelColor(t.reviewerDot, t.reviewerId)}
                  src={world.avatarOf(t.reviewerId)}
                  size="sm"
                >
                  {initialsOf(t.reviewerName ?? '?')}
                </Reel>
              ))}
              {outros.length > ROSTOS ? (
                <span className="q text-[10px] leading-none text-ink-faint">
                  +{outros.length - ROSTOS}
                </span>
              ) : null}
            </span>
          ) : null}

          <SeenCheck on={visto} busy={salvando} onToggle={() => void alternar()} />

          <ChevronDown
            aria-hidden
            className={cn(
              'h-4 w-4 flex-none text-ink-faint transition-transform duration-200',
              aberta && 'rotate-180'
            )}
            strokeWidth={1.7}
          />
        </div>
      </div>

      {}
      <Drawer open={aberta}>
        <div className="px-2 pb-4 pl-[120px]">
          {ep.overview ? (
            <p className="max-w-[70ch] text-[13px] leading-relaxed text-ink-dim">{ep.overview}</p>
          ) : (
            <p className="text-[13px] text-ink-faint">O TMDB não tem sinopse deste episódio.</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="legend">Quem já viu</span>
            {!vistoPor.length ? (
              <span className="q text-[12px] text-ink-faint">ninguém do clube ainda</span>
            ) : (
              vistoPor.map(t => (
                <span key={t.id} className="flex items-center gap-1.5">
                  <Reel
                    color={reelColor(t.reviewerDot, t.reviewerId)}
                    src={world.avatarOf(t.reviewerId)}
                    size="sm"
                  >
                    {initialsOf(t.reviewerName ?? '?')}
                  </Reel>
                  <span className="text-[12.5px] text-ink">
                    {t.reviewerId === meId ? 'você' : t.reviewerName ?? 'alguém'}
                  </span>
                  <span className="q text-[11px] text-ink-faint">{whenOf(t.watchedAt)}</span>
                </span>
              ))
            )}
          </div>
        </div>
      </Drawer>
    </li>
  );
}

function SeenCheck({ on, busy, onToggle }: { on: boolean; busy: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={on ? 'Visto — clique para desmarcar' : 'Marcar como visto'}
      title={on ? 'Visto — clique para desmarcar' : 'Marcar como visto'}
      disabled={busy}
      onClick={onToggle}
      className={cn(
        'flex h-9 w-9 flex-none items-center justify-center rounded-cell ring-1',
        'coarse:h-11 coarse:w-11',
        'transition-[background-color,color,box-shadow] duration-150 active:translate-y-px',
        'disabled:cursor-not-allowed disabled:opacity-50',
        on
          ? 'bg-dye-brass/15 text-dye-brass ring-dye-brass/60 shadow-[inset_0_0_14px_rgba(217,164,65,0.20)]'
          : 'text-ink-faint/45 ring-house-rail hover:bg-beam/[0.06] hover:text-beam hover:ring-beam/50'
      )}
    >
      <Check className="h-4 w-4" strokeWidth={on ? 2.6 : 1.8} />
    </button>
  );
}

function MineNote({ take }: { take: ShowTake }) {
  return (
    <span
      aria-label={`Sua nota: ${fmt(take.final ?? 0)}${take.scores ? ', criteriosa' : ''}`}
      title={take.scores ? 'Avaliação criteriosa' : 'Sua nota'}
      className={cn(
        'flex h-9 min-w-[38px] items-center justify-center rounded-cell px-1.5 ring-1',
        take.scores
          ? 'bg-beam/10 text-beam ring-beam/45'
          : 'text-ink ring-house-rail'
      )}
    >
      <span className="q text-[14px] font-medium">{fmt(take.final ?? 0)}</span>
    </span>
  );
}

function whenBR(iso: string) {
  const at = new Date(iso + 'T12:00:00');
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

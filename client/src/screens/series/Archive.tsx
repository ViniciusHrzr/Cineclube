import { useMemo, useState } from 'react';
import { Check, ChevronLeft } from 'lucide-react';
import {
  Bill,
  Blank,
  Drawer,
  IconKey,
  Poster,
  Reel,
  ReelPicker,
  Skeleton,
} from '@/components/bits';
import { fmt, initialsOf, reelColor, type Reviewer, type ShowTake } from '@/lib/api';
import { cn, plural } from '@/lib/utils';
import { useWorld } from '@/lib/world';
import { TakeCard } from './shared';

export function SeriesArchiveScreen({
  takes,
  roster,
  onOpen,
}: {
  takes: ShowTake[] | null;
  roster: Reviewer[];
  onOpen: (showId: number) => void;
}) {
  const [quem, setQuem] = useState<string | null>(null);
  const [abertas, setAbertas] = useState<ReadonlySet<number>>(() => new Set());
  const [temporadas, setTemporadas] = useState<ReadonlySet<string>>(() => new Set());

  const gente = useMemo(() => {
    const mapa = new Map<string, { id: string; name: string; dot: string | null; count: number }>();
    for (const t of takes ?? []) {
      const achado = mapa.get(t.reviewerId);
      if (achado) achado.count += 1;
      else if (t.reviewerName)
        mapa.set(t.reviewerId, {
          id: t.reviewerId,
          name: t.reviewerName,
          dot: t.reviewerDot,
          count: 1,
        });
    }
    return [...mapa.values()].map(p => ({
      ...p,
      avatar: roster.find(r => r.id === p.id)?.avatar ?? null,
    }));
  }, [takes, roster]);

  const arvore = useMemo(() => {
    const vistos = (takes ?? []).filter(t => !quem || t.reviewerId === quem);
    const series = new Map<
      number,
      {
        id: number;
        title: string;
        poster: string | null;
        seasons: Map<
          number,
          { takes: ShowTake[]; eps: Map<number, { title: string | null; takes: ShowTake[] }> }
        >;
      }
    >();

    for (const t of vistos) {
      let s = series.get(t.showId);
      if (!s) {
        s = { id: t.showId, title: t.showTitle, poster: t.showPoster, seasons: new Map() };
        series.set(t.showId, s);
      }
      let temp = s.seasons.get(t.season);
      if (!temp) {
        temp = { takes: [], eps: new Map() };
        s.seasons.set(t.season, temp);
      }
      if (t.kind === 'season' || t.episode == null) {
        temp.takes.push(t);
        continue;
      }
      let ep = temp.eps.get(t.episode);
      if (!ep) {
        ep = { title: t.episodeTitle, takes: [] };
        temp.eps.set(t.episode, ep);
      }
      if (!ep.title && t.episodeTitle) ep.title = t.episodeTitle;
      ep.takes.push(t);
    }

    const medir = (lista: ShowTake[]) => {
      const comNota = lista.filter(x => x.final != null);
      return comNota.length
        ? comNota.reduce((acc, x) => acc + (x.final ?? 0), 0) / comNota.length
        : null;
    };

    return [...series.values()]
      .map(s => {
        const seasons = [...s.seasons.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([numero, temp]) => {
            const episodios = [...temp.eps.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([n, ep]) => ({ numero: n, ...ep }));
            return { numero, episodios, takes: temp.takes, average: medir(temp.takes) };
          });
        const todas = seasons
          .map(t => t.average)
          .filter((n): n is number => n != null);
        return {
          ...s,
          seasons,
          episodes: seasons.reduce((n, t) => n + t.episodios.length, 0),
          average: todas.length ? todas.reduce((a, b) => a + b, 0) / todas.length : null,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [takes, quem]);

  if (!takes) {
    return (
      <section>
        <Bill title="Avaliados" note="carregando…" />
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="h-[64px] w-full" />
          ))}
        </div>
      </section>
    );
  }

  if (!takes.length) {
    return (
      <section>
        <Bill title="Avaliados" />
        <Blank title="Nenhum episódio marcado ainda">
          Abra uma série e marque um episódio como visto. A nota é da temporada, e se dá no
          painel acima da lista.
        </Blank>
      </section>
    );
  }

  const marcados = takes.filter(t => t.kind === 'episode').length;
  const fichas = takes.filter(t => t.final != null).length;

  return (
    <section>
      <Bill
        title="Avaliados"
        note={`${plural(marcados, 'episódio visto', 'episódios vistos')} · ${plural(fichas, 'ficha', 'fichas')}`}
      />

      {}
      {gente.length ? (
        <div className="mb-6">
          <ReelPicker
            title="Quem avaliou"
            value={quem}
            onPick={setQuem}
            choices={[
              {
                id: null,
                label: 'O clube',
                count: takes.length,
                hint: 'Ver o acervo do clube inteiro',
              },
              ...gente.map(p => ({
                id: p.id,
                label: p.name,
                count: p.count,
                hint: `Ver só o que ${p.name} marcou`,
                reel: (
                  <Reel color={reelColor(p.dot, p.id)} src={p.avatar} size="md">
                    {initialsOf(p.name)}
                  </Reel>
                ),
              })),
            ]}
          />
        </div>
      ) : null}

      {!arvore.length ? (
        <Blank title="Nada marcado por essa pessoa ainda">
          Escolha <span className="text-ink">O clube</span> para ver o acervo inteiro.
        </Blank>
      ) : (
        <ul className="flex flex-col">
          {arvore.map(serie => {
            const aberta = abertas.has(serie.id);
            return (
              <li key={serie.id} className="border-t border-white/[0.06] first:border-t-0">
                <div className="flex items-center gap-3 px-2 transition-colors hover:bg-beam/[0.05]">
                  <button
                    type="button"
                    aria-expanded={aberta}
                    onClick={() =>
                      setAbertas(prev => {
                        const next = new Set(prev);
                        if (next.has(serie.id)) next.delete(serie.id);
                        else next.add(serie.id);
                        return next;
                      })
                    }
                    className="group flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
                  >
                    <Poster src={serie.poster} className="h-[52px] w-[35px] flex-none" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] text-ink transition-colors group-hover:text-beam">
                        {serie.title}
                      </span>
                      <span className="q block text-[11px] text-ink-dim">
                        {plural(serie.seasons.length, 'temporada', 'temporadas')} ·{' '}
                        {plural(serie.episodes, 'episódio', 'episódios')}
                      </span>
                    </span>
                    {serie.average != null ? (
                      <span className="q flex-none text-[17px] text-beam">{fmt(serie.average)}</span>
                    ) : null}
                  </button>
                  {}
                  <IconKey aria-label={`Abrir ${serie.title}`} onClick={() => onOpen(serie.id)}>
                    <ChevronLeft className="h-4 w-4 rotate-180" strokeWidth={1.8} />
                  </IconKey>
                </div>

                <Drawer open={aberta}>
                  <ul className="flex flex-col pb-2 pl-6">
                    {serie.seasons.map(temp => {
                      const chave = `${serie.id}x${temp.numero}`;
                      const abertaT = temporadas.has(chave);
                      return (
                        <ArchiveSeason
                          key={chave}
                          numero={temp.numero}
                          episodios={temp.episodios}
                          takes={temp.takes}
                          average={temp.average}
                          aberta={abertaT}
                          onToggle={() =>
                            setTemporadas(prev => {
                              const next = new Set(prev);
                              if (next.has(chave)) next.delete(chave);
                              else next.add(chave);
                              return next;
                            })
                          }
                        />
                      );
                    })}
                  </ul>
                </Drawer>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ArchiveSeason({
  numero,
  episodios,
  takes,
  average,
  aberta,
  onToggle,
}: {
  numero: number;
  episodios: { numero: number; title: string | null; takes: ShowTake[] }[];
  takes: ShowTake[];
  average: number | null;
  aberta: boolean;
  onToggle: () => void;
}) {
  const world = useWorld();
  const [ficha, setFicha] = useState<string | null>(null);
  const [tocada, setTocada] = useState(false);

  const comNota = takes.filter(t => t.final != null);

  return (
    <li className="border-t border-white/[0.05]">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pr-2">
        <button
          type="button"
          aria-expanded={aberta}
          onClick={onToggle}
          className="group flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left transition-colors hover:bg-beam/[0.04]"
        >
          <span className="font-display text-[13px] uppercase tracking-[0.1em] text-ink transition-colors group-hover:text-beam">
            Temporada {numero}
          </span>
          <span className="q text-[11px] text-ink-faint">
            {plural(episodios.length, 'episódio', 'episódios')}
          </span>
        </button>

        {comNota.map(t => {
          const on = ficha === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-expanded={on}
              aria-label={`${on ? 'Fechar' : 'Abrir'} a ficha de ${t.reviewerName ?? 'alguém'} — nota ${fmt(t.final ?? 0)}`}
              onClick={() => {
                setFicha(v => (v === t.id ? null : t.id));
                setTocada(true);
              }}
              className={cn(
                'flex flex-none items-center gap-1.5 rounded-cell px-1.5 py-1 ring-1 transition-colors duration-150',
                on
                  ? 'text-dye-brass ring-dye-brass/60 shadow-[inset_0_0_14px_rgba(217,164,65,0.18)]'
                  : 'text-ink-dim ring-house-rail hover:text-beam hover:ring-white/25'
              )}
            >
              <Reel color={reelColor(t.reviewerDot, t.reviewerId)} src={world.avatarOf(t.reviewerId)} size="sm">
                {initialsOf(t.reviewerName ?? '?')}
              </Reel>
              <span className={cn('q text-[12.5px] font-medium', t.scores ? 'text-beam' : undefined)}>
                {fmt(t.final ?? 0)}
              </span>
            </button>
          );
        })}

        {average != null ? (
          <span className="q flex-none text-[14px] text-beam">{fmt(average)}</span>
        ) : null}
      </div>

      <Drawer open={ficha !== null}>
        {tocada ? (
          <div className="pb-3 pr-2">
            {comNota
              .filter(t => t.id === ficha)
              .map(t => (
                <TakeCard key={t.id} take={t} />
              ))}
          </div>
        ) : null}
      </Drawer>

      <Drawer open={aberta}>
        <ul className="flex flex-col pb-2 pl-4">
          {episodios.map(ep => (
            <ArchiveEpisode key={ep.numero} numero={ep.numero} title={ep.title} takes={ep.takes} />
          ))}
        </ul>
      </Drawer>
    </li>
  );
}

function ArchiveEpisode({
  numero,
  title,
  takes,
}: {
  numero: number;
  title: string | null;
  takes: ShowTake[];
}) {
  const world = useWorld();

  return (
    <li className="border-t border-white/[0.04]">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 py-2 pr-2">
        <span className="q flex-none text-[11px] text-ink-dim">
          E{String(numero).padStart(2, '0')}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
          {title || 'sem título'}
        </span>

        {takes.length ? (
          <span
            className="flex flex-none items-center gap-1 opacity-60"
            title={`Visto por ${takes.map(t => t.reviewerName ?? 'alguém').join(', ')}`}
          >
            <Check className="h-3.5 w-3.5 flex-none text-ink-faint" strokeWidth={2} aria-hidden />
            {takes.map(t => (
              <Reel key={t.id} color={reelColor(t.reviewerDot, t.reviewerId)} src={world.avatarOf(t.reviewerId)} size="sm">
                {initialsOf(t.reviewerName ?? '?')}
              </Reel>
            ))}
          </span>
        ) : null}
      </div>
    </li>
  );
}

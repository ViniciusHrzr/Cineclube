import { useMemo, useState } from 'react';
import { Bill, Blank, Reel, ReelPicker, Skeleton } from '@/components/bits';
import { initialsOf, type QueuedShow, reelColor, type Reviewer, type SessionUser } from '@/lib/api';
import { plural } from '@/lib/utils';
import { SeriesCell } from './shared';

const NINGUEM = '\0sem-dono';

export function SeriesQueueScreen({
  shows,
  roster,
  me,
  onOpen,
  onRemove,
}: {
  shows: QueuedShow[] | null;
  roster: Reviewer[];
  me: SessionUser;
  onOpen: (showId: number) => void;
  onRemove: (showId: number) => void;
}) {
  const [quem, setQuem] = useState<string | null>(me.id);

  const { donos, orfas } = useMemo(() => {
    const conta = new Map<string, number>();
    for (const s of shows ?? []) {
      const seus = s.wanters.filter(id => roster.some(p => p.id === id));
      for (const dono of seus.length ? seus : [NINGUEM]) {
        conta.set(dono, (conta.get(dono) ?? 0) + 1);
      }
    }
    return {
      donos: roster
        .map(p => ({ ...p, count: conta.get(p.id) ?? 0 }))
        .filter(p => p.count > 0),
      orfas: conta.get(NINGUEM) ?? 0,
    };
  }, [shows, roster]);

  if (quem && quem !== NINGUEM && !donos.some(d => d.id === quem)) setQuem(null);
  if (quem === NINGUEM && !orfas) setQuem(null);

  const naTela = (shows ?? []).filter(s => {
    if (!quem) return true;
    const seus = s.wanters.filter(id => roster.some(p => p.id === id));
    return seus.length ? seus.includes(quem) : quem === NINGUEM;
  });

  const quemSegue = (s: QueuedShow) =>
    s.wanters
      .map(id => roster.find(p => p.id === id))
      .filter((p): p is Reviewer => !!p);

  if (!shows) {
    return (
      <section>
        <Bill title="Minhas séries" note="carregando…" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {[0, 1, 2].map(i => <Skeleton key={i} className="aspect-[2/3] w-full" />)}
        </div>
      </section>
    );
  }

  if (!shows.length) {
    return (
      <section>
        <Bill title="Minhas séries" />
        <Blank title="O clube ainda não acompanha nenhuma série">
          Ache uma no catálogo e marque para acompanhar. O que o clube combinar de ver aparece
          aqui, com o quanto já foi visto.
        </Blank>
      </section>
    );
  }

  return (
    <section>
      <Bill
        title="Minhas séries"
        note={
          quem
            ? `${naTela.length} de ${plural(shows.length, 'série', 'séries')}`
            : `${plural(shows.length, 'série', 'séries')} que o clube acompanha`
        }
      />

      {}
      {donos.length || orfas ? (
        <div className="mb-5">
          <ReelPicker
            title="Quem acompanha"
            value={quem}
            onPick={setQuem}
            choices={[
              { id: null, label: 'Todos', count: shows.length, hint: 'Ver a lista inteira' },
              ...donos.map(d => ({
                id: d.id,
                label: d.name,
                count: d.count,
                hint: `Ver só o que ${d.name} acompanha`,
                reel: (
                  <Reel color={reelColor(d.dot, d.id)} src={d.avatar ?? null} size="md">
                    {initialsOf(d.name)}
                  </Reel>
                ),
              })),
              ...(orfas
                ? [
                    {
                      id: NINGUEM,
                      label: 'Sem registro',
                      count: orfas,
                      hint: 'Ver só o que a lista não sabe de quem é',
                    },
                  ]
                : []),
            ]}
          />
        </div>
      ) : null}

      {!naTela.length ? (
        <Blank title="Nada nesta lista por essa pessoa">
          Escolha <span className="text-ink">Todos</span> para ver o que o clube inteiro acompanha.
        </Blank>
      ) : null}

      {}
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
        {naTela.map(s => {
          const segue = quemSegue(s);
          return (
            <li key={s.id}>
              <SeriesCell
                show={{
                  id: s.id,
                  title: s.title,
                  original: s.original,
                  year: s.year,
                  genre: s.genre,
                  genres: [s.genre],
                  poster: s.poster,
                  crowd: null,
                  watch: s.watch,
                }}
                seen={
                  s.totalEpisodes ? `${s.seen}/${s.totalEpisodes} vistos` : `${s.seen} vistos`
                }
                average={s.average}
                upNext={s.upNext}
                upcoming={s.upcoming}
                caughtUp={s.caughtUp}
                wants={segue}
                onOpen={() => onOpen(s.id)}
                onRemove={
                  segue.some(p => p.id === me.id) || me.isAdmin
                    ? () => onRemove(s.id)
                    : undefined
                }
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

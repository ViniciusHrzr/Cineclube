import { useEffect, useRef, useState } from 'react';
import { type TabId } from '@/App';
import { Bill, Blank, Chip, Key, SearchField, Skeleton } from '@/components/bits';
import { seriesApi, type SeriesItem } from '@/lib/api';
import { SuggestionsKey } from '@/screens/Reels';
import { SeriesCell } from './shared';

export function SeriesCatalogScreen({
  queued,
  onQueue,
  onOpen,
  onTab,
  fault,
}: {
  queued: Set<number>;
  onQueue: (s: SeriesItem) => void;
  onOpen: (showId: number) => void;
  onTab: (t: TabId) => void;
  fault: (msg: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('Todos');
  const [items, setItems] = useState<SeriesItem[] | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const busca = query.trim();

  useEffect(() => {
    let vivo = true;
    setItems(null);
    const pedido = busca
      ? seriesApi.search(busca, page)
      : genre === 'Todos'
        ? seriesApi.popular(page)
        : seriesApi.byGenre(genre, page);
    void pedido
      .then(r => {
        if (!vivo) return;
        setItems(r.results);
        setTotalPages(r.totalPages);
      })
      .catch(e => {
        if (!vivo) return;
        setItems([]);
        fault('Não foi possível falar com o TMDB: ' + (e as Error).message);
      });
    return () => {
      vivo = false;
    };
  }, [busca, genre, page, fault]);

  const cut = `${busca}|${genre}`;
  const lastCut = useRef(cut);
  if (lastCut.current !== cut) {
    lastCut.current = cut;
    if (page !== 1) setPage(1);
  }

  return (
    <section>
      <Bill
        title="Catálogo"
        note={busca ? `buscando "${busca}"` : 'as séries mais vistas no TMDB'}
      />

      {}
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <div className="min-w-[240px] max-w-[440px] flex-1">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Buscar uma série…"
            hint={busca ? 'busca no TMDB, não no que o clube já viu' : undefined}
          />
        </div>
        <SuggestionsKey onOpen={() => onTab('sugestoes')} />
      </div>

      {}
      {!busca ? (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {['Todos', ...GENRES].map(g => (
            <Chip key={g} size="sm" on={genre === g} onClick={() => setGenre(g)}>
              {g}
            </Chip>
          ))}
        </div>
      ) : null}

      {!items ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {[0, 1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="aspect-[2/3] w-full" />
          ))}
        </div>
      ) : !items.length ? (
        <Blank title="Nenhuma série com esse nome">
          Tente o título original, se souber — o TMDB indexa os dois.
        </Blank>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {items.map(s => (
              <li key={s.id}>
                <SeriesCell
                  show={s}
                  inQueue={queued.has(s.id)}
                  onOpen={() => onOpen(s.id)}
                  onQueue={() => onQueue(s)}
                />
              </li>
            ))}
          </ul>
          {totalPages > 1 ? (
            <div className="mt-8 flex items-center gap-3">
              <Key tone="ghost" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                Anterior
              </Key>
              <span className="q text-[12px] text-ink-dim">
                {page} de {totalPages.toLocaleString('pt-BR')}
              </span>
              <Key tone="ghost" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                Próxima
              </Key>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

const GENRES = [
  'Ação', 'Animação', 'Comédia', 'Documentário', 'Drama',
  'Ficção científica', 'Romance', 'Suspense', 'Terror',
];

import { Strip } from '@/components/bits';
import { WithMentions } from '@/components/mention';
import { fmt, type Review } from '@/lib/api';
import { cn } from '@/lib/utils';

/* ══════════════════════════════════════════════════════════════════════════
   A FICHA ABERTA

   Os onze critérios de uma avaliação, e o que a pessoa escreveu embaixo deles.

   Morava dentro da tela de avaliados, que por muito tempo foi o único lugar
   onde uma ficha se abria por inteiro. Deixou de ser: o perfil abre a ficha na
   própria página agora, porque mandar quem está explorando alguém para outra
   aba é fazer essa pessoa perder o lugar — e quem estava percorrendo doze
   fichas de alguém não volta.

   Uma cópia teria sido o caminho curto e o errado, pelo mesmo motivo de sempre:
   é o mesmo detalhamento, com a mesma grade e as mesmas regras de leitura, e
   duas implementações da mesma coisa divergem na terceira vez que alguém mexe
   numa delas.
   ══════════════════════════════════════════════════════════════════════════ */

export function Breakdown({ r, comment }: { r: Review; comment?: string }) {
  const rows = r.breakdown;
  return (
    /* The ring is inset. A Tailwind ring is a shadow cast outside the box, and
       this plate opens inside a container that clips its overflow to animate the
       height — flush against that container's top edge, the outer 1px lands
       outside the clip and the plate loses its lid. Drawn inside, it cannot be
       cropped by whatever it is opened in. */
    <div className="rounded-cell bg-house-deep/60 px-3 py-2.5 ring-1 ring-inset ring-white/[0.05]">
      {/* Filled down the columns rather than across the rows. The two criteria
          the genre weighs double are the last two on the card, and read across
          they landed diagonally apart — one at the end of a row, the other alone
          on the next — which is the least cohesive place two halves of a pair
          can be. Read down, they finish in the same column, one under the other.

          The row count is the criteria divided by the columns at that width, so
          this holds if a genre is ever given a third criterion. The DOM order
          never changes, so a screen reader still hears the card as it is written.

          Every row measures the same — a capped name, a fixed strip, a fixed
          number — so centring them in equal columns keeps them in register with
          each other and the block centred on the plate. */}
      <div
        style={
          {
            '--rows-1': rows.length,
            '--rows-2': Math.ceil(rows.length / 2),
            '--rows-3': Math.ceil(rows.length / 3),
          } as React.CSSProperties
        }
        /* A segunda coluna voltou para `sm`. Ela tinha subido para `md` porque
           o controle de voto somava ~66px a cada linha e a 640px duas delas não
           cabiam mais dentro da carta — a grade não quebrava, transbordava.
           Sem o controle, a linha é nome, régua e número, e cabem duas cedo. */
        className={cn(
          'grid grid-flow-col auto-cols-fr justify-items-center gap-x-4 gap-y-0.5',
          'grid-rows-[repeat(var(--rows-1),auto)]',
          'sm:grid-rows-[repeat(var(--rows-2),auto)]',
          'lg:grid-rows-[repeat(var(--rows-3),auto)]'
        )}
      >
        {rows.map(b => (
          <div
            key={b.key}
            className="grid w-fit grid-cols-[minmax(0,104px)_52px_30px] items-center gap-1.5 py-1"
          >
            {/* The genre pair used to be the bright row because it weighed
                double. It still reads brighter, for what is now the honest
                reason: it is the part of the card this film chose, and the
                personal one is bright for the same kind of reason — it is the
                only answer that is about the person whose card this is. */}
            <span className={cn('truncate text-[12.5px]', b.group === 'oficio' ? 'text-ink-dim' : 'text-ink')}>
              {b.name}
            </span>
            <Strip value={b.value} cells={10} className="h-[5px]" />
            <span className="q text-right text-[12.5px]">{fmt(b.value)}</span>
          </div>
        ))}
      </div>
      {/* O comentário da própria ficha também chama gente pelo nome: é o outro
          lugar do produto onde se escreve. */}
      {comment ? (
        <p className="mt-2 border-t border-white/[0.06] pt-2.5 text-[13px] italic leading-relaxed text-ink-dim">
          “<WithMentions text={comment} />”
        </p>
      ) : null}
    </div>
  );
}

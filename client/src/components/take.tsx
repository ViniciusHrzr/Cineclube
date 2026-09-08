import { Strip } from '@/components/bits';
import { WithMentions } from '@/components/mention';
import { fmt, type BreakdownRow } from '@/lib/api';
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

/* `r` é qualquer ficha que já chegue aberta: a de um filme, com os onze
   critérios, e a de um episódio, com os nove. As duas trazem `breakdown` pronto
   do servidor — é ele que decide o vocabulário do gênero e o que a ficha de
   fato respondeu —, e daqui para dentro não há diferença nenhuma entre elas. */
export function Breakdown({ r, comment }: { r: { breakdown: BreakdownRow[] }; comment?: string }) {
  const rows = r.breakdown;
  /* Uma ficha sem critério nenhum e sem texto não tem carta: é o caso da nota
     rápida de um episódio, que é um número e mais nada. Desenhar a placa vazia
     seria uma caixa anunciando conteúdo que ela não tem. */
  if (!rows.length && !comment) return null;
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
      {rows.length ? <div
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
      </div> : null}
      {/* O comentário da própria ficha também chama gente pelo nome: é o outro
          lugar do produto onde se escreve. Sem régua quando não há critério
          acima dele: uma linha separando o texto de nada seria a borda de uma
          metade que não existe. */}
      {comment ? (
        <p className={cn(
          'text-[13px] italic leading-relaxed text-ink-dim',
          rows.length && 'mt-2 border-t border-white/[0.06] pt-2.5'
        )}>
          “<WithMentions text={comment} />”
        </p>
      ) : null}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   DE ONDE A FICHA VEIO

   O acervo de uma sala é o acervo das pessoas dela: quem entra num clube novo
   chega com o que já escreveu, em vez de chegar com a estante vazia. Uma ficha
   assim precisa dizer onde foi escrita, ou o clube parece ter avaliado coisas
   que nunca viu junto.

   Só aparece quando a ficha veio de fora — o servidor manda `origin` nulo para o
   que foi gravado aqui, que é o caso comum. Uma etiqueta em toda linha do acervo
   é uma etiqueta que ninguém lê.

   As duas peças são a mesma informação em dois lugares: a pastilha, na fileira
   fechada, e a frase, dentro da gaveta, onde a conversa estaria. A conversa não
   viaja com a ficha — comentário e voto acontecem na sala onde ela foi gravada,
   porque não têm sala própria e vazariam de um clube fechado para outro. Então
   a gaveta diz isso em palavras, e aponta a porta.
   ══════════════════════════════════════════════════════════════════════════ */

export type Origin = { name: string | null; slug: string | null };

/** A pastilha da fileira: o nome da sala, discreto, sem competir com a nota. */
export function OriginTag({ where }: { where: Origin }) {
  const name = where.name ?? 'outro clube';
  return (
    <span
      title={`Avaliado no ${name}`}
      className="hidden flex-none rounded-cell bg-house-seat/70 px-1.5 py-[3px] font-display text-[9.5px] uppercase leading-none tracking-[0.1em] text-ink-faint ring-1 ring-house-rail sm:inline-block"
    >
      {name}
    </span>
  );
}

/** A frase da gaveta, no lugar da conversa. */
export function OriginNote({ where }: { where: Origin }) {
  const name = where.name ?? 'outro clube';
  return (
    <p className="q mt-4 border-t border-white/[0.06] pt-3 text-[12px] text-ink-dim">
      Avaliado no <span className="text-ink">{name}</span> — a conversa sobre esta ficha acontece lá.
      {where.slug ? (
        <>
          {' '}
          <a
            href={`#c/${encodeURIComponent(where.slug)}/avaliados`}
            className="underline underline-offset-2 transition-colors hover:text-beam"
          >
            Abrir
          </a>
        </>
      ) : null}
    </p>
  );
}

import { useEffect, useRef, useState } from 'react';
import {
  Check as CheckIcon,
  ChevronDown as ChevronDownIcon,
  Play as PlayIcon,
  Search as SearchIcon,
  Users as UsersIcon,
  X as XIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmt, type Universe } from '@/lib/api';

/* ── a lente ──────────────────────────────────────────────────────────────
   Filmes ou séries: a escolha mais externa do produto, e por isso a mais alta
   em toda tela que a desenha.

   Sublinhado vermelho e não chapa de latão: pela regra do DESIGN.md, vermelho
   marca ONDE VOCÊ ESTÁ e latão marca o que você escolheu — e isto é um lugar em
   que se está. */
const LENSES: { id: Universe; label: string }[] = [
  { id: 'filmes', label: 'Filmes' },
  { id: 'series', label: 'Séries' },
];

export function Lens({ on, onPick }: { on: Universe; onPick: (u: Universe) => void }) {
  return (
    <div className="flex flex-none items-center gap-0.5" role="tablist" aria-label="Universo">
      {LENSES.map(o => {
        const here = on === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={here}
            onClick={() => onPick(o.id)}
            className={cn(
              'relative px-1.5 pb-1.5 pt-1 font-display text-[13px] uppercase leading-none sm:px-2',
              'tracking-[0.12em] transition-colors duration-150 coarse:min-h-[38px]',
              here ? 'text-beam' : 'text-ink-dim hover:text-ink'
            )}
          >
            {o.label}
            {/* Sempre montado, só trocando de opacidade: aparecer e sumir do
                fluxo mudaria a altura da barra a cada troca. */}
            <span
              aria-hidden
              className={cn(
                'absolute inset-x-1 bottom-0 h-[2px] bg-dye-red transition-opacity duration-150',
                here ? 'opacity-100' : 'opacity-0'
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

/* ── poster ───────────────────────────────────────────────────────────────
   A film with no poster is not a hole: it is an unexposed cell, which is a
   real state in this world rather than a grey rectangle. */
export function Poster({ src, alt, className }: { src?: string | null; alt?: string; className?: string }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-cell bg-house-deep ring-1 ring-white/[0.06]',
        className
      )}
      style={
        src
          ? undefined
          : {
              backgroundImage:
                'repeating-linear-gradient(135deg, rgba(255,233,196,0.05) 0 6px, transparent 6px 12px)',
            }
      }
    >
      {src ? <img src={src} alt={alt ?? ''} loading="lazy" className="h-full w-full object-cover" /> : null}
    </div>
  );
}

/* ── the strip meter ──────────────────────────────────────────────────────
   A run of film cells, one per half point on the master (twenty of them, the
   exact step the criteria move in) and one per point on the small records.
   Brightness encodes role, never score: the live take burns at full beam, a
   past take sits dim. Nothing changes colour at a threshold, because the scale
   the club rates on is continuous. */
export function Strip({
  value,
  cells = 10,
  live = false,
  className,
}: {
  value: number;
  cells?: number;
  live?: boolean;
  className?: string;
}) {
  const per = 10 / cells;
  const filled = Math.max(0, Math.min(cells, value / per));
  return (
    <div className={cn('flex gap-[2px]', className)} role="img" aria-label={`${fmt(value)} de 10`}>
      {Array.from({ length: cells }, (_, i) => (
        /* Two layers per cell, and only one number changes: the unlit cell is
           always underneath, and the beam is laid over it at the exact fraction
           of that cell the score reaches.

           It was one layer, with the class deciding the colour and an inline
           opacity deciding the fraction — which made opacity mean two different
           things. Leaving the partial cell dropped the inline value, so opacity
           snapped back to 1 while the background was still fading, and for that
           moment the cell sat fully opaque over a half-lit colour. That was the
           blink. Here one opacity, from 0 to 1, meaning one thing. */
        <span key={i} className="relative flex-1 rounded-[1px] bg-white/[0.07]">
          <span
            className={cn(
              'absolute inset-0 rounded-[1px] transition-opacity duration-100',
              live ? 'bg-beam' : 'bg-beam/45'
            )}
            style={{ opacity: Math.max(0, Math.min(1, filled - i)) }}
          />
        </span>
      ))}
    </div>
  );
}

/* ── reel tag ─────────────────────────────────────────────────────────────
   Who signed a take. With a portrait it stays a reel: the frame goes square and
   the picture sits inside it, cropped like a film cell. Not a circle — a circle
   is every other product's avatar, and a round portrait next to square
   everything would be the one element here that came from somewhere else. */
/* Both branches are listed side by side on purpose: a row where one person has
   a portrait and the next has initials is the ordinary case, and the two have
   to stand the same height or the row reads as broken. */
const REEL_SIZE = {
  /** Beside a line of text, where it is a signature and not a face. */
  sm: { photo: 'h-5 w-5', tag: 'h-5 min-w-[28px] px-1.5 text-[10.5px]' },
  /** In a list of takes, where the person is half of what the row is about. */
  md: { photo: 'h-6 w-6', tag: 'h-6 min-w-[32px] px-1.5 text-[11px]' },
  /** Where the person is the subject: the marquee, the roster. */
  lg: { photo: 'h-7 w-7', tag: 'h-7 min-w-[36px] px-2 text-[12px]' },
} as const;

export function Reel({
  color,
  src,
  size = 'sm',
  children,
  className,
}: {
  color: string;
  /** The portrait, if this person has one. */
  src?: string | null;
  size?: keyof typeof REEL_SIZE;
  children: React.ReactNode;
  className?: string;
}) {
  if (src) {
    return (
      <span
        className={cn(
          'inline-flex flex-none overflow-hidden rounded-[1px] ring-1 ring-white/15',
          REEL_SIZE[size].photo,
          className
        )}
        style={{ background: color }}
      >
        <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex flex-none items-center justify-center rounded-[1px] font-bold tracking-[0.08em] text-house-deep',
        REEL_SIZE[size].tag,
        className
      )}
      style={{ background: color }}
    >
      {children}
    </span>
  );
}

/* ── the bill ─────────────────────────────────────────────────────────────
   The board outside a cinema, naming what is playing. Every section built its
   own — the same five classes typed out in five files, with the margin drifting
   in one of them.

   The rule is the part that is new: a single word set at 46px leaves most of a
   1240px line empty, and the emptiness read as the layout not having finished
   loading rather than as air.

   Beam and not brass, deliberately: brass means *selected* in this room, and
   spending it on a decoration at the top of all five screens would spend the
   one thing that makes a chosen chip legible as chosen. */
export function Bill({
  title,
  note,
  children,
}: {
  title: string;
  /** The line under the title: a count, a source, what the filter left. */
  note?: React.ReactNode;
  /** Anything that belongs on the title's own line, at the far end. */
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-6">
      {/* Centred on the line box rather than on the baseline: the display face
          is caps-only, so there are no descenders and the optical middle of the
          lettering is the middle of the box. */}
      <div className="flex items-center gap-4">
        <h1 className="font-display text-[38px] leading-none tracking-[0.04em] text-beam sm:text-[46px]">
          {title}
        </h1>
        <span
          aria-hidden
          className="h-px min-w-[2rem] flex-1 bg-gradient-to-r from-beam/25 via-beam/[0.07] to-transparent"
        />
        {children}
      </div>
      {note ? <p className="q mt-2.5 text-[12.5px] text-ink-dim">{note}</p> : null}
    </header>
  );
}

/* ── keys ─────────────────────────────────────────────────────────────────
   One action shape across the whole product. `tone` names what it does, never
   how loud it should look. */
export function Key({
  tone = 'flush',
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'flush' | 'commit' | 'ghost' | 'danger' }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-cell px-4 py-2.5',
        /* Trinta e três pixels é confortável sob um cursor de um pixel e pequeno
           demais para uma ponta de dedo — o piso reconhecido é 44. E a diferença
           era ao contrário: com o zoom da interface, esta chave media 41px no
           computador e 33px no telefone, ou seja o aparelho com dedos recebia o
           alvo menor. Uma linha aqui conserta todo botão do produto de uma vez. */
        'coarse:min-h-[44px] coarse:px-5 coarse:text-[14px]',
        'font-display text-[13px] uppercase tracking-[0.14em] leading-none',
        'transition-[background-color,color,border-color,transform] duration-150 active:translate-y-px',
        'disabled:cursor-not-allowed disabled:opacity-40',
        tone === 'commit' &&
          'bg-dye-red text-beam-hot ring-1 ring-dye-red hover:bg-dye-red-hot disabled:bg-house-seat disabled:text-ink-dim disabled:ring-house-rail',
        /* The chip's surface, for the chip's reason: these keys sit on the film
           wall too, and a ring around nothing leaves the lettering to fend for
           itself against a lit, moving background. Seven tenths, so the room
           still comes through — even with a frame line burning behind it at
           full beam, the label holds 5:1.

           Cream on hover, not red: `commit` fills with red and `danger` é
           vermelho vazado, e as duas cores que a sala guarda para "isto grava
           alguma coisa" e "isto destrói alguma coisa" têm de continuar
           significando isso. */
        tone === 'flush' &&
          'bg-house-seat/70 ring-1 ring-house-rail text-ink hover:ring-beam/70 hover:text-beam',
        tone === 'ghost' && 'text-ink-dim hover:text-beam',
        /* Vermelho parado, e não só sob o ponteiro. Ele era cinza que ficava
           vermelho no hover — e no dedo não existe hover: a chave mais séria da
           tela era a mais apagada dela, lida como desligada justamente onde
           quase todo mundo abre este app. Vazado e não cheio: cheio é `commit`,
           e destruir não pode parecer a ação principal de nada. */
        tone === 'danger' &&
          'ring-1 ring-dye-red-lit/45 text-dye-red-lit hover:ring-dye-red-lit hover:text-dye-red-glow',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconKey({
  className,
  children,
  active,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        /* Same surface as the key it stands beside — under a poster they are one
           row of controls, and one of them floating on the wall while the other
           sits on a plate would read as two different kinds of thing. */
        'inline-flex h-[38px] w-[38px] flex-none items-center justify-center rounded-cell',
        /* Quadrado de 44 no dedo — o ícone dentro não muda, só a área que ele
           oferece para ser acertado. */
        'coarse:h-11 coarse:w-11',
        'bg-house-seat/70 ring-1 ring-house-rail',
        'transition-colors duration-150 active:translate-y-px',
        active ? 'text-dye-red-lit' : 'text-ink-dim hover:text-beam',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ── the chip ─────────────────────────────────────────────────────────────
   A filter that is either on or off. The opaque surface is not decoration:
   these sit straight on the film wall, in tracked caps at 12.5px, and the wall
   is lit and moving underneath — a ring alone left the dim ink reading against
   whatever happened to be behind it that second.

   ── por que latão, e não vermelho ───────────────────────────────────────
   O chip escolhido era vermelho, e isso era uma regra sendo quebrada no lugar
   mais visível do produto. A distinção que ele precisa é: **vermelho diz ONDE
   VOCÊ ESTÁ** — a aba acesa da seção em que se está — e **latão diz o que você
   ESCOLHEU**. Um chip é uma escolha, não um lugar.

   O que sobreviveu da versão vermelha é a razão dela: a lavagem. O chip
   escolhido é opaco e aceso por dentro, e não um tingimento que deixava a
   parede aparecer através dele. */
/* Two geometries, one control. `md` is the filter row that stands on its own
   line; `sm` is the same choice made inline beside something else, where a
   full-size chip would outweigh the thing it is attached to. The state, the
   surface and the dye are shared; only the size is not. */
/* Estas eram as piores medidas do produto para uma mão: a `md` dava 24px de
   altura e a `sm`, 15. Uma fileira de gêneros no catálogo era uma fileira de
   alvos de quinze pixels encostados — errar o gênero ao lado não era descuido,
   era a única coisa que dava para fazer.

   A `sm` não vai a 44: ela existe para não pesar mais do que aquilo a que está
   colada, e um alvo de 44px ao lado do nome de um filme inverteria a hierarquia
   que ela mantém. Vai a 34 e ganha ar em volta. */
const CHIP_SIZE = {
  sm: 'rounded-[1px] px-2 py-0.5 text-[11px] tracking-[0.14em] coarse:min-h-[34px] coarse:px-3 coarse:text-[12px]',
  md: 'rounded-cell px-3 py-1.5 text-[12.5px] tracking-[0.12em] coarse:min-h-[40px] coarse:px-4 coarse:text-[13.5px]',
} as const;

export function Chip({
  on,
  onClick,
  size = 'md',
  children,
}: {
  on: boolean;
  onClick: () => void;
  size?: keyof typeof CHIP_SIZE;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center bg-house-seat/70 font-display uppercase',
        CHIP_SIZE[size],
        'ring-1 transition-colors duration-150',
        on
          ? 'text-dye-brass ring-dye-brass/70 shadow-[inset_0_0_14px_rgba(217,164,65,0.20)]'
          : 'text-ink-dim ring-house-rail hover:text-ink hover:ring-white/25'
      )}
    >
      {children}
    </button>
  );
}

/* ══ a chave de quem ══════════════════════════════════════════════════════
   Retrato, nome e quantos, dentro de uma chave que abre. Era uma FILEIRA de
   pastilhas, desenhada para uma sala de seis: com onze elas quebravam em três
   linhas, e o filtro passou a ocupar mais tela do que a lista que ele filtra.

   Fechada, mostra QUEM está escolhido e quantos são. Aberta, a lista cai POR
   CIMA do conteúdo e não empurra nada: escolher é uma visita, e uma visita não
   reorganiza a sala.

   Uma linha por pessoa e não pastilhas embrulhadas: em coluna os nomes
   alinham, truncam num lugar só e o número fica sempre na mesma margem — a
   diferença entre ler e procurar.

   Acesa (latão) quando há alguém escolhido: o estado do filtro continua legível
   de longe, sem contar pastilhas.

   Mora aqui porque quatro listas do produto pedem a mesma chave, e quatro
   cópias seriam quatro chances de ela divergir. */
export type ReelChoice = {
  /** `null` é a opção que não filtra nada: "Todos", "O clube". */
  id: string | null;
  label: string;
  count: number;
  /** O retrato, quando a opção é uma pessoa. Sem ele entra o ícone de gente. */
  reel?: React.ReactNode;
  /** O que o leitor de tela ouve nesta linha. Cada lista descreve o seu. */
  hint?: string;
};

export function ReelPicker({
  choices,
  value,
  onPick,
  title,
}: {
  choices: ReelChoice[];
  /** O `id` escolhido. `null` é a opção que mostra tudo. */
  value: string | null;
  onPick: (id: string | null) => void;
  /** O que esta chave filtra, para o título e para o leitor de tela. */
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  /* Fecha ao clicar fora e no Escape, como o sino da marquise. Um painel que só
     fecha pelo próprio botão obriga a mirar de volta no alvo que acabou de sair
     do lugar. O foco volta para a chave: quem fechou com o teclado não pode
     ficar sem lugar nenhum na página. */
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  /* Quem sai do clube, ou tem a última ficha apagada, pode levar embora a opção
     escolhida entre um render e outro. A chave cai na primeira — a que mostra
     tudo — em vez de ficar em branco anunciando um estado que não existe. */
  const here = choices.find(c => c.id === value) ?? choices[0];
  if (!here) return null;

  const face = (c: ReelChoice) =>
    c.reel ?? (
      <span className="flex h-6 w-6 flex-none items-center justify-center">
        <UsersIcon className="h-[15px] w-[15px]" strokeWidth={1.7} aria-hidden />
      </span>
    );

  return (
    <div ref={box} className="relative inline-flex">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        title={title}
        aria-label={`${title} — ${here.label}`}
        className={cn(
          'flex items-center gap-2 rounded-cell bg-house-seat/70 py-1 pl-1 pr-2 ring-1 transition-colors duration-150',
          /* No dedo o alvo cresce, como toda chave do produto. O retrato dentro
             não muda de tamanho — o que cresce é a área de acerto. */
          'coarse:min-h-[40px]',
          value !== null || open
            ? 'text-dye-brass ring-dye-brass/70 shadow-[inset_0_0_14px_rgba(217,164,65,0.20)]'
            : 'text-ink-dim ring-house-rail hover:text-ink hover:ring-white/25'
        )}
      >
        {face(here)}
        <span className="max-w-[46vw] truncate font-display text-[12.5px] uppercase leading-none tracking-[0.1em] sm:max-w-[220px]">
          {here.label}
        </span>
        <span className="q text-[10.5px] leading-none opacity-70">{here.count}</span>
        <ChevronDownIcon
          aria-hidden
          strokeWidth={1.8}
          className={cn(
            'h-3.5 w-3.5 flex-none opacity-70 transition-transform duration-200 ease-beam',
            open && 'rotate-180'
          )}
        />
      </button>

      {/* Ancorada à esquerda, que é onde a chave mora em todas as listas, e com
          teto de altura: numa sala grande a lista inteira passaria da tela. A
          largura cede para a janela menos as margens da página, para o painel
          nunca sair pela direita num telefone. */}
      {open ? (
        <div
          role="group"
          aria-label={title}
          className="plate absolute left-0 top-[calc(100%+6px)] z-40 max-h-[min(calc(60dvh/var(--ui-zoom)),360px)] w-[264px] max-w-[calc(100vw-2rem)] overflow-y-auto p-1"
        >
          {choices.map(c => {
            const on = c.id === here.id;
            return (
              <button
                key={c.id ?? 'tudo'}
                type="button"
                aria-pressed={on}
                aria-label={c.hint}
                onClick={() => {
                  onPick(c.id);
                  setOpen(false);
                  trigger.current?.focus();
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-cell px-2 py-2 text-left transition-colors duration-150 coarse:min-h-[44px]',
                  on
                    ? 'bg-beam/[0.06] text-dye-brass'
                    : 'text-ink-dim hover:bg-beam/[0.05] hover:text-ink'
                )}
              >
                {face(c)}
                <span className="min-w-0 flex-1 truncate font-display text-[12.5px] uppercase leading-tight tracking-[0.1em]">
                  {c.label}
                </span>
                <span className="q flex-none text-[10.5px] leading-none opacity-70">{c.count}</span>
                {/* Sempre montado, só trocando de opacidade: entrar e sair do
                    fluxo mexeria na largura dos nomes a cada escolha. */}
                <CheckIcon
                  aria-hidden
                  strokeWidth={2}
                  className={cn('h-3.5 w-3.5 flex-none', on ? 'opacity-100' : 'opacity-0')}
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ── search ───────────────────────────────────────────────────────────────
   One field shape for both bins. `onClear` renders the escape hatch, because a
   filtered list that offers no way back reads as an empty library. */
export function SearchField({
  value,
  onChange,
  placeholder,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 rounded-cell bg-house-deep px-3 ring-1 ring-house-rail focus-within:ring-dye-brass">
        <SearchIcon className="h-4 w-4 flex-none text-ink-dim" strokeWidth={1.7} />
        <input
          type="search"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          autoComplete="off"
          className="w-full bg-transparent py-2.5 text-[14.5px] text-ink caret-dye-red outline-none placeholder:text-ink-dim [&::-webkit-search-cancel-button]:hidden"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Limpar busca"
            className="flex-none rounded-cell p-1 text-ink-dim transition-colors hover:text-beam"
          >
            <XIcon className="h-4 w-4" strokeWidth={1.8} />
          </button>
        ) : null}
      </div>
      {hint ? <p className="q mt-2 text-[11px] text-ink-dim">{hint}</p> : null}
    </div>
  );
}

/* ── the drawer ───────────────────────────────────────────────────────────
   Opening used to animate height from 0 to `auto`, which cannot be done without
   measuring: the panel mounts, its full height is read, and only then does the
   animation start from zero. If the browser paints in between — and it does —
   one frame lands at full height, and everything below jumps down and comes
   straight back. That was the flick.

   A grid row measured in fractions needs no measurement: `0fr` to `1fr`
   interpolates natively, and there is never a frame at the wrong size. The
   content stays mounted, so `visibility` is what closes it to the keyboard and
   to a screen reader — transitioned rather than switched, so it turns visible
   at the start of the opening and stays visible until the closing has
   finished. */
export function Drawer({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      /* No `motion-reduce` escape here, by the owner's standing decision: this
         is the same call as the wall's drift. Opening a drawer is a response to
         a click and not a performance played at the reader, and the height it
         travels is the only thing that says where the panel came from. */
      className={cn(
        'grid transition-[grid-template-rows] duration-[240ms] ease-beam',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      )}
    >
      <div
        className={cn(
          'overflow-hidden transition-[visibility] duration-[240ms]',
          open ? 'visible' : 'invisible'
        )}
      >
        {children}
      </div>
    </div>
  );
}

/* ══ o trailer ════════════════════════════════════════════════════════════
   Era um link para fora: clicar mandava a pessoa para o YouTube, com uma parede
   de recomendações do outro lado convidando a ficar lá. O clube estava
   escolhendo um filme, e o gesto que ajuda a escolher tirava todo mundo da
   sala. Agora é uma folha por cima da ficha, e fechar devolve a pessoa
   exatamente onde ela estava.

   **`youtube-nocookie.com`**: o mesmo player, sem o cookie de rastreio até
   alguém dar play. É o endereço que o YouTube publica para isso.

   **A moldura só existe enquanto a folha está aberta.** Fechar DESMONTA o
   iframe, e é isso que para o som — esconder com CSS deixaria o trailer tocando
   atrás da ficha.

   **A saída para o YouTube continua lá dentro**, porque nem todo vídeo permite
   ser emoldurado: quando o dono do canal diz não, o player mostra um aviso e
   mais nada, e o link no rodapé é o que faz esse caso continuar tendo resposta.

   Sem id reconhecível, o componente volta a ser o link para fora que sempre
   foi: nenhuma ficha fica sem trailer por causa de uma expressão regular. */

/** As quatro formas de URL de trailer: `watch?v=`, `youtu.be/`, `embed/`, `shorts/`. */
const YT_ID = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/;

export function TrailerKey({
  url,
  title,
  className,
  children,
}: {
  url: string;
  /** O nome da obra, para a folha e para o `title` da moldura. */
  title: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const id = YT_ID.exec(url)?.[1] ?? null;

  /* A mesma tipografia dos quatro links que este componente substituiu: vermelho
     de ação, versalete, e o triângulo antes do texto. */
  const look = cn(
    'inline-flex w-fit items-center gap-2 font-display text-[12px] uppercase leading-none tracking-[0.14em]',
    'text-dye-red-lit transition-colors hover:text-dye-red-glow',
    className
  );
  const rotulo = children ?? 'Assistir trailer';

  if (!id) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={look}>
        <PlayIcon className="h-3.5 w-3.5 fill-current" strokeWidth={0} aria-hidden />
        {rotulo}
      </a>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className={look}>
        <PlayIcon className="h-3.5 w-3.5 fill-current" strokeWidth={0} aria-hidden />
        {rotulo}
      </button>
      {aberto ? (
        <TrailerSheet id={id} url={url} title={title} onClose={() => setAberto(false)} />
      ) : null}
    </>
  );
}

function TrailerSheet({
  id,
  url,
  title,
  onClose,
}: {
  id: string;
  url: string;
  title: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  /* O Esc fecha pelo nosso caminho e não pelo do navegador: fechado por fora, o
     React continuaria achando que a folha está aberta e a moldura não sairia da
     árvore — ou seja, o som continuaria. */
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

  return (
    <dialog
      ref={ref}
      aria-label={`Trailer de ${title}`}
      onClick={e => {
        if (e.target === ref.current) onClose();
      }}
      /* Esta folha é uma tela dentro de uma sala escura, então o fundo é o mais
         fechado do produto — o quarto ao redor do projetor apaga. */
      className="w-full max-w-[980px] bg-transparent p-2 text-ink backdrop:bg-house-deep/95 open:animate-beam-in sm:p-4"
    >
      <div className="plate relative p-3 sm:p-4">
        <div className="flex items-center gap-3 pr-1">
          <p className="legend min-w-0 flex-1 truncate">Trailer · {title}</p>
          <IconKey aria-label="Fechar" onClick={onClose} className="flex-none">
            <XIcon className="h-4 w-4" strokeWidth={1.8} />
          </IconKey>
        </div>

        {/* 16:9 pela proporção e não por altura fixa: a folha encolhe com a
            janela e o vídeo nunca ganha tarja de dois lados. */}
        <div className="mt-3 aspect-video w-full overflow-hidden rounded-cell bg-black ring-1 ring-white/[0.08]">
          <iframe
            /* `autoplay` porque a pessoa acabou de clicar em "assistir": o
               gesto do navegador é o mesmo, e um segundo clique dentro da
               folha seria pedir a mesma coisa duas vezes. `rel=0` mantém as
               sugestões do fim dentro do canal do próprio filme. */
            src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
            title={`Trailer de ${title}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            className="h-full w-full border-0"
          />
        </div>

        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="q mt-3 inline-flex items-center gap-1.5 text-[11.5px] text-ink-dim transition-colors hover:text-beam"
        >
          Abrir no YouTube
        </a>
      </div>
    </dialog>
  );
}

/* ── states ───────────────────────────────────────────────────────────── */

export function Blank({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="max-w-[58ch] py-10">
      <p className="font-display text-[18px] tracking-[0.1em] text-ink-dim uppercase">{title}</p>
      {children ? <p className="mt-2 text-[13.5px] leading-relaxed text-ink-dim">{children}</p> : null}
    </div>
  );
}

export function Fault({ children, detail }: { children: React.ReactNode; detail?: string }) {
  return (
    <div role="alert" className="rounded-cell bg-dye-red/10 px-4 py-3 text-[13.5px] text-ink ring-1 ring-dye-red/45">
      {children}
      {detail ? <span className="q mt-1 block text-[11.5px] text-ink-dim">{detail}</span> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-cell bg-white/[0.05]', className)} />;
}

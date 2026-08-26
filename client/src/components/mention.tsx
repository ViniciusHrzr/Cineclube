import { useEffect, useMemo, useRef, useState } from 'react';
import { Reel } from '@/components/bits';
import { initialsOf, reelColor, type Reviewer } from '@/lib/api';
import { cn, norm } from '@/lib/utils';
import { useClub } from '@/App';

/* ══════════════════════════════════════════════════════════════════════════
   Chamar alguém pelo nome.

   Duas coisas escrevem neste produto: o comentário numa conversa e o
   comentário que a pessoa deixa ao avaliar um filme. As duas ganham o mesmo
   campo, porque chamar alguém é a mesma ação nos dois lugares e um `@` que
   funciona num e não no outro é um `@` que ninguém confia.

   ── por que uma lista e não só texto ────────────────────────────────────
   Porque o apelido não é o nome. "Beren Costa" é chamada de `@beren`, e dois
   Brunos viram `@brunosa` e `@brunolima` — regra que o servidor calcula sobre o
   clube inteiro (ver handles.js) e entrega pronta em cada avaliador. Ninguém
   deveria ter de adivinhar isso, então a lista aparece e a escolha é do dedo.

   ── o cursor é o assunto ────────────────────────────────────────────────
   Tudo aqui gira em torno de uma pergunta: onde o `@` que estou escrevendo
   começa? A resposta é o último `@` antes do cursor que não tem letra colada
   atrás dele — sem essa segunda metade, um e-mail no meio da frase abriria a
   lista, e a pessoa levaria um menu na cara por ter escrito um endereço.
   ══════════════════════════════════════════════════════════════════════════ */

/** O `@` aberto imediatamente antes do cursor, ou null. */
function openMention(text: string, caret: number) {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at < 0) return null;
  // Colado em letra ou número: é e-mail, não menção.
  if (at > 0 && /[a-zA-Z0-9._-]/.test(upto[at - 1])) return null;
  const typed = upto.slice(at + 1);
  // Uma menção não tem espaço dentro. Passou disso, a pessoa seguiu escrevendo.
  if (/\s/.test(typed)) return null;
  return { at, typed };
}

export function MentionField({
  value,
  onChange,
  onSubmit,
  placeholder,
  rows = 2,
  maxLength,
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Enter sem shift. Ausente onde Enter deve apenas quebrar a linha. */
  onSubmit?: () => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  /** Para quem lê a tela em vez de olhar para ela. */
  label: string;
  className?: string;
}) {
  const club = useClub();
  const box = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState<{ at: number; typed: string } | null>(null);
  const [pick, setPick] = useState(0);

  /* Quem pode ser chamado: todo mundo, inclusive você — mencionar-se não avisa
     ninguém (o servidor recusa avisar a si mesmo), mas escrever "como o @gipico
     disse" sobre si próprio é uma frase legítima e a lista não deveria fingir
     que você não existe. */
  const found = useMemo(() => {
    if (!open) return [];
    const typed = norm(open.typed);
    return club.reviewers
      .filter(r => r.handle && (!typed || r.handle.startsWith(typed) || norm(r.name).includes(typed)))
      .slice(0, 6);
  }, [open, club.reviewers]);

  useEffect(() => setPick(0), [open?.typed]);

  function readCaret() {
    const el = box.current;
    if (!el) return;
    setOpen(openMention(el.value, el.selectionStart ?? el.value.length));
  }

  /* Troca o pedaço que está sendo digitado pelo apelido inteiro e deixa um
     espaço: a frase continua sem a pessoa ter de sair do meio dela. */
  function choose(who: Reviewer) {
    const el = box.current;
    if (!el || !open || !who.handle) return;
    const caret = el.selectionStart ?? value.length;
    const next = `${value.slice(0, open.at)}@${who.handle} ${value.slice(caret)}`;
    const to = open.at + who.handle.length + 2;
    onChange(next);
    setOpen(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(to, to);
    });
  }

  return (
    <div className={cn('relative', className)}>
      <label className="block">
        <span className="sr-only">{label}</span>
        <textarea
          ref={box}
          rows={rows}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-autocomplete="list"
          aria-expanded={!!found.length}
          onChange={e => {
            onChange(e.target.value);
            // Depois do valor novo, senão a leitura é do texto anterior.
            requestAnimationFrame(readCaret);
          }}
          onClick={readCaret}
          onBlur={() => {
            /* Um quadro de atraso: o clique na lista acontece depois do blur do
               campo, e fechar na hora tiraria o alvo debaixo do dedo. */
            window.setTimeout(() => setOpen(null), 120);
          }}
          onKeyDown={e => {
            if (found.length) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                return setPick(p => (p + 1) % found.length);
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                return setPick(p => (p - 1 + found.length) % found.length);
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                return choose(found[pick]);
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                return setOpen(null);
              }
            }
            /* Enter envia — mas nunca enquanto a lista está aberta, senão
               escolher alguém publicaria o comentário pela metade. */
            if (onSubmit && e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
            requestAnimationFrame(readCaret);
          }}
          className="w-full resize-y rounded-cell bg-house-deep px-3 py-2 text-[13px] leading-relaxed text-ink caret-dye-red ring-1 ring-house-rail placeholder:text-ink-dim focus-visible:ring-dye-brass"
        />
      </label>

      {found.length ? (
        /* Acima do campo e não abaixo: numa conversa o campo é a última coisa
           da gaveta, e uma lista para baixo abriria fora da carta ou empurraria
           a página inteira enquanto a pessoa digita. */
        <ul
          role="listbox"
          aria-label="Quem chamar"
          className="plate absolute bottom-[calc(100%+4px)] left-0 z-30 w-[min(260px,100%)] overflow-hidden p-0"
        >
          {found.map((r, i) => (
            <li key={r.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === pick}
                onMouseDown={e => e.preventDefault()}
                onClick={() => choose(r)}
                onMouseEnter={() => setPick(i)}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-100',
                  i === pick ? 'bg-beam/[0.08]' : 'hover:bg-beam/[0.05]'
                )}
              >
                <Reel color={reelColor(r.dot, r.id)} src={r.avatar} size="sm">
                  {initialsOf(r.name)}
                </Reel>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{r.name}</span>
                <span className="q flex-none text-[11px] text-dye-brass">@{r.handle}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ── e o nome, depois de escrito ──────────────────────────────────────────
   Um comentário guardado é texto puro; quem foi chamado é decidido na leitura,
   contra o clube de agora. Isso tem uma consequência que vale conhecer: se
   alguém trocar o próprio nome, menções antigas deixam de acender. O texto
   continua dizendo o que foi escrito, que é o registro honesto — o link é que
   é uma leitura do presente.

   Em latão, que é a cor de estado desta sala: uma menção é uma pessoa apontada,
   não uma ação nem um destaque. */
export function WithMentions({ text }: { text: string }) {
  const club = useClub();
  const handles = useMemo(
    () =>
      club.reviewers
        .filter(r => r.handle)
        .map(r => r.handle as string)
        .sort((a, b) => b.length - a.length),
    [club.reviewers]
  );

  if (!text.includes('@') || !handles.length) return <>{text}</>;

  /* O maior apelido primeiro, senão "@brunosa" sairia como "@bruno" mais um
     "sa" solto — a mesma ordem que o servidor usa para decidir quem foi
     chamado, pela mesma razão. */
  const pattern = new RegExp(`(^|[^a-zA-Z0-9@._-])@(${handles.join('|')})(?![a-z0-9])`, 'gi');
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(text)) !== null) {
    const start = m.index + m[1].length;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <span key={`${start}`} className="text-dye-brass">
        @{m[2]}
      </span>
    );
    last = start + m[2].length + 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

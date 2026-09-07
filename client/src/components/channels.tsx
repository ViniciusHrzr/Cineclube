import { useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform, useVelocity } from 'framer-motion';
import { fmt, type Criterion } from '@/lib/api';
import { cn } from '@/lib/utils';

/* ── as réguas de critério ────────────────────────────────────────────────
   Um critério por linha: nome e nota em cima, a régua inteira embaixo, e a
   explicação sob ela. A explicação é impressa para todo mundo em vez de ficar
   atrás de um hover, e a régua continua sendo um `input[type=range]` nativo —
   é o que mantém o teclado e o leitor de tela funcionando.

   Saiu da tela de avaliar e virou peça no dia em que um EPISÓDIO passou a ter
   ficha própria. As duas fichas são a mesma interação sobre listas de critérios
   diferentes: onze para um filme, nove para um episódio. Copiar isto seria ter
   duas réguas que divergem na terceira mexida — e esta é a interação-assinatura
   do produto, a que não pode ter duas versões. */

export function Channels({
  criteria,
  scores,
  genre,
  crew,
  onChange,
}: {
  criteria: Criterion[];
  scores: Record<string, number>;
  /** Só para a legenda do grupo de gênero. Uma ficha sem esse grupo não a usa. */
  genre?: string;
  /** Quem assina cada critério. Vazio quando ninguém está creditado. */
  crew?: Record<string, string[]>;
  onChange: (key: string, value: number) => void;
}) {
  /* Agrupado pelo que o servidor declara, e não pelo peso. O peso era o atalho —
     ×1 era ofício, ×2 era gênero — e no dia em que todo peso virou 1 esse atalho
     passou a juntar as perguntas numa lista só. */
  const craft = criteria.filter(c => c.group === 'oficio');
  const gen = criteria.filter(c => c.group === 'genero');
  const personal = criteria.filter(c => c.group === 'pessoal');
  let i = 0;
  const row = (c: Criterion) => (
    <Channel
      key={c.key}
      c={c}
      index={i++}
      value={scores[c.key] ?? 5}
      signers={crew?.[c.key]}
      onChange={onChange}
    />
  );

  return (
    <div className="plate overflow-hidden px-4 pb-4 sm:px-5">
      {/* Não "técnicos". Dois gêneros substituem uma vaga destes oito — animação
          é perguntada sobre elenco de voz e não sobre atuação, documentário
          sobre acesso e material —, então a palavra que descrevia o grupo o
          descreveria errado para dois deles. */}
      <p className="legend py-4">Como {gen.length ? 'o filme' : 'o episódio'} é feito</p>
      {craft.map(row)}

      {/* ── o grupo do gênero, e só quando ele existe ──────────────────────
          Uma ficha de episódio não tem esse par: um gênero é uma promessa que
          uma OBRA faz, e o quinto episódio de uma série de terror pode ser o de
          tribunal (ver criteria.js). Sem a guarda, a legenda apareceria sobre
          uma lista vazia — um cabeçalho anunciando nada. */}
      {gen.length ? (
        <>
          <p className="legend mt-5 border-t border-white/[0.07] pt-5 text-dye-brass">
            O que {(genre ?? '').toLowerCase()} pede
          </p>
          {gen.map(row)}
        </>
      ) : null}

      {/* Região própria, no fim, porque é outra pergunta: tudo acima pergunta o
          que a obra faz, e este pergunta o que ela fez com você — e se responde
          depois de ter desmontado a obra, nunca antes. */}
      {personal.length ? (
        <>
          <p className="legend mt-5 border-t border-white/[0.07] pt-5">E o seu</p>
          {personal.map(row)}
        </>
      ) : null}
    </div>
  );
}

function Channel({
  c,
  index,
  value,
  signers,
  onChange,
}: {
  c: Criterion;
  index: number;
  value: number;
  signers?: string[];
  onChange: (key: string, value: number) => void;
}) {
  /* ── a comporta e a luz ─────────────────────────────────────────────────
     O trecho de película exposto é a nota, e ele NÃO é animado — de propósito.
     Uma faixa preenchida não é um objeto com massa, é o valor desenhado como
     comprimento, e um valor que chega depois da mão que o pôs faz o controle
     parecer quebrado. Foi uma mola aqui primeiro, subindo meio tempo atrás da
     comporta, e lia como atraso porque era atraso.

     O que é animado é o clarão na comporta — o facho florescendo enquanto a
     película corre. A posição é exata e instantânea; só a intensidade se move,
     movida pela velocidade da nota e apagando quando ela para.

     O número fica quieto. Ele inchava numa mola, o que significa texto
     rasterizado em escala fracionária a cada quadro — era isso que piscava, e
     não há ajuste que conserte: tipo rasterizado a 1,06× é uma versão borrada
     de si mesmo. */
  const gate = useMotionValue(value);
  useEffect(() => {
    gate.set(value);
  }, [value, gate]);

  const rush = useVelocity(gate);
  const flare = useSpring(useTransform(rush, [-16, 0, 16], [1, 0, 1]), {
    stiffness: 240,
    damping: 28,
  });
  const bloom = useTransform(flare, [0, 1], [0, 0.9]);
  const spread = useTransform(flare, [0, 1], [0.9, 1.85]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1], delay: Math.min(index, 9) * 0.026 }}
      className="group border-t border-white/[0.06] py-4 first-of-type:border-0"
    >
      {/* Sem distintivo de peso. Ele lia ×1 ou ×2 e carregava o único fato que
          separava as duas metades da ficha; com todo critério no mesmo peso ele
          imprimiria ×1 onze vezes, que é uma coluna de nada vestida de dado. */}
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[15px] uppercase tracking-[0.1em] text-ink">{c.name}</span>
        <span className="q ml-auto text-[21px] font-medium tabular-nums text-ink transition-colors duration-150 group-hover:text-beam group-focus-within:text-beam">
          {fmt(value)}
        </span>
      </div>

      {/* ── quem assina ────────────────────────────────────────────────────
          O nome vai ACIMA da régua e não na explicação embaixo dela, porque é a
          coisa sendo julgada e não uma explicação do julgamento. Arrastar
          Fotografia de 5 para 8 é um juízo sobre o trabalho de alguém, e a ficha
          deve dizer de quem enquanto a mão está nela.

          Calado quando ninguém é creditado. Numa animação raramente há diretor
          de fotografia e ninguém assina Originalidade — uma linha com "—"
          inventaria uma ausência que não existe. */}
      {signers?.length ? (
        <p className="mt-1 text-[12px] leading-snug text-beam-dim">{signers.join(' · ')}</p>
      ) : null}

      {/* Tudo o que se vê é desenhado aqui; o input é invisível e fica por cima,
          onde continua recebendo o arrasto, as setas e o leitor de tela. Ele vem
          primeiro no DOM para que as partes desenhadas reajam a ele como irmãs —
          pressionado, focado — e o z-10 o devolve para cima delas no ponteiro. */}
      <div className="relative mt-2 h-[34px]">
        <input
          type="range"
          min={0}
          max={10}
          step={0.5}
          value={value}
          onChange={e => onChange(c.key, parseFloat(e.target.value))}
          aria-label={c.name}
          aria-describedby={`hint-${c.key}`}
          className="peer film-range absolute inset-0 z-10 w-full"
        />

        {/* Recuado por metade da área de pega, para 0% e 100% caírem sob o meio
            da comporta em vez de fora da ponta da película. */}
        <span aria-hidden className="pointer-events-none absolute inset-x-2 top-3 h-[10px]">
          <span className="film-strip absolute inset-0" />
          {/* Largura, e não scaleX: escalar estica o gradiente rasterizado e o
              brilho interno junto, e a borda borrada tremendo de quadro em
              quadro era metade do que parecia flicker. */}
          <span className="film-strip-lit absolute inset-y-0 left-0" style={{ width: `${value * 10}%` }} />
          <motion.span
            style={{ left: `${value * 10}%`, marginLeft: -13, opacity: bloom, scale: spread }}
            className="absolute -top-[7px] h-[24px] w-[26px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,231,180,0.9),transparent_70%)] transition-[left] duration-[130ms] ease-beam"
          />
        </span>

        {/* A comporta. Pressionada, ela cresce no quadro e queima mais forte;
            focada pelo teclado, ela recebe o anel que o input abriu mão. */}
        <span
          aria-hidden
          style={{ left: `calc(0.5rem + (100% - 1rem) * ${value / 10})` }}
          className={cn(
            'film-gate pointer-events-none absolute top-1 -ml-[2px] h-[26px] w-[4px]',
            'transition-[left,transform,box-shadow] duration-[130ms] ease-beam',
            'peer-active:scale-y-[1.16] peer-active:shadow-[0_0_0_1px_rgba(4,5,10,0.9),0_2px_10px_rgba(0,0,0,0.8),0_0_22px_rgba(255,214,150,0.7)]',
            'peer-focus-visible:shadow-[0_0_0_2px_theme(colors.dye.brass),0_0_18px_rgba(255,214,150,0.5)]'
          )}
        />
      </div>
      <p id={`hint-${c.key}`} className="mt-2 max-w-[70ch] text-[12px] leading-relaxed text-ink-dim">
        {c.hint}
      </p>
    </motion.div>
  );
}

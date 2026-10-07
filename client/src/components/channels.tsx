import { useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform, useVelocity } from 'framer-motion';
import { fmt, type Criterion } from '@/lib/api';
import { cn } from '@/lib/utils';

export function Channels({
  criteria,
  scores,
  genre,
  crew,
  still,
  onChange,
}: {
  criteria: Criterion[];
  scores: Record<string, number>;
  genre?: string;
  crew?: Record<string, string[]>;
  still?: boolean;
  onChange: (key: string, value: number) => void;
}) {
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
      still={still}
      onChange={onChange}
    />
  );

  return (
    <div className="plate overflow-hidden px-4 pb-4 sm:px-5">
      {}
      <p className="legend py-4">Como {gen.length ? 'o filme' : 'o episódio'} é feito</p>
      {craft.map(row)}

      {}
      {gen.length ? (
        <>
          <p className="legend mt-5 border-t border-white/[0.07] pt-5 text-dye-brass">
            O que {(genre ?? '').toLowerCase()} pede
          </p>
          {gen.map(row)}
        </>
      ) : null}

      {}
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
  still,
  onChange,
}: {
  c: Criterion;
  index: number;
  value: number;
  signers?: string[];
  still?: boolean;
  onChange: (key: string, value: number) => void;
}) {
  const Row = still ? 'div' : motion.div;
  const entrada = still
    ? {}
    : {
        initial: { opacity: 0, y: 10 },
        animate: { opacity: 1, y: 0 },
        transition: {
          duration: 0.32,
          ease: [0.16, 1, 0.3, 1] as const,
          delay: Math.min(index, 9) * 0.026,
        },
      };

  return (
    <Row
      {...entrada}
      className="group border-t border-white/[0.06] py-4 first-of-type:border-0"
    >
      {}
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[15px] uppercase tracking-[0.1em] text-ink">{c.name}</span>
        <span className="q ml-auto text-[21px] font-medium tabular-nums text-ink transition-colors duration-150 group-hover:text-beam group-focus-within:text-beam">
          {fmt(value)}
        </span>
      </div>

      {}
      {signers?.length ? (
        <p className="mt-1 text-[12px] leading-snug text-beam-dim">{signers.join(' · ')}</p>
      ) : null}

      <Gauge
        value={value}
        onChange={v => onChange(c.key, v)}
        label={c.name}
        describedBy={`hint-${c.key}`}
        className="mt-2"
      />
      <p id={`hint-${c.key}`} className="mt-2 max-w-[70ch] text-[12px] leading-relaxed text-ink-dim">
        {c.hint}
      </p>
    </Row>
  );
}

export function Gauge({
  value,
  onChange,
  label,
  describedBy,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  describedBy?: string;
  className?: string;
}) {
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
    <div className={cn('relative h-[34px]', className)}>
      <input
        type="range"
        min={0}
        max={10}
        step={0.5}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        aria-label={label}
        aria-describedby={describedBy}
        className="peer film-range absolute inset-0 z-10 w-full"
      />

      {}
      <span aria-hidden className="pointer-events-none absolute inset-x-2 top-3 h-[10px]">
        <span className="film-strip absolute inset-0" />
        {}
        <span className="film-strip-lit absolute inset-y-0 left-0" style={{ width: `${value * 10}%` }} />
        <motion.span
          style={{ left: `${value * 10}%`, marginLeft: -13, opacity: bloom, scale: spread }}
          className="absolute -top-[7px] h-[24px] w-[26px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,231,180,0.9),transparent_70%)] transition-[left] duration-[130ms] ease-beam"
        />
      </span>

      {}
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
  );
}

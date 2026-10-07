import { forwardRef, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Fault, Key } from '@/components/bits';
import { HolographicWall } from '@/components/ui/holographic-wall-shadcnui';
import { api, auth, fmt, type Review, type SessionUser } from '@/lib/api';
import { inShell, openOutside } from '@/lib/shell';
import { cn } from '@/lib/utils';

function errorFromHash() {
  const raw = (location.hash || '').replace(/^#/, '');
  const q = raw.indexOf('?');
  if (q < 0) return null;
  const got = new URLSearchParams(raw.slice(q + 1)).get('erro');
  return got || null;
}

type Ficha = {
  id: number;
  title: string;
  year: number | null;
  poster: string;
  director: string | null;
  average: number;
  takes: number;
};

type Acervo = { fichas: number; filmes: number; pessoas: number };

const MAX_MOSTRA = 3;

const CLUBE = 'cineclube';

function abrirGoogle(e: React.MouseEvent<HTMLAnchorElement>) {
  if (!inShell()) return;
  e.preventDefault();
  openOutside(e.currentTarget.href);
}

function Marca({ size }: { size: 'sm' | 'lg' }) {
  const grande = size === 'lg';
  return (
    <div className="flex items-baseline gap-3">
      <span
        className={cn(
          'font-display leading-none text-beam',
          grande
            ? 'text-[46px] tracking-[0.1em] sm:text-[62px] lg:text-[74px]'
            : 'text-[30px] tracking-[0.16em] sm:text-[38px]'
        )}
      >
        CINECLUBE
      </span>
      <span
        aria-hidden
        className={cn(
          'inline-block flex-none animate-lamp rounded-full bg-dye-red shadow-[0_0_10px_rgba(242,86,74,0.85)]',
          grande ? 'h-[11px] w-[11px]' : 'h-[7px] w-[7px]'
        )}
      />
    </div>
  );
}

export function SignIn({ onSignedIn }: { onSignedIn: (u: SessionUser) => void }) {
  const [google, setGoogle] = useState(true);
  const [error] = useState<string | null>(() => errorFromHash());
  const [door, setDoor] = useState<'entrar' | 'criar' | null>(error ? 'entrar' : null);
  const [forgot, setForgot] = useState<string | null>(null);
  const [canMail, setCanMail] = useState(false);
  const [fichas, setFichas] = useState<Ficha[] | null>(null);
  const [acervo, setAcervo] = useState<Acervo | null>(null);

  useEffect(() => {
    void auth
      .me()
      .then(r => {
        setGoogle(r.google !== false);
        setCanMail(r.mail === true);
      })
      .catch(() => setGoogle(true));
  }, []);

  useEffect(() => {
    let vivo = true;
    void api<{ reviews: Review[] }>(`/api/c/${CLUBE}/reviews`)
      .then(({ reviews }) => {
        if (!vivo) return;
        setAcervo({
          fichas: reviews.length,
          filmes: new Set(reviews.map(r => r.movieId)).size,
          pessoas: new Set(reviews.map(r => r.reviewerId)).size,
        });
        const por = new Map<number, Ficha & { soma: number }>();
        for (const r of reviews) {
          if (!r.moviePoster) continue;
          const tem = por.get(r.movieId);
          if (tem) {
            tem.soma += r.final;
            tem.takes += 1;
            tem.average = tem.soma / tem.takes;
            continue;
          }
          por.set(r.movieId, {
            id: r.movieId,
            title: r.movieTitle,
            year: r.movieYear,
            poster: r.moviePoster,
            director: r.movieDirector,
            average: r.final,
            soma: r.final,
            takes: 1,
          });
        }
        setFichas(
          [...por.values()]
            .sort((a, b) => b.average - a.average)
            .slice(0, MAX_MOSTRA)
            .map(({ soma: _soma, ...f }) => f)
        );
      })
      .catch(() => setFichas([]));
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (errorFromHash()) history.replaceState(null, '', location.pathname + '#entrar');
  }, []);

  function abrir(qual: 'entrar' | 'criar') {
    setForgot(null);
    setDoor(qual);
  }

  const mostra = fichas === null || fichas.length > 0;

  return (
    <div className="relative flex min-h-[calc(100dvh/var(--ui-zoom))] flex-col overflow-x-hidden">
      <HolographicWall asBackdrop />

      <div className="relative z-[1] flex flex-1 flex-col">
        <header className="mx-auto flex w-full max-w-[1240px] items-center justify-between gap-6 px-5 py-5 lg:px-6 lg:py-6">
          {door === null ? <span /> : <Marca size="sm" />}
          {door === null ? (
            <Key tone="ghost" onClick={() => abrir('entrar')}>
              Entrar
            </Key>
          ) : (
            <span />
          )}
        </header>

        <section
          className={cn(
            'mx-auto grid w-full max-w-[1240px] flex-1 items-center gap-10 px-5 py-8 lg:gap-16 lg:px-6 lg:py-10',
            mostra
              ? 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]'
              : 'max-w-[520px] grid-cols-1'
          )}
        >
          <div className="min-w-0">
            <AnimatePresence initial={false} mode="wait">
              {door === null ? (
                <motion.div
                  key="convite"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Convite
                    google={google}
                    onCriar={() => abrir('criar')}
                    onEntrar={() => abrir('entrar')}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="porta"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Porta
                    mode={door}
                    onMode={setDoor}
                    google={google}
                    canMail={canMail}
                    error={error}
                    forgot={forgot}
                    onForgot={setForgot}
                    onSignedIn={onSignedIn}
                    onClose={() => {
                      setForgot(null);
                      setDoor(null);
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {mostra ? <Mostra fichas={fichas} acervo={acervo} /> : null}
        </section>

        <footer className="border-t border-white/[0.06]">
          <div className="mx-auto w-full max-w-[1240px] px-5 py-5 lg:px-6 lg:py-6">
            <span className="text-[10.5px] text-ink-dim">Imagens e catálogo: TMDB</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Convite({
  google,
  onCriar,
  onEntrar,
}: {
  google: boolean;
  onCriar: () => void;
  onEntrar: () => void;
}) {
  return (
    <div className="flex w-full max-w-[420px] flex-col gap-3">
      <Marca size="lg" />
      <div className="mt-9" />
      <Key tone="commit" onClick={onCriar} className="w-full px-6 py-4 text-[14px]">
        Criar minha conta
      </Key>
      {google ? (
        <a
          href={auth.googleUrl}
          onClick={abrirGoogle}
          className={cn(
            'flex w-full items-center justify-center gap-2.5 rounded-cell px-6 py-4 no-underline',
            'bg-house-seat/70 ring-1 ring-house-rail',
            'font-display text-[14px] uppercase leading-none tracking-[0.14em] text-ink',
            'transition-colors duration-150 hover:text-beam hover:ring-beam/70',
            'coarse:min-h-[44px]'
          )}
        >
          <GoogleMark />
          Entrar com Google
        </a>
      ) : (
        <Key tone="flush" onClick={onEntrar} className="w-full px-6 py-4 text-[14px]">
          Já tenho conta
        </Key>
      )}
    </div>
  );
}

function Porta({
  mode,
  onMode,
  google,
  canMail,
  error,
  forgot,
  onForgot,
  onSignedIn,
  onClose,
}: {
  mode: 'entrar' | 'criar';
  onMode: (m: 'entrar' | 'criar') => void;
  google: boolean;
  canMail: boolean;
  error: string | null;
  forgot: string | null;
  onForgot: (email: string | null) => void;
  onSignedIn: (u: SessionUser) => void;
  onClose: () => void;
}) {
  const criando = mode === 'criar';
  const pedindo = forgot !== null;

  return (
    <div className="w-full max-w-[420px]">
      <h1 className="font-display text-[32px] uppercase leading-[0.95] tracking-[0.04em] text-beam sm:text-[40px]">
        {pedindo ? 'Volte para dentro.' : criando ? 'Puxe uma cadeira.' : 'De volta à sala.'}
      </h1>

      {error ? (
        <div className="mt-5">
          <Fault>{error}</Fault>
        </div>
      ) : null}

      {pedindo ? (
        <ForgotPassword email={forgot} onBack={() => onForgot(null)} />
      ) : (
        <>
          {google ? (
            <>
              <a
                href={auth.googleUrl}
                onClick={abrirGoogle}
                className={cn(
                  'mt-6 flex w-full items-center justify-center gap-3 rounded-cell px-4 py-3 no-underline',
                  'bg-house-seat/70 ring-1 ring-house-rail',
                  'font-display text-[13px] uppercase leading-none tracking-[0.14em] text-ink',
                  'transition-colors duration-150 hover:text-beam hover:ring-beam/70',
                  'coarse:min-h-[44px]'
                )}
              >
                <GoogleMark />
                {criando ? 'Criar conta com o Google' : 'Entrar com o Google'}
              </a>
              <div className="mt-5 flex items-center gap-3">
                <span aria-hidden className="h-px flex-1 bg-white/[0.07]" />
                <span className="legend text-[10px]">ou</span>
                <span aria-hidden className="h-px flex-1 bg-white/[0.07]" />
              </div>
            </>
          ) : null}

          <PasswordEntry
            mode={mode}
            onMode={onMode}
            onSignedIn={onSignedIn}
            canMail={canMail}
            onForgot={onForgot}
          />
        </>
      )}

      <button
        type="button"
        onClick={onClose}
        className="mt-6 font-display text-[12px] uppercase leading-none tracking-[0.14em] text-ink-dim transition-colors hover:text-beam"
      >
        ← Voltar
      </button>
    </div>
  );
}

const SLOTS = [
  { x: '-140%', y: '8.7%', rotate: -9, scale: 0.879, zIndex: 1, opacity: 0.9 },
  { x: '-50%', y: '0%', rotate: -2, scale: 1, zIndex: 3, opacity: 1 },
  { x: '40%', y: '3.8%', rotate: 8, scale: 0.879, zIndex: 1, opacity: 0.9 },
];

const HOVER: ({ rotate: number; y: string } | null)[] = [
  { rotate: -11, y: '6.8%' },
  null,
  { rotate: 10, y: '1.9%' },
];

function posicoesDe(n: number) {
  if (n >= 3) return [0, 1, 2];
  if (n === 2) return [0, 1];
  return [1];
}

function Mostra({ fichas, acervo }: { fichas: Ficha[] | null; acervo: Acervo | null }) {
  const quieto = useReducedMotion();

  const carregando = fichas === null;
  const lista = carregando ? [] : fichas.slice(0, MAX_MOSTRA);
  const n = carregando ? MAX_MOSTRA : lista.length;
  const posicoes = posicoesDe(n);
  const meio = posicoes.indexOf(1);

  const [ordem, setOrdem] = useState<number[]>(() => posicoes.map((_, i) => i));
  useEffect(() => {
    setOrdem(Array.from({ length: n }, (_, i) => i));
  }, [n]);

  const centro = lista[ordem[meio]] ?? lista[0] ?? null;

  function trazer(k: number) {
    if (k === meio) return;
    setOrdem(atual => {
      const prox = [...atual];
      [prox[meio], prox[k]] = [prox[k], prox[meio]];
      return prox;
    });
  }

  return (
    <div className="min-w-0 py-2 lg:py-6">
      <div className="relative mx-auto aspect-[1/0.58] w-full max-w-[680px]">
        {posicoes.map((slot, k) => {
          const ficha = lista[ordem[k]] ?? null;
          const alvo = SLOTS[slot];
          const hover = HOVER[slot];
          const atras = slot !== 1;
          const noAlto = slot === 2;

          return (
            <motion.div
              key={ficha ? `f${ficha.id}` : `vazia-${k}`}
              className={cn(
                'absolute left-1/2 top-0 aspect-[2/3] w-[35%] overflow-hidden rounded-cell',
                ficha ? 'bg-house-deep' : 'bg-house-seat',
                slot === 1
                  ? 'shadow-[0_34px_70px_-20px_rgba(0,0,0,0.92)]'
                  : 'shadow-[0_24px_50px_-18px_rgba(0,0,0,0.9)]'
              )}
              initial={
                quieto || !ficha ? alvo : { ...alvo, y: '16%', opacity: 0, rotate: alvo.rotate * 0.3 }
              }
              animate={alvo}
              whileHover={quieto || !ficha ? undefined : (hover ?? undefined)}
              transition={
                quieto
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 190, damping: 26, mass: 0.9 }
              }
            >
              {ficha ? (
                <img
                  src={ficha.poster}
                  alt=""
                  draggable={false}
                  className="h-full w-full object-cover"
                />
              ) : null}

              {ficha ? (
                <>
                  <span
                    aria-hidden
                    className={cn(
                      'pointer-events-none absolute inset-x-0 h-1/3',
                      noAlto
                        ? 'top-0 bg-gradient-to-b from-house-deep/90 to-transparent'
                        : 'bottom-0 bg-gradient-to-t from-house-deep/90 to-transparent'
                    )}
                  />
                  <span
                    aria-hidden
                    className={cn(
                      'q pointer-events-none absolute font-display leading-none',
                      atras
                        ? 'text-[17px] text-dye-brass sm:text-[19px]'
                        : 'text-[23px] text-beam sm:text-[26px]',
                      noAlto ? 'right-2.5 top-2.5' : 'bottom-2.5',
                      slot === 0 ? 'left-2.5' : 'right-2.5'
                    )}
                  >
                    {fmt(ficha.average)}
                  </span>
                  {atras ? (
                    <button
                      type="button"
                      onClick={() => trazer(k)}
                      aria-label={`Pôr ${ficha.title} em destaque — nota ${fmt(ficha.average)}`}
                      className="absolute inset-0 cursor-pointer focus-visible:outline-offset-[-4px]"
                    />
                  ) : null}
                </>
              ) : null}
            </motion.div>
          );
        })}

      </div>

      <div
        aria-live="polite"
        className="mx-auto mt-5 min-h-[52px] max-w-[680px] border-t border-white/[0.06] pt-4"
      >
        {centro ? (
          <motion.div
            key={`legenda-${centro.id}`}
            initial={quieto ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="min-w-0"
          >
            <div className="truncate font-display text-[24px] uppercase leading-[1.15] tracking-[0.03em] text-beam sm:text-[28px]">
              {centro.title}
            </div>
            <div className="mt-1 truncate text-[11.5px] text-ink-dim">
              {[centro.director, centro.year].filter(Boolean).join(' · ')}
            </div>
          </motion.div>
        ) : null}
      </div>

      {acervo?.fichas ? (
        <p className="mx-auto mt-3 flex max-w-[680px] flex-wrap items-baseline gap-x-2 gap-y-1 font-display text-[11.5px] uppercase leading-none tracking-[0.13em] text-ink-dim">
          <Conta n={acervo.fichas} one="ficha gravada" many="fichas gravadas" />
          <span aria-hidden>·</span>
          <Conta n={acervo.filmes} one="filme" many="filmes" />
          <span aria-hidden>·</span>
          <Conta n={acervo.pessoas} one="pessoa" many="pessoas" />
        </p>
      ) : null}
    </div>
  );
}

function Conta({ n, one, many }: { n: number; one: string; many: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="q text-[13px] text-beam">{n}</span>
      {n === 1 ? one : many}
    </span>
  );
}

function PasswordEntry({
  mode,
  onMode,
  onSignedIn,
  canMail,
  onForgot,
}: {
  mode: 'entrar' | 'criar';
  onMode: (m: 'entrar' | 'criar') => void;
  onSignedIn: (u: SessionUser) => void;
  canMail: boolean;
  onForgot: (email: string) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  const criando = mode === 'criar';

  useEffect(() => {
    first.current?.focus();
  }, [criando]);

  const curta = criando && password.length > 0 && password.length < 8;
  const pronto = criando
    ? !!name.trim() && !!email.trim() && password.length >= 8
    : !!email.trim() && !!password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !pronto) return;
    setBusy(true);
    setError(null);
    try {
      const { reviewer } = criando
        ? await auth.register(name.trim(), email.trim(), password)
        : await auth.login(email.trim(), password);
      onSignedIn(reviewer);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
      {}
      {criando ? (
        <Field
          ref={first}
          label="Como te chamam"
          autoComplete="name"
          maxLength={60}
          value={name}
          onChange={setName}
        />
      ) : null}
      <Field
        ref={criando ? undefined : first}
        label="E-mail"
        type="email"
        autoComplete="username"
        value={email}
        onChange={setEmail}
      />
      <Field
        label="Senha"
        type="password"
        autoComplete={criando ? 'new-password' : 'current-password'}
        value={password}
        onChange={setPassword}
        hint={criando ? 'Pelo menos 8 caracteres.' : undefined}
        bad={curta}
      />

      {error ? <Fault>{error}</Fault> : null}

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Key tone="commit" type="submit" disabled={busy || !pronto}>
          {busy ? (criando ? 'Criando' : 'Entrando') : criando ? 'Criar conta' : 'Entrar'}
        </Key>
        {}
        <Key
          tone="ghost"
          onClick={() => {
            setError(null);
            onMode(criando ? 'entrar' : 'criar');
          }}
        >
          {criando ? 'Já tenho conta' : 'Criar uma conta'}
        </Key>
      </div>

      {}
      {!criando && canMail ? (
        <button
          type="button"
          onClick={() => onForgot(email.trim())}
          className="mt-1 self-start text-[12.5px] text-ink-dim underline underline-offset-4 transition-colors hover:text-ink"
        >
          Esqueci minha senha
        </button>
      ) : null}
    </form>
  );
}

function ForgotPassword({ email: inicial, onBack }: { email: string; onBack: () => void }) {
  const [email, setEmail] = useState(inicial);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await auth.requestReset(email.trim());
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <div className="mt-5">
        <p className="text-[13.5px] leading-relaxed text-ink">
          Se existir uma conta com <span className="text-beam">{email.trim()}</span>, o link está
          a caminho. Vale por uma hora.
        </p>
        <div className="mt-5">
          <Key tone="ghost" onClick={onBack}>
            Voltar
          </Key>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
      <Field ref={first} label="E-mail da conta" type="email" autoComplete="username" value={email} onChange={setEmail} />
      {error ? <Fault>{error}</Fault> : null}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Key tone="commit" type="submit" disabled={busy || !email.trim()}>
          {busy ? 'Mandando' : 'Mandar o link'}
        </Key>
        <Key tone="ghost" onClick={onBack}>
          Voltar
        </Key>
      </div>
    </form>
  );
}

export function SetPassword({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  const short = password.length > 0 && password.length < 8;
  const mismatch = again.length > 0 && again !== password;
  const ready = password.length >= 8 && again === password && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await auth.setPassword(password);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-[calc(100dvh/var(--ui-zoom))] flex-col">
      <HolographicWall asBackdrop />
      <div className="relative mx-auto flex w-full max-w-[900px] flex-1 flex-col justify-center px-5 py-14">
        <header className="mb-8 text-center">
          <h1 className="font-display text-[34px] leading-none tracking-[0.06em] text-beam">
            Guarde uma segunda chave
          </h1>
          <p className="mx-auto mt-4 max-w-[42ch] text-[13.5px] leading-relaxed text-ink-dim">
            O caminho de volta no dia em que a conta do Google não estiver à mão.
          </p>
        </header>

        <form onSubmit={submit} className="mx-auto flex w-full max-w-[380px] flex-col gap-3">
          <Field
            ref={first}
            label="Nova senha"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            hint="Pelo menos 8 caracteres."
            bad={short}
          />
          <Field
            label="De novo"
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={setAgain}
            hint={mismatch ? 'As duas não batem.' : undefined}
            bad={mismatch}
          />

          {error ? <Fault>{error}</Fault> : null}

          <div className="mt-1 flex items-center gap-2">
            <Key tone="commit" type="submit" disabled={!ready}>
              {busy ? 'Gravando' : 'Gravar senha'}
            </Key>
            <Key tone="ghost" onClick={onSkip}>
              Agora não
            </Key>
          </div>
        </form>
      </div>
    </div>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  bad?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>;

const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, value, onChange, hint, bad, ...rest },
  ref
) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="legend text-[10px]">{label}</span>
      <input
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        {...rest}
        className={cn(
          'w-full rounded-cell bg-house-deep px-3 py-2.5 text-[14px] text-ink caret-dye-red',
          'ring-1 transition-shadow placeholder:text-ink-dim',
          'focus-visible:outline-none focus-visible:ring-dye-brass',
          bad ? 'ring-dye-red-lit/60' : 'ring-house-rail',
          rest.className
        )}
      />
      {hint ? (
        <span className={cn('text-[12px]', bad ? 'text-dye-red-lit' : 'text-ink-dim')}>{hint}</span>
      ) : null}
    </label>
  );
});

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="h-[18px] w-[18px] flex-none">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59A14.5 14.5 0 0 1 9.77 24c0-1.6.28-3.14.76-4.59l-7.98-6.19A23.94 23.94 0 0 0 0 24c0 3.88.93 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Plus } from 'lucide-react';
import { Fault, Key, Reel } from '@/components/bits';
import { HolographicWall } from '@/components/ui/holographic-wall-shadcnui';
import { api, auth, initialsOf, post, reelColor, type Reviewer, type SessionUser } from '@/lib/api';
import { cn } from '@/lib/utils';

/* ══════════════════════════════════════════════════════════════════════════
   Quem está entrando.

   O clube assiste junto pelo Discord, cada um no seu navegador, então a sessão
   começa escolhendo quem você é e digitando quatro dígitos. É a mesma ideia da
   tela de perfis que a Netflix abre — só que aqui os perfis são fotogramas na
   parede iluminada, e não avatares num fundo cinza.
   ══════════════════════════════════════════════════════════════════════════ */

export function SignIn({ onSignedIn }: { onSignedIn: (u: SessionUser) => void }) {
  const [reviewers, setReviewers] = useState<Reviewer[] | null>(null);
  const [picked, setPicked] = useState<Reviewer | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<{ reviewers: Reviewer[] }>('/api/reviewers')
      .then(r => setReviewers(r.reviewers))
      .catch(e => setError((e as Error).message));

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="relative flex min-h-dvh flex-col">
      <HolographicWall asBackdrop />

      <div className="relative mx-auto flex w-full max-w-[900px] flex-1 flex-col justify-center px-5 py-14">
        <header className="mb-10 text-center">
          <h1 className="font-display text-[42px] leading-none tracking-[0.16em] text-beam sm:text-[56px]">
            CINECLUBE
          </h1>
          <p className="mt-3 text-[13.5px] text-ink-dim">
            {picked ? 'Digite seu PIN de 4 dígitos.' : creating ? 'Crie seu avaliador.' : 'Quem está avaliando?'}
          </p>
        </header>

        {error ? (
          <div className="mx-auto mb-6 w-full max-w-[420px]">
            <Fault detail={error}>Não foi possível carregar os avaliadores.</Fault>
          </div>
        ) : null}

        <AnimatePresence mode="wait">
          {creating ? (
            <motion.div
              key="new"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mx-auto w-full max-w-[380px]"
            >
              <NewReviewer
                onCancel={() => setCreating(false)}
                onCreated={async u => {
                  await load();
                  onSignedIn(u);
                }}
              />
            </motion.div>
          ) : picked ? (
            <motion.div
              key="pin"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mx-auto w-full max-w-[380px]"
            >
              <PinEntry reviewer={picked} onBack={() => setPicked(null)} onSignedIn={onSignedIn} />
            </motion.div>
          ) : (
            <motion.div
              key="pick"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-wrap items-start justify-center gap-6"
            >
              {reviewers?.map((r, i) => (
                <motion.button
                  key={r.id}
                  type="button"
                  onClick={() => setPicked(r)}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1], delay: Math.min(i, 8) * 0.045 }}
                  className="group flex w-[120px] flex-col items-center gap-3 sm:w-[136px]"
                >
                  <span
                    className="flex aspect-square w-full items-center justify-center rounded-plate font-display text-[38px] tracking-[0.06em] text-house-deep ring-1 ring-white/10 transition-transform duration-200 ease-beam group-hover:scale-[1.05] group-focus-visible:scale-[1.05]"
                    style={{ background: reelColor(r.dot, r.id) }}
                  >
                    {initialsOf(r.name)}
                  </span>
                  <span className="text-center text-[14px] text-ink-dim transition-colors group-hover:text-beam">
                    {r.name}
                    {r.isAdmin ? <span className="ml-1 text-[10px] text-dye-cyan">ADM</span> : null}
                    {!r.hasPin ? (
                      <span className="mt-0.5 block font-display text-[10px] uppercase tracking-[0.12em] text-dye-red-lit">
                        PIN pendente
                      </span>
                    ) : null}
                  </span>
                </motion.button>
              ))}

              {reviewers ? (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="group flex w-[120px] flex-col items-center gap-3 sm:w-[136px]"
                >
                  <span className="flex aspect-square w-full items-center justify-center rounded-plate text-ink-dim ring-1 ring-dashed ring-house-rail transition-colors group-hover:text-beam group-hover:ring-beam/40">
                    <Plus className="h-8 w-8" strokeWidth={1.4} />
                  </span>
                  <span className="text-[14px] text-ink-dim transition-colors group-hover:text-beam">Novo</span>
                </button>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ── the PIN pad ─────────────────────────────────────────────────────────
   Four cells that fill as you type. It is one real <input> underneath, so the
   keyboard, paste and a phone's numeric pad all work; the cells are only how
   it looks. */
function PinEntry({
  reviewer,
  onBack,
  onSignedIn,
}: {
  reviewer: Reviewer;
  onBack: () => void;
  onSignedIn: (u: SessionUser) => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(value: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await auth.login(reviewer.id, value);
      onSignedIn(res.reviewer);
    } catch (e) {
      setError((e as Error).message);
      setPin('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="plate p-6 text-center">
      <div className="mb-5 flex items-center justify-center gap-3">
        <Reel color={reelColor(reviewer.dot, reviewer.id)}>{initialsOf(reviewer.name)}</Reel>
        <span className="font-display text-[20px] uppercase tracking-[0.1em] text-beam">{reviewer.name}</span>
      </div>

      {!reviewer.hasPin ? (
        <p className="mb-5 text-[13px] leading-relaxed text-ink-dim">
          Este avaliador ainda não tem PIN. Peça ao administrador do clube para definir um.
        </p>
      ) : null}

      <label className="relative block">
        <span className="sr-only">PIN de 4 dígitos de {reviewer.name}</span>
        <input
          ref={inputRef}
          value={pin}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={4}
          disabled={busy || !reviewer.hasPin}
          onChange={e => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 4);
            setPin(v);
            setError(null);
            if (v.length === 4) void submit(v);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && pin.length === 4) void submit(pin);
          }}
          // The real field sits invisibly over the cells so every native
          // behaviour survives; the cells below are the drawing of it.
          className="absolute inset-0 z-10 h-full w-full cursor-default bg-transparent text-transparent caret-transparent outline-none"
        />
        <span className="flex justify-center gap-3" aria-hidden="true">
          {[0, 1, 2, 3].map(i => (
            <span
              key={i}
              className={cn(
                'flex h-14 w-12 items-center justify-center rounded-cell bg-house-deep font-display text-[26px] text-beam ring-1 transition-colors duration-150',
                error ? 'ring-dye-red-lit/70' : pin.length === i ? 'ring-dye-cyan' : 'ring-house-rail'
              )}
            >
              {pin[i] ? '•' : ''}
            </span>
          ))}
        </span>
      </label>

      {error ? <p className="mt-4 text-[13px] text-dye-red-lit">{error}</p> : null}

      <div className="mt-6 flex justify-center gap-2">
        <Key tone="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
          Trocar de avaliador
        </Key>
      </div>
    </div>
  );
}

function NewReviewer({ onCancel, onCreated }: { onCancel: () => void; onCreated: (u: SessionUser) => void }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setError(null);
    if (!name.trim()) return setError('Digite um nome.');
    if (!/^\d{4}$/.test(pin)) return setError('O PIN precisa ter exatamente 4 dígitos.');
    if (pin !== confirmPin) return setError('Os dois PINs não são iguais.');
    setBusy(true);
    try {
      const rec = await post<Reviewer>('/api/reviewers', { name: name.trim(), pin });
      const res = await auth.login(rec.id, pin);
      onCreated(res.reviewer);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field =
    'w-full rounded-cell bg-house-deep px-3 py-2.5 text-[15px] text-ink caret-dye-red ring-1 ring-house-rail placeholder:text-ink-dim focus-visible:ring-dye-cyan';

  return (
    <div className="plate space-y-4 p-6">
      <label className="block">
        <span className="legend mb-2 block">Nome</span>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="ex: Marina" className={field} />
      </label>
      <label className="block">
        <span className="legend mb-2 block">PIN de 4 dígitos</span>
        <input
          value={pin}
          inputMode="numeric"
          maxLength={4}
          onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="••••"
          className={cn(field, 'q tracking-[0.5em]')}
        />
      </label>
      <label className="block">
        <span className="legend mb-2 block">Repita o PIN</span>
        <input
          value={confirmPin}
          inputMode="numeric"
          maxLength={4}
          onChange={e => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onKeyDown={e => {
            if (e.key === 'Enter') void create();
          }}
          placeholder="••••"
          className={cn(field, 'q tracking-[0.5em]')}
        />
      </label>

      {error ? <Fault>{error}</Fault> : null}

      <div className="flex gap-2 pt-1">
        <Key tone="commit" className="flex-1" disabled={busy} onClick={() => void create()}>
          {busy ? 'Criando…' : 'Entrar no clube'}
        </Key>
        <Key tone="ghost" onClick={onCancel}>
          Voltar
        </Key>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Blank, Fault, IconKey, Key, Reel } from '@/components/bits';
import { auth, del, initialsOf, post, reelColor, type Reviewer } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useClub } from '@/App';

const FIELD =
  'w-full rounded-cell bg-house-deep px-3 py-2.5 text-[14px] text-ink caret-dye-red ring-1 ring-house-rail placeholder:text-ink-dim focus-visible:ring-dye-cyan';
const PIN_FIELD = cn(FIELD, 'q tracking-[0.5em]');
const onlyDigits = (v: string) => v.replace(/\D/g, '').slice(0, 4);

export function PeopleScreen() {
  return (
    <section className="max-w-[640px]">
      <header className="mb-6">
        <h1 className="font-display text-[38px] leading-none tracking-[0.04em] text-beam sm:text-[46px]">
          Avaliadores
        </h1>
        <p className="mt-3 max-w-[60ch] text-[13.5px] leading-relaxed text-ink-dim">
          Cada pessoa entra com um PIN de 4 dígitos e recebe uma cor de rolo, que identifica suas notas em
          todas as telas. A sessão dura 24 horas.
        </p>
      </header>

      <MyPin />
      <NewMember />
      <Roster />
    </section>
  );
}

/* ── my own PIN ─────────────────────────────────────────────────────────
   The current PIN is required, so someone who finds an unlocked browser still
   cannot lock the owner out of their own account. */
function MyPin() {
  const club = useClub();
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function change() {
    setMsg(null);
    if (!/^\d{4}$/.test(newPin)) return setMsg({ ok: false, text: 'O novo PIN precisa ter 4 dígitos.' });
    if (newPin !== confirmPin) return setMsg({ ok: false, text: 'Os dois PINs novos não são iguais.' });
    setBusy(true);
    try {
      await auth.changePin(currentPin, newPin);
      setMsg({ ok: true, text: 'PIN alterado. As outras abas foram desconectadas.' });
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="plate mb-6 p-5">
      <div className="mb-4 flex items-center gap-3">
        <KeyRound className="h-4 w-4 text-dye-cyan" strokeWidth={1.8} />
        <span className="legend">Meu PIN</span>
        <span className="ml-auto flex items-center gap-2 text-[13px] text-ink-dim">
          <Reel color={reelColor(club.me.dot, club.me.id)}>{initialsOf(club.me.name)}</Reel>
          {club.me.name}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="legend mb-1.5 block">PIN atual</span>
          <input
            value={currentPin}
            inputMode="numeric"
            maxLength={4}
            placeholder="••••"
            onChange={e => setCurrentPin(onlyDigits(e.target.value))}
            className={PIN_FIELD}
          />
        </label>
        <label className="block">
          <span className="legend mb-1.5 block">Novo</span>
          <input
            value={newPin}
            inputMode="numeric"
            maxLength={4}
            placeholder="••••"
            onChange={e => setNewPin(onlyDigits(e.target.value))}
            className={PIN_FIELD}
          />
        </label>
        <label className="block">
          <span className="legend mb-1.5 block">Repita</span>
          <input
            value={confirmPin}
            inputMode="numeric"
            maxLength={4}
            placeholder="••••"
            onChange={e => setConfirmPin(onlyDigits(e.target.value))}
            onKeyDown={e => {
              if (e.key === 'Enter') void change();
            }}
            className={PIN_FIELD}
          />
        </label>
      </div>
      {msg ? (
        <p className={cn('mt-3 text-[13px]', msg.ok ? 'text-dye-cyan' : 'text-dye-red-lit')}>{msg.text}</p>
      ) : null}
      <div className="mt-4">
        <Key tone="flush" disabled={busy} onClick={() => void change()}>
          {busy ? 'Trocando…' : 'Trocar meu PIN'}
        </Key>
      </div>
    </div>
  );
}

function NewMember() {
  const club = useClub();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    setError(null);
    if (!name.trim()) return setError('Digite um nome para cadastrar o avaliador.');
    if (!/^\d{4}$/.test(pin)) return setError('O PIN precisa ter exatamente 4 dígitos.');
    setBusy(true);
    try {
      await post<Reviewer>('/api/reviewers', { name: name.trim(), pin });
      await club.refreshReviewers();
      setName('');
      setPin('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-7 border-t border-white/[0.07] pt-6">
      <span className="legend mb-3 block">Novo avaliador</span>
      <div className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="ex: Marina"
          autoComplete="off"
          className={cn(FIELD, 'min-w-[180px] flex-1')}
        />
        <input
          value={pin}
          inputMode="numeric"
          maxLength={4}
          placeholder="PIN"
          onChange={e => setPin(onlyDigits(e.target.value))}
          onKeyDown={e => {
            if (e.key === 'Enter') void add();
          }}
          className={cn(PIN_FIELD, 'w-[120px] flex-none')}
        />
        <Key tone="flush" disabled={busy} onClick={() => void add()}>
          <Plus className="h-4 w-4" strokeWidth={2} />
          Cadastrar
        </Key>
      </div>
      {error ? <div className="mt-3"><Fault>{error}</Fault></div> : null}
    </div>
  );
}

function Roster() {
  const club = useClub();
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetPin, setResetPin] = useState('');
  const [note, setNote] = useState<string | null>(null);

  async function remove(p: Reviewer) {
    const n = club.reviews.filter(r => r.reviewerId === p.id).length;
    const isSelf = p.id === club.me.id;
    const warn = n ? ` As ${n} avaliação(ões) dessa pessoa também serão apagadas.` : '';
    if (!confirm(`${isSelf ? 'Sair do clube e apagar sua conta' : `Remover ${p.name}`}?${warn}`)) return;
    try {
      await del(`/api/reviewers/${p.id}`);
      if (isSelf) return club.signOut();
      club.reload({
        reviewers: club.reviewers.filter(x => x.id !== p.id),
        reviews: club.reviews.filter(r => r.reviewerId !== p.id),
      });
    } catch (e) {
      club.fault('Não foi possível remover: ' + (e as Error).message);
    }
  }

  async function doReset(p: Reviewer) {
    setNote(null);
    if (!/^\d{4}$/.test(resetPin)) {
      setNote('O PIN precisa ter 4 dígitos.');
      return;
    }
    try {
      await auth.resetPin(p.id, resetPin);
      await club.refreshReviewers();
      setNote(`PIN de ${p.name} redefinido. Avise essa pessoa — ninguém consegue ler o PIN depois.`);
      setResetting(null);
      setResetPin('');
    } catch (e) {
      setNote((e as Error).message);
    }
  }

  return (
    <div className="border-t border-white/[0.07]">
      {club.reviewers.length ? (
        club.reviewers.map(p => {
          const n = club.reviews.filter(r => r.reviewerId === p.id).length;
          const isSelf = p.id === club.me.id;
          const canRemove = isSelf || club.me.isAdmin;
          return (
            <div key={p.id} className="border-b border-white/[0.06] py-3">
              <div className="flex items-center gap-3 px-1">
                <Reel color={reelColor(p.dot, p.id)}>{initialsOf(p.name)}</Reel>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[15px] font-medium">
                    <span className="truncate">{p.name}</span>
                    {isSelf ? <span className="q text-[10px] text-ink-dim">você</span> : null}
                    {p.isAdmin ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-dye-cyan">
                        <ShieldCheck className="h-3 w-3" strokeWidth={2} />
                        ADM
                      </span>
                    ) : null}
                  </span>
                  <span className="q block text-[11px] text-ink-dim">
                    {n ? `${n} ${n === 1 ? 'filme avaliado' : 'filmes avaliados'}` : 'ainda não avaliou'}
                    {p.hasPin === false ? ' · PIN pendente' : ''}
                  </span>
                </span>

                {club.me.isAdmin && !isSelf ? (
                  <Key
                    tone="ghost"
                    onClick={() => {
                      setResetting(resetting === p.id ? null : p.id);
                      setResetPin('');
                      setNote(null);
                    }}
                  >
                    <KeyRound className="h-3.5 w-3.5" strokeWidth={1.8} />
                    Resetar PIN
                  </Key>
                ) : null}

                {canRemove ? (
                  <IconKey aria-label={isSelf ? 'Sair do clube' : `Remover ${p.name}`} onClick={() => void remove(p)}>
                    <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                  </IconKey>
                ) : null}
              </div>

              {resetting === p.id ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
                  <input
                    autoFocus
                    value={resetPin}
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="Novo PIN"
                    onChange={e => setResetPin(onlyDigits(e.target.value))}
                    onKeyDown={e => {
                      if (e.key === 'Enter') void doReset(p);
                    }}
                    className={cn(PIN_FIELD, 'w-[140px] flex-none')}
                  />
                  <Key tone="commit" onClick={() => void doReset(p)}>
                    Definir
                  </Key>
                  <Key tone="ghost" onClick={() => setResetting(null)}>
                    Cancelar
                  </Key>
                </div>
              ) : null}
            </div>
          );
        })
      ) : (
        <Blank title="Nenhum avaliador ainda">Cadastre a primeira pessoa acima.</Blank>
      )}

      {note ? <p className="mt-4 text-[13px] text-ink-dim">{note}</p> : null}

      {!club.me.isAdmin ? (
        <p className="mt-5 text-[12.5px] leading-relaxed text-ink-dim">
          Esqueceu o PIN? Só o administrador do clube pode definir um novo — nem ele consegue ler o antigo,
          porque o PIN é guardado com hash.
        </p>
      ) : null}
    </div>
  );
}

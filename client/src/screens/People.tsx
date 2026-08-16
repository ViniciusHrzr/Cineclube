import { useRef, useState } from 'react';
import { Camera, KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Blank, Fault, IconKey, Key, Reel } from '@/components/bits';
import { auth, del, initialsOf, post, profile, reelColor, type Reviewer } from '@/lib/api';
import { PortraitGate } from '@/components/portrait';
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
      </header>

      <MyProfile />
      <MyPin />
      <NewMember />
      <Roster />
    </section>
  );
}

/* ── who I am here ────────────────────────────────────────────────────────
   A name and a face sit next to everything a person ever said in this club, so
   they belong to that person and to nobody else — the route takes no id at all,
   it edits whoever the session is. The admin is not an exception: resetting a
   forgotten PIN is letting someone back in, renaming them is speaking for them.

   The portrait is cut to a square in the browser before it is sent. A phone
   photo is four megabytes of something drawn here at twenty pixels across. */
function MyProfile() {
  const club = useClub();
  const [name, setName] = useState(club.me.name);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<'name' | 'photo' | null>(null);
  /** The file waiting to be framed. Nothing is uploaded while this is set. */
  const [pending, setPending] = useState<File | null>(null);
  const file = useRef<HTMLInputElement>(null);

  /* The field is seeded from the account and then owned by the hand typing in
     it — but the account can change underneath it, and then the two disagree
     with nobody having typed anything. A session cookie belongs to the whole
     browser, so signing in as somebody else in another tab does exactly that:
     the marquee updates, and this field is left holding the previous person's
     name and offering to save it onto the new one.

     Re-seeding on a change of account is the standard adjustment, made during
     the render that noticed rather than in an effect afterwards — an effect
     would let one frame paint the wrong name into the box. */
  const seeded = useRef(club.me.name);
  if (seeded.current !== club.me.name) {
    seeded.current = club.me.name;
    setName(club.me.name);
  }

  const dirty = name.trim() !== club.me.name && name.trim().length > 0;

  async function saveName() {
    setMsg(null);
    const value = name.trim();
    if (!value) return setMsg({ ok: false, text: 'O nome não pode ficar vazio.' });
    setBusy('name');
    try {
      await profile.update({ name: value });
      // The roster draws it too, and the reviews carry it by join.
      await Promise.all([club.refreshMe(), club.refreshReviewers()]);
      setMsg({ ok: true, text: 'Nome atualizado.' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  /* Picking a file opens the gate; nothing is sent until the framing is
     decided. Clearing the input here rather than after is what lets somebody
     pick the same file again after cancelling — a file input fires no change
     event when the value it is given is the value it already has. */
  function pick(picked: File) {
    setMsg(null);
    setPending(picked);
    if (file.current) file.current.value = '';
  }

  async function savePhoto(avatar: string) {
    setPending(null);
    setBusy('photo');
    try {
      await profile.update({ avatar });
      await Promise.all([club.refreshMe(), club.refreshReviewers()]);
      setMsg({ ok: true, text: 'Foto atualizada.' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function removePhoto() {
    setMsg(null);
    setBusy('photo');
    try {
      await profile.update({ avatar: null });
      await Promise.all([club.refreshMe(), club.refreshReviewers()]);
      setMsg({ ok: true, text: 'Foto removida.' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="plate mb-6 p-5">
      <div className="mb-4 flex items-center gap-3">
        <Camera className="h-4 w-4 text-ink-dim" strokeWidth={1.8} />
        <span className="legend">Meu perfil</span>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        {/* The portrait at the size it is worth looking at, in the same square
            frame the small one uses everywhere else. */}
        <div className="flex flex-col items-center gap-2">
          <Reel
            color={reelColor(club.me.dot, club.me.id)}
            src={club.me.avatar}
            className={cn('h-[76px] w-[76px] text-[24px]', !club.me.avatar && 'min-w-0')}
          >
            {initialsOf(club.me.name)}
          </Reel>
          <input
            ref={file}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              const picked = e.target.files?.[0];
              if (picked) pick(picked);
            }}
          />
          <Key
            tone="ghost"
            className="px-2 py-1 text-[11px]"
            disabled={busy === 'photo'}
            onClick={() => file.current?.click()}
          >
            {busy === 'photo' ? 'Enviando…' : club.me.avatar ? 'Trocar' : 'Enviar foto'}
          </Key>
          {club.me.avatar ? (
            <button
              type="button"
              disabled={busy === 'photo'}
              onClick={() => void removePhoto()}
              className="text-[11px] text-ink-dim underline underline-offset-4 transition-colors hover:text-dye-red-lit disabled:opacity-40"
            >
              remover
            </button>
          ) : null}
        </div>

        <div className="min-w-[220px] flex-1">
          <label className="block">
            <span className="legend mb-1.5 block">Meu nome</span>
            <input
              value={name}
              maxLength={40}
              autoComplete="off"
              onChange={e => setName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && dirty) void saveName();
              }}
              className={FIELD}
            />
          </label>
          <p className="q mt-2 text-[11px] text-ink-dim">
            É como você aparece em todas as suas avaliações. Só você pode mudar.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Key tone="flush" disabled={!dirty || busy === 'name'} onClick={() => void saveName()}>
              {busy === 'name' ? 'Salvando…' : 'Salvar nome'}
            </Key>
            {dirty ? (
              <Key tone="ghost" onClick={() => setName(club.me.name)}>
                Desfazer
              </Key>
            ) : null}
          </div>
        </div>
      </div>

      {msg ? (
        <p className={cn('mt-4 text-[13px]', msg.ok ? 'text-dye-cyan' : 'text-dye-red-lit')}>{msg.text}</p>
      ) : null}

      {pending ? (
        <PortraitGate
          file={pending}
          onCancel={() => setPending(null)}
          onDone={avatar => void savePhoto(avatar)}
        />
      ) : null}
    </div>
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
        {/* The icon labels the section; it is not a state, so it takes the
            colour of the legend beside it rather than a colour of its own. */}
        <KeyRound className="h-4 w-4 text-ink-dim" strokeWidth={1.8} />
        <span className="legend">Meu PIN</span>
        <span className="ml-auto flex items-center gap-2 text-[13px] text-ink-dim">
          <Reel color={reelColor(club.me.dot, club.me.id)} src={club.me.avatar}>
            {initialsOf(club.me.name)}
          </Reel>
          {club.me.name}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="legend mb-1.5 block">PIN atual</span>
          <input
            value={currentPin}
            type="password"
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
            type="password"
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
            type="password"
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
          type="password"
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
    const warn = n
      ? ` ${n === 1 ? 'A avaliação' : `As ${n} avaliações`} dessa pessoa também ${n === 1 ? 'será apagada' : 'serão apagadas'}.`
      : '';
    if (!confirm(`Remover ${p.name}?${warn}`)) return;
    try {
      await del(`/api/reviewers/${p.id}`);
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
          /* The same rule the route enforces, said again here only so the
             interface does not offer what the server will refuse. The seat is a
             flag on a row and no route grants it back, so removing it would
             leave the club with nobody able to reset a PIN or remove anyone. */
          const canRemove = club.me.isAdmin && !p.isAdmin;
          return (
            <div key={p.id} className="border-b border-white/[0.06] py-3">
              <div className="flex items-center gap-3 px-1">
                <Reel color={reelColor(p.dot, p.id)} src={p.avatar} size="md">
                  {initialsOf(p.name)}
                </Reel>
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
                  <IconKey aria-label={`Remover ${p.name}`} onClick={() => void remove(p)}>
                    <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                  </IconKey>
                ) : null}
              </div>

              {resetting === p.id ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
                  <input
                    autoFocus
                    value={resetPin}
                    type="password"
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
        /* Kept, and cut to its useful half: someone locked out needs to know
           who can let them back in. How the PIN is stored is not their
           problem. */
        <p className="mt-5 text-[12.5px] text-ink-dim">
          Esqueceu o PIN? Só o administrador do clube pode definir um novo.
        </p>
      ) : null}
    </div>
  );
}

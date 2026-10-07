import { cloneElement, forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronDown, LogOut, Plus, Settings, User } from 'lucide-react';
import { Fault, Key, Reel } from '@/components/bits';
import { PortraitGate } from '@/components/portrait';
import { HolographicWall } from '@/components/ui/holographic-wall-shadcnui';
import { clubs, initialsOf, reelColor, type Club, type SessionUser } from '@/lib/api';
import { cn, plural, useAwayClose } from '@/lib/utils';
import { mediaUrl } from '@/lib/session';

export function ClubSwitch({
  club,
  onEnter,
}: {
  club: Club;
  onEnter: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<Club[] | null>(null);
  const [others, setOthers] = useState<Club[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [founding, setFounding] = useState(false);
  const [founded, setFounded] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const got = await clubs.all();
      setMine(got.mine);
      setOthers(got.open);
      setFounded(got.founded);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setMine(held => held ?? []);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useAwayClose(open, box, useCallback(() => setOpen(false), []));

  async function ask(slug: string) {
    try {
      const out = await clubs.join(slug);
      if (out.joined) {
        onEnter(slug);
        return;
      }
      setOthers(list => list.map(c => (c.slug === slug ? { ...c, requested: true } : c)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const outras = (mine ?? []).filter(c => c.slug !== club.slug);

  return (
    <div ref={box} className="relative flex min-w-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-label={`${club.name} — trocar de clube`}
        title="Trocar de clube"
        className="group flex min-w-0 items-center gap-2.5 rounded-cell py-1 pr-1 text-left sm:pr-2"
      >
        {club.photo ? (
          <img
            src={mediaUrl(club.photo)}
            alt=""
            className="h-[26px] w-[26px] flex-none rounded-cell object-cover ring-1 ring-white/10"
          />
        ) : null}
        {}
        <span className="min-w-0 truncate font-display text-[18px] leading-none tracking-[0.08em] text-beam transition-colors group-hover:text-beam-hot sm:text-[22px] sm:tracking-[0.1em]">
          {club.name}
        </span>
        {club.visibility === 'private' ? (
          <span className="legend hidden text-[9px] text-ink-faint sm:inline">Privado</span>
        ) : null}
        <ChevronDown
          aria-hidden
          strokeWidth={1.9}
          className={cn(
            'h-4 w-4 flex-none text-ink-faint transition-transform duration-200 group-hover:text-ink-dim',
            open && 'rotate-180'
          )}
        />
      </button>

      {open ? (
        <div
          role="region"
          aria-label="Clubes"
          className="plate absolute left-0 top-[calc(100%+8px)] z-40 max-h-[min(calc(72dvh/var(--ui-zoom)),560px)] w-[320px] max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
        >
          <header className="flex items-center gap-2.5 border-b border-white/[0.07] px-4 py-3.5">
            <ClubMark club={club} size={34} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-[19px] leading-none tracking-[0.06em] text-beam">
                {club.name}
              </span>
              <span className="q mt-1.5 block text-[11px] text-ink-dim">
                {[
                  club.members ? plural(club.members, 'pessoa', 'pessoas') : null,
                  club.visibility === 'private' ? 'Privado' : 'Aberto',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            {}
            <span aria-hidden className="h-8 w-[2px] flex-none bg-dye-red" />
          </header>

          {error ? (
            <div className="px-4 py-3">
              <Fault detail={error}>Não foi possível carregar seus clubes.</Fault>
            </div>
          ) : null}

          {mine === null && !error ? (
            <p className="legend animate-flicker px-4 py-4">Acendendo o projetor</p>
          ) : null}

          {outras.length ? (
            <Block legend="Trocar de sala">
              {outras.map(c => (
                <ClubRow key={c.id} club={c} onPick={() => onEnter(c.slug)} />
              ))}
            </Block>
          ) : null}

          {others.length ? (
            <Block legend="Salas abertas">
              {others.map(c => (
                <ClubRow
                  key={c.id}
                  club={c}
                  onAsk={() => void ask(c.slug)}
                />
              ))}
            </Block>
          ) : null}

          {}
          <div className="border-t border-white/[0.07] p-3">
            {founded ? (
              <p className="px-1 py-0.5 text-[12.5px] leading-relaxed text-ink-dim">
                Você já tem o seu clube. Cada pessoa funda um — nos outros, entre
                pela lista.
              </p>
            ) : (
              <Key
                tone="flush"
                onClick={() => {
                  setOpen(false);
                  setFounding(true);
                }}
                className="w-full"
              >
                <Plus className="h-[15px] w-[15px]" strokeWidth={2} aria-hidden />
                Fundar um clube
              </Key>
            )}
          </div>
        </div>
      ) : null}

      {founding ? (
        <FoundClub onClose={() => setFounding(false)} onFounded={slug => onEnter(slug)} />
      ) : null}
    </div>
  );
}

function Block({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/[0.07] py-2 first-of-type:border-t-0">
      <p className="legend px-4 pb-1 pt-1.5 text-[10px]">{legend}</p>
      {children}
    </section>
  );
}

function ClubRow({
  club,
  onPick,
  onAsk,
}: {
  club: Club;
  onPick?: () => void;
  onAsk?: () => void;
}) {
  const face = (
    <>
      <ClubMark club={club} size={26} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'min-w-0 truncate font-display text-[15px] leading-none tracking-[0.06em]',
              onPick ? 'text-ink transition-colors group-hover:text-beam' : 'text-ink'
            )}
          >
            {club.name}
          </span>
          {club.visibility === 'private' ? (
            <span className="legend flex-none text-[9px] text-ink-faint">Privado</span>
          ) : null}
        </span>
        {club.tagline ? (
          <span className="mt-1 block truncate text-[12px] leading-snug text-ink-dim">
            {club.tagline}
          </span>
        ) : null}
      </span>
    </>
  );

  if (onPick) {
    return (
      <button
        type="button"
        onClick={onPick}
        className="group flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-beam/[0.05]"
      >
        {face}
        {club.members ? (
          <span className="q flex-none text-[11px] text-ink-faint">{club.members}</span>
        ) : null}
      </button>
    );
  }

  return (
    <div className="flex w-full items-center gap-2.5 px-4 py-2.5">
      {face}
      {club.requested ? (
        <span className="legend flex-none text-[10px] text-dye-brass">Pedido</span>
      ) : (
        <button
          type="button"
          onClick={onAsk}
          className="flex-none rounded-cell px-2.5 py-1.5 font-display text-[11px] uppercase leading-none tracking-[0.12em] text-ink-dim ring-1 ring-house-rail transition-colors hover:text-beam hover:ring-beam/70 coarse:min-h-[36px]"
        >
          {club.visibility === 'private' ? 'Pedir' : 'Entrar'}
        </button>
      )}
    </div>
  );
}

function ClubMark({ club, size }: { club: Club; size: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="flex flex-none items-center justify-center overflow-hidden rounded-cell bg-house-deep ring-1 ring-white/10"
    >
      {club.photo ? (
        <img src={mediaUrl(club.photo)} alt="" className="h-full w-full object-cover" />
      ) : (
        <span
          className="font-display leading-none text-ink-faint"
          style={{ fontSize: Math.round(size * 0.42) }}
        >
          {initialsOf(club.name)}
        </span>
      )}
    </span>
  );
}

function FoundClub({ onClose, onFounded }: { onClose: () => void; onFounded: (slug: string) => void }) {
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [photo, setPhoto] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { club } = await clubs.create({
        name: name.trim(),
        tagline: tagline.trim(),
        visibility,
        photo,
      });
      onFounded(club.slug);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-house-deep/95 sm:items-center">
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="plate max-h-[calc(92dvh/var(--ui-zoom))] w-full max-w-[460px] overflow-y-auto p-5 sm:p-6"
      >
        <h2 className="font-display text-[26px] leading-none tracking-[0.04em] text-beam">
          Fundar um clube
        </h2>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-dim">
          Você será o ADM: é quem aprova quem entra e quem muda o que o clube é.
        </p>

        <div className="mt-6 flex flex-col gap-4">
          <ClubField
            ref={first}
            label="Nome"
            value={name}
            onChange={setName}
            maxLength={40}
            hint="Único na rede — não dá para haver dois clubes com o mesmo nome."
          />
          <ClubField
            label="Uma linha sobre ele"
            value={tagline}
            onChange={setTagline}
            maxLength={140}
            hint="Opcional. É o que aparece embaixo do nome na lista de clubes."
          />

          <div className="flex flex-col gap-2">
            <span className="legend text-[10px]">Foto</span>
            <div className="flex items-center gap-3">
              <span className="flex h-[64px] w-[64px] flex-none items-center justify-center overflow-hidden rounded-plate bg-house-deep ring-1 ring-house-rail">
                {photo ? (
                  <img src={mediaUrl(photo)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="font-display text-[24px] text-ink-faint">
                    {name.trim() ? initialsOf(name) : '—'}
                  </span>
                )}
              </span>
              <label className="cursor-pointer rounded-cell px-3 py-2 font-display text-[12px] uppercase leading-none tracking-[0.14em] text-ink-dim ring-1 ring-house-rail transition-colors hover:text-beam hover:ring-beam/70">
                {photo ? 'Trocar' : 'Escolher'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) setFile(f);
                    e.target.value = '';
                  }}
                />
              </label>
              {photo ? (
                <Key tone="ghost" onClick={() => setPhoto(null)}>
                  Tirar
                </Key>
              ) : null}
            </div>
          </div>

          {}
          <fieldset className="flex flex-col gap-2">
            <span className="legend text-[10px]">Como se entra</span>
            <div className="flex gap-2">
              <Choice
                on={visibility === 'public'}
                onClick={() => setVisibility('public')}
                title="Aberto"
                line="Qualquer pessoa entra e já pode avaliar. Sem pedido, sem espera."
              />
              <Choice
                on={visibility === 'private'}
                onClick={() => setVisibility('private')}
                title="Fechado"
                line="Aparece na lista, mas entrar depende de você aprovar. O acervo é só de quem é do clube."
              />
            </div>
          </fieldset>

          {error ? <Fault>{error}</Fault> : null}
        </div>

        <div className="mt-6 flex items-center gap-2">
          <Key tone="commit" type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Fundando' : 'Fundar'}
          </Key>
          <Key tone="ghost" onClick={onClose}>
            Cancelar
          </Key>
        </div>
      </motion.form>

      {file ? (
        <PortraitGate
          file={file}
          onCancel={() => setFile(null)}
          onDone={url => {
            setPhoto(url);
            setFile(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Choice({
  on,
  onClick,
  title,
  line,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  line: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'flex-1 rounded-cell px-3 py-2.5 text-left ring-1 transition-colors',
        on ? 'bg-dye-brass/10 ring-dye-brass' : 'ring-house-rail hover:ring-white/20'
      )}
    >
      <span
        className={cn(
          'flex items-center gap-1.5 font-display text-[12px] uppercase leading-none tracking-[0.12em]',
          on ? 'text-dye-brass' : 'text-ink'
        )}
      >
        {on ? <Check className="h-[13px] w-[13px]" strokeWidth={2.2} /> : null}
        {title}
      </span>
      <span className="mt-1.5 block text-[12px] leading-snug text-ink-dim">{line}</span>
    </button>
  );
}

type ClubFieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>;

const ClubField = forwardRef<HTMLInputElement, ClubFieldProps>(function ClubField(
  { label, value, onChange, hint, ...rest },
  ref
) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="legend text-[10px]">{label}</span>
      <input
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-cell bg-house-deep px-3 py-2.5 text-[14px] text-ink caret-dye-red ring-1 ring-house-rail transition-shadow placeholder:text-ink-dim focus-visible:outline-none focus-visible:ring-dye-brass"
        {...rest}
      />
      {hint ? <span className="text-[12px] text-ink-faint">{hint}</span> : null}
    </label>
  );
});

export function Projecting() {
  return (
    <>
      <HolographicWall asBackdrop />
      <div className="relative flex min-h-[calc(100dvh/var(--ui-zoom))] items-center justify-center">
        <span className="legend animate-flicker">Acendendo o projetor</span>
      </div>
    </>
  );
}

export function ClubClosed({ detail, onHome }: { detail: string; onHome: () => void }) {
  return (
    <>
      <HolographicWall asBackdrop />
      <div className="relative mx-auto flex min-h-[calc(100dvh/var(--ui-zoom))] w-full max-w-[560px] flex-col justify-center px-5">
        <h1 className="font-display text-[34px] leading-none tracking-[0.04em] text-beam">
          Este clube não abre
        </h1>
        <div className="mt-5">
          <Fault detail={detail}>O clube não existe, ou é privado e você não está nele.</Fault>
        </div>
        <div className="mt-5">
          <Key onClick={onHome}>Ir para outro clube</Key>
        </div>
      </div>
    </>
  );
}

export function SelfMenu({
  me,
  onOpenSelf,
  onOpenSettings,
  onSignOut,
}: {
  me: SessionUser;
  onOpenSelf: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useAwayClose(open, box, useCallback(() => setOpen(false), []));

  const pick = (go: () => void) => () => {
    setOpen(false);
    go();
  };

  return (
    <div ref={box} className="relative flex">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${me.name} — minha conta`}
        title="Minha conta"
        className="group flex items-center gap-2 rounded-cell py-1 pl-1 pr-0.5 transition-colors sm:pr-1"
      >
        <Reel color={reelColor(me.dot, me.id)} src={me.avatar} size="lg">
          {initialsOf(me.name)}
        </Reel>
        <span className="hidden text-[13px] text-ink-dim transition-colors group-hover:text-ink sm:inline">
          {me.name}
        </span>
        <ChevronDown
          aria-hidden
          strokeWidth={1.9}
          className={cn(
            'h-4 w-4 flex-none text-ink-dim transition-transform duration-200 group-hover:text-ink',
            open && 'rotate-180'
          )}
        />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Minha conta"
          className="plate absolute right-0 top-[calc(100%+8px)] z-40 w-[210px] py-2"
        >
          <MenuRow icon={<User />} onClick={pick(onOpenSelf)}>
            Meu perfil
          </MenuRow>
          <MenuRow icon={<Settings />} onClick={pick(onOpenSettings)}>
            Ajustes
          </MenuRow>
          <div aria-hidden className="my-2 border-t border-white/[0.07]" />
          <MenuRow icon={<LogOut />} tone="exit" onClick={pick(onSignOut)}>
            Sair
          </MenuRow>
        </div>
      ) : null}
    </div>
  );
}

function MenuRow({
  icon,
  tone,
  onClick,
  children,
}: {
  icon: React.ReactElement<{ className?: string; strokeWidth?: number }>;
  tone?: 'exit';
  onClick: () => void;
  children: React.ReactNode;
}) {
  const saindo = tone === 'exit';
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors duration-150',
        saindo ? 'hover:bg-dye-red/[0.12]' : 'hover:bg-beam/[0.05]'
      )}
    >
      {cloneElement(icon, {
        className: cn(
          'h-[15px] w-[15px] flex-none transition-colors',
          saindo ? 'text-dye-red-lit' : 'text-ink-dim group-hover:text-beam'
        ),
        strokeWidth: 1.9,
      })}
      <span
        className={cn(
          'font-display text-[15px] leading-none tracking-[0.06em] transition-colors',
          saindo ? 'text-dye-red-lit group-hover:text-dye-red-glow' : 'text-ink group-hover:text-beam'
        )}
      >
        {children}
      </span>
    </button>
  );
}

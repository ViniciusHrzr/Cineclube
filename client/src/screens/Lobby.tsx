import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Clock, Plus, ShieldCheck } from 'lucide-react';
import { Blank, Fault, Key, Reel } from '@/components/bits';
import { HolographicWall } from '@/components/ui/holographic-wall-shadcnui';
import { PortraitGate } from '@/components/portrait';
import { clubs, initialsOf, reelColor, type Club, type SessionUser } from '@/lib/api';
import { cn, plural } from '@/lib/utils';

/* ══════════════════════════════════════════════════════════════════════════
   O saguão.

   Um cinema tem mais de uma sala, e até agora este produto tinha uma. O saguão é
   o lugar de onde se vê o que está passando em cada uma antes de entrar — e é a
   primeira tela da rede, a que responde "onde eu vou".

   Duas listas, e elas respondem perguntas diferentes: `mine` é o chaveiro de
   quem já chegou, `open` é a vitrine de quem está olhando. Um clube em que você
   já está nunca aparece nas duas — uma sala listada duas vezes na mesma tela é a
   tela dizendo que não sabe quem você é.

   ── esta é a versão do Passo 1 ────────────────────────────────────────────
   Funcional e no mundo certo, sem a vitrine que ainda vem: a parede de pôsteres
   da semana, as fichas em destaque, as salas com sessão rolando agora. O que
   está aqui é o suficiente para o produto ser usável com clubes, e nada que vá
   precisar ser desfeito quando o resto chegar.
   ══════════════════════════════════════════════════════════════════════════ */

export function Lobby({
  me,
  onEnter,
  onSignOut,
  onOpenSelf,
}: {
  me: SessionUser;
  onEnter: (slug: string) => void;
  onSignOut: () => void;
  onOpenSelf: () => void;
}) {
  const [mine, setMine] = useState<Club[] | null>(null);
  const [open, setOpen] = useState<Club[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [founding, setFounding] = useState(false);

  const load = useCallback(async () => {
    try {
      const got = await clubs.all();
      setMine(got.mine);
      setOpen(got.open);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function ask(slug: string) {
    try {
      await clubs.join(slug);
      setOpen(list => list.map(c => (c.slug === slug ? { ...c, requested: true } : c)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function unask(slug: string) {
    try {
      await clubs.unjoin(slug);
      setOpen(list => list.map(c => (c.slug === slug ? { ...c, requested: false } : c)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="relative flex min-h-[calc(100dvh/var(--ui-zoom))] flex-col">
      <HolographicWall asBackdrop />

      <header className="relative border-b border-white/[0.07] bg-house/95">
        <div className="mx-auto flex max-w-[1240px] items-center gap-x-6 px-4 py-3 sm:px-6">
          <span className="mr-auto font-display text-[26px] leading-none tracking-[0.14em] text-beam">
            CINECLUBE
          </span>
          <button
            type="button"
            onClick={onOpenSelf}
            title="Minha conta"
            className="flex items-center gap-2 rounded-cell px-1 py-1 transition-colors hover:[&>span]:text-ink"
          >
            <Reel color={reelColor(me.dot, me.id)} src={me.avatar} size="lg">
              {initialsOf(me.name)}
            </Reel>
            <span className="hidden text-[13px] text-ink-dim transition-colors sm:inline">{me.name}</span>
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-cell px-2 py-1.5 font-display text-[12px] uppercase tracking-[0.12em] text-ink-dim transition-colors hover:text-dye-red-lit"
          >
            Sair
          </button>
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-[1240px] flex-1 px-4 pb-20 pt-8 sm:px-6 sm:pt-12">
        {error ? (
          <div className="mb-6 max-w-[60ch]">
            <Fault>{error}</Fault>
          </div>
        ) : null}

        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="font-display text-[34px] leading-none tracking-[0.04em] text-beam">
              Suas salas
            </h1>
            <Key onClick={() => setFounding(true)}>
              <Plus className="h-[15px] w-[15px]" strokeWidth={2} />
              Fundar um clube
            </Key>
          </div>
          <span className="mt-4 block h-px w-full bg-gradient-to-r from-beam/25 to-transparent" />

          {mine === null ? (
            <p className="legend animate-flicker mt-8">Acendendo o projetor</p>
          ) : mine.length ? (
            <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {mine.map((c, i) => (
                <ClubPanel key={c.id} club={c} index={i} onOpen={() => onEnter(c.slug)} />
              ))}
            </div>
          ) : (
            <div className="mt-8">
              <Blank title="Você ainda não está em nenhum clube">
                Funde o seu, ou peça para entrar num dos que estão abertos aqui embaixo.
              </Blank>
            </div>
          )}
        </section>

        {open.length ? (
          <section className="mt-16">
            <h2 className="font-display text-[26px] leading-none tracking-[0.04em] text-beam">
              Clubes abertos
            </h2>
            <p className="mt-3 max-w-[60ch] text-[13.5px] leading-relaxed text-ink-dim">
              O acervo destes é aberto para leitura. Entrar — e escrever — depende
              de quem administra a sala aceitar.
            </p>
            <span className="mt-4 block h-px w-full bg-gradient-to-r from-beam/25 to-transparent" />

            <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {open.map((c, i) => (
                <ClubPanel
                  key={c.id}
                  club={c}
                  index={i}
                  onOpen={() => onEnter(c.slug)}
                  onAsk={() => (c.requested ? void unask(c.slug) : void ask(c.slug))}
                />
              ))}
            </div>
          </section>
        ) : null}
      </main>

      {founding ? (
        <FoundClub
          onClose={() => setFounding(false)}
          onFounded={slug => {
            setFounding(false);
            onEnter(slug);
          }}
        />
      ) : null}
    </div>
  );
}

/* ── um painel de marquise ────────────────────────────────────────────────
   A foto do clube atrás do vidro, o nome em Bebas, e embaixo o que ele é. A
   proporção é a de um cartaz na entrada de uma sala, não a de um cartão de
   dashboard: retrato, e não a fileira de retângulos iguais que toda grade de
   cards vira.

   Sem foto, o painel não fica vazio — fica com a inicial do nome em corpo
   grande sobre a cor do clube. Um lugar sem cartaz ainda é um lugar. */
function ClubPanel({
  club,
  index,
  onOpen,
  onAsk,
}: {
  club: Club;
  index: number;
  onOpen: () => void;
  onAsk?: () => void;
}) {
  const mine = club.isMember;
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1], delay: Math.min(index, 8) * 0.045 }}
      className="flex flex-col overflow-hidden rounded-plate bg-house-seat ring-1 ring-white/[0.07]"
    >
      <button
        type="button"
        onClick={onOpen}
        className="group relative block aspect-[4/3] w-full overflow-hidden bg-house-deep text-left"
      >
        {club.photo ? (
          <img
            src={club.photo}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 ease-beam group-hover:scale-[1.03]"
          />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center font-display text-[56px] leading-none tracking-[0.06em] text-house-deep transition-transform duration-300 ease-beam group-hover:scale-[1.03]"
            style={{ background: reelColor(null, club.id) }}
          >
            {initialsOf(club.name)}
          </span>
        )}
        {/* O nome sobre a foto, com a sala escurecendo por baixo dele: um título
            branco sobre uma imagem qualquer é ilegível em metade das imagens. */}
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-house-deep via-house-deep/80 to-transparent px-4 pb-3 pt-10">
          <span className="block font-display text-[22px] leading-none tracking-[0.06em] text-beam">
            {club.name}
          </span>
        </span>
        {club.visibility === 'private' ? (
          <span className="legend absolute right-3 top-3 rounded-cell bg-house-deep/80 px-2 py-1 text-[9.5px] text-ink-dim">
            Privado
          </span>
        ) : null}
      </button>

      <div className="flex flex-1 flex-col gap-3 px-4 py-3.5">
        {club.tagline ? (
          <p className="text-[13px] leading-relaxed text-ink-dim">{club.tagline}</p>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-3">
          <span className="q text-[12px] text-ink-faint">
            {typeof club.members === 'number'
              ? plural(club.members, 'pessoa', 'pessoas')
              : club.role === 'admin'
                ? 'Você administra'
                : ''}
          </span>

          {mine ? (
            <span className="flex items-center gap-3">
              {club.role === 'admin' ? (
                <span className="flex items-center gap-1 font-display text-[10.5px] uppercase tracking-[0.12em] text-dye-brass">
                  <ShieldCheck className="h-[13px] w-[13px]" strokeWidth={1.8} />
                  ADM
                </span>
              ) : null}
              <Key tone="ghost" onClick={onOpen}>
                Entrar
              </Key>
            </span>
          ) : club.requested ? (
            /* "Pedido enviado" é um estado, não uma confirmação que some: quem
               volta ao saguão amanhã precisa ver que já pediu, e o mesmo botão
               desfaz — desistir de um pedido não merece uma segunda tela. */
            <button
              type="button"
              onClick={onAsk}
              title="Desistir do pedido"
              className="flex items-center gap-1.5 rounded-cell px-2 py-1.5 font-display text-[11px] uppercase leading-none tracking-[0.12em] text-dye-brass transition-colors hover:text-ink-dim"
            >
              <Clock className="h-[13px] w-[13px]" strokeWidth={1.8} />
              Pedido enviado
            </button>
          ) : (
            <Key onClick={onAsk}>Pedir para entrar</Key>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ── fundar ───────────────────────────────────────────────────────────────
   Quem cria é ADM, e isso não é uma opção em lugar nenhum: uma sala sem ninguém
   que possa aprovar uma entrada nasce trancada.

   Nasce privada quando não se diz nada, e a folha diz isso em vez de esconder
   num padrão: o erro caro tem um lado só. */
function FoundClub({ onClose, onFounded }: { onClose: () => void; onFounded: (slug: string) => void }) {
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-house-deep/80 backdrop-blur-sm sm:items-center">
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="plate max-h-[92dvh] w-full max-w-[460px] overflow-y-auto p-5 sm:p-6"
      >
        <h2 className="font-display text-[26px] leading-none tracking-[0.04em] text-beam">
          Fundar um clube
        </h2>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-dim">
          Você será o ADM: é quem aprova quem entra e quem muda o que a sala é.
        </p>

        <div className="mt-6 flex flex-col gap-4">
          <LobbyField
            ref={first}
            label="Nome"
            value={name}
            onChange={setName}
            maxLength={40}
            hint="Único na rede — não dá para haver dois clubes com o mesmo nome."
          />
          <LobbyField
            label="Uma linha sobre ele"
            value={tagline}
            onChange={setTagline}
            maxLength={140}
            hint="Opcional. É o que aparece embaixo do nome na vitrine."
          />

          <div className="flex flex-col gap-2">
            <span className="legend text-[10px]">Foto</span>
            <div className="flex items-center gap-3">
              <span className="flex h-[64px] w-[64px] flex-none items-center justify-center overflow-hidden rounded-plate bg-house-deep ring-1 ring-house-rail">
                {photo ? (
                  <img src={photo} alt="" className="h-full w-full object-cover" />
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

          <fieldset className="flex flex-col gap-2">
            <span className="legend text-[10px]">Quem pode ver</span>
            <div className="flex gap-2">
              <Choice
                on={visibility === 'private'}
                onClick={() => setVisibility('private')}
                title="Privado"
                line="Só quem é do clube. Não aparece para mais ninguém."
              />
              <Choice
                on={visibility === 'public'}
                onClick={() => setVisibility('public')}
                title="Público"
                line="Qualquer um lê o acervo. Entrar depende de você aprovar."
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

type LobbyFieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>;

const LobbyField = forwardRef<HTMLInputElement, LobbyFieldProps>(function LobbyField(
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

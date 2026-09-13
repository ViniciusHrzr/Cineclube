import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { Fault, Key } from '@/components/bits';
import { PortraitGate } from '@/components/portrait';
import { clubs, initialsOf, type Club } from '@/lib/api';
import { cn, plural } from '@/lib/utils';
import { mediaUrl } from '@/lib/session';

/* ══════════════════════════════════════════════════════════════════════════
   A TROCA DE SALA — o nome do clube na marquise, e o painel que ele abre.

   Havia um saguão: uma tela inteira antes de qualquer clube, com as duas listas
   de salas e uma vitrine do que a rede andava fazendo. Ele foi apagado por
   decisão do usuário. Trocar de sala é um gesto de segundos e não um destino:
   pagar uma tela inteira e o caminho de volta por ele era cobrar uma viagem por
   um passo.

   O que ele tinha e valia continua aqui — suas salas, as abertas, e fundar uma.
   O que ele tinha e não valia — parede de cartazes, pódio, ficha da semana —
   saiu junto com ele.

   ── por que a sala de agora não é um item da lista ───────────────────────
   Ela é o cabeçalho do painel. Uma linha que leva aonde a pessoa já está é um
   controle que não faz nada, e ter uma delas acesa obrigaria o painel a
   explicar qual é a diferença entre a acesa e as outras. Dito no topo, não há o
   que explicar: isto é onde você está, e embaixo estão os outros lugares.

   ── e por que cada bloco se cala ─────────────────────────────────────────
   Quem só está no Cineclube e não tem clube aberto para olhar abre um painel de
   duas linhas: a sala em que está e a chave de fundar. É a regra do placar do
   critério em escala de bloco — contagem zero não é dado, é ruído com forma de
   dado.
   ══════════════════════════════════════════════════════════════════════════ */

export function ClubSwitch({
  club,
  onEnter,
}: {
  /** A sala de agora, que a marquise já carrega. É o cabeçalho, não um item. */
  club: Club;
  onEnter: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<Club[] | null>(null);
  const [others, setOthers] = useState<Club[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [founding, setFounding] = useState(false);
  /** Se a sua sala já existe: cada pessoa funda uma. Ver routes/clubs.js. */
  const [founded, setFounded] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  /* Só ao abrir, e outra vez a cada abertura. Uma lista de salas buscada no boot
     é uma requisição por sessão para uma pergunta que quase ninguém faz; e
     guardada da abertura anterior, mostraria um clube que a pessoa acabou de
     fundar em outra aba como inexistente. O que já veio fica na tela enquanto a
     resposta nova não chega — piscar para vazio a cada abertura seria a lista se
     desmontando debaixo do cursor. */
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

  /* Fecha ao clicar fora e no Escape, como o painel do sino: um painel que só
     fecha pelo próprio botão obriga a mirar de volta no alvo. */
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  /* Uma ação, dois desfechos: numa sala aberta você entra, numa fechada vira
     pedido. Quem diz qual foi é o servidor — a visibilidade pode ter mudado
     entre a lista e o clique. */
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
    /* `relative` aqui e não no bloco da marquise: este painel se alinha pela
       ESQUERDA, junto do nome de que ele fala, enquanto o do sino se alinha pela
       direita do bloco de ações. Dois donos diferentes, duas âncoras. */
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
        {/* Menor no telefone, e não por gosto: esta palavra divide uma linha só
            com o sino, o retrato e a lente, e a 22px um nome de duas palavras
            consome a barra inteira antes de começar a truncar. */}
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
            {/* A marca de onde se está, e é a mesma do produto inteiro: um traço
                de 2px em vermelho de cortina embaixo da seção em que a pessoa
                está parada. Aqui ele fica de pé, porque a lista corre para
                baixo. */}
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
                  /* A linha inteira não entra: entrar numa sala que não é sua é
                     um pedido, e a chave que o faz precisa ser distinguível de
                     um simples "abrir". Ver a chave dentro da linha. */
                  onAsk={() => void ask(c.slug)}
                />
              ))}
            </Block>
          ) : null}

          {/* ── a chave de fundar, ou o porquê de ela não estar aqui ──────
              Cada pessoa funda um clube. Dito onde a chave estaria, e não num
              erro depois do formulário preenchido: uma regra que só aparece no
              envio é um trabalho perdido. Quem já fundou entra nos outros pela
              lista acima. */}
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

/* Uma sala numa linha. Com `onPick` a linha inteira é o botão — é uma sala sua e
   abrir é a única coisa a fazer com ela. Com `onAsk` a linha é inerte e a chave
   é que age: pedir para entrar não é abrir, e uma linha que às vezes navega e às
   vezes envia um pedido é a mesma superfície com dois significados. */
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
        /* Sem chave: o pedido já está posto e desfazê-lo é uma decisão maior do
           que cabe numa linha de painel. A palavra diz em que pé está. */
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

/* A foto da sala, ou as iniciais dela. Quadrada como tudo o mais: o retrato
   redondo deste produto é de gente, e uma sala não é gente. */
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

/* ── fundar ───────────────────────────────────────────────────────────────
   A mesma folha que ficava no saguão, sem uma vírgula de diferença no que ela
   pergunta: nome, uma linha, foto, e como se entra. Aberta do painel e não de
   uma tela, porque não há mais tela. */
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
    /* Sem desfoque, pela razão em components/film.tsx: a parede atrás nunca para
       de andar, e um borrão sobre ela é refeito a cada quadro. */
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

          {/* A escolha é sobre a PORTA e não sobre a fachada: os dois aparecem na
              lista com nome e foto. */}
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

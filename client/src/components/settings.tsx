import { useEffect, useRef, useState } from 'react';
import { KeyRound, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import { Fault, IconKey, Key, Reel } from '@/components/bits';
import { PortraitGate } from '@/components/portrait';
import { auth, del, initialsOf, post, profile, reelColor, type Reviewer } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useClub } from '@/App';

/* ══════════════════════════════════════════════════════════════════════════
   OS AJUSTES

   Tudo o que a tela `Avaliadores` era, atrás de uma engrenagem.

   Aquela tela tinha o nome de uma seção e o conteúdo de um painel de
   preferências: quatro placas empilhadas de formulário — meu nome, meu PIN,
   cadastrar avaliador, a lista com resetar e remover. Ela ocupava uma rota
   inteira do produto para responder perguntas que alguém faz duas vezes por
   ano, e ocupava o lugar onde deveria estar a página sobre a pessoa.

   ── por que uma folha, e não uma aba ────────────────────────────────────
   Porque configuração é uma interrupção com começo e fim: você vem trocar o
   PIN, troca, e volta para onde estava. Uma aba faria disso um lugar — algo que
   se visita, que aparece na navegação, que compete com o que o clube faz. Um
   `<dialog>` nativo dá o cerco de foco, o Escape e a inércia do fundo de graça,
   e some sem deixar endereço.

   É a segunda folha do produto, e ela segue as regras da primeira (ver a ficha
   de projeção em components/film.tsx): o `cancel` é interceptado para o Escape
   sair pelo mesmo caminho do botão, e um clique que pousa no próprio elemento
   do diálogo — ou seja, fora da placa — fecha.

   ── duas regiões, e a segunda quase nunca existe ────────────────────────
   **Conta** é sua: nome, retrato, bio, PIN. **O clube** é do administrador:
   cadastrar quem entrou, devolver o PIN de quem esqueceu, remover quem saiu.
   Para todo mundo que não é admin a segunda região não é desenhada desabilitada
   — ela não existe. Um controle cinza é uma promessa que a interface não pode
   cumprir, e o servidor recusa de qualquer jeito.
   ══════════════════════════════════════════════════════════════════════════ */

const FIELD =
  'w-full rounded-cell bg-house-deep px-3 py-2.5 text-[14px] text-ink caret-dye-red ring-1 ring-house-rail placeholder:text-ink-dim focus-visible:ring-dye-brass';
const PIN_FIELD = cn(FIELD, 'q tracking-[0.5em]');
const onlyDigits = (v: string) => v.replace(/\D/g, '').slice(0, 4);

/** O mesmo teto que routes/reviewers.js aplica. Espelhado, nunca decidido aqui. */
const MAX_BIO = 140;

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const club = useClub();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener('cancel', cancel);
    return () => el.removeEventListener('cancel', cancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-label="Ajustes"
      onClick={e => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'w-full max-w-[620px] bg-transparent p-2 text-ink backdrop:bg-house-deep/80 backdrop:backdrop-blur-sm sm:p-4',
        'open:animate-beam-in'
      )}
    >
      <div className="plate relative max-h-[calc(100dvh-1rem)] overflow-y-auto p-5 sm:p-7">
        <IconKey aria-label="Fechar" onClick={onClose} className="absolute right-3 top-3 z-10">
          <X className="h-4 w-4" strokeWidth={1.8} />
        </IconKey>

        <p className="legend mb-6 pr-12">Ajustes</p>

        <Account />
        <Pin />
        {/* A região do administrador não é desenhada para quem não é. */}
        {club.me.isAdmin ? <ClubAdmin /> : <LockedOut />}
      </div>
    </dialog>
  );
}

/* ── uma região da folha ──────────────────────────────────────────────────
   Régua em cima e legenda, e nada de placa: a folha já É a placa, e uma placa
   dentro de outra são duas caixas dizendo a mesma coisa em alturas diferentes.
   Regra da regra fina — ver DESIGN.md. */
function Region({
  title,
  first,
  children,
}: {
  title: string;
  /** A primeira região não abre com uma régua: não há nada acima dela. */
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={cn(!first && 'mt-7 border-t border-white/[0.07] pt-6')}>
      <p className="legend mb-4">{title}</p>
      {children}
    </section>
  );
}

/** Uma frase de resultado: verde escreveu, vermelho recusou. */
function Note({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p className={cn('mt-3 text-[13px]', msg.ok ? 'text-dye-green-lit' : 'text-dye-red-lit')}>
      {msg.text}
    </p>
  );
}

/* ── quem eu sou aqui ─────────────────────────────────────────────────────
   Nome, retrato e bio, e os três pela mesma regra: aparecem ao lado de tudo o
   que a pessoa já disse neste clube, então pertencem a ela e a mais ninguém. A
   rota não recebe id — editar outra pessoa não é algo a proibir, é algo que não
   há como pedir. O admin não é exceção: devolver um PIN é deixar alguém entrar,
   trocar o nome é falar pela boca dela.

   O retrato é cortado em quadrado no navegador antes de subir. Uma foto de
   celular são quatro megabytes de uma coisa desenhada aqui com vinte pixels. */
function Account() {
  const club = useClub();
  /* A bio mora no roster e não na sessão: a sessão carrega quem você é para a
     marquise desenhar, e a lista do clube é a que o servidor mantém completa. */
  const mine = club.reviewers.find(p => p.id === club.me.id);

  const [name, setName] = useState(club.me.name);
  const [bio, setBio] = useState(mine?.bio ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<'name' | 'photo' | 'bio' | null>(null);
  /** O arquivo esperando enquadramento. Nada sobe enquanto isto estiver posto. */
  const [pending, setPending] = useState<File | null>(null);
  const file = useRef<HTMLInputElement>(null);

  /* Os campos nascem da conta e passam a ser de quem está digitando — mas a
     conta pode mudar por baixo, e aí os dois discordam sem ninguém ter digitado
     nada. Um cookie de sessão é do navegador inteiro, então entrar como outra
     pessoa noutra aba faz exatamente isso: a marquise atualiza e este campo fica
     segurando o nome do anterior, oferecendo salvá-lo por cima do novo.

     Resemeado na renderização que percebeu, e não num efeito depois: um efeito
     deixaria um quadro pintar o nome errado dentro da caixa. */
  const seeded = useRef(club.me.id);
  if (seeded.current !== club.me.id) {
    seeded.current = club.me.id;
    setName(club.me.name);
    setBio(mine?.bio ?? '');
  }

  const nameDirty = name.trim() !== club.me.name && name.trim().length > 0;
  const bioDirty = bio.trim() !== (mine?.bio ?? '');

  async function save(patch: { name?: string; bio?: string | null }, which: 'name' | 'bio') {
    setMsg(null);
    setBusy(which);
    try {
      await profile.update(patch);
      // O nome desenha em todo lugar; a bio, só no perfil. As duas listas são
      // relidas de qualquer forma: uma requisição a menos não vale a divergência.
      await Promise.all([club.refreshMe(), club.refreshReviewers()]);
      setMsg({ ok: true, text: which === 'name' ? 'Nome atualizado.' : 'Bio atualizada.' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  function saveName() {
    const value = name.trim();
    if (!value) return setMsg({ ok: false, text: 'O nome não pode ficar vazio.' });
    void save({ name: value }, 'name');
  }

  /* Vazio manda `null`: apagar a bio e nunca ter escrito uma são o mesmo estado,
     e o servidor grava os dois como null pelo mesmo motivo. */
  const saveBio = () => void save({ bio: bio.trim() || null }, 'bio');

  /* Escolher um arquivo abre o enquadramento; nada é enviado antes de a moldura
     ser decidida. Limpar o input aqui e não depois é o que deixa escolher o
     MESMO arquivo outra vez após cancelar — um input de arquivo não dispara
     change quando recebe o valor que já tinha. */
  function pick(picked: File) {
    setMsg(null);
    setPending(picked);
    if (file.current) file.current.value = '';
  }

  async function savePhoto(avatar: string | null) {
    setPending(null);
    setMsg(null);
    setBusy('photo');
    try {
      await profile.update({ avatar });
      await Promise.all([club.refreshMe(), club.refreshReviewers()]);
      setMsg({ ok: true, text: avatar ? 'Foto atualizada.' : 'Foto removida.' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const left = MAX_BIO - bio.trim().length;

  return (
    <Region title="Conta" first>
      <div className="flex flex-wrap items-start gap-5">
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
              onClick={() => void savePhoto(null)}
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
                if (e.key === 'Enter' && nameDirty) saveName();
              }}
              className={FIELD}
            />
          </label>
          <p className="q mt-2 text-[11px] text-ink-dim">
            É como você aparece em todas as suas avaliações. Só você pode mudar.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Key tone="flush" disabled={!nameDirty || busy === 'name'} onClick={saveName}>
              {busy === 'name' ? 'Salvando…' : 'Salvar nome'}
            </Key>
            {nameDirty ? (
              <Key tone="ghost" onClick={() => setName(club.me.name)}>
                Desfazer
              </Key>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── a bio ──────────────────────────────────────────────────────────
          A única coisa do perfil que a pessoa afirma sobre si. Tudo o mais que
          a página mostra é derivado do que ela avaliou — e derivado é mais
          honesto, porque ninguém escreve "sou o cara da fotografia": isso se
          prova avaliando. Isto existe para o que uma média não alcança, que é
          o tom de voz.

          O contador só aparece perto do fim. Um número contando cada tecla
          desde o primeiro caractere transforma escrever uma frase em cumprir
          uma cota. */}
      <label className="mt-5 block">
        <span className="legend mb-1.5 block">Minha bio</span>
        <textarea
          value={bio}
          rows={2}
          maxLength={MAX_BIO}
          placeholder="Uma linha sobre você. Ex: só vim pelo terror."
          onChange={e => setBio(e.target.value)}
          className={cn(FIELD, 'resize-none leading-relaxed')}
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Key tone="flush" disabled={!bioDirty || busy === 'bio'} onClick={saveBio}>
          {busy === 'bio' ? 'Salvando…' : 'Salvar bio'}
        </Key>
        {bioDirty ? (
          <Key tone="ghost" onClick={() => setBio(mine?.bio ?? '')}>
            Desfazer
          </Key>
        ) : null}
        {left <= 30 ? (
          <span className={cn('q text-[11px]', left < 0 ? 'text-dye-red-lit' : 'text-ink-dim')}>
            {left}
          </span>
        ) : null}
      </div>

      <Note msg={msg} />

      {pending ? (
        <PortraitGate
          file={pending}
          onCancel={() => setPending(null)}
          onDone={avatar => void savePhoto(avatar)}
        />
      ) : null}
    </Region>
  );
}

/* ── o meu PIN ────────────────────────────────────────────────────────────
   O PIN atual é exigido, então quem encontra um navegador aberto ainda não
   consegue trancar o dono fora da própria conta. */
function Pin() {
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
    <Region title="Meu PIN">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="legend mb-1.5 block">PIN atual</span>
          <input
            value={currentPin}
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="••••"
            autoComplete="current-password"
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
            autoComplete="new-password"
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
            autoComplete="new-password"
            onChange={e => setConfirmPin(onlyDigits(e.target.value))}
            onKeyDown={e => {
              if (e.key === 'Enter') void change();
            }}
            className={PIN_FIELD}
          />
        </label>
      </div>
      <Note msg={msg} />
      <div className="mt-4">
        <Key tone="flush" disabled={busy} onClick={() => void change()}>
          {busy ? 'Trocando…' : 'Trocar meu PIN'}
        </Key>
      </div>
    </Region>
  );
}

/* Quem não é admin não vê a região do clube, e vê no lugar dela a única coisa
   dali que lhe diz respeito: quem consegue devolver um PIN esquecido. Como o
   PIN é guardado não é problema dessa pessoa. */
function LockedOut() {
  return (
    <Region title="Esqueci meu PIN">
      <p className="max-w-[54ch] text-[13px] leading-relaxed text-ink-dim">
        Só o administrador do clube pode definir um novo — e nem ele consegue ler o seu.
      </p>
    </Region>
  );
}

/* ── o clube, para quem administra ────────────────────────────────────────
   Cadastrar quem entrou, devolver o PIN de quem esqueceu, remover quem saiu.
   As três regras que o servidor aplica são repetidas aqui só para a interface
   não oferecer o que vai ser negado — nunca como a defesa, que é de lá. */
function ClubAdmin() {
  const club = useClub();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetPin, setResetPin] = useState('');
  const [note, setNote] = useState<string | null>(null);

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
    if (!/^\d{4}$/.test(resetPin)) return setNote('O PIN precisa ter 4 dígitos.');
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
    <Region title="O clube">
      <div className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Nome de quem entrou"
          autoComplete="off"
          aria-label="Nome do novo avaliador"
          className={cn(FIELD, 'min-w-[180px] flex-1')}
        />
        <input
          value={pin}
          type="password"
          inputMode="numeric"
          maxLength={4}
          placeholder="PIN"
          aria-label="PIN do novo avaliador"
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
      {error ? (
        <div className="mt-3">
          <Fault>{error}</Fault>
        </div>
      ) : null}

      <div className="mt-5 border-t border-white/[0.07]">
        {club.reviewers.map(p => {
          const n = club.reviews.filter(r => r.reviewerId === p.id).length;
          const isSelf = p.id === club.me.id;
          /* A cadeira de admin é uma coluna numa linha e nenhuma rota a devolve,
             então remover quem a ocupa deixaria o clube sem ninguém capaz de
             devolver um PIN ou remover alguém. */
          const canRemove = !p.isAdmin;
          return (
            <div key={p.id} className="border-b border-white/[0.06] py-3">
              <div className="flex items-center gap-3 px-1">
                <Reel color={reelColor(p.dot, p.id)} src={p.avatar} size="lg">
                  {initialsOf(p.name)}
                </Reel>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[15px] font-medium">
                    <span className="truncate">{p.name}</span>
                    {isSelf ? <span className="q text-[10px] text-ink-dim">você</span> : null}
                    {p.isAdmin ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-dye-brass">
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

                {!isSelf ? (
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
                    aria-label={`Novo PIN de ${p.name}`}
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
        })}
      </div>

      {note ? <p className="mt-4 text-[13px] text-ink-dim">{note}</p> : null}
    </Region>
  );
}

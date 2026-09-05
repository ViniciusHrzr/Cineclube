import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { Fault, IconKey, Key, Reel } from '@/components/bits';
import { PortraitGate } from '@/components/portrait';
import {
  auth,
  clubs as clubsApi,
  initialsOf,
  profile,
  reelColor,
  type JoinRequest,
  type SessionUser,
} from '@/lib/api';
import { cn, plural } from '@/lib/utils';
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
   **Conta** é sua: nome, retrato, bio, senha. **A sala** é do ADM do clube:
   quem está dentro, quem pediu para entrar, e o que o clube é.

   Para quem não administra, a segunda região não é desenhada desabilitada — ela
   não existe. Um controle cinza é uma promessa que a interface não pode cumprir,
   e o servidor recusa de qualquer jeito.

   ── e por que a Conta não conhece o clube ───────────────────────────────
   Porque ela é usada em dois lugares agora: dentro de uma sala, e no saguão, que
   é onde uma pessoa sem clube nenhum ainda precisa poder trocar o próprio nome e
   cadastrar uma senha. Um componente que chamasse `useClub()` não existiria no
   segundo. Então ele recebe o que precisa, e quem sabe de onde aquilo veio é
   quem o monta.
   ══════════════════════════════════════════════════════════════════════════ */

const FIELD =
  'w-full rounded-cell bg-house-deep px-3 py-2.5 text-[14px] text-ink caret-dye-red ring-1 ring-house-rail placeholder:text-ink-dim focus-visible:ring-dye-brass';

/** O mesmo teto que routes/reviewers.js aplica. Espelhado, nunca decidido aqui. */
const MAX_BIO = 140;

/* A folha do saguão: só a conta, porque lá não há sala nenhuma sobre a qual
   falar. Mesma casca, mesmas regiões, uma a menos. */
export function AccountSheet({
  open,
  onClose,
  me,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  me: SessionUser;
  onChanged: () => void | Promise<void>;
}) {
  return (
    <Sheet open={open} onClose={onClose} label="Minha conta">
      <Account me={me} bio={me.bio ?? null} onSaved={onChanged} />
      <Password />
    </Sheet>
  );
}

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const club = useClub();
  const mine = club.reviewers.find(p => p.id === club.me.id);
  return (
    <Sheet open={open} onClose={onClose} label="Ajustes">
      <Account
        me={club.me}
        bio={mine?.bio ?? null}
        onSaved={async () => {
          await Promise.all([club.refreshMe(), club.refreshReviewers()]);
        }}
      />
      <Password />
      {/* A região da sala não é desenhada para quem não a administra. */}
      {club.isClubAdmin ? <ClubRoom /> : <NotTheAdmin />}
    </Sheet>
  );
}

function Sheet({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
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
      aria-label={label}
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

        <p className="legend mb-6 pr-12">{label}</p>

        {children}
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
function Account({
  me,
  bio: theirBio,
  onSaved,
}: {
  me: SessionUser;
  bio: string | null;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState(me.name);
  const [bio, setBio] = useState(theirBio ?? '');
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
  const seeded = useRef(me.id);
  if (seeded.current !== me.id) {
    seeded.current = me.id;
    setName(me.name);
    setBio(theirBio ?? '');
  }

  const nameDirty = name.trim() !== me.name && name.trim().length > 0;
  const bioDirty = bio.trim() !== (theirBio ?? '');

  async function save(patch: { name?: string; bio?: string | null }, which: 'name' | 'bio') {
    setMsg(null);
    setBusy(which);
    try {
      await profile.update(patch);
      // O nome desenha em todo lugar; a bio, só no perfil. As duas listas são
      // relidas de qualquer forma: uma requisição a menos não vale a divergência.
      await onSaved();
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
      await onSaved();
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
            color={reelColor(me.dot, me.id)}
            src={me.avatar}
            className={cn('h-[76px] w-[76px] text-[24px]', !me.avatar && 'min-w-0')}
          >
            {initialsOf(me.name)}
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
            {busy === 'photo' ? 'Enviando…' : me.avatar ? 'Trocar' : 'Enviar foto'}
          </Key>
          {me.avatar ? (
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
              <Key tone="ghost" onClick={() => setName(me.name)}>
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
          <Key tone="ghost" onClick={() => setBio(theirBio ?? '')}>
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

/* ── um interruptor ───────────────────────────────────────────────────────
   Uma linha inteira clicável, com a lâmpada à esquerda e o que ela faz escrito
   ao lado. Não é um `checkbox` nem um seletor de arrastar: o produto já tem um
   vocabulário para "isto está ligado", e é a lâmpada — o ponto de seis pixels
   com o brilho, a única coisa redonda deste sistema (ver DESIGN.md).

   Vermelho aceso e `ink-faint` apagado, como a lâmpada da legenda na sala de
   projeção e a da Sessão na marquise. Um interruptor que acendesse latão diria
   "selecionado", que é outra coisa: latão é escolha, vermelho é funcionamento. */
function Switch({
  on,
  onToggle,
  title,
  line,
}: {
  on: boolean;
  onToggle: () => void;
  title: string;
  line: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={cn(
        'flex w-full items-start gap-3 rounded-cell px-3 py-2.5 text-left ring-1 transition-colors',
        on ? 'bg-dye-red/[0.07] ring-dye-red-lit/40' : 'ring-house-rail hover:ring-white/20'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-[3px] h-1.5 w-1.5 flex-none rounded-full transition-colors',
          on ? 'bg-dye-red-lit shadow-[0_0_7px_rgba(242,86,74,0.85)]' : 'bg-ink-faint'
        )}
      />
      <span className="min-w-0">
        <span
          className={cn(
            'block font-display text-[12px] uppercase leading-none tracking-[0.12em]',
            on ? 'text-dye-red-lit' : 'text-ink'
          )}
        >
          {title}
        </span>
        <span className="mt-1.5 block text-[12px] leading-snug text-ink-dim">{line}</span>
      </span>
    </button>
  );
}

/* ── a minha senha ────────────────────────────────────────────────────────
   A atual é exigida quando já existe uma, então quem encontra um navegador
   destrancado ainda não consegue trancar o dono fora da própria conta.

   Quando não existe — conta que entrou pelo Google e pulou o cadastro —, o
   campo "atual" não é desenhado desabilitado: ele simplesmente não está lá, e o
   título diz "Cadastrar senha" em vez de "Trocar". Um campo cinza pedindo uma
   coisa que não existe é a interface fazendo a pessoa duvidar da própria
   memória. */
function Password() {
  const [has, setHas] = useState<boolean | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void auth
      .me()
      .then(r => setHas(!r.needsPassword))
      .catch(() => setHas(true));
  }, []);

  async function change() {
    setMsg(null);
    if (next.length < 8) return setMsg({ ok: false, text: 'A senha precisa ter pelo menos 8 caracteres.' });
    if (next !== again) return setMsg({ ok: false, text: 'As duas senhas novas não são iguais.' });
    setBusy(true);
    try {
      await auth.setPassword(next, has ? current : undefined);
      setMsg({
        ok: true,
        text: has
          ? 'Senha alterada. As outras abas foram desconectadas.'
          : 'Senha cadastrada. Agora você entra pelo Google ou por ela.',
      });
      setHas(true);
      setCurrent('');
      setNext('');
      setAgain('');
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Region title={has === false ? 'Cadastrar senha' : 'Minha senha'}>
      {has === false ? (
        <p className="mb-4 max-w-[52ch] text-[13px] leading-relaxed text-ink-dim">
          Você entra pelo Google. Uma senha é o caminho de volta no dia em que
          aquela conta não estiver mais à mão.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {has ? (
          <label className="block">
            <span className="legend mb-1.5 block">Senha atual</span>
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={e => setCurrent(e.target.value)}
              className={FIELD}
            />
          </label>
        ) : null}
        <label className="block">
          <span className="legend mb-1.5 block">Nova senha</span>
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={e => setNext(e.target.value)}
            className={FIELD}
          />
        </label>
        <label className="block">
          <span className="legend mb-1.5 block">De novo</span>
          <input
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={e => setAgain(e.target.value)}
            className={FIELD}
          />
        </label>
      </div>

      <Key tone="flush" className="mt-4" disabled={busy} onClick={() => void change()}>
        {busy ? 'Gravando…' : has === false ? 'Cadastrar senha' : 'Trocar minha senha'}
      </Key>

      <Note msg={msg} />
    </Region>
  );
}

/* O que sobra para quem não administra a sala: a frase que diz a quem pedir.
   Antes isto era "esqueci meu PIN" e a resposta era o admin da instalação; agora
   quem manda numa sala é o ADM dela, e é o nome dele que a pessoa precisa. */
function NotTheAdmin() {
  const club = useClub();
  const admins = club.reviewers.filter(p => p.role === 'admin').map(p => p.name);
  return (
    <Region title="Esta sala">
      <p className="max-w-[52ch] text-[13px] leading-relaxed text-ink-dim">
        {admins.length
          ? `Quem administra ${club.club.name} ${admins.length > 1 ? 'são' : 'é'} ${admins.join(', ')}. ` +
            'Aprovar quem entra, mudar a foto e o nome do clube são coisas de ADM.'
          : 'Este clube está sem ADM. Fale com o administrador da instalação.'}
      </p>
      {/* Quem fundou não sai: sair é deixar de administrar, e a regra é que quem
          fundou administra enquanto o clube existir. A saída dessa pessoa é
          outra, e ela está na região de baixo. */}
      {!club.club.isCreator ? (
        <Key
          tone="danger"
          className="mt-4"
          onClick={() => {
            if (!confirm(`Sair de ${club.club.name}? Suas avaliações neste clube continuam lá.`)) return;
            void club.leaveClub();
          }}
        >
          Sair deste clube
        </Key>
      ) : null}
    </Region>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   A sala, para quem a administra.

   Três coisas, e elas são as três perguntas de um ADM: quem está pedindo para
   entrar, quem já está dentro, e o que este clube é.

   Os pedidos vêm primeiro de propósito. É a única das três que tem alguém
   esperando do outro lado — as outras duas ninguém está esperando.
   ══════════════════════════════════════════════════════════════════════════ */
function ClubRoom() {
  const club = useClub();
  const [requests, setRequests] = useState<JoinRequest[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [name, setName] = useState(club.club.name);
  const [tagline, setTagline] = useState(club.club.tagline ?? '');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const loadRequests = useCallback(async () => {
    try {
      const got = await clubsApi.requests(club.club.slug);
      setRequests(got.requests);
    } catch {
      setRequests([]);
    }
  }, [club.club.slug]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  async function answer(id: string, approve: boolean) {
    try {
      await clubsApi.answer(club.club.slug, id, approve);
      setRequests(list => (list ?? []).filter(r => r.id !== id));
      /* O clube sempre, o elenco só quando alguém entrou: é o clube que carrega
         a conta de quem está esperando, e é ela que acende o distintivo na
         marquise. Sem isto o número continuaria lá depois de a fila esvaziar. */
      await club.refreshClub();
      if (approve) await club.refreshReviewers();
    } catch (e) {
      setNote((e as Error).message);
    }
  }

  async function saveClub(patch: Parameters<typeof clubsApi.update>[1]) {
    setBusy(true);
    setNote(null);
    try {
      await clubsApi.update(club.club.slug, patch);
      await club.refreshClub();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const nameDirty = name.trim() !== club.club.name && !!name.trim();
  const taglineDirty = tagline.trim() !== (club.club.tagline ?? '');

  return (
    <>
      <Region title={`Pedidos para entrar${requests?.length ? ` (${requests.length})` : ''}`}>
        {requests === null ? (
          <p className="legend animate-flicker">Carregando</p>
        ) : requests.length === 0 ? (
          <p className="text-[13px] text-ink-dim">
            {club.club.visibility === 'public'
              ? 'Ninguém está esperando.'
              : 'O clube é privado, então ninguém consegue pedir para entrar.'}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {requests.map(r => (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-3 rounded-cell bg-house-deep px-3 py-2.5 ring-1 ring-house-rail"
              >
                <Reel color={reelColor(r.dot, r.id)} src={r.avatar}>
                  {initialsOf(r.name)}
                </Reel>
                <span className="mr-auto text-[14px] text-ink">{r.name}</span>
                <Key tone="commit" onClick={() => void answer(r.id, true)}>
                  Aceitar
                </Key>
                <Key tone="ghost" onClick={() => void answer(r.id, false)}>
                  Recusar
                </Key>
              </div>
            ))}
          </div>
        )}
      </Region>

      <Region title="Quem está aqui">
        <div className="flex flex-col gap-2">
          {club.reviewers.map(p => {
            const isSelf = p.id === club.me.id;
            const isAdmin = p.role === 'admin';
            /* Quem fundou administra enquanto o clube existir, então os dois
               controles somem para essa pessoa. O servidor recusa de qualquer
               jeito; um botão que existe para dar erro é a interface prometendo
               o que ela sabe que não pode cumprir. */
            const fundador = club.club.isCreator && isSelf;
            return (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-3 rounded-cell bg-house-deep px-3 py-2.5 ring-1 ring-house-rail"
              >
                <Reel color={reelColor(p.dot, p.id)} src={p.avatar}>
                  {initialsOf(p.name)}
                </Reel>
                <span className="mr-auto text-[14px] text-ink">
                  {p.name}
                  {isAdmin ? <span className="ml-2 text-[10px] text-dye-brass">ADM</span> : null}
                  {fundador ? (
                    <span className="ml-2 text-[11px] text-ink-faint">fundou o clube</span>
                  ) : isSelf ? (
                    <span className="ml-2 text-[11px] text-ink-faint">você</span>
                  ) : null}
                </span>

                {!fundador ? (
                  <Key
                    tone="ghost"
                    onClick={() => {
                      void clubsApi
                        .setRole(club.club.slug, p.id, isAdmin ? 'member' : 'admin')
                        .then(() => club.refreshReviewers())
                        .catch(e => setNote((e as Error).message));
                    }}
                  >
                    {isAdmin ? 'Tirar ADM' : 'Tornar ADM'}
                  </Key>
                ) : null}

                {/* Tirar alguém não apaga a conta dela nem as fichas: ela sai da
                    sala, e o que ela escreveu aqui continua onde está. É a
                    diferença entre uma pessoa deixar de frequentar e a
                    conversa dela nunca ter existido. */}
                {!isSelf ? (
                  <IconKey
                    aria-label={`Tirar ${p.name} do clube`}
                    onClick={() => {
                      if (!confirm(`Tirar ${p.name} do clube? As avaliações dela aqui continuam.`)) return;
                      void clubsApi
                        .leave(club.club.slug, p.id)
                        .then(() => club.refreshReviewers())
                        .catch(e => setNote((e as Error).message));
                    }}
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                  </IconKey>
                ) : null}
              </div>
            );
          })}
        </div>
      </Region>

      <Region title="O que este clube é">
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex flex-col items-center gap-2">
            <span className="flex h-[76px] w-[76px] items-center justify-center overflow-hidden rounded-plate bg-house-deep ring-1 ring-house-rail">
              {club.club.photo ? (
                <img src={club.club.photo} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="font-display text-[26px] text-ink-faint">
                  {initialsOf(club.club.name)}
                </span>
              )}
            </span>
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) setPending(f);
                e.target.value = '';
              }}
            />
            <Key tone="ghost" className="px-2 py-1 text-[11px]" onClick={() => photoInput.current?.click()}>
              {club.club.photo ? 'Trocar' : 'Enviar foto'}
            </Key>
            {club.club.photo ? (
              <button
                type="button"
                onClick={() => void saveClub({ photo: null })}
                className="text-[11px] text-ink-dim underline underline-offset-4 transition-colors hover:text-dye-red-lit"
              >
                remover
              </button>
            ) : null}
          </div>

          <div className="min-w-[220px] flex-1">
            <label className="block">
              <span className="legend mb-1.5 block">Nome do clube</span>
              <input
                value={name}
                maxLength={40}
                onChange={e => setName(e.target.value)}
                className={FIELD}
              />
            </label>
            {/* O endereço acompanha o nome, e o antigo deixa de funcionar. É o
                preço de o endereço ser legível, e ele é dito aqui em vez de
                descoberto por um link quebrado no Discord. */}
            <p className="q mt-2 text-[11px] text-ink-dim">
              Trocar o nome troca o endereço do clube. Links antigos param de valer.
            </p>

            <label className="mt-4 block">
              <span className="legend mb-1.5 block">Uma linha sobre ele</span>
              <input
                value={tagline}
                maxLength={140}
                onChange={e => setTagline(e.target.value)}
                className={FIELD}
              />
            </label>

            <div className="mt-3 flex flex-wrap gap-2">
              <Key
                tone="flush"
                disabled={busy || (!nameDirty && !taglineDirty)}
                onClick={() =>
                  void saveClub({
                    ...(nameDirty ? { name: name.trim() } : {}),
                    ...(taglineDirty ? { tagline: tagline.trim() } : {}),
                  })
                }
              >
                {busy ? 'Salvando…' : 'Salvar'}
              </Key>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <span className="legend mb-2 block">Como se entra</span>
          <div className="flex flex-wrap gap-2">
            <Key
              tone={club.club.visibility === 'public' ? 'commit' : 'flush'}
              onClick={() => void saveClub({ visibility: 'public' })}
            >
              Aberto
            </Key>
            <Key
              tone={club.club.visibility === 'private' ? 'commit' : 'flush'}
              onClick={() => void saveClub({ visibility: 'private' })}
            >
              Fechado
            </Key>
          </div>
          <p className="mt-2 max-w-[54ch] text-[12.5px] leading-relaxed text-ink-dim">
            {club.club.visibility === 'public'
              ? 'Qualquer pessoa entra e já pode avaliar, e o acervo é lido por quem passar. Abrir agora admite quem estava esperando na fila de pedidos.'
              : 'O clube aparece no saguão com nome e foto, mas entrar depende de você aprovar. O que um estranho enxerga daqui de dentro você decide abaixo.'}
          </p>
        </div>

        {/* ── o que um estranho enxerga ───────────────────────────────────
            Só faz sentido num clube fechado: num aberto tudo é legível de
            qualquer jeito, e desenhar dois interruptores que não fazem nada
            seria a tela oferecendo uma escolha que ela não vai honrar.

            Os dois ligados deixam o clube fechado apenas na PORTA: ler é livre,
            entrar e avaliar continuam dependendo de você. */}
        {club.club.visibility === 'private' ? (
          <div className="mt-6">
            <span className="legend mb-2 block">O que quem não é do clube vê</span>
            <div className="flex flex-col gap-2">
              <Switch
                on={!!club.club.showReviews}
                onToggle={() => void saveClub({ showReviews: !club.club.showReviews })}
                title="Mostrar avaliações"
                line="As fichas do clube, com as notas e os onze critérios."
              />
              <Switch
                on={!!club.club.showComments}
                onToggle={() => void saveClub({ showComments: !club.club.showComments })}
                title="Mostrar comentários"
                line="A conversa em cima das fichas, e as concordâncias."
              />
            </div>
            <p className="mt-3 max-w-[54ch] text-[12.5px] leading-relaxed text-ink-dim">
              {club.club.showReviews && club.club.showComments
                ? 'Com as duas ligadas, o clube fica fechado só na porta: qualquer pessoa lê tudo, e entrar e avaliar continuam dependendo de você aprovar.'
                : club.club.showReviews || club.club.showComments
                  ? 'A fila e o elenco acompanham: quem pode ler o que o clube escreveu vê quem escreveu e o que ele pretende assistir.'
                  : 'Nada é legível de fora. Quem não é do clube vê só o nome, a foto e quantas pessoas estão aqui.'}
            </p>
            <p className="mt-2 max-w-[54ch] text-[12.5px] leading-relaxed text-ink-faint">
              A sala de projeção nunca abre: assistir junto é de dentro, e o
              painel dela diz quem está na sala agora.
            </p>

            {/* ── e o que a sala empresta para o saguão ──────────────────────
                Uma pergunta diferente das duas de cima, e por isso uma região
                própria: aquelas decidem se um estranho LÊ esta sala; esta decide
                se o que ela avaliou entra nas contas da rede.

                O que se empresta é número — média, contagem, um pôster. Quem deu
                a nota e o que escreveu continuam do lado de dentro, a não ser
                que "Mostrar avaliações" também esteja ligado, e é isso que a
                última frase diz em vez de deixar supor. */}
            <div className="mt-6">
              <span className="legend mb-2 block">O que o clube empresta à rede</span>
              <Switch
                on={!!club.club.showCharts}
                onToggle={() => void saveClub({ showCharts: !club.club.showCharts })}
                title="Entrar nas contas do saguão"
                line="As notas daqui contam na média da rede, e a sala aparece entre as mais ativas."
              />
              <p className="mt-3 max-w-[54ch] text-[12.5px] leading-relaxed text-ink-dim">
                {club.club.showCharts
                  ? club.club.showReviews
                    ? 'Ligada junto de “Mostrar avaliações”, uma ficha daqui pode ser a ficha em destaque do saguão — com o nome de quem escreveu e o que escreveu.'
                    : 'O saguão soma as notas e mostra os pôsteres, sem dizer quem deu nota nem o que escreveu. Para uma ficha daqui poder ser destaque lá, ligue também “Mostrar avaliações”.'
                  : 'Desligada, nada deste clube existe no saguão: nem na contagem de fichas, nem num pôster, nem num filme mais bem avaliado. O nome, a foto e quantas pessoas continuam à vista — é como alguém pede para entrar.'}
              </p>
            </div>
          </div>
        ) : null}

        {note ? <p className="mt-4 text-[13px] text-dye-red-lit">{note}</p> : null}
      </Region>

      {club.club.isCreator ? <EndClub /> : null}

      {pending ? (
        <PortraitGate
          file={pending}
          onCancel={() => setPending(null)}
          onDone={photo => {
            setPending(null);
            void saveClub({ photo });
          }}
        />
      ) : null}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Encerrar o clube.

   A única coisa verdadeiramente destrutiva deste produto, e a única reservada a
   quem fundou — não ao ADM: ADMs podem ser vários e são promovidos por outro
   ADM, e "quem administra hoje" é um cargo, não um dono.

   ── por que escrever o nome ───────────────────────────────────────────────
   Porque isto apaga o que OUTRAS pessoas escreveram. Um `confirm()` é o preço
   de um clique distraído, e o que está do outro lado dele são as fichas, a
   conversa e os votos de um clube inteiro. Escrever o nome não é burocracia: é o
   único jeito de a mão parar tempo suficiente para a cabeça alcançar.

   A conta do que se perde vem primeiro, e é a de verdade — as listas já estão
   carregadas no cliente desde o boot, então não é uma estimativa nem um número
   redondo. "12 fichas e 5 pessoas" é uma frase que se pesa; "esta ação não pode
   ser desfeita" é uma que se lê sem ver.
   ══════════════════════════════════════════════════════════════════════════ */
function EndClub() {
  const club = useClub();
  const [armado, setArmado] = useState(false);
  const [escrito, setEscrito] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const confere = escrito.trim().toLowerCase() === club.club.name.trim().toLowerCase();

  async function encerrar() {
    if (!confere || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await clubsApi.remove(club.club.slug);
      club.goLobby();
    } catch (e) {
      setErro((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Region title="Encerrar o clube">
      <p className="max-w-[54ch] text-[13px] leading-relaxed text-ink-dim">
        Você fundou {club.club.name}, então é a única pessoa que pode encerrá-lo —
        e é também por isso que você não deixa de administrá-lo enquanto ele
        existir.
      </p>

      {!armado ? (
        <Key tone="danger" className="mt-4" onClick={() => setArmado(true)}>
          Encerrar o clube
        </Key>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <p className="max-w-[54ch] text-[13px] leading-relaxed text-ink">
            Some para todo mundo, e não tem volta:{' '}
            <span className="text-dye-red-lit">
              {plural(club.reviews.length, 'ficha', 'fichas')}
            </span>
            , a conversa em cima delas, os votos,{' '}
            <span className="text-dye-red-lit">
              {plural(club.watchlist.length, 'filme na fila', 'filmes na fila')}
            </span>{' '}
            e a lista de {plural(club.reviewers.length, 'pessoa', 'pessoas')}.
          </p>

          <label className="block max-w-[320px]">
            <span className="legend mb-1.5 block">Escreva {club.club.name} para confirmar</span>
            <input
              value={escrito}
              autoFocus
              autoComplete="off"
              onChange={e => setEscrito(e.target.value)}
              className={FIELD}
            />
          </label>

          {erro ? <Fault>{erro}</Fault> : null}

          <div className="flex items-center gap-2">
            <Key tone="commit" disabled={!confere || busy} onClick={() => void encerrar()}>
              {busy ? 'Encerrando…' : 'Encerrar para sempre'}
            </Key>
            <Key
              tone="ghost"
              onClick={() => {
                setArmado(false);
                setEscrito('');
                setErro(null);
              }}
            >
              Cancelar
            </Key>
          </div>
        </div>
      )}
    </Region>
  );
}

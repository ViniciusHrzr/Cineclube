import { forwardRef, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Fault, Key } from '@/components/bits';
import { HolographicWall } from '@/components/ui/holographic-wall-shadcnui';
import { auth, type SessionUser } from '@/lib/api';
import { cn } from '@/lib/utils';

/* ══════════════════════════════════════════════════════════════════════════
   Quem está entrando.

   Isto era um mural de rostos: o clube inteiro na parede iluminada, você clicava
   no seu e digitava quatro dígitos. Era a coisa certa enquanto o produto era uma
   sala, porque a lista de rostos ERA o clube — e é a coisa errada no instante em
   que existem muitas salas, porque a mesma tela passaria a ser a lista de todo
   mundo que existe na rede.

   Então a porta muda de natureza. Antes de saber em que sala você entra, o
   produto precisa saber quem você é, e isso agora é um e-mail.

   ── duas portas para a mesma conta ─────────────────────────────────────────
   O Google é a normal: um clique, nenhuma senha nova para inventar, e quem cuida
   de segundo fator e de conta invadida é quem já cuida disso na vida da pessoa.

   A senha existe para a porta não ser única. É pedida uma vez, logo depois da
   primeira entrada pelo Google, e é o que garante que ninguém perca o clube por
   um motivo que não tem nada a ver com o clube.

   ── a sala continua sendo a sala ───────────────────────────────────────────
   Nada aqui virou formulário de serviço. A parede continua atrás, o nome
   continua em Bebas na altura de uma marquise, e as duas portas são duas chaves
   do mesmo tamanho — não um botão grande de marca e um formulário pequeno de
   consolação.
   ══════════════════════════════════════════════════════════════════════════ */

/** O erro que a volta do Google escreve no endereço, se houver. */
function errorFromHash() {
  const raw = (location.hash || '').replace(/^#/, '');
  const q = raw.indexOf('?');
  if (q < 0) return null;
  const got = new URLSearchParams(raw.slice(q + 1)).get('erro');
  return got || null;
}

export function SignIn({ onSignedIn }: { onSignedIn: (u: SessionUser) => void }) {
  const [google, setGoogle] = useState(true);
  /* O erro só é escrito no primeiro render, pela volta do Google. Nada nesta
     tela produz um segundo — o formulário de senha tem o seu próprio. */
  const [error] = useState<string | null>(() => errorFromHash());
  /* A porta da senha começa fechada. Não é a porta principal, e desenhar os dois
     campos abertos ao lado do botão do Google seria a tela dizendo que espera
     que você digite — quando o que ela espera é um clique. */
  const [byPassword, setByPassword] = useState(false);

  /* Se esta instalação sequer tem a porta do Google configurada. Sem as
     variáveis no servidor o botão não aparece: um botão que leva a um 503 é pior
     do que um botão que não está lá. */
  useEffect(() => {
    void auth
      .me()
      .then(r => setGoogle(r.google !== false))
      .catch(() => setGoogle(true));
  }, []);

  /* O erro veio no endereço e já foi lido. Limpar evita que ele reapareça a cada
     recarga de uma aba que ficou aberta com o endereço sujo. */
  useEffect(() => {
    if (errorFromHash()) history.replaceState(null, '', location.pathname + '#entrar');
  }, []);

  return (
    <div className="relative flex min-h-[calc(100dvh/var(--ui-zoom))] flex-col">
      <HolographicWall asBackdrop />

      <div className="relative mx-auto flex w-full max-w-[900px] flex-1 flex-col justify-center px-5 py-14">
        <header className="mb-10 text-center">
          <h1 className="font-display text-[42px] leading-none tracking-[0.16em] text-beam sm:text-[56px]">
            CINECLUBE
          </h1>
          <p className="mt-3 text-[13.5px] text-ink-dim">
            Onde um grupo de amigos avalia filme por filme.
          </p>
        </header>

        {error ? (
          <div className="mx-auto mb-6 w-full max-w-[420px]">
            <Fault>{error}</Fault>
          </div>
        ) : null}

        <div className="mx-auto w-full max-w-[380px]">
          {google ? (
            <a
              href={auth.googleUrl}
              className={cn(
                'flex w-full items-center justify-center gap-3 rounded-cell px-4 py-3 no-underline',
                'bg-house-seat/70 ring-1 ring-house-rail',
                'font-display text-[13px] uppercase leading-none tracking-[0.14em] text-ink',
                'transition-colors duration-150 hover:text-beam hover:ring-beam/70'
              )}
            >
              <GoogleMark />
              Entrar com o Google
            </a>
          ) : null}

          <AnimatePresence initial={false} mode="wait">
            {byPassword ? (
              <motion.div
                key="senha"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
              >
                <PasswordEntry
                  onSignedIn={onSignedIn}
                  onBack={google ? () => setByPassword(false) : undefined}
                />
              </motion.div>
            ) : (
              <motion.div
                key="escolha"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {google ? (
                  <div className="mt-5 flex items-center gap-3">
                    <span className="h-px flex-1 bg-white/[0.07]" />
                    <span className="legend text-[10px]">ou</span>
                    <span className="h-px flex-1 bg-white/[0.07]" />
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => setByPassword(true)}
                  className="mt-5 w-full text-center font-display text-[12px] uppercase leading-none tracking-[0.14em] text-ink-dim transition-colors hover:text-beam"
                >
                  Entrar com e-mail e senha
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* A conta nasce da primeira entrada pelo Google, e não de um cadastro.
            Dizer isso aqui evita a pergunta que a ausência de um "criar conta"
            provoca — e ela é a primeira que alguém faz nesta tela. */}
        <p className="mx-auto mt-10 max-w-[38ch] text-center text-[12.5px] leading-relaxed text-ink-faint">
          Não existe cadastro: entrar pelo Google pela primeira vez já cria a sua
          conta. O clube vem depois.
        </p>
      </div>
    </div>
  );
}

/* ── e-mail e senha ───────────────────────────────────────────────────────
   Uma frase só de erro para senha errada e para e-mail que não existe, porque o
   servidor também responde uma só: um formulário que distingue os dois casos é
   um jeito de descobrir quem tem conta aqui. */
function PasswordEntry({
  onSignedIn,
  onBack,
}: {
  onSignedIn: (u: SessionUser) => void;
  onBack?: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { reviewer } = await auth.login(email.trim(), password);
      onSignedIn(reviewer);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
      <Field
        ref={first}
        label="E-mail"
        type="email"
        autoComplete="username"
        value={email}
        onChange={setEmail}
      />
      <Field
        label="Senha"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
      />

      {error ? <Fault>{error}</Fault> : null}

      <div className="mt-1 flex items-center gap-2">
        <Key tone="commit" type="submit" disabled={busy || !email.trim() || !password}>
          {busy ? 'Entrando' : 'Entrar'}
        </Key>
        {onBack ? (
          <Key tone="ghost" onClick={onBack}>
            Voltar
          </Key>
        ) : null}
      </div>
    </form>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   A senha, na primeira entrada.

   Aparece depois do Google e antes do saguão, e é a única coisa entre a pessoa e
   o produto — então ela diz por que existe. Um formulário que pede uma senha sem
   explicar por que, logo depois de a pessoa ter acabado de provar quem é, parece
   trabalho repetido; com a frase, é a pessoa guardando uma segunda chave.

   Dá para pular. Não é uma exigência do produto, é um seguro — e um seguro
   obrigatório na porta de entrada é um pedágio. Quem pular volta a ver o convite,
   porque o motivo dele não expira.
   ══════════════════════════════════════════════════════════════════════════ */
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
          <p className="mx-auto mt-4 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-dim">
            Você entrou pelo Google, e isso basta para hoje. Uma senha é o
            caminho de volta no dia em que aquela conta não estiver mais à mão —
            e o clube não é uma coisa que se possa perder por causa dela.
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
            hint={short ? 'Pelo menos 8 caracteres.' : 'Pelo menos 8 caracteres.'}
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

/* ── um campo ─────────────────────────────────────────────────────────────
   Recuado na sala, como todo campo deste produto: fundo `house-deep`, anel
   `house-rail`, cantos de 2px e o cursor vermelho — a única aparição de vermelho
   em repouso no sistema, porque um cursor é uma cabeça de gravação. */
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
        className={cn(
          'w-full rounded-cell bg-house-deep px-3 py-2.5 text-[14px] text-ink caret-dye-red',
          'ring-1 transition-shadow placeholder:text-ink-dim',
          'focus-visible:outline-none focus-visible:ring-dye-brass',
          bad ? 'ring-dye-red-lit/60' : 'ring-house-rail'
        )}
        {...rest}
      />
      {hint ? (
        <span className={cn('text-[12px]', bad ? 'text-dye-red-lit' : 'text-ink-faint')}>{hint}</span>
      ) : null}
    </label>
  );
});

/* A marca do Google, desenhada e não uma fonte de ícone: é a única coisa neste
   produto que pertence a outra pessoa, e ela tem uma forma exata. */
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

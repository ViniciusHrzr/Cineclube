import { forwardRef, useEffect, useRef, useState } from 'react';
import { Fault, Key } from '@/components/bits';
import { HolographicWall } from '@/components/ui/holographic-wall-shadcnui';
import { auth, type SessionUser } from '@/lib/api';
import { cn } from '@/lib/utils';

/* ══════════════════════════════════════════════════════════════════════════
   ONDE UM LINK DE E-MAIL CAI.

   Duas telas com a mesma forma: alguém abriu uma mensagem, clicou, e chegou
   aqui com um segredo no endereço. Nenhuma das duas exige sessão — o link pode
   ser aberto no celular enquanto a conta está aberta no computador, e é
   justamente esse o caso de quem perdeu a senha.

   ── por que a tela apresenta o token, e não o link ────────────────────────
   O link do e-mail aponta para `#confirmar/<token>`, que é ESTA tela, e é ela
   que faz o POST. A tentação é apontar direto para uma rota e resolver o
   assunto num GET, e ela custa caro: servidores de e-mail e antivírus abrem os
   links das mensagens antes de a pessoa ver, para conferir se são seguros. Um
   token que se gasta ao ser aberto é um token que o scanner queima no caminho,
   e a pessoa clica num link que já não vale sem ninguém ter errado nada.

   Um POST vindo desta tela não é feito por scanner nenhum.

   ── e o token sai do endereço assim que é lido ────────────────────────────
   Um segredo na barra de endereço fica no histórico do navegador e viaja no
   `Referer` de qualquer link que a pessoa clique depois. Ele é copiado para a
   memória no primeiro render e o endereço é reescrito na mesma volta.
   ══════════════════════════════════════════════════════════════════════════ */

/* O token só é lido uma vez, e o endereço é limpo em seguida. Fora do
   componente porque isto não é estado de tela: é uma leitura destrutiva do
   endereço, e ela tem de acontecer uma vez só ainda que o React monte duas
   (o modo estrito monta duas em desenvolvimento). */
function takeToken(prefixo: string) {
  const raw = (location.hash || '').replace(/^#/, '').split('?')[0];
  const parts = raw.split('/').filter(Boolean);
  if (parts[0] !== prefixo || !parts[1]) return '';
  const token = decodeURIComponent(parts[1]);
  history.replaceState(null, '', location.pathname + '#' + prefixo);
  return token;
}

function Sheet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-[calc(100dvh/var(--ui-zoom))] flex-col">
      <HolographicWall asBackdrop />
      <div className="relative mx-auto flex w-full max-w-[900px] flex-1 flex-col justify-center px-5 py-14">
        <header className="mb-9 text-center">
          <h1 className="font-display text-[38px] leading-none tracking-[0.16em] text-beam sm:text-[46px]">
            CINECLUBE
          </h1>
          <p className="legend mt-4">{title}</p>
        </header>
        <div className="mx-auto w-full max-w-[380px]">{children}</div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Confirmar o endereço.

   Acontece sozinho ao abrir: não há nada a decidir, e um botão "confirmar"
   aqui seria pedir que a pessoa confirme que clicou no link em que clicou.
   ══════════════════════════════════════════════════════════════════════════ */
export function ConfirmEmail({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<'indo' | 'ok' | 'erro'>('indo');
  const [message, setMessage] = useState<string | null>(null);
  const token = useRef(takeToken('confirmar'));

  useEffect(() => {
    let vivo = true;
    void auth
      .verifyEmail(token.current)
      .then(() => vivo && setState('ok'))
      .catch(err => {
        if (!vivo) return;
        setMessage((err as Error).message);
        setState('erro');
      });
    return () => {
      vivo = false;
    };
  }, []);

  if (state === 'indo') {
    return (
      <Sheet title="Confirmando">
        <p className="legend animate-flicker text-center">Acendendo o projetor</p>
      </Sheet>
    );
  }

  if (state === 'erro') {
    return (
      <Sheet title="Não deu">
        <Fault>{message || 'Este link não vale mais.'}</Fault>
        <p className="mt-4 text-[12.5px] leading-relaxed text-ink-dim">
          Um link de confirmação vale por 24 horas e só funciona uma vez. Entre
          na sua conta e peça outro.
        </p>
        <div className="mt-5">
          <Key onClick={onDone}>Ir para a entrada</Key>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Confirmado">
      <p className="text-[13.5px] leading-relaxed text-ink">
        Pronto — seu e-mail está confirmado.
      </p>
      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-dim">
        Agora dá para fundar um clube e recuperar a senha por aqui, se um dia
        precisar.
      </p>
      <div className="mt-5">
        <Key tone="commit" onClick={onDone}>
          Continuar
        </Key>
      </div>
    </Sheet>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Escolher uma senha nova.

   O token é gasto no envio, e não na abertura: quem chega aqui com um link
   velho descobre no botão e não antes, o que é o certo — a alternativa é uma
   tela que valida o token ao abrir e queima o único uso dele antes de a pessoa
   ter escolhido alguma coisa.

   Ao dar certo, a pessoa já entra: o servidor derruba as outras sessões da
   conta e abre uma nova aqui. Mandá-la para a tela de entrada, para digitar a
   senha que ela acabou de escolher, seria o formulário duvidando dela.
   ══════════════════════════════════════════════════════════════════════════ */
export function ResetPassword({ onSignedIn }: { onSignedIn: (u: SessionUser) => void }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef(takeToken('senha'));
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  const curta = password.length > 0 && password.length < 8;
  const difere = again.length > 0 && again !== password;
  const pronto = password.length >= 8 && again === password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !pronto) return;
    setBusy(true);
    setError(null);
    try {
      const { reviewer } = await auth.resetPassword(token.current, password);
      onSignedIn(reviewer);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title="Senha nova">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-[12.5px] leading-relaxed text-ink-dim">
          Escolha uma senha nova. As outras sessões desta conta caem junto — se
          alguém tinha entrado, deixa de estar dentro.
        </p>
        <LinkField
          ref={first}
          label="Senha nova"
          value={password}
          onChange={setPassword}
          hint="Pelo menos 8 caracteres."
          bad={curta}
        />
        <LinkField
          label="Repita"
          value={again}
          onChange={setAgain}
          hint={difere ? 'As duas precisam ser iguais.' : undefined}
          bad={difere}
        />
        {error ? <Fault>{error}</Fault> : null}
        <div className="mt-1">
          <Key tone="commit" type="submit" disabled={busy || !pronto}>
            {busy ? 'Gravando' : 'Gravar a senha'}
          </Key>
        </div>
      </form>
    </Sheet>
  );
}

/* Um campo de senha. Não reaproveita o `Field` da tela de entrada porque aquele
   mora lá e não é exportado — e exportar um componente de uma tela para outra
   só para não repetir um `<input>` acopla as duas por nada. */
const LinkField = forwardRef<
  HTMLInputElement,
  { label: string; value: string; onChange: (v: string) => void; hint?: string; bad?: boolean }
>(function LinkField({ label, value, onChange, hint, bad }, ref) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="legend text-[10px]">{label}</span>
      <input
        ref={ref}
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={e => onChange(e.target.value)}
        className={cn(
          'w-full rounded-cell bg-house-deep px-3 py-2.5 text-[14px] text-ink caret-dye-red ring-1 transition-shadow',
          'placeholder:text-ink-dim focus-visible:outline-none focus-visible:ring-dye-brass',
          bad ? 'ring-dye-red-lit/60' : 'ring-house-rail'
        )}
      />
      {hint ? (
        <span className={cn('text-[12px]', bad ? 'text-dye-red-lit' : 'text-ink-faint')}>{hint}</span>
      ) : null}
    </label>
  );
});

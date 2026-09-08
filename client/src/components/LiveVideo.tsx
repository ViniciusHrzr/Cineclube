import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/* ══════════════════════════════════════════════════════════════════════════
   O PLAYER DA TELA AO VIVO, E O QUE ELE DELIBERADAMENTE NÃO FAZ.

   O irmão deste arquivo, SyncedVideo, tem seiscentas linhas porque precisa
   fazer um vídeo local concordar com uma sala: deriva, tolerância, almofada de
   buffer, eco de eventos. Nada disso existe aqui, e a razão é que não há o que
   sincronizar — o que chega já é a imagem de outra pessoa, com menos de um
   segundo de atraso, e não existe uma segunda cópia para discordar dela.

   Então este arquivo tem um assunto só: o navegador não deixa um vídeo com som
   começar sozinho.

   ── a regra do autoplay, e por que ela não é contornável ─────────────────
   Um `<video>` com áudio só toca por conta própria se a pessoa já interagiu
   com a página. Quem apertou "Compartilhar tela" interagiu; quem só tinha a
   aba aberta quando a transmissão começou, não — e para essa pessoa a chamada
   a `play()` é recusada.

   Existe um jeito garantido de contornar: começar mudo, porque vídeo mudo pode
   tocar sozinho. É o que quase todo site faz, e é errado aqui: uma sessão de
   cinema que começa muda é uma sessão que começou errada, e a pessoa passa os
   primeiros segundos procurando o controle de volume em vez de assistindo.

   Então este player tenta com som, e quando é recusado NÃO se desenrasca — ele
   diz o que aconteceu e põe um botão. Um toque resolve para sempre naquela
   aba, e a pessoa sabe por que teve de dar o toque.
   ══════════════════════════════════════════════════════════════════════════ */

export function LiveVideo({
  stream,
  /* Quem transmite se vê mudo. Não é preferência: o som do filme está saindo
     das caixas daquela máquina, e o player devolvendo o mesmo áudio por cima é
     um eco de si mesmo com o atraso da captura. */
  muted,
  className,
}: {
  stream: MediaStream | null;
  muted: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [blocked, setBlocked] = useState(false);

  /* `srcObject` e não `src`: um MediaStream não tem URL, e a gambiarra antiga
     de criar uma com `createObjectURL` foi removida dos navegadores. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    /* Comparado antes de atribuir. Atribuir `srcObject` reinicia o elemento
       mesmo quando o valor é o mesmo, e esta tela redesenha sozinha — o painel
       de quem está na sessão muda a cada chegada. Sem a comparação, a imagem
       piscaria a cada uma delas. */
    if (el.srcObject !== stream) el.srcObject = stream;
    if (!stream) return;
    el.play().then(
      () => setBlocked(false),
      () => setBlocked(true)
    );
  }, [stream]);

  const unblock = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    /* O clique É a interação que faltava, então esta chamada acontece dentro do
       gesto e por isso é aceita. */
    el.muted = false;
    void el.play().then(() => setBlocked(false));
  }, []);

  return (
    <div className={cn('relative overflow-hidden rounded-cell bg-black', className)}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        /* Sem `controls`. Numa transmissão ao vivo eles seriam uma mentira: a
           barra oferece um lugar para arrastar e não há para onde ir, e a pausa
           pausa só a sua imagem enquanto o filme segue na dos outros — o que
           reaparece depois como "estou uns segundos atrás de vocês" sem
           ninguém lembrar por quê. Quem controla o filme é quem transmite. */
        className="aspect-video w-full bg-black"
      />

      {blocked ? (
        <button
          type="button"
          onClick={unblock}
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-center"
        >
          <span className="font-display text-[15px] uppercase tracking-[0.14em] text-beam">
            Tocar com som
          </span>
          <span className="max-w-[36ch] text-[12.5px] leading-relaxed text-ink-dim">
            O navegador não deixa um vídeo com áudio começar sozinho numa aba em que ninguém tocou.
          </span>
        </button>
      ) : null}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Maximize2, Minimize2, Play, Volume1, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ══════════════════════════════════════════════════════════════════════════
   O PROJETOR DA TELA AO VIVO.

   O irmão deste arquivo, SyncedVideo, tem seiscentas linhas porque precisa
   fazer um vídeo local concordar com uma sala. Nada disso existe aqui: o que
   chega já é a imagem de outra pessoa, e não há uma segunda cópia para
   discordar dela. O que existe é uma cabine com três controles, e a decisão de
   desenho foi qual deles é uma verdade e qual seria mentira.

   ── por que não há barra de tempo ────────────────────────────────────────
   Porque não há para onde ir: uma transmissão ao vivo não tem passado
   armazenado em lugar nenhum. Desenhar uma barra arrastável seria oferecer um
   lugar que não existe, e a pessoa passaria meia hora tentando voltar dois
   minutos. O lugar é sempre AGORA, e é por isso que a lâmpada vermelha ocupa o
   canto: ela é a barra de tempo desta sala.

   ── e por que também não há pausa ────────────────────────────────────────
   Ela existiu e foi tirada. Pausar aqui não engana, mas também não serve: o
   filme segue para o clube de qualquer jeito, então o botão só fazia a pessoa
   perder um pedaço com mais passos do que olhar para o outro lado.

   ── a barra que some ─────────────────────────────────────────────────────
   Ela existe sobre a imagem, então sai da frente. Aparece com o ponteiro, com o
   teclado e sempre que o filme está parado — uma tela pausada sem controle
   visível é uma tela quebrada — e nunca some enquanto o ponteiro estiver em
   cima dela: recolher um botão debaixo do dedo de quem ia apertá-lo é a forma
   mais rápida de fazer um controle parecer defeito.
   ══════════════════════════════════════════════════════════════════════════ */

/** Quanto tempo de quietude apaga a cabine. */
const IDLE_MS = 2600;

/* O volume fica nesta máquina e atravessa as sessões, porque não é um fato
   sobre o filme — é um fato sobre a sala em que a pessoa está sentada, do mesmo
   jeito que o tamanho da legenda. Ver `SUB_SIZE` em Screening.tsx. */
const VOLUME_KEY = 'cineclube.volume';

function savedVolume() {
  try {
    const raw = Number(localStorage.getItem(VOLUME_KEY));
    return raw >= 0 && raw <= 1 ? raw : 1;
  } catch {
    return 1; // storage recusado: o padrão não vale uma exceção
  }
}

export function LiveVideo({
  stream,
  /* Quem transmite se vê mudo. Não é preferência: o som do filme está saindo
     das caixas daquela máquina, e o player devolvendo o mesmo áudio por cima é
     um eco de si mesmo com o atraso da captura. */
  hostPreview,
  /** Quem está com a tela, para a cabine dizer de quem é a imagem. */
  hostName,
  /* ── o som, do lado de quem transmite ───────────────────────────────────
     Só chega preenchido para o transmissor, e é o controle que o volume seria
     se volume fizesse sentido ali: a tela dele já toca nas caixas dele, e o
     que ele precisa decidir não é quão alto ouve — é O QUE o clube ouve.

     Mora aqui dentro, na mesma barra, porque é um controle da transmissão e
     não um ajuste de conta. Quem está transmitindo e percebe eco no Discord
     tem de resolver isso sem sair da imagem. */
  audio,
  className,
}: {
  stream: MediaStream | null;
  hostPreview: boolean;
  hostName: string;
  audio?: {
    sources: MediaDeviceInfo[];
    currentId: string | null;
    list: () => Promise<void>;
    pick: (deviceId: string | null) => Promise<void>;
  };
  className?: string;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const shell = useRef<HTMLDivElement | null>(null);

  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [volume, setVolume] = useState(savedVolume);
  const [muted, setMuted] = useState(hostPreview);
  const [full, setFull] = useState(false);
  const [awake, setAwake] = useState(true);
  /* O invólucro nascia travado em 16:9. Um notebook é 16:10, um ultrawide é
     21:9, e uma janela solta é o que a pessoa deixou — o resultado era a imagem
     esticada ou achatada.

     16:9 continua sendo o palpite até haver o que medir, porque um invólucro de
     altura zero faz a página pular quando o primeiro quadro chega. `resize` está
     junto dos metadados porque quem transmite pode trocar de janela no meio. */
  const [ratio, setRatio] = useState(16 / 9);
  /** O ponteiro está sobre a própria cabine: ela não pode sumir. */
  const overBar = useRef(false);
  /* Um painel aberto segura a cabine acesa. Sem isto, a barra sumiria por
     baixo de uma lista que a pessoa está lendo — e some justamente porque ela
     parou de mexer o ponteiro para ler. */
  const [pinned, setPinned] = useState(false);

  /* `srcObject` e não `src`: um MediaStream não tem URL, e a gambiarra antiga
     de criar uma com `createObjectURL` foi removida dos navegadores. */
  useEffect(() => {
    const el = video.current;
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

  /* O volume é aplicado no elemento e guardado na máquina. Os dois num efeito
     só porque são a mesma decisão vista de dois lugares. */
  useEffect(() => {
    const el = video.current;
    if (el) el.volume = volume;
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
      /* volta ao padrão na próxima sessão, e tudo bem */
    }
  }, [volume]);

  useEffect(() => {
    const el = video.current;
    if (el) el.muted = muted;
  }, [muted]);

  /* Tela cheia no INVÓLUCRO e não no `<video>`. O botão nativo do navegador
     promove o elemento sozinho e deixa todo irmão para trás — a cabine some, e
     com ela o volume e a pausa, justamente quando a tela ficou grande e a
     pessoa está longe dela. */
  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shell.current?.requestFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === shell.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  /* A proporção da fonte, lida do elemento. Zero enquanto não há quadro, e
     um zero aqui viraria uma divisão que apaga o invólucro. */
  const medir = useCallback((el: HTMLVideoElement) => {
    if (el.videoWidth > 0 && el.videoHeight > 0) setRatio(el.videoWidth / el.videoHeight);
  }, []);

  /* ── a cabine acorda, e volta a dormir ─────────────────────────────────── */
  const wake = useCallback(() => {
    setAwake(true);
  }, []);

  useEffect(() => {
    /* Parado, ela fica. Uma tela pausada sem controle visível não parece uma
       escolha, parece um travamento. */
    if (!playing || overBar.current || pinned) {
      setAwake(true);
      return;
    }
    if (!awake) return;
    const id = window.setTimeout(() => setAwake(false), IDLE_MS);
    return () => window.clearTimeout(id);
  }, [awake, playing, pinned]);

  /* ── teclado ─────────────────────────────────────────────────────────────
     Os atalhos que qualquer pessoa já tenta num player, porque tentar e não
     acontecer nada é pior do que não haver atalho. Interceptados no invólucro,
     que tem foco próprio; um botão focado continua respondendo ao Enter dele
     e não é roubado por isto. */
  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      const tecla = e.key.toLowerCase();
      if (tecla === 'm') {
        setMuted(v => !v);
      } else if (tecla === 'f') {
        toggleFull();
      } else if (tecla === 'arrowup' || tecla === 'arrowdown') {
        e.preventDefault();
        setVolume(v => Math.min(1, Math.max(0, v + (tecla === 'arrowup' ? 0.05 : -0.05))));
        setMuted(false);
      } else {
        return;
      }
      wake();
    },
    [toggleFull, wake]
  );

  const Speaker = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      ref={shell}
      tabIndex={0}
      aria-label={`Tela de ${hostName}, ao vivo`}
      onKeyDown={onKey}
      onPointerMove={wake}
      onPointerLeave={() => playing && setAwake(false)}
      style={full ? undefined : { aspectRatio: String(ratio) }}
      className={cn(
        'group relative overflow-hidden rounded-cell bg-black outline-none',
        'focus-visible:ring-1 focus-visible:ring-dye-brass',
        /* Em tela cheia o retângulo vira a sala inteira: os cantos de célula
           não têm o que arredondar contra, e a proporção medida sai do caminho
           — quem manda passa a ser o monitor. */
        full && 'h-full w-full rounded-none',
        !awake && playing && 'cursor-none',
        className
      )}
    >
      <video
        ref={video}
        autoPlay
        playsInline
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onVolumeChange={e => setMuted((e.currentTarget as HTMLVideoElement).muted)}
        /* A fonte diz o próprio tamanho, nos dois momentos em que ele pode
           mudar: quando o primeiro quadro chega, e quando quem transmite
           redimensiona a janela que está compartilhando. */
        onLoadedMetadata={e => medir(e.currentTarget)}
        onResize={e => medir(e.currentTarget)}
        /* Sem `controls`: a barra nativa traz uma linha do tempo arrastável, e
           numa transmissão ao vivo ela é um lugar que não existe.

           `object-contain` e nunca `cover`: cortar a borda de uma tela
           compartilhada corta legenda, corta menu, corta o que a pessoa quis
           mostrar. Tarja preta é a resposta certa — é o que um cinema faz.

           `absolute` em tela cheia porque a raiz roda com `zoom: 1.25`, e um
           `height: 100%` dentro de um elemento em tela cheia resolve contra a
           caixa sem zoom: o vídeo saía com 80% do monitor, com tarja dos quatro
           lados. */
        className={cn(
          'bg-black object-contain',
          full ? 'absolute inset-0 h-full w-full' : 'h-full w-full'
        )}
      />

      {/* ── a lâmpada ────────────────────────────────────────────────────
          A única coisa redonda do sistema é a lâmpada REC, porque ela é uma
          lâmpada de verdade (ver DESIGN.md). Aqui ela ganha o segundo emprego
          que já era dela por natureza: numa transmissão sem linha do tempo,
          "agora" é a única posição que existe, e é isto que a diz.

          Pulsa apenas enquanto a imagem corre. Uma lâmpada de gravação acesa e
          fixa sobre uma tela pausada estaria mentindo. */}
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            'h-2 w-2 flex-none rounded-full bg-dye-red shadow-[0_0_10px_rgba(224,54,44,0.8)]',
            playing && 'motion-safe:animate-pulse'
          )}
        />
        <span className="font-display text-[11px] uppercase leading-none tracking-[0.14em] text-beam">
          Ao vivo
        </span>
      </div>

      {/* ── a cabine ─────────────────────────────────────────────────────
          Sobre a imagem, separada dela pela mesma hairline que separa tudo
          neste sistema, e apoiada num degradê em vez de num painel: a barra
          precisa ser legível sobre um filme que pode estar branco naquele
          segundo, e uma placa opaca cortaria o rodapé da cena para sempre. */}
      <div
        onPointerEnter={() => {
          overBar.current = true;
          wake();
        }}
        onPointerLeave={() => {
          overBar.current = false;
        }}
        className={cn(
          'absolute inset-x-0 bottom-0 bg-gradient-to-t from-house-deep via-house-deep/85 to-transparent pt-8',
          'transition-opacity duration-200 motion-reduce:transition-none',
          awake || !playing ? 'opacity-100' : 'opacity-0'
        )}
      >
        <div className="flex items-center gap-1.5 border-t border-white/[0.07] bg-house/80 px-2 py-2 backdrop-blur-sm sm:gap-2 sm:px-3">
          {/* ── o volume, de todo mundo ──────────────────────────────────
              Inclusive de quem transmite. A tela dele começa muda de propósito
              — o som do filme já está saindo das caixas daquela máquina, e
              devolvê-lo por cima é um eco de si mesmo com o atraso da captura
              —, mas o controle fica: é com ele que se confere o que foi
              parar na transmissão sem ter de perguntar ao clube.

              A película e a porta do sistema, num terço do tamanho: a faixa
              acesa é a parte exposta, o resto é filme virgem. Ver
              `.vol-range` em index.css. */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <CabinKey
              onClick={() => setMuted(v => !v)}
              label={muted ? 'Tirar do mudo' : 'Deixar mudo'}
              hint={
                hostPreview && muted
                  ? 'Ouvir o que está indo para o clube (vai ecoar com as suas caixas)'
                  : undefined
              }
            >
              <Speaker className="h-4 w-4" strokeWidth={1.8} aria-hidden />
            </CabinKey>

            <div className="relative w-[76px] sm:w-[104px]">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-seam bg-white/[0.09]"
              />
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-seam bg-beam',
                  muted && 'opacity-30'
                )}
                style={{ width: `${(muted ? 0 : volume) * 100}%` }}
              />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={e => {
                  setVolume(Number(e.target.value));
                  setMuted(false);
                }}
                aria-label="Volume"
                aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`}
                className="vol-range relative"
              />
            </div>
          </div>

          {/* O que o clube ouve, e só para quem transmite. É a outra pergunta
              do som: não "quão alto", mas "o quê". */}
          {hostPreview && audio ? <AudioPicker audio={audio} onOpenChange={setPinned} /> : null}

          {/* De quem é a imagem, no meio da barra e não numa legenda acima
              dela: em tela cheia não existe nada acima dela. Some no telefone,
              onde a largura é do controle e não do rótulo. */}
          <span className="ml-auto hidden truncate pl-2 font-display text-[11px] uppercase leading-none tracking-[0.14em] text-ink-dim sm:block">
            {hostPreview ? 'Você está transmitindo' : hostName}
          </span>

          <CabinKey
            className="ml-auto sm:ml-0"
            onClick={toggleFull}
            label={full ? 'Sair da tela cheia' : 'Tela cheia'}
          >
            {full ? (
              <Minimize2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />
            ) : (
              <Maximize2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />
            )}
          </CabinKey>
        </div>
      </div>

      {/* ── o som que o navegador não deixa começar sozinho ───────────────
          Um vídeo com áudio só toca por conta própria se a pessoa já tiver
          interagido com a página. Quem apertou "Compartilhar tela" interagiu;
          quem só tinha a aba aberta quando a transmissão começou, não.

          Começar mudo resolveria e está errado: uma sessão de cinema que
          começa muda é uma sessão que começou errada, e a pessoa passa os
          primeiros minutos procurando o volume. Então a tela diz o que houve e
          põe um botão — um toque resolve para sempre naquela aba. */}
      {blocked ? (
        <button
          type="button"
          onClick={() => {
            const el = video.current;
            if (!el) return;
            el.muted = false;
            setMuted(false);
            void el.play().then(() => setBlocked(false));
          }}
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-house-deep/80 px-6 text-center backdrop-blur-sm"
        >
          <span className="flex items-center gap-2.5 font-display text-[15px] uppercase tracking-[0.14em] text-beam">
            <Play className="h-4 w-4" strokeWidth={1.9} aria-hidden />
            Tocar com som
          </span>
          <span className="max-w-[38ch] text-[12.5px] leading-relaxed text-ink-dim">
            O navegador não deixa um vídeo com áudio começar sozinho numa aba em que ninguém tocou.
          </span>
        </button>
      ) : null}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   O ÁUDIO QUE VAI PARA O CLUBE.

   O que se quer é escolher o áudio de UM APLICATIVO — manda o VLC, não manda o
   Discord —, e isso não existe na web: nenhum navegador expõe de qual programa
   vem o som, e `getDisplayMedia` recebe o mix da máquina já pronto.

   Então este painel não escolhe o aplicativo, escolhe a ENTRADA por onde o som
   chega — a alavanca que sobra, e a que faz as duas receitas funcionarem:

   · **o filme está numa aba**: compartilhe a ABA em vez da tela. Áudio de aba é
     só daquela aba, e o Discord fica de fora por construção.
   · **o filme está no VLC**: o Windows manda cada aplicativo para o dispositivo
     de saída que se quiser, e a captura de tela só carrega o que sai pelo
     PADRÃO. O player vai para um cabo virtual, o Discord para o fone, e é o
     cabo que se escolhe aqui.

   Recolhido atrás de um ícone porque listar as entradas exige a permissão de
   microfone — não por isto ser um microfone, mas por ser a mesma permissão. Ela
   não é pedida a quem nunca vai trocar de fonte.
   ══════════════════════════════════════════════════════════════════════════ */
function AudioPicker({
  audio,
  onOpenChange,
}: {
  audio: {
    sources: MediaDeviceInfo[];
    currentId: string | null;
    list: () => Promise<void>;
    pick: (deviceId: string | null) => Promise<void>;
  };
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const abrir = async () => {
    const indo = !open;
    setOpen(indo);
    onOpenChange(indo);
    if (indo && !audio.sources.length) {
      setBusy(true);
      await audio.list();
      setBusy(false);
    }
  };

  const escolher = async (id: string | null) => {
    setBusy(true);
    await audio.pick(id);
    setBusy(false);
    setOpen(false);
    onOpenChange(false);
  };

  return (
    <div className="relative">
      <CabinKey
        onClick={() => void abrir()}
        label="Áudio que vai para o clube"
        hint="Áudio que vai para o clube"
      >
        <AudioLines className="h-4 w-4" strokeWidth={1.8} aria-hidden />
      </CabinKey>

      {open ? (
        <div className="absolute bottom-[calc(100%+8px)] left-0 z-10 w-[min(80vw,300px)] rounded-plate bg-house-seat p-3.5 ring-1 ring-white/[0.06]">
          <span className="legend">Áudio que vai para o clube</span>
          <div className="mt-2.5 flex flex-col items-start gap-1.5">
            <SourceChip on={audio.currentId === null} onClick={() => void escolher(null)}>
              Som da captura
            </SourceChip>
            {audio.sources.map(d => (
              <SourceChip
                key={d.deviceId}
                on={audio.currentId === d.deviceId}
                onClick={() => void escolher(d.deviceId)}
              >
                {d.label || 'entrada sem nome'}
              </SourceChip>
            ))}
          </div>
          {busy ? <p className="q mt-2.5 text-[11px] text-ink-dim">trocando…</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/* A pastilha do sistema, no tamanho `sm` e dentro de uma superfície escura.
   Não é a `Chip` de bits.tsx porque aquela assume o fundo da sala atrás dela
   — aqui o fundo é uma placa sobre a imagem, e a opacidade que a torna legível
   lá desenharia uma segunda placa em cima desta. */
function SourceChip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'max-w-full truncate rounded-seam px-2.5 py-1.5 text-left font-display text-[11px] uppercase leading-none tracking-[0.12em] ring-1 transition-colors duration-150',
        on
          ? 'text-dye-brass ring-dye-brass/70 shadow-[inset_0_0_14px_rgba(217,164,65,0.2)]'
          : 'text-ink-dim ring-house-rail hover:text-beam hover:ring-white/25'
      )}
    >
      {children}
    </button>
  );
}

/* Um controle da cabine. É a `IconKey` do sistema com duas diferenças que a
   posição exige: 34px em vez de 38px, porque a barra inteira tem 50 e precisa
   caber num telefone, e sem anel em repouso, porque um anel por botão sobre a
   imagem desenharia uma fileira de caixas em cima do filme. O anel volta no
   hover e no foco, que é quando ele quer dizer alguma coisa. */
function CabinKey({
  children,
  onClick,
  label,
  hint,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  hint?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={hint ?? label}
      className={cn(
        'flex h-[34px] w-[34px] flex-none items-center justify-center rounded-cell text-ink',
        'ring-1 ring-transparent transition-colors duration-150',
        'hover:text-beam hover:ring-house-rail',
        'focus-visible:text-beam focus-visible:outline-none focus-visible:ring-dye-brass',
        className
      )}
    >
      {children}
    </button>
  );
}

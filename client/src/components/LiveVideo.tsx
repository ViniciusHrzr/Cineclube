import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Maximize2, Minimize2, Play, Volume1, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';

const IDLE_MS = 2600;

const VOLUME_KEY = 'cineclube.volume';

function savedVolume() {
  try {
    const raw = Number(localStorage.getItem(VOLUME_KEY));
    return raw >= 0 && raw <= 1 ? raw : 1;
  } catch {
    return 1;
  }
}

export function LiveVideo({
  stream,
  hostPreview,
  hostName,
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
  const [ratio, setRatio] = useState(16 / 9);
  const overBar = useRef(false);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (!stream) return;
    el.play().then(
      () => setBlocked(false),
      () => setBlocked(true)
    );
  }, [stream]);

  useEffect(() => {
    const el = video.current;
    if (el) el.volume = volume;
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
    }
  }, [volume]);

  useEffect(() => {
    const el = video.current;
    if (el) el.muted = muted;
  }, [muted]);

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shell.current?.requestFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === shell.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const medir = useCallback((el: HTMLVideoElement) => {
    if (el.videoWidth > 0 && el.videoHeight > 0) setRatio(el.videoWidth / el.videoHeight);
  }, []);

  const wake = useCallback(() => {
    setAwake(true);
  }, []);

  useEffect(() => {
    if (!playing || overBar.current || pinned) {
      setAwake(true);
      return;
    }
    if (!awake) return;
    const id = window.setTimeout(() => setAwake(false), IDLE_MS);
    return () => window.clearTimeout(id);
  }, [awake, playing, pinned]);

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
        onLoadedMetadata={e => medir(e.currentTarget)}
        onResize={e => medir(e.currentTarget)}
        className={cn(
          'bg-black object-contain',
          full ? 'absolute inset-0 h-full w-full' : 'h-full w-full'
        )}
      />

      {}
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

      {}
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
          {}
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

          {}
          {hostPreview && audio ? <AudioPicker audio={audio} onOpenChange={setPinned} /> : null}

          {}
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

      {}
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

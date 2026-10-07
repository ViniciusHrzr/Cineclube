import { useEffect, useRef, useState } from 'react';
import { Key } from '@/components/bits';
import { encodeCrop, loadImage, type Crop, type Loaded } from '@/lib/image';

const GATE = 264;
const MAX_ZOOM = 4;

type Frame = { zoom: number; x: number; y: number };

export function PortraitGate({
  file,
  onCancel,
  onDone,
}: {
  file: File;
  onCancel: () => void;
  onDone: (dataUrl: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const gateRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<Frame>({ zoom: 1, x: 0, y: 0 });

  const base = loaded ? GATE / Math.min(loaded.width, loaded.height) : 1;
  const shown = loaded
    ? { w: loaded.width * base * frame.zoom, h: loaded.height * base * frame.zoom }
    : { w: 0, h: 0 };

  const clamp = (f: Frame, w: number, h: number): Frame => ({
    zoom: f.zoom,
    x: Math.min(0, Math.max(GATE - w, f.x)),
    y: Math.min(0, Math.max(GATE - h, f.y)),
  });

  useEffect(() => {
    let alive = true;
    let opened: Loaded | null = null;
    setError(null);
    loadImage(file)
      .then(img => {
        if (!alive) return img.release();
        opened = img;
        setLoaded(img);
        const b = GATE / Math.min(img.width, img.height);
        setFrame({ zoom: 1, x: (GATE - img.width * b) / 2, y: (GATE - img.height * b) / 2 });
      })
      .catch(e => alive && setError((e as Error).message));
    return () => {
      alive = false;
      opened?.release();
    };
  }, [file]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el || el.open) return;
    el.showModal();
  }, []);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const cancel = (e: Event) => {
      e.preventDefault();
      onCancel();
    };
    el.addEventListener('cancel', cancel);
    return () => el.removeEventListener('cancel', cancel);
  }, [onCancel]);

  function drag(e: React.PointerEvent) {
    if (!loaded || e.button !== 0) return;
    const gate = gateRef.current;
    if (!gate) return;
    const k = gate.offsetWidth ? gate.getBoundingClientRect().width / gate.offsetWidth : 1;
    const from = { x: e.clientX, y: e.clientY };
    const start = frame;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();

    const move = (ev: PointerEvent) => {
      setFrame(
        clamp(
          {
            zoom: start.zoom,
            x: start.x + (ev.clientX - from.x) / k,
            y: start.y + (ev.clientY - from.y) / k,
          },
          shown.w,
          shown.h
        )
      );
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function zoomTo(next: number) {
    if (!loaded) return;
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    const w = loaded.width * base * z;
    const h = loaded.height * base * z;
    const ratio = z / frame.zoom;
    setFrame(
      clamp(
        {
          zoom: z,
          x: GATE / 2 - (GATE / 2 - frame.x) * ratio,
          y: GATE / 2 - (GATE / 2 - frame.y) * ratio,
        },
        w,
        h
      )
    );
  }

  function nudge(dx: number, dy: number) {
    setFrame(f => clamp({ zoom: f.zoom, x: f.x + dx, y: f.y + dy }, shown.w, shown.h));
  }

  function use() {
    if (!loaded) return;
    const scale = base * frame.zoom;
    const side = Math.min(GATE / scale, loaded.width, loaded.height);
    const crop: Crop = {
      x: Math.min(Math.max(0, -frame.x / scale), loaded.width - side),
      y: Math.min(Math.max(0, -frame.y / scale), loaded.height - side),
      side,
    };
    try {
      onDone(encodeCrop(loaded, crop));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="Enquadrar a foto"
      onClick={e => {
        if (e.target === dialogRef.current) onCancel();
      }}
      className="w-full max-w-[420px] bg-transparent p-3 text-ink backdrop:bg-house-deep/95 open:animate-beam-in"
    >
      <div className="plate p-5">
        <span className="legend">Enquadrar</span>

        {error ? (
          <p className="mt-4 text-[13px] text-dye-red-lit">{error}</p>
        ) : !loaded ? (
          <p className="legend mt-6 animate-flicker">Carregando a imagem</p>
        ) : (
          <>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">
              Arraste para posicionar e use a barra para aproximar. O que estiver dentro do quadro é a
              sua foto.
            </p>

            {}
            <div
              ref={gateRef}
              role="application"
              data-noswipe
              aria-label="Área de enquadramento. Use as setas para mover e as teclas mais e menos para aproximar."
              tabIndex={0}
              onPointerDown={drag}
              onWheel={e => zoomTo(frame.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))}
              onKeyDown={e => {
                const step = e.shiftKey ? 20 : 6;
                if (e.key === 'ArrowLeft') return void (e.preventDefault(), nudge(step, 0));
                if (e.key === 'ArrowRight') return void (e.preventDefault(), nudge(-step, 0));
                if (e.key === 'ArrowUp') return void (e.preventDefault(), nudge(0, step));
                if (e.key === 'ArrowDown') return void (e.preventDefault(), nudge(0, -step));
                if (e.key === '+' || e.key === '=') return void (e.preventDefault(), zoomTo(frame.zoom * 1.15));
                if (e.key === '-') return void (e.preventDefault(), zoomTo(frame.zoom / 1.15));
              }}
              style={{ width: GATE, height: GATE, touchAction: 'none' }}
              className="relative mx-auto mt-4 cursor-grab overflow-hidden rounded-cell bg-house-deep ring-1 ring-house-rail focus-visible:ring-2 focus-visible:ring-dye-brass active:cursor-grabbing"
            >
              <PictureLayer
                source={loaded.source}
                left={frame.x}
                top={frame.y}
                w={shown.w}
                h={shown.h}
              />
              {}
              <span className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-beam/25" />
            </div>

            <label className="mt-4 block">
              <span className="legend mb-2 block">Aproximar</span>
              <input
                type="range"
                min={1}
                max={MAX_ZOOM}
                step={0.02}
                value={frame.zoom}
                onChange={e => zoomTo(parseFloat(e.target.value))}
                aria-label="Aproximação"
                className="w-full cursor-pointer accent-dye-brass"
              />
            </label>

            <div className="mt-5 flex flex-wrap gap-2">
              <Key tone="commit" className="flex-1" onClick={use}>
                Usar esta foto
              </Key>
              <Key tone="ghost" onClick={onCancel}>
                Cancelar
              </Key>
            </div>
          </>
        )}

        {error ? (
          <div className="mt-4">
            <Key tone="ghost" onClick={onCancel}>
              Fechar
            </Key>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

function PictureLayer({
  source,
  left,
  top,
  w,
  h,
}: {
  source: CanvasImageSource;
  left: number;
  top: number;
  w: number;
  h: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = Math.max(1, Math.round(w));
  const height = Math.max(1, Math.round(h));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
  }, [source, width, height]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{ position: 'absolute', left, top, width, height }}
    />
  );
}

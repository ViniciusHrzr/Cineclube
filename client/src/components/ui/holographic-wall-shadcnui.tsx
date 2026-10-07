"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cn, useFinePointer } from "@/lib/utils";

type HolographicWallProps = {
  intensity?: number;
  radius?: number;
  className?: string;
  asBackdrop?: boolean;
};

const GAUGE = 1.7;

const GECKO =
  typeof document !== 'undefined' && 'MozAppearance' in document.documentElement.style;

const SOFTWARE =
  typeof document !== 'undefined' &&
  document.documentElement.getAttribute('data-render') === 'software';

const ONE_WALL = GECKO || SOFTWARE;

const COARSE =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

const CELL = 46 * GAUGE;
const STRIP = 188 * GAUGE;
const PERF_IN = 10 * GAUGE;
const HOLE = 2 * GAUGE;

function geo(s: number) {
  return { w: STRIP * s, cell: CELL * s, inset: PERF_IN * s, hole: HOLE * s };
}

type Plane = {
  s: number;
  speed: number;
  dir: -1 | 1;
  cells: number;
  alpha: number;
  z: number;
  shade: string;
};

const PLANES: Plane[] = [
  { s: 1.0, speed: 2.2, dir: -1, cells: 2, alpha: 1, z: 4, shade: '3px 5px 30px 7px rgba(2,3,7,0.55)' },
  { s: 0.74, speed: 0.8, dir: 1, cells: 1, alpha: 0.54, z: 2, shade: '1px 2px 15px 3px rgba(2,3,7,0.34)' },
  { s: 0.89, speed: 1.4, dir: -1, cells: 2, alpha: 0.82, z: 3, shade: '2px 4px 22px 5px rgba(2,3,7,0.45)' },
  { s: 0.66, speed: 0.45, dir: 1, cells: 1, alpha: 0.44, z: 1, shade: '1px 1px 9px 2px rgba(2,3,7,0.22)' },
];

function stripFace(line: string, edge: string, perf: string, fill: string, s: number) {
  const { w: strip, cell, hole, inset } = geo(s);
  return {
    backgroundImage: [
      `radial-gradient(circle at ${inset}px 50%, ${perf} 0 ${hole}px, transparent ${hole * 1.3}px)`,
      `radial-gradient(circle at ${strip - inset}px 50%, ${perf} 0 ${hole}px, transparent ${hole * 1.3}px)`,
      `repeating-linear-gradient(180deg, ${line} 0 1px, transparent 1px ${cell}px)`,
      `linear-gradient(90deg, ${edge} 0 1px, transparent 1px)`,
      `linear-gradient(0deg, ${fill}, ${fill})`,
    ].join(', '),
    backgroundSize: [
      `${strip}px ${cell / 2}px`,
      `${strip}px ${cell / 2}px`,
      `${strip}px ${cell}px`,
      `${strip}px 100%`,
      `${strip}px 100%`,
    ].join(', '),
  } as const;
}

function layOut(width: number) {
  const field = width * 1.3;
  const out: { x: number; plane: Plane }[] = [];
  for (let x = 0, i = 0; x < field; i++) {
    const plane = PLANES[i % PLANES.length];
    out.push({ x, plane });
    x += geo(plane.s).w;
  }
  return out;
}

const Reel = memo(function Reel({
  width,
  line,
  edge,
  perf,
  fill,
  cast = true,
}: {
  width: number;
  line: string;
  edge: string;
  perf: string;
  fill: string;
  cast?: boolean;
}) {
  const strips = useMemo(() => layOut(width), [width]);
  return (
    <div className="absolute -inset-[12%] origin-center -rotate-[1.5deg]">
      {strips.map(({ x, plane }, i) => {
        const { w, cell } = geo(plane.s);
        const travel = plane.cells * cell;
        return (
          <div
            key={i}
            className="strip-creep absolute -top-32 -bottom-32"
            style={
              {
                left: x,
                width: w,
                opacity: plane.alpha,
                zIndex: plane.z,
                boxShadow: cast ? plane.shade : undefined,
                '--creep': `${plane.dir * travel}px`,
                '--dur': `${(travel / plane.speed).toFixed(1)}s`,
                '--phase': `${(-i * 6.7).toFixed(1)}s`,
                ...stripFace(line, edge, perf, fill, plane.s),
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
});

function Wall({
  intensity = 0.38,
  radius = 240,
  className,
  asBackdrop = false,
}: HolographicWallProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const beamRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const next = useRef<{ x: number; y: number } | null>(null);
  const [calm, setCalm] = useState(false);
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const fine = useFinePointer();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      setSize(s => {
        const w = host.clientWidth;
        const h = host.clientHeight;
        if (s.w === w && s.h === h) return s;

        if (COARSE && s.w === w && Math.abs(s.h - h) < 160) return s;

        return { w, h };
      });
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setCalm(q.matches);
    sync();
    q.addEventListener('change', sync);
    return () => q.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    if (!fine) return;

    const box = { left: 0, top: 0, k: 1 };
    const measure = () => {
      const r = host.getBoundingClientRect();
      const k = host.offsetWidth ? r.width / host.offsetWidth : 1;
      box.left = r.left;
      box.top = r.top;
      box.k = k;
    };
    measure();

    const beamOffset = radius;
    const haloOffset = radius * 1.9;

    const paint = () => {
      frame.current = 0;
      const p = next.current;
      if (!p) return;
      const bx = p.x - beamOffset;
      const by = p.y - beamOffset;
      if (beamRef.current) beamRef.current.style.transform = `translate3d(${bx}px, ${by}px, 0)`;
      if (backRef.current) backRef.current.style.transform = `translate3d(${-bx}px, ${-by}px, 0)`;
      if (haloRef.current)
        haloRef.current.style.transform = `translate3d(${p.x - haloOffset}px, ${p.y - haloOffset}px, 0)`;
    };

    let on = false;
    const show = (v: boolean) => {
      if (on === v) return;
      on = v;
      if (beamRef.current) beamRef.current.parentElement!.style.opacity = v ? String(intensity) : '0';
      if (haloRef.current)
        haloRef.current.style.opacity = v ? String(intensity * (ONE_WALL ? 1 : 0.6)) : '0';
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      next.current = { x: (e.clientX - box.left) / box.k, y: (e.clientY - box.top) / box.k };
      show(true);
      if (!frame.current) frame.current = requestAnimationFrame(paint);
    };
    const onLeave = () => show(false);

    const target: Window | HTMLElement = asBackdrop ? window : host;
    target.addEventListener("pointermove", onMove as EventListener, { passive: true });
    target.addEventListener("pointerleave", onLeave as EventListener);
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      target.removeEventListener("pointermove", onMove as EventListener);
      target.removeEventListener("pointerleave", onLeave as EventListener);
      window.removeEventListener('resize', measure);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [asBackdrop, fine, intensity, radius]);

  const beamBox = radius * 2;
  const haloBox = radius * 1.9 * 2;
  const mask = `radial-gradient(${radius}px circle at 50% 50%, #000 0%, #000 22%, rgba(0,0,0,0.6) 52%, transparent 78%)`;
  const fade = `opacity ${calm ? 0 : 350}ms cubic-bezier(0.16, 1, 0.3, 1)`;

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className={cn(
        "overflow-hidden",
        asBackdrop
          ? "pointer-events-none fixed inset-0 -z-10 bg-house"
          : "relative h-96 w-full rounded-plate bg-house",
        className
      )}
    >
      {}
      <Reel
        width={size.w}
        line="rgba(184,200,224,0.075)"
        edge="rgba(184,200,224,0.13)"
        perf="rgba(184,200,224,0.11)"
        fill="rgba(184,200,224,0.05)"
      />

      {}
      {fine && !ONE_WALL ? (
        <div className="absolute inset-0" style={{ opacity: 0, transition: fade }}>
          <div
            ref={beamRef}
            className="absolute left-0 top-0 overflow-hidden"
            style={{
              width: beamBox,
              height: beamBox,
              transform: 'translate3d(-9999px, -9999px, 0)',
              willChange: 'transform',
              WebkitMaskImage: mask,
              maskImage: mask,
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
            }}
          >
            <div
              ref={backRef}
              className="absolute left-0 top-0"
              style={{ width: size.w, height: size.h, willChange: 'transform' }}
            >
              <Reel
                width={size.w}
                line="rgba(255,214,150,0.66)"
                edge="rgba(255,228,175,0.85)"
                perf="rgba(255,244,220,0.9)"
                fill="rgba(255,214,150,0.13)"
                cast={false}
              />
            </div>
          </div>
        </div>
      ) : null}

      {}
      {fine ? (
        <div
          ref={haloRef}
          className="absolute left-0 top-0"
          style={{
            width: haloBox,
            height: haloBox,
            opacity: 0,
            transform: 'translate3d(-9999px, -9999px, 0)',
            willChange: 'transform, opacity',
            transition: fade,
            background:
              'radial-gradient(closest-side circle at 50% 50%, rgba(255,205,140,0.22) 0%, rgba(255,180,110,0.09) 38%, transparent 72%)',
          }}
        />
      ) : null}

      {}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 95% at 50% 0%, rgba(4,5,10,0.22) 0%, rgba(4,5,10,0.38) 45%, rgba(4,5,10,0.82) 100%)",
        }}
      />
    </div>
  );
}

export const HolographicWall = memo(Wall);

export default HolographicWall;

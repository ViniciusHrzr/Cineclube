"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn, useFinePointer } from "@/lib/utils";

type HolographicWallProps = {
  intensity?: number;
  radius?: number;
  className?: string;
  /** Full-viewport fixed backdrop instead of a bounded panel. */
  asBackdrop?: boolean;
};

/* ══════════════════════════════════════════════════════════════════════════
   The film wall.

   Same mechanic as the holographic-wall reference: a dark field of marks that
   ignite where the pointer is, with a soft halo riding the cursor. Two things
   are deliberately different.

   THE CONTENT is celluloid, not hieroglyphs — a 4-perforation film strip grid
   with frame lines, because this is a cinema and the wall should be made of
   the thing the club is arguing about.

   THE ENGINE is CSS, not four hundred springs. The reference mounts one
   motion.div per glyph and re-animates every one of them on every mouse move;
   at panel size that is merely wasteful, but as a full-viewport backdrop it is
   ~1500 spring animations per pointer event and it drops frames on contact.
   The same image comes from three composited layers: the dark field, a warm
   copy of the field revealed through a radial mask at the pointer, and the
   halo. Pointer writes two CSS variables, throttled to one frame. The ignite
   is now continuous rather than quantised per glyph, which reads better, and
   it holds 60fps behind a scrolling page.
   ══════════════════════════════════════════════════════════════════════════ */

/* The wall is hung at its own scale, over and above the interface's 125%: the
   room should be a size larger than the thing standing in front of it, or the
   frames start to compete with the cards for the same grain of attention. One
   knob, and the whole material follows it. */
/* Also, quietly, a performance knob: every strip is an element animating for as
   long as the tab is open, and there is a ceiling on how many of those a browser
   will hand to the compositor. Wider film means fewer lengths of it on screen —
   about seven per copy instead of ten — for the same wall. */
const GAUGE = 2.1;

const CELL = 46 * GAUGE;     // px — one frame, top to bottom
const STRIP = 188 * GAUGE;   // px — the width of a length of 35mm, edge to edge
const PERF_IN = 10 * GAUGE;  // px — the sprocket column, inset from the edge
const HOLE = 2 * GAUGE;      // px — the radius of one perforation

/* ── depth ────────────────────────────────────────────────────────────────
   The strips hang at four distances from the room, interleaved so no two
   neighbours share a plane. Depth is not one trick but four, all keyed to the
   same number `s`, because a single cue reads as a mistake and four read as
   distance:

     scale     a strip further off is narrower and its frames are shorter — this
               is the only honest one, the rest are the eye's shortcuts
     speed     parallax: the near plane crosses more of the screen per second, so
               the planes separate at rates that sort themselves by distance
     light     atmospheric perspective — the far planes sit back into the dark of
               the room rather than competing with the near ones
     shadow    the near planes are lit from the projector and throw that shadow
               onto whatever hangs behind them, which is the one cue that puts a
               measurable gap between two strips instead of only sorting them
     direction alternating strictly, and constant: a strip that runs up runs up
               for as long as the page is open

   Speed is given in pixels per second rather than as a duration, because what
   the eye sorts by distance is the rate, and a duration hides the rate behind
   the plane's own scale. The loop time is worked back from it. */
type Plane = {
  s: number;
  /** On-screen travel, px per second. The whole parallax lives in this column. */
  speed: number;
  dir: -1 | 1;
  /** Whole frames travelled per loop. Whole, or the loop would jump. */
  cells: number;
  alpha: number;
  /** Paint order. Without it the strips stack by document order and a near
      strip's shadow lands under the strip it is supposed to fall on. */
  z: number;
  /** Offset down and to the right of the beam, which comes from the box at the
      back of the room. Cast outside the border box only, so a strip darkens its
      neighbours and never its own frames.

      Every plane casts, including the ones at the back. Only the front two had
      one at first, and the wall gave itself away: the second plane reads as
      "in front" too, so half the strips near the eye appeared to be lying flat
      against the wall. What sorts the planes is not whether there is a shadow
      but how far it is thrown and how soft it has gone — a strip further back
      is closer to what it falls on.

      The spread is always larger than the horizontal offset, and that is the
      whole rule. An outer shadow is clipped to outside the box it comes from,
      so once the offset exceeds the spread the shadow's own edge retreats
      inside the strip on the upwind side, and all that survives there is the
      weak half of a blur. A heavy shadow on one flank and nothing on the other
      does not read as light coming from a direction; it reads as broken. Every
      strip here darkens both its neighbours, one of them more. */
  shade: string;
};

/* The blurs are half what they were, and the two planes at the back cast
   nothing at all. A blurred shadow has to be rasterised into the layer that
   carries it, and these layers are the height of the screen and never stop
   moving; thirty pixels of blur on every one of them is a bill paid on every
   device, for a gradient of shadow that reads the same at fourteen. What sorts
   the planes was never the shadow's size anyway — it is that the near ones
   throw and the far ones do not. */
const PLANES: Plane[] = [
  // nearest: widest, brightest, fastest, and the only shadow thrown far
  { s: 1.0, speed: 2.2, dir: -1, cells: 2, alpha: 1, z: 4, shade: '3px 5px 14px 5px rgba(2,3,7,0.55)' },
  { s: 0.74, speed: 0.8, dir: 1, cells: 1, alpha: 0.54, z: 2, shade: 'none' }, // far
  { s: 0.89, speed: 1.4, dir: -1, cells: 2, alpha: 0.82, z: 3, shade: '2px 4px 10px 3px rgba(2,3,7,0.45)' }, // mid
  // furthest: barely there, barely moves, and casts nothing
  { s: 0.66, speed: 0.45, dir: 1, cells: 1, alpha: 0.44, z: 1, shade: 'none' },
];

/* Celluloid, built the way the material actually is: one length of 35mm as one
   element — a stack of frames divided by frame lines, with a column of sprocket
   holes down both edges. Drawn as four background layers rather than a two-axis
   grid, because an even grid reads as graph paper, which is exactly what the
   first version of this looked like.

   A strip is its own element and not a repeat of one field, because a repeating
   background can only ever move as one sheet, and these have to move apart.

   `s` scales the whole material — width, frame height, the sprocket holes and
   their inset — so a distant strip is the same film seen from further away and
   not a different gauge of it.

   `fill` is the base the strip is printed on, and it is the reason the shadows
   read at all. A strip made only of hairlines is very nearly a hole in the
   wall: a shadow falling across it has nothing to darken but the black of the
   room, which is already black — 82% of nothing is still nothing, and every
   shadow on this wall was invisible for exactly that reason.

   So the celluloid gets a body. Physically it is the right answer and not a
   trick: film hung on a dark wall reflects some light back, which is why you
   can see it at all, and being lighter than the wall is precisely the condition
   under which a shadow falling across it becomes visible. The wash is what a
   strip loses when its neighbour blocks the beam.

   The wall stays far darker than the type in front of it: at full strength a
   strip reads #101319 and, through the scrim, #0d1016 — cream text over that is
   about 14.9:1, where the floor for body copy is 4.5:1. */
function stripFace(line: string, edge: string, perf: string, fill: string, s: number) {
  const strip = STRIP * s;
  const cell = CELL * s;
  const hole = HOLE * s;
  const inset = PERF_IN * s;
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

/* Widths now differ per plane, so the strips are laid out by running total
   rather than by index × pitch. The field is overscanned by 12% on each side so
   the tilt never exposes a corner, and it is filled until it is covered. */
function layOut(width: number) {
  const field = width * 1.3;
  const out: { x: number; plane: Plane }[] = [];
  for (let x = 0, i = 0; x < field; i++) {
    const plane = PLANES[i % PLANES.length];
    out.push({ x, plane });
    x += STRIP * plane.s;
  }
  return out;
}

/* The wall itself, at one colour. It is rendered twice — once unlit, once in
   tungsten behind the beam's mask — and the two copies have to stay registered
   with each other, so every strip's phase comes from its index rather than from
   when it happened to mount. */
function Reel({
  width,
  line,
  edge,
  perf,
  fill,
}: {
  width: number;
  line: string;
  edge: string;
  perf: string;
  fill: string;
}) {
  const strips = useMemo(() => layOut(width), [width]);
  return (
    /* The whole field is rotated a degree and a half and overscanned. An
       axis-aligned field of hairlines is a UI grid overlay no matter what it is
       made of; strips pinned up off-square are cloth, paper, film. The tilt is
       what stops this reading as graph paper, and it costs nothing. */
    <div className="absolute -inset-[12%] origin-center -rotate-[1.5deg]">
      {strips.map(({ x, plane }, i) => {
        /* A whole number of frames, so the loop closes on itself and the creep
           has no seam to catch the eye. */
        const travel = plane.cells * CELL * plane.s;
        return (
          <div
            key={i}
            /* Taller than the field it sits in, so a strip that has run up does
               not drag its own end into view. */
            className="strip-creep absolute -top-32 -bottom-32"
            style={
              {
                left: x,
                width: STRIP * plane.s,
                opacity: plane.alpha,
                zIndex: plane.z,
                boxShadow: plane.shade,
                '--creep': `${plane.dir * travel}px`,
                '--dur': `${(travel / plane.speed).toFixed(1)}s`,
                /* Strips of the same plane repeat every fourth column; without
                   an offset they run in step and the wall reads as one sheet
                   with a pattern printed on it. */
                '--phase': `${(-i * 6.7).toFixed(1)}s`,
                ...stripFace(line, edge, perf, fill, plane.s),
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

export function HolographicWall({
  /* Dimmer than it was, twice over: the wall should suggest itself, not
     announce itself. The halo is taken from this same number, so the whole
     beam — reveal and scatter — comes down together. */
  intensity = 0.49,
  radius = 340,
  className,
  asBackdrop = false,
}: HolographicWallProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [lit, setLit] = useState(false);
  const frame = useRef(0);
  const next = useRef<{ x: number; y: number } | null>(null);
  const [calm, setCalm] = useState(false);
  const [width, setWidth] = useState(() => window.innerWidth);
  const fine = useFinePointer();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => setWidth(host.clientWidth));
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

    // A touch screen has no pointer to follow, so there is nothing to wire up.
    // Reduced motion, however, does NOT switch the light off: this backdrop is
    // the product's commissioned interactive surface, and a light that tracks
    // the cursor is direct feedback, not an animation playing at the visitor.
    // What the preference removes is the easing of the beam — see `calm`. The
    // creep of the strips is deliberately exempt; the reason is in index.css.
    if (!fine) return;

    /* The box is measured when it changes, not when the mouse moves. The
       pointer arrives in screen pixels and leaves as a CSS length inside a
       zoomed page, and those are not the same unit — the element reports both
       of its own widths and the ratio converts one to the other, which also
       keeps it right if the visitor zooms the browser on top of everything.

       That conversion used to be computed inside the move handler, where a
       client rect and an offset width are two forced synchronous layouts. A
       mouse can fire hundreds of events a second, and the handler was making
       the browser stop and re-measure the page on every one of them — the
       single most expensive thing in this file, and it cost exactly nothing to
       move it here, because a fixed full-screen box only changes on resize. */
    const box = { left: 0, top: 0, k: 1 };
    const measure = () => {
      const r = host.getBoundingClientRect();
      const k = host.offsetWidth ? r.width / host.offsetWidth : 1;
      box.left = r.left;
      box.top = r.top;
      box.k = k;
    };
    measure();

    const paint = () => {
      frame.current = 0;
      const p = next.current;
      if (!p) return;
      host.style.setProperty('--mx', `${p.x}px`);
      host.style.setProperty('--my', `${p.y}px`);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      next.current = { x: (e.clientX - box.left) / box.k, y: (e.clientY - box.top) / box.k };
      if (!lit) setLit(true);
      if (!frame.current) frame.current = requestAnimationFrame(paint);
    };
    const onLeave = () => setLit(false);

    const target: Window | HTMLElement = asBackdrop ? window : host;
    target.addEventListener("pointermove", onMove as EventListener, { passive: true });
    target.addEventListener("pointerleave", onLeave as EventListener);
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      target.removeEventListener("pointermove", onMove as EventListener);
      target.removeEventListener("pointerleave", onLeave as EventListener);
      window.removeEventListener('resize', measure);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [asBackdrop, lit, fine]);

  const mask = `radial-gradient(${radius}px circle at var(--mx, -1000px) var(--my, -1000px), #000 0%, #000 22%, rgba(0,0,0,0.6) 52%, transparent 78%)`;

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
      {/* the unlit wall: celluloid you can just make out in a dark room */}
      <Reel
        width={width}
        line="rgba(184,200,224,0.075)"
        edge="rgba(184,200,224,0.13)"
        perf="rgba(184,200,224,0.11)"
        fill="rgba(184,200,224,0.05)"
      />

      {/* The lit wall: the same strip in tungsten, revealed only where the beam
          falls. The mask must stay in the viewport's own coordinate space or the
          beam drifts away from the cursor, so the wrapper carries the mask and
          only the pattern inside it is rotated.

          It exists only for a cursor, so on a touch screen it is not built at
          all. It used to be: a second full set of strips, every one of them
          animating, behind a full-screen mask, on a phone that could never
          light a single one of them. Same for the halo below. */}
      {fine ? (
      <motion.div
        className="absolute inset-0"
        animate={{ opacity: lit ? intensity : 0 }}
        transition={{ duration: calm ? 0 : 0.35, ease: [0.16, 1, 0.3, 1] }}
        style={{ WebkitMaskImage: mask, maskImage: mask }}
      >
        <Reel
          width={width}
          line="rgba(255,214,150,0.66)"
          edge="rgba(255,228,175,0.85)"
          perf="rgba(255,244,220,0.9)"
          fill="rgba(255,214,150,0.13)"
        />
      </motion.div>
      ) : null}

      {/* The halo: light scattering in the air of the room. Held well under the
          reveal, because the two do different amounts of damage to the text
          over them — the reveal is hairlines, which the type reads between,
          while the halo is a flat wash across everything the cursor is near,
          and a wash is what actually lifts a background off the page. */}
      <AnimatePresence>
        {fine && lit && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: intensity * 0.6 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0"
            style={{
              background: `radial-gradient(${radius * 1.9}px circle at var(--mx, -1000px) var(--my, -1000px), rgba(255,205,140,0.22) 0%, rgba(255,180,110,0.09) 38%, transparent 72%)`,
            }}
          />
        )}
      </AnimatePresence>

      {/* The screen surround: the room falls off toward its edges. It is also
          the legibility floor, and that is the more important of its two jobs —
          the app's headings and body copy sit straight on this wall with no
          plate under them, so the wall is never allowed to reach full strength
          anywhere text can land. It used to be fully transparent for the first
          30%, which is exactly the band the page titles occupy. Now it never
          drops below a fifth, and every layer above is dimmed by it, the beam
          included. Worst case measured through this scrim — cream text over a
          lit frame line, right under the cursor — is about 7.9:1. */}
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

export default HolographicWall;

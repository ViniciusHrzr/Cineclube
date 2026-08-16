"use client";

import { cn, useFinePointer } from "@/lib/utils";

import React, {
  createContext,
  useState,
  useContext,
  useRef,
  useEffect,
} from "react";

const MouseEnterContext = createContext<
  [boolean, React.Dispatch<React.SetStateAction<boolean>>] | undefined
>(undefined);

export const CardContainer = ({
  children,
  className,
  containerClassName,
}: {
  children?: React.ReactNode;
  className?: string;
  containerClassName?: string;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMouseEntered, setIsMouseEntered] = useState(false);
  const fine = useFinePointer();

  /* ── the card's own box, measured once ──────────────────────────────────
     The tilt needs to know where the card is and how big it is. Reading that
     from a client rect inside the move handler was a forced synchronous layout
     on every mouse event — and the handler had just written a transform, so the
     layout was always dirty and the browser always had to redo it. Read, write,
     read, write, hundreds of times a second, over a grid of a hundred posters.
     That is layout thrashing, and it is the kind that only shows up when
     someone actually moves the mouse across the catalogue.

     The box is measured when the pointer arrives instead, and again only if
     something that could have moved it happened while the pointer was still
     over the card. Between those, a move is one write and nothing else. */
  const box = useRef({ left: 0, top: 0, width: 0, height: 0, k: 1 });
  const stale = useRef(true);
  const frame = useRef(0);
  const at = useRef({ x: 0, y: 0 });

  const measure = () => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    /* Degrees per pixel, where the pixel has to be the card's own — the page is
       zoomed, so a client rect is wider than the box that drew it, and without
       this the tilt steepens by exactly the zoom factor. */
    const k = el.offsetWidth ? r.width / el.offsetWidth : 1;
    box.current = { left: r.left, top: r.top, width: r.width, height: r.height, k };
    stale.current = false;
  };

  const paint = () => {
    frame.current = 0;
    const el = containerRef.current;
    if (!el) return;
    if (stale.current) measure();
    const b = box.current;
    const x = (at.current.x - b.left - b.width / 2) / (25 * b.k);
    const y = (at.current.y - b.top - b.height / 2) / (25 * b.k);
    el.style.transform = `rotateY(${x}deg) rotateX(${y}deg)`;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    at.current = { x: e.clientX, y: e.clientY };
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  };

  const handleMouseEnter = () => {
    measure();
    setIsMouseEntered(true);
  };

  const handleMouseLeave = () => {
    if (frame.current) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    }
    stale.current = true;
    setIsMouseEntered(false);
    if (containerRef.current)
      containerRef.current.style.transform = `rotateY(0deg) rotateX(0deg)`;
  };

  /* A scroll or a resize moves the card out from under a rect that was taken
     when the pointer arrived — the wheel under a hovering hand is the ordinary
     way to browse this grid. The listeners exist only while a card is held, and
     they do no work: they mark the measurement stale and the next frame that
     needs it takes a fresh one. */
  useEffect(() => {
    if (!isMouseEntered) return;
    const drop = () => {
      stale.current = true;
    };
    window.addEventListener("scroll", drop, { passive: true, capture: true });
    window.addEventListener("resize", drop, { passive: true });
    return () => {
      window.removeEventListener("scroll", drop, { capture: true });
      window.removeEventListener("resize", drop);
    };
  }, [isMouseEntered]);

  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    },
    []
  );

  /* Without a mouse there is nothing to tip toward, so none of the machinery is
     built: no perspective, no preserve-3d, no transitions, no handlers. That is
     not a small saving. A card in a 3D context is a card the browser may not
     flatten or squash with its neighbours — every layer stands on its own plane
     — and this component puts one on the container, one on the body, one on
     each of the body's children and one per item. Twenty posters is a hundred
     and twenty boxes held in 3D so that a pointer which does not exist can tilt
     them. */
  if (!fine) {
    return (
      <MouseEnterContext.Provider value={[isMouseEntered, setIsMouseEntered]}>
        <div className={cn("flex items-center justify-center", containerClassName)}>
          <div className={cn("relative flex items-center justify-center", className)}>{children}</div>
        </div>
      </MouseEnterContext.Provider>
    );
  }

  return (
    <MouseEnterContext.Provider value={[isMouseEntered, setIsMouseEntered]}>
      <div
        className={cn("flex items-center justify-center", containerClassName)}
        style={{ perspective: "1000px" }}
      >
        <div
          ref={containerRef}
          onMouseEnter={handleMouseEnter}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className={cn(
            /* Transform only. `transition-all` here meant every animatable
               property on the card was watched for change, on every card. */
            "relative flex items-center justify-center transition-transform duration-200 ease-linear",
            className
          )}
          style={{ transformStyle: "preserve-3d" }}
        >
          {children}
        </div>
      </div>
    </MouseEnterContext.Provider>
  );
};

export const CardBody = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "[transform-style:preserve-3d] [&>*]:[transform-style:preserve-3d]",
        className
      )}
    >
      {children}
    </div>
  );
};

/* A layer of the card, standing at its own depth. Only the depth is ever asked
   for here, so only the depth is offered: the six axes this carried are five
   more than the product uses, and each of them was a prop compared on every
   render of every layer of every poster.

   The transform is a style, not an effect. Writing it from a useEffect meant a
   render, then a commit, then a second pass over the DOM to say the thing the
   render already knew. */
export function CardItem({
  children,
  className,
  translateZ = 0,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
  className?: string;
  translateZ?: number;
}) {
  const [isMouseEntered] = useMouseEnter();
  return (
    <div
      className={cn("transition-transform duration-200 ease-linear", className)}
      /* No transform at all at rest, rather than a transform that happens to be
         zero: a card nobody is pointing at should not be asking for a plane of
         its own. */
      style={isMouseEntered ? { transform: `translateZ(${translateZ}px)` } : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}

// Create a hook to use the context
export const useMouseEnter = () => {
  const context = useContext(MouseEnterContext);
  if (context === undefined) {
    throw new Error("useMouseEnter must be used within a MouseEnterProvider");
  }
  return context;
};

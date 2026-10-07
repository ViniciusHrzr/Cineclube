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

  const box = useRef({ left: 0, top: 0, width: 0, height: 0, k: 1 });
  const stale = useRef(true);
  const frame = useRef(0);
  const at = useRef({ x: 0, y: 0 });

  const measure = () => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
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
      style={isMouseEntered ? { transform: `translateZ(${translateZ}px)` } : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}

export const useMouseEnter = () => {
  const context = useContext(MouseEnterContext);
  if (context === undefined) {
    throw new Error("useMouseEnter must be used within a MouseEnterProvider");
  }
  return context;
};

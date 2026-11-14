"use client";
// A figure that counts up once, the first time it comes into view ("21/21" rolls from "0/0"): subtle, about a second,
// easing out. Its final text holds the space from the first paint, so nothing moves; screen readers get the final
// value. Reduced motion, or no script: the final value, still.

import { useEffect, useRef, useState } from "react";

const NUM = /\d+(?:\.\d+)?/g;

export function CountUp({ value, className }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const nums = (value.match(NUM) ?? []).map(Number);
    if (!nums.some((n) => n > 0)) return;
    const at = (k: number) => {
      let i = 0;
      return value.replace(NUM, (m) => {
        const n = nums[i++] ?? 0;
        const dec = m.includes(".") ? m.split(".")[1]!.length : 0;
        return (n * k).toFixed(dec);
      });
    };
    setShown(at(0));
    let raf = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const step = (now: number) => {
          const u = Math.min(1, (now - t0) / 1100);
          setShown(at(1 - (1 - u) ** 3));
          if (u < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);
  return (
    <span ref={ref} aria-label={value} role="img" className={`relative inline-block ${className ?? ""}`}>
      <span aria-hidden className="invisible">
        {value}
      </span>
      <span aria-hidden className="absolute inset-y-0 left-0 whitespace-nowrap">
        {shown}
      </span>
    </span>
  );
}

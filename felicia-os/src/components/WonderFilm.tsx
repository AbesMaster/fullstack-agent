"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Short looping promotional film. Starts silently once the page has checked the visitor's
 * motion preference; anyone who asks their device for reduced motion sees the still image
 * instead, with a play button if they want it.
 */
export function WonderFilm({ sources, poster, label }: { sources: { src: string; type: string }[]; poster: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      setReduced(mq.matches);
      if (mq.matches) ref.current?.pause();
      else ref.current?.play().catch(() => undefined);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return (
    <video
      ref={ref}
      poster={poster}
      aria-label={label}
      muted
      loop
      playsInline
      controls={reduced}
      preload="metadata"
      className="h-full w-full object-cover"
    >
      {sources.map((s) => <source key={s.src} src={s.src} type={s.type} />)}
    </video>
  );
}

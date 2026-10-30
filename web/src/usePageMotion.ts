import { useEffect, useRef } from 'react';

/** Entrances start from readable content and run once; no hidden loading state. */
export function usePageMotion() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('motion-play');
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.12 });
    root.current?.querySelectorAll('[data-motion]').forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);
  return root;
}

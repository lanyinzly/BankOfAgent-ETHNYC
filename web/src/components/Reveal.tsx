import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap, prefersReducedMotion } from '../lib/gsap';

interface Props {
  children: ReactNode;
  className?: string;
  id?: string;
  /** Animate direct children in sequence instead of the block as a whole. */
  stagger?: boolean;
  y?: number;
  delay?: number;
}

/** Fade-and-rise a block (or its children) into view on scroll. Respects
 *  prefers-reduced-motion by leaving content at its natural state. */
export default function Reveal({ children, className, id, stagger = false, y = 26, delay = 0 }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion || !ref.current) return;
      const targets = stagger ? Array.from(ref.current.children) : ref.current;
      gsap.from(targets, {
        opacity: 0,
        y,
        duration: 0.85,
        ease: 'power3.out',
        delay,
        stagger: stagger ? 0.09 : 0,
        scrollTrigger: { trigger: ref.current, start: 'top 86%', once: true },
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={className} id={id}>
      {children}
    </div>
  );
}

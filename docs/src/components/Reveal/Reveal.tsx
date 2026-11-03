import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import styles from './Reveal.module.css';

type TRevealFrom = 'below' | 'left' | 'right';

type TRevealProps = {
    children: ReactNode;
    className?: string;
    delayMs?: number;
    from?: TRevealFrom;
};

const HIDDEN_CLASS_BY_FROM: Record<TRevealFrom, string> = {
    below: styles.revealHidden,
    left: styles.revealHiddenLeft,
    right: styles.revealHiddenRight,
};

export function useRevealed<TElement extends Element>(): [React.RefObject<TElement | null>, boolean, boolean] {
    const elementRef = useRef<TElement | null>(null);
    const [isArmed, setIsArmed] = useState(false);
    const [isShown, setIsShown] = useState(false);
    useEffect(() => {
        const element = elementRef.current;
        if (element === null || typeof IntersectionObserver === 'undefined') return undefined;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setIsShown(true);
            return undefined;
        }
        setIsArmed(true);
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) {
                setIsShown(true);
                observer.disconnect();
            }
        }, { threshold: 0.18 });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    return [elementRef, isArmed, isShown];
}

export default function Reveal({ children, className, delayMs = 0, from = 'below' }: TRevealProps): ReactNode {
    const [elementRef, isArmed, isShown] = useRevealed<HTMLDivElement>();
    return (
        <div
            ref={elementRef}
            className={clsx(styles.reveal, isArmed && !isShown && HIDDEN_CLASS_BY_FROM[from], className)}
            style={{ transitionDelay: `${delayMs}ms` }}
        >
            {children}
        </div>
    );
}

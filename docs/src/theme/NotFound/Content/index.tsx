import React from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';
import { PixelSkull } from '@site/src/components/PixelSprite/PixelSprite';
import styles from './styles.module.css';

export default function NotFoundContent({ className }: { className?: string }): ReactNode {
    return (
        <main className={clsx('container', styles.page, className)}>
            <PixelSkull size={260} wired chattering className={styles.skull} />
            <p className={styles.code}>404 · no dendrite</p>
            <Heading as="h1" className={styles.title}>
                This signal has nowhere to land.
            </Heading>
            <p className={styles.text}>
                No neuron in this graph listens on that route, so the stimulation ended here. The page may have moved,
                or the link that sent you is broken.
            </p>
            <div className={styles.flatline} aria-hidden="true">
                <i />
            </div>
            <div className={styles.links}>
                <Link className="button button--primary" to="/">
                    Back to the landing
                </Link>
                <Link to="/docs/core/quick-start">Quick start →</Link>
            </div>
        </main>
    );
}

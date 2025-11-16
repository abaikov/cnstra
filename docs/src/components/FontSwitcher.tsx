import React, { useEffect, useState } from 'react';
import styles from './FontSwitcher.module.css';

const FONT_STORAGE_KEY = 'cnstra-font-preference';
const FONT_PIXEL = 'pixel';
const FONT_SIMPLE = 'simple';

export default function FontSwitcher(): JSX.Element {
    const [fontMode, setFontMode] = useState<string>(FONT_PIXEL);

    useEffect(() => {
        // Load saved preference or default to pixel font
        const saved = localStorage.getItem(FONT_STORAGE_KEY);
        const initialFont = saved || FONT_PIXEL;
        setFontMode(initialFont);
        applyFont(initialFont);
    }, []);

    const applyFont = (font: string) => {
        const root = document.documentElement;
        if (font === FONT_SIMPLE) {
            root.classList.add('font-simple');
        } else {
            root.classList.remove('font-simple');
        }
    };

    const toggleFont = () => {
        const newFont = fontMode === FONT_PIXEL ? FONT_SIMPLE : FONT_PIXEL;
        setFontMode(newFont);
        localStorage.setItem(FONT_STORAGE_KEY, newFont);
        applyFont(newFont);
    };

    return (
        <button
            className={styles.fontSwitcher}
            onClick={toggleFont}
            title={fontMode === FONT_PIXEL ? 'Switch to simple font' : 'Switch to pixel font'}
            aria-label={fontMode === FONT_PIXEL ? 'Switch to simple font' : 'Switch to pixel font'}
        >
            <span className={styles.fontIcon}>
                {fontMode === FONT_PIXEL ? '🔤' : '🖥️'}
            </span>
        </button>
    );
}


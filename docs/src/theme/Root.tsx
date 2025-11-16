import React, { useEffect } from 'react';
import Head from '@docusaurus/Head';
import FontSwitcher from '../components/FontSwitcher';

export default function Root({ children }: { children: React.ReactNode }) {
    useEffect(() => {
        // Apply saved font preference on mount
        const saved = localStorage.getItem('cnstra-font-preference');
        const font = saved || 'pixel';
        if (font === 'simple') {
            document.documentElement.classList.add('font-simple');
        }
    }, []);

    return (
        <>
            <Head>
                <link
                    rel="preload"
                    href="/fonts/Px437_IBM_Conv.ttf"
                    as="font"
                    type="font/ttf"
                    crossOrigin="anonymous"
                />
            </Head>
            <div className="font-switcher-container">
                <FontSwitcher />
            </div>
            {children}
        </>
    );
}

import React from 'react';
import Head from '@docusaurus/Head';

export default function Root({ children }: { children: React.ReactNode }) {
    return (
        <>
            <Head>
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
                <link
                    href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&display=swap"
                    rel="stylesheet"
                />
                <link
                    rel="preload"
                    href="/fonts/Px437_IBM_Conv.ttf"
                    as="font"
                    type="font/ttf"
                    crossOrigin="anonymous"
                />
            </Head>
            {children}
        </>
    );
}

import React from 'react';
import Head from '@docusaurus/Head';

export default function Root({ children }: { children: React.ReactNode }) {
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
            {children}
        </>
    );
}

import type { Config } from '@docusaurus/types';
import type { Preset } from '@docusaurus/preset-classic';
import { themes as prismThemes } from 'prism-react-renderer';

const config: Config = {
    title: 'CNStra',
    tagline: 'Central Nervous System for JavaScript apps',
    favicon: 'img/logo.svg',

    url: 'https://abaikov.github.io',
    baseUrl: '/cnstra/',
    baseUrlIssueBanner: true,
    trailingSlash: true,

    organizationName: 'abaikov',
    projectName: 'cnstra',

    i18n: {
        defaultLocale: 'en',
        locales: ['en'],
    },

    onBrokenLinks: 'throw',
    onDuplicateRoutes: 'warn',

    markdown: {
        hooks: {
            onBrokenMarkdownLinks: 'warn',
        },
    },

    presets: [
        [
            'classic',
            {
                docs: {
                    path: '.',
                    routeBasePath: '/docs',
                    sidebarPath: './sidebars.ts',
                    editUrl:
                        'https://github.com/abaikov/cnstra/edit/master/docs/',
                    showLastUpdateAuthor: true,
                    showLastUpdateTime: true,
                    include: ['**/*.md', '**/*.mdx'],
                    exclude: [
                        '_**/*.{md,mdx}',
                        '**/_*.{md,mdx}',
                        '**/*.test.{md,mdx}',
                        'node_modules/**',
                        '**/node_modules/**',
                        'build/**',
                        'dist/**',
                        '.docusaurus/**',
                    ],
                },
                blog: false,
                theme: {
                    customCss: './src/css/custom.css',
                },
                sitemap: {
                    changefreq: 'weekly',
                    priority: 0.5,
                    filename: 'sitemap.xml',
                },
                gtag: undefined,
            } satisfies Preset.Options,
        ],
    ],

    themeConfig: {
        image: 'img/logo.svg',
        metadata: [
            {
                name: 'keywords',
                content:
                    'cnstra, cns, ierg, inverted explicit reactive graph, state machines, state machine, state management, orchestration, reactive graph, javascript, typescript, react, node, backend, devtools, swift, swiftui, ios',
            },
            {
                name: 'description',
                content:
                    'CNStra is an inverted explicit reactive graph for state management and orchestration. Deterministic state machines for React/TypeScript and backend, plus Swift/SwiftUI ecosystem.',
            },
            { property: 'og:type', content: 'website' },
            { property: 'og:site_name', content: 'CNStra' },
            { property: 'og:image:alt', content: 'CNStra logo' },
            {
                property: 'og:description',
                content:
                    'Deterministic orchestration and state machines with CNStra (IERG). React/TypeScript and Swift/SwiftUI ecosystem.',
            },
            { name: 'twitter:card', content: 'summary_large_image' },
            { name: 'twitter:site', content: '@abaikov' },
            {
                name: 'twitter:description',
                content:
                    'CNStra: IERG-based orchestration and state machines. React/TS and Swift/SwiftUI.',
            },
            { name: 'theme-color', content: '#0ea5e9' },
        ],
        navbar: {
            title: 'CNStra',
            logo: {
                alt: 'CNStra Logo',
                src: 'img/logo.svg',
            },
            items: [
                { to: '/docs', label: 'Docs', position: 'left' },
                {
                    to: '/docs/tutorials/oimdb-app',
                    label: 'Tutorials',
                    position: 'left',
                },
                {
                    to: '/docs/frontend/oimdb',
                    label: 'Frontend',
                    position: 'left',
                },
                {
                    to: '/docs/backend/overview',
                    label: 'Backend',
                    position: 'left',
                },
                {
                    to: '/docs/recipes/cancel',
                    label: 'Recipes',
                    position: 'left',
                },
                {
                    to: '/docs/ecosystem/swift',
                    label: 'Ecosystem',
                    position: 'left',
                },
                {
                    href: 'https://github.com/abaikov/cnstra',
                    label: 'GitHub',
                    position: 'right',
                },
            ],
        },
        footer: {
            style: 'dark',
            copyright: `Copyright © ${new Date().getFullYear()} CNStra. MIT License.`,
            links: [
                {
                    title: 'Docs',
                    items: [
                        { label: 'Introduction', to: '/docs' },
                        {
                            label: 'Getting Started',
                            to: '/docs/getting-started/installation',
                        },
                        {
                            label: 'Concepts',
                            to: '/docs/concepts/architecture',
                        },
                    ],
                },
                {
                    title: 'Community',
                    items: [
                        {
                            label: 'GitHub Issues',
                            href: 'https://github.com/abaikov/cnstra/issues',
                        },
                    ],
                },
                {
                    title: 'More',
                    items: [
                        {
                            label: 'GitHub',
                            href: 'https://github.com/abaikov/cnstra',
                        },
                    ],
                },
            ],
        },
        colorMode: {
            defaultMode: 'dark',
            disableSwitch: false,
            respectPrefersColorScheme: true,
        },
        prism: {
            theme: prismThemes.dracula,
            darkTheme: prismThemes.dracula,
            additionalLanguages: ['bash', 'json', 'typescript'],
        },
        tableOfContents: {
            minHeadingLevel: 2,
            maxHeadingLevel: 4,
        },
    },
};

export default config;

import type { Config } from '@docusaurus/types';
import type { Preset } from '@docusaurus/preset-classic';
import { themes as prismThemes } from 'prism-react-renderer';

const config: Config = {
    title: 'CNStra',
    tagline: 'Central Nervous System for JavaScript apps',
    favicon: 'img/logo.svg',

    url: 'https://cnstra.org',
    baseUrl: '/',
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
                    'state management, state machine, state machines, orchestration, orchestrator, flow orchestration, workflow engine, saga pattern, event sourcing, reactive programming, reactive graph, deterministic state machine, finite state machine, FSM, XState alternative, Redux alternative, MobX alternative, Zustand alternative, Jotai alternative, Recoil alternative, Flux pattern, CQRS, event-driven architecture, message queue, task queue, job queue, BullMQ, RabbitMQ, SQS, backend orchestration, frontend state management, TypeScript state machine, React state management, single responsibility principle, SRP, SOLID principles, best practices, clean architecture, domain-driven design, DDD, microservices orchestration, API orchestration, ETL pipeline, data pipeline, process automation, business logic orchestration, declarative programming, functional reactive programming, FRP, actor model, petri net, directed graph, DAG, dependency injection, inversion of control, IoC, zero dependencies, lightweight state machine, predictable state management, testable state machine, type-safe orchestration, graph-based orchestration, neuron network, signal flow, collateral, dendrite, axon, cancellation, backpressure, concurrency control, rate limiting, retry logic, error handling, context management, saga orchestration, long-running processes, distributed workflows, serverless orchestration, edge computing, React Native, Node.js, browser, Swift, SwiftUI, iOS, cross-platform, IERG, inverted explicit reactive graph, CNStra, CNS, JavaScript orchestration, TypeScript orchestration, React orchestration, frontend orchestration, backend orchestration, full-stack orchestration, real-time orchestration, async orchestration, parallel processing, sequential processing, graph traversal, state transition, event handler, callback pattern, observer pattern, pub-sub alternative, no global state, explicit flow, readable code, maintainable code, scalable architecture, performance optimization, memory efficient, deterministic behavior, reproducible state, debugging tools, devtools, visual graph, state visualization, flow diagram, execution trace, monitoring, observability, APM integration, OpenTelemetry, distributed tracing',
            },
            {
                name: 'description',
                content:
                    'CNStra: Type-safe state machine and orchestration library for JavaScript/TypeScript. Zero dependencies. Deterministic workflows, saga patterns, SOLID/SRP by design. Perfect for React state management, backend orchestration, ETL pipelines, queue systems (BullMQ/RabbitMQ), and distributed workflows. Alternative to Redux, XState, MobX. Works in Node.js, browsers, serverless, React Native, and Swift/SwiftUI.',
            },
            { property: 'og:type', content: 'website' },
            { property: 'og:site_name', content: 'CNStra' },
            {
                property: 'og:title',
                content:
                    'CNStra - Type-Safe State Machine & Orchestration for JavaScript',
            },
            {
                property: 'og:image:alt',
                content:
                    'CNStra: Deterministic orchestration and state machines',
            },
            {
                property: 'og:description',
                content:
                    'Zero-dependency state machine & orchestration library. Deterministic workflows, saga patterns, SOLID/SRP principles. For React, Node.js, backend orchestration, and distributed systems. Alternative to Redux, XState, MobX.',
            },
            { name: 'twitter:card', content: 'summary_large_image' },
            { name: 'twitter:site', content: '@abaikov' },
            {
                name: 'twitter:title',
                content: 'CNStra - State Machine & Orchestration Library',
            },
            {
                name: 'twitter:description',
                content:
                    'Type-safe orchestration for React & Node.js. Zero dependencies. Deterministic state machines, saga patterns, SOLID/SRP. Alternative to Redux, XState, MobX.',
            },
            { name: 'theme-color', content: '#0ea5e9' },
            { name: 'author', content: 'CNStra Team' },
            { name: 'robots', content: 'index, follow' },
            { name: 'googlebot', content: 'index, follow' },
            { property: 'og:locale', content: 'en_US' },
            { property: 'og:url', content: 'https://cnstra.org' },
        ],
        navbar: {
            title: 'CNStra',
            logo: {
                alt: 'CNStra Logo',
                src: 'img/logo.svg',
            },
            items: [
                { to: '/docs/intro', label: 'Intro', position: 'left' },
                {
                    to: '/docs/core/quick-start',
                    label: 'Quick Start',
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
                    to: '/docs/examples/react',
                    label: 'Examples',
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
                        { label: 'Introduction', to: '/docs/intro' },
                        {
                            label: 'Quick Start',
                            to: '/docs/core/quick-start',
                        },
                        {
                            label: 'Concepts',
                            to: '/docs/concepts/ierg',
                        },
                        {
                            label: 'Recipes',
                            to: '/docs/recipes/cancel',
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

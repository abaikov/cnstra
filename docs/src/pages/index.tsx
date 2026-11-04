import React, { useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import CodeBlock from '@theme/CodeBlock';
import BrowserOnly from '@docusaurus/BrowserOnly';
import ResumeDemo from '@site/src/components/ResumeDemo/ResumeDemo';
import Reveal from '@site/src/components/Reveal/Reveal';
import Heartbeat from '@site/src/components/Heartbeat/Heartbeat';
import styles from './index.module.css';

const HERO_CODE = `const userCreated = collateral<{ id: string; name: string }>();
const userRegistered = collateral<{ userId: string }>();

const registration = neuron({ userRegistered }).dendrite({
    collateral: userCreated,
    response: async (user, axon) => {
        await users.insert(user);
        return axon.userRegistered.createSignal({ userId: user.id });
    },
});

const cns = new CNS([registration, welcomeMail, analytics]);
const run = cns.stimulate(userCreated.createSignal(newUser));
await run.waitUntilComplete();`;

const PILLARS = [
    {
        tag: '01',
        title: 'Isolated units',
        text: 'Each neuron owns one responsibility. Change one and the compiler and the graph show exactly what it affects.',
    },
    {
        tag: '02',
        title: 'Typed and exhaustive',
        text: 'Signals are typed collaterals, and the compiler makes you handle every one you subscribe to. An incomplete flow does not build.',
    },
    {
        tag: '03',
        title: 'Traceable and resumable',
        text: 'Every hop lands in devtools. A running flow persists its frontier and resumes after a restart.',
    },
];

const FRONTEND_PAINS = [
    {
        tag: 'Redux',
        quote: 'Sagas turned into an impenetrable spaghetti mess of actions and events going everywhere… it was impossible to trace what was going on.',
        source: 'a Redux maintainer, Hacker News',
        href: 'https://news.ycombinator.com/item?id=33506626',
        answer: 'In CNStra the flow is the graph: each neuron names what it reacts to and what it emits, and the compiler checks the wiring.',
    },
    {
        tag: 'Redux Toolkit',
        quote: 'Your action handling logic is split across thunks & reducers, and is hard to follow.',
        source: 'Hacker News',
        href: 'https://news.ycombinator.com/item?id=24047649',
        answer: 'One signal starts one stimulation, and its whole chain — async steps included — is one run you can read and replay.',
    },
    {
        tag: 'Atoms',
        quote: 'Currently, the only info about a change is when it occurred.',
        source: 'Jotai issue #931',
        href: 'https://github.com/pmndrs/jotai/issues/931',
        answer: 'The devtools show every hop of a run: which neuron wrote what, from which signal, in which order.',
    },
    {
        tag: 'Effects',
        quote: 'The component (and its children) have to re-render between each set call in the chain… Such code is often rigid and fragile.',
        source: 'react.dev, You Might Not Need an Effect',
        href: 'https://react.dev/learn/you-might-not-need-an-effect',
        answer: 'The steps live in the graph, not in hooks, and a whole turn of it commits to the store in one frame.',
    },
];

const HOMEOSTASIS_CODE = `const cardReceptor = new CNSHomeostatReceptor<[cardId: string], TCard>({
    name: 'card',
    transduce: ([cardId], signal) => api.cards.get(cardId, { signal }),
});

const board = defineCNSHomeostatModel().collection('cards', {
    idOf: (card: TCard) => card.id,
    homeostatReceptor: cardReceptor,
});

const db = new OIMDB();
const { cards } = createCNSOIMDBHomeostatSchema(db, { homeostatModels: { board } }).board;

const cardSchema = exoJsx<{ status: TExoAttrPort; title: TExoTextPort }>($ => (
    <article class="card" data-status={$.status}>{$.title}</article>
));

const cardMachine = composeExoMachine(
    createExoMachine(cardSchema, {
        createInitialState: (_c: TExoDomNode, cardId: string) => ({ cardId }),
    }),
    m => withOIMEffects(m, effect => {
        effect(c => {
            const card = cards.collection.getSlotByKey(c.state.cardId).entity;
            const { status } = cards.homeostasis.getSlotByKey(cards.keyOf(c.state.cardId)).value;
            c.attr(cardSchema.ports.status, card ? 'ready' : status);
            c.text(cardSchema.ports.title, card?.title ?? '');
        });
    })
);`;

const HOMEOSTASIS_BEATS = [
    {
        tag: '01',
        title: 'The read is the request',
        text: 'The first screen that reads an empty card asks the receptor, on the next flush. No hook, no query key, no loading flag to wire.',
    },
    {
        tag: '02',
        title: 'One request, many readers',
        text: 'Every screen reading the same card shares its slot and its request. With a batch transducer, the keys of one turn go out as one request.',
    },
    {
        tag: '03',
        title: 'Quiet when nothing changed',
        text: 'A refetch that answers the same card writes nothing, so nothing redraws. Loading and failure are the key\'s own status, right next to the data.',
    },
];

const USE_CASES = [
    { title: 'Frontend orchestration', text: 'UI events become signals; neurons write the store, queries keep it equal to the server.' },
    { title: 'Backend orchestration', text: 'Services and handlers as one typed graph: order, concurrency, resume after a crash.' },
    { title: 'Backend jobs', text: 'Workers and queue-triggered flows: fan-out, fan-in, concurrency gates.' },
    { title: 'Integrations', text: 'Webhooks and third-party APIs as explicit, testable steps.' },
    { title: 'Pipelines', text: 'Step-by-step transforms with retries, backoff and clear boundaries.' },
    { title: 'Sagas', text: 'Deterministic retries, cancellation and compensation.' },
];

function Hero(): ReactNode {
    const logoRef = useRef<HTMLImageElement>(null);
    const contract = useCallback(() => {
        logoRef.current?.animate(
            [
                { transform: 'scale(1)', filter: 'drop-shadow(0 0 0 transparent)' },
                { transform: 'scale(1.18)', filter: 'drop-shadow(0 0 10px rgba(82, 167, 201, 0.9))' },
                { transform: 'scale(1)', filter: 'drop-shadow(0 0 0 transparent)' },
            ],
            { duration: 320, easing: 'ease-out' }
        );
    }, []);
    return (
        <header className={styles.hero}>
            <div className={styles.glow} aria-hidden="true" />
            <div className={styles.grid} aria-hidden="true" />
            <div className={styles.scanlines} aria-hidden="true" />
            <div className={`container ${styles.heroInner}`}>
                <div className={styles.heroText}>
                    <div className={styles.brand}>
                        <img ref={logoRef} className={styles.brandLogo} src={useBaseUrl('/img/logo.svg')} alt="" aria-hidden="true" />
                        <span className={styles.brandName}>CNStra</span>
                        <span className={styles.brandTag}>v3 · MIT</span>
                    </div>
                    <p className={styles.kicker}>Typed orchestration for TypeScript</p>
                    <h1 className={styles.title}>
                        Every flow is a graph.
                        <br />
                        <span className={styles.accent} data-text="Every run is visible.">
                            Every run is visible.
                        </span>
                    </h1>
                    <p className={styles.subtitle}>
                        Wire your app as neurons and typed signals. The compiler checks the wiring, the engine runs it
                        deterministically, and devtools show every hop of every run as it happens.
                    </p>
                    <div className={styles.buttons}>
                        <Link className="button button--primary button--lg" to="/docs/core/quick-start">
                            Get started
                        </Link>
                        <Link className={styles.ghost} to="/docs/devtools/overview">
                            Open the devtools →
                        </Link>
                    </div>
                    <code className={styles.install}>npm i @cnstra/core</code>
                </div>
                <Reveal className={styles.window} from="right">
                    <div className={styles.windowBar}>
                        <span />
                        <span />
                        <span />
                        <em>registration.ts</em>
                    </div>
                    <CodeBlock language="ts">{HERO_CODE}</CodeBlock>
                </Reveal>
            </div>
            <div className={`container ${styles.heartbeat}`}>
                <BrowserOnly fallback={<div className={styles.heartbeatFallback} />}>{() => <Heartbeat onContraction={contract} />}</BrowserOnly>
            </div>
        </header>
    );
}

function LiveSection(): ReactNode {
    const demoUrl = useBaseUrl('/devtools/?transport=demo');
    return (
        <section className={styles.section}>
            <div className="container">
                <Reveal>
                    <p className={styles.eyebrow}>Live</p>
                    <h2 className={styles.statement}>The real devtools, watching a real engine in your browser.</h2>
                    <p className={styles.lead}>
                        A shop flow of six neurons runs here every couple of seconds, and every fifth card is declined.
                        This is the actual devtools panel, connected to it without a server: open a failed run and press
                        Retry, and it resumes from the neuron that failed.
                    </p>
                </Reveal>
                <Reveal>
                    <div className={styles.window}>
                        <div className={styles.windowBar}>
                            <span />
                            <span />
                            <span />
                            <em>cnstra devtools · demo</em>
                        </div>
                        <iframe className={styles.devtools} src={demoUrl} title="CNStra devtools running a demo shop flow" loading="lazy" />
                    </div>
                </Reveal>
                <div className={styles.links}>
                    <a href={demoUrl} target="_blank" rel="noopener noreferrer">
                        Open it full screen →
                    </a>
                    <Link to="/docs/devtools/overview">Devtools docs →</Link>
                </div>
            </div>
        </section>
    );
}

function ResumeSection(): ReactNode {
    return (
        <section className={styles.section}>
            <div className="container">
                <Reveal>
                    <p className={styles.eyebrow}>Resume</p>
                    <h2 className={styles.statement}>Fail it mid-run. It continues from where it stopped.</h2>
                    <p className={styles.lead}>
                        The run fails inside payment. Its frontier is the work still outstanding, and activating it runs
                        only that branch: the stock is not reserved a second time. Checkpoint the same frontier and it
                        survives a process restart too.
                    </p>
                </Reveal>
                <Reveal>
                    <BrowserOnly fallback={<div className={styles.monitorFallback} />}>{() => <ResumeDemo />}</BrowserOnly>
                </Reveal>
                <div className={styles.links}>
                    <Link to="/docs/advanced/persistence">How resume works →</Link>
                </div>
            </div>
        </section>
    );
}

function Pillars(): ReactNode {
    return (
        <section className={styles.section}>
            <div className="container">
                <div className={styles.pillars}>
                    {PILLARS.map((pillar, index) => (
                        <Reveal key={pillar.tag} className={styles.card} delayMs={index * 120}>
                            <span className={styles.cardTag}>{pillar.tag}</span>
                            <h3 className={styles.cardTitle}>{pillar.title}</h3>
                            <p className={styles.cardText}>{pillar.text}</p>
                        </Reveal>
                    ))}
                </div>
            </div>
        </section>
    );
}

function UseCases(): ReactNode {
    return (
        <section className={styles.section}>
            <div className="container">
                <p className={styles.eyebrow}>Where it fits</p>
                <div className={styles.useCases}>
                    {USE_CASES.map(useCase => (
                        <div key={useCase.title} className={styles.useCase}>
                            <h3 className={styles.useCaseTitle}>{useCase.title}</h3>
                            <p className={styles.cardText}>{useCase.text}</p>
                        </div>
                    ))}
                </div>
                <div className={styles.links}>
                    <Link to="/docs/frontend/sync">Frontend: queries and sync →</Link>
                    <Link to="/docs/backend/overview">Backend overview →</Link>
                    <Link to="/docs/concepts/comparison">CNStra vs Temporal, Zeebe, Conductor →</Link>
                </div>
            </div>
        </section>
    );
}

function FrontendSection(): ReactNode {
    return (
        <section className={styles.section}>
            <div className="container">
                <Reveal>
                    <p className={styles.eyebrow}>Frontend</p>
                    <h2 className={styles.statement}>Click a button. Can you say what happens next?</h2>
                    <p className={styles.lead}>
                        Developers say it in their own words: the answer is spread across reducers, middleware, effects
                        and atoms, and the state manager cannot tell which of them changed a value.
                    </p>
                </Reveal>
                <div className={styles.pains}>
                    {FRONTEND_PAINS.map((pain, index) => (
                        <Reveal key={pain.href} className={styles.card} delayMs={index * 80}>
                            <span className={styles.cardTag}>{pain.tag}</span>
                            <blockquote className={styles.painQuote}>“{pain.quote}”</blockquote>
                            <a className={styles.painSource} href={pain.href} target="_blank" rel="noopener noreferrer">
                                — {pain.source}
                            </a>
                            <p className={styles.cardText}>{pain.answer}</p>
                        </Reveal>
                    ))}
                </div>
                <p className={styles.lead} style={{ marginTop: 28 }}>
                    In CNStra the flow is a graph you can read. A UI event is a signal; each neuron says what it reacts
                    to and what it emits; the compiler checks the wiring, and the devtools show every hop — which neuron
                    wrote what, and in which order. The store stays a store: it holds the data and redraws the screen.
                </p>
                <div className={styles.links}>
                    <Link to="/docs/frontend/oimdb">CNStra & OIMDB →</Link>
                    <Link to="/docs/frontend/sync">Queries and sync →</Link>
                    <Link to="/docs/frontend/exodra">CNStra & Exodra →</Link>
                    <Link to="/docs/frontend/redux-migration">Coming from Redux →</Link>
                </div>
            </div>
        </section>
    );
}

function HomeostasisSection(): ReactNode {
    return (
        <section className={styles.section}>
            <div className="container">
                <Reveal>
                    <p className={styles.eyebrow}>Homeostasis</p>
                    <h2 className={styles.statement}>Read a key. The data is already on its way.</h2>
                    <p className={styles.lead}>
                        Like React Query or a GraphQL client, but with no query hook and no query key: a screen reads a
                        slot of the store, and an empty slot asks for itself. The transport is any async function — REST,
                        GraphQL, a socket — and you choose collection by collection what syncs on its own.
                    </p>
                </Reveal>
                <Reveal className={styles.window}>
                    <div className={styles.windowBar}>
                        <span />
                        <span />
                        <span />
                        <em>card.tsx · Exodra</em>
                    </div>
                    <CodeBlock language="tsx">{HOMEOSTASIS_CODE}</CodeBlock>
                </Reveal>
                <div className={styles.pillars} style={{ marginTop: 20 }}>
                    {HOMEOSTASIS_BEATS.map((beat, index) => (
                        <Reveal key={beat.tag} className={styles.card} delayMs={index * 120}>
                            <span className={styles.cardTag}>{beat.tag}</span>
                            <h3 className={styles.cardTitle}>{beat.title}</h3>
                            <p className={styles.cardText}>{beat.text}</p>
                        </Reveal>
                    ))}
                </div>
                <p className={styles.homeostasisNote}>
                    Built for reads. A write stays your signal: the model's neuron writes the change and invalidates
                    what it touched. The JSX is compiled by the Exodra build plugin.
                </p>
                <div className={styles.links}>
                    <Link to="/docs/frontend/sync">Sync and queries →</Link>
                    <Link to="/docs/frontend/sync#a-synced-domain-model-the-domain-neuron-owns-its-data">A synced domain model →</Link>
                    <Link to="/docs/frontend/exodra">CNStra & Exodra →</Link>
                </div>
            </div>
        </section>
    );
}

function Closing(): ReactNode {
    return (
        <section className={styles.closing}>
            <div className="container">
                <h2 className={styles.closingTitle}>Wire it once. Watch it run.</h2>
                <p className={styles.lead}>Install @cnstra/core, declare a neuron, and stimulate it.</p>
                <div className={styles.pairing}>
                    <p className={styles.pairingLabel}>Recommended together with</p>
                    <div className={styles.pairingItems}>
                        <div className={styles.pairingItem}>
                            <a className={styles.pairingName} href="https://oimdb.org/" target="_blank" rel="noopener noreferrer">
                                OIMDB
                            </a>
                            <p className={styles.cardText}>
                                CNStra decides what happens and in what order. OIMDB holds the data and reacts to it. One
                                line connects them, and every turn of the orchestrator lands in one frame:
                            </p>
                            <code className={styles.pairingCode}>cns.addDrainListener(() =&gt; db.flush());</code>
                            <Link to="/docs/frontend/oimdb">Using CNStra with OIMDB →</Link>
                        </div>
                        <div className={styles.pairingItem}>
                            <a className={styles.pairingName} href="https://exodra.org/" target="_blank" rel="noopener noreferrer">
                                Exodra
                            </a>
                            <p className={styles.cardText}>
                                Exodra draws the screen. An event port of a machine becomes a signal of the CNS, and the
                                screen reads what the neurons wrote into OIMDB:
                            </p>
                            <code className={styles.pairingCode}>receptor(Ports.RENAME, deckRenamed, payloadOf);</code>
                            <Link to="/docs/frontend/exodra">Using CNStra with Exodra →</Link>
                        </div>
                    </div>
                </div>
                <div className={`${styles.buttons} ${styles.buttonsCentered}`}>
                    <Link className="button button--primary button--lg" to="/docs/core/quick-start">
                        Get started
                    </Link>
                    <Link className={styles.ghost} to="/docs/core/overview">
                        How it works →
                    </Link>
                </div>
            </div>
        </section>
    );
}

export default function Home(): ReactNode {
    return (
        <Layout
            title="Every flow is a graph. Every run is visible."
            description="CNStra: typed, deterministic orchestration for TypeScript. Neurons and typed signals, compiler-checked wiring, resumable runs, and devtools that show every hop."
        >
            <div className={styles.page}>
                <Hero />
                <main>
                    <LiveSection />
                    <ResumeSection />
                    <Pillars />
                    <UseCases />
                    <FrontendSection />
                    <HomeostasisSection />
                    <Closing />
                </main>
            </div>
        </Layout>
    );
}

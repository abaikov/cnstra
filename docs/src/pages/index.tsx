import React from 'react';
import type { ReactNode } from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import CodeBlock from '@theme/CodeBlock';
import BrowserOnly from '@docusaurus/BrowserOnly';
import RunMonitor from '@site/src/components/RunMonitor/RunMonitor';
import ResumeDemo from '@site/src/components/ResumeDemo/ResumeDemo';
import Reveal from '@site/src/components/Reveal/Reveal';
import styles from './index.module.css';

const HERO_CODE = `const userCreated = cnsCollateral<{ id: string; name: string }>();
const userRegistered = cnsCollateral<{ userId: string }>();

const registration = cnsNeuron({ userRegistered }).dendrite({
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

const USE_CASES = [
    { title: 'Backend jobs', text: 'Workers and queue-triggered flows: fan-out, fan-in, concurrency gates.' },
    { title: 'Integrations', text: 'Webhooks and third-party APIs as explicit, testable steps.' },
    { title: 'Pipelines', text: 'Step-by-step transforms with retries, backoff and clear boundaries.' },
    { title: 'Sagas', text: 'Deterministic retries, cancellation and compensation.' },
];

function Hero(): ReactNode {
    return (
        <header className={styles.hero}>
            <div className={styles.glow} aria-hidden="true" />
            <div className={styles.grid} aria-hidden="true" />
            <div className={`container ${styles.heroInner}`}>
                <div className={styles.heroText}>
                    <div className={styles.brand}>
                        <img className={styles.brandLogo} src={useBaseUrl('/img/logo.svg')} alt="" aria-hidden="true" />
                        <span className={styles.brandName}>CNStra</span>
                        <span className={styles.brandTag}>v3 · MIT</span>
                    </div>
                    <p className={styles.kicker}>Typed orchestration for TypeScript</p>
                    <h1 className={styles.title}>
                        Every flow is a graph.
                        <br />
                        <span className={styles.accent}>Every run is visible.</span>
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
        </header>
    );
}

function LiveSection(): ReactNode {
    return (
        <section className={styles.section}>
            <div className="container">
                <Reveal>
                    <p className={styles.eyebrow}>Live</p>
                    <h2 className={styles.statement}>This is the real engine, running in your browser.</h2>
                    <p className={styles.lead}>
                        An order flow of four neurons: inventory, then payment, then the receipt and the shipment in
                        parallel. Watch the hops light up, or decline a card and see where the run stops.
                    </p>
                </Reveal>
                <Reveal>
                    <BrowserOnly fallback={<div className={styles.monitorFallback} />}>{() => <RunMonitor />}</BrowserOnly>
                </Reveal>
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
                    <Link to="/docs/backend/overview">Backend overview →</Link>
                    <Link to="/docs/concepts/comparison">CNStra vs Temporal, Zeebe, Conductor →</Link>
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
                    <a className={styles.pairingName} href="https://oimdb.org/" target="_blank" rel="noopener noreferrer">
                        OIMDB
                    </a>
                    <p className={styles.cardText}>
                        CNStra decides what happens and in what order. OIMDB holds the data and reacts to it. One line
                        connects them, and every turn of the orchestrator lands in one frame:
                    </p>
                    <code className={styles.pairingCode}>cns.addDrainListener(() =&gt; db.flush());</code>
                    <Link to="/docs/frontend/oimdb">Using CNStra with OIMDB →</Link>
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
                    <Closing />
                </main>
            </div>
        </Layout>
    );
}

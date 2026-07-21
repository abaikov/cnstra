import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';

export default function Home(): JSX.Element {
    return (
        <Layout
            title="CNStra Documentation"
            description="Workflow / orchestration engine for TypeScript (embeddable, deterministic, in-memory)"
        >
            <header className="hero hero--primary">
                <div className="container">
                    <Heading as="h1" className="heroTitleRed">
                        CNStra
                    </Heading>
                    <p className="hero__subtitle">
                        A typed orchestration engine for your app's logic: model
                        flows as an explicit graph of isolated units — run them
                        deterministically, trace and resume them, decoupled from
                        storage and I/O. On the backend and the frontend.
                    </p>
                    {/* removed extra tagline */}
                    <div>
                        <Link
                            className="button button--secondary button--lg"
                            to="/docs/core/quick-start"
                        >
                            Get Started
                        </Link>
                    </div>
                </div>
            </header>
            <main>
                <section className="container margin-vert--lg">
                    <div className="row">
                        <div className="col col--4">
                            <h3>Isolated units</h3>
                            <p>
                                Each neuron owns one responsibility. Change one
                                and the compiler + graph show exactly what it
                                affects — no hidden coupling.
                            </p>
                        </div>
                        <div className="col col--4">
                            <h3>Typed &amp; exhaustive</h3>
                            <p>
                                Signals are typed collaterals, and the compiler
                                forces you to handle every one you subscribe to.
                                You can't ship an incomplete flow.
                            </p>
                        </div>
                        <div className="col col--4">
                            <h3>Traceable &amp; durable</h3>
                            <p>
                                Trace and replay every step in devtools — and
                                persist a running flow to resume it after a
                                restart.
                            </p>
                        </div>
                    </div>
                </section>
                <section className="container margin-vert--lg">
                    <div className="row">
                        <div className="col col--3">
                            <h3>Backend jobs</h3>
                            <p>
                                Orchestrate workers and queue-triggered flows
                                (fan-out/fan-in, concurrency gates).
                            </p>
                        </div>
                        <div className="col col--3">
                            <h3>Sync & integrations</h3>
                            <p>
                                Webhooks and third-party APIs with explicit,
                                testable steps.
                            </p>
                        </div>
                        <div className="col col--3">
                            <h3>ETL & pipelines</h3>
                            <p>
                                Step-by-step transforms with retries/backoff and
                                clear boundaries.
                            </p>
                        </div>
                        <div className="col col--3">
                            <h3>Retries & sagas</h3>
                            <p>
                                Deterministic retry patterns, cancellation, and
                                compensation flows.
                            </p>
                        </div>
                    </div>
                    <div className="margin-top--md">
                        <Link to="/docs/backend/overview">Backend overview</Link>
                        {' · '}
                        <Link to="/docs/concepts/comparison">
                            CNStra vs Temporal/Zeebe/Conductor
                        </Link>
                    </div>
                </section>
            </main>
        </Layout>
    );
}

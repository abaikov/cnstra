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
                        Workflow / orchestration engine for building predictable,
                        type-safe pipelines.
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
                            <h3>Composable</h3>
                            <p>
                                Build complex flows from small, testable units
                                (neurons, signals, queues).
                            </p>
                        </div>
                        <div className="col col--4">
                            <h3>Type-Safe</h3>
                            <p>
                                First-class TypeScript support across core,
                                devtools, and React bindings.
                            </p>
                        </div>
                        <div className="col col--4">
                            <h3>Observable</h3>
                            <p>
                                Devtools and visual graph help inspect and debug
                                neuron networks.
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

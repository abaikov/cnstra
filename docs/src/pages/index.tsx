import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';

export default function Home(): JSX.Element {
    return (
        <Layout
            title="CNStra Documentation"
            description="Central Nervous System for apps"
        >
            <header className="hero hero--primary">
                <div className="container">
                    <Heading as="h1" className="heroTitleRed">
                        CNStra
                    </Heading>
                    <p className="hero__subtitle">
                        Central Nervous System for building predictable,
                        reactive pipelines.
                    </p>
                    <div>
                        <Link
                            className="button button--secondary button--lg"
                            to="/docs/getting-started/quickstart"
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
            </main>
        </Layout>
    );
}

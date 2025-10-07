---
id: oimdb-app
title: Build a Small OIMDB App
sidebar_label: OIMDB App
slug: /examples/oimdb-app
---

In this tutorial, you will build a small search-style UI that uses OIMDB as a reactive in-memory database for derived state, and CNStra for orchestration and cancellation.

## Prerequisites

- React 18
- `@cnstra/core`, `@cnstra/react`
- `@oimdb/core`, `@oimdb/react`

## 1) Define an OIMDB schema

```ts
import { OIMDatabase, OIMReactiveIndexManual } from '@oimdb/core';

export type Recent = { id: string; q: string; at: number };
export type Result = { id: string; q: string; title: string };

export const db = new OIMDatabase({
  recent: {
    pk: 'id',
    indexes: {
      byTimeDesc: new OIMReactiveIndexManual<Recent, number>({ name: 'byTimeDesc', key: r => -r.at }),
    },
  },
  results: {
    pk: 'id',
    indexes: {
      byQuery: new OIMReactiveIndexManual<Result, string>({ name: 'byQuery', key: r => r.q }),
    },
  },
});
```

## 2) A neuron to run a search (abortable)

```ts
import { createNeuron } from '@cnstra/core';

// Pretend this queries a remote or local dataset
async function fetchResults(q: string): Promise<{ title: string }[]> {
  await new Promise(r => setTimeout(r, 250));
  const all = ['Alpha', 'Beta', 'Gamma', 'Delta'];
  return all.filter(x => x.toLowerCase().includes(q.toLowerCase())).map(title => ({ title }));
}

export const searchNeuron = createNeuron<string, { title: string }[]>(async ({ signal, context }) => {
  const res = await fetchResults(signal);
  return res;
});
```

## 3) Wire UI with abort + persist into OIMDB

```tsx
import { useNeuron } from '@cnstra/react';
import { useSelectEntitiesByIndexKey } from '@oimdb/react';
import { db } from './db';

const EMPTY: any[] = [];

export function Search() {
  const [results, stimulate] = useNeuron(searchNeuron);
  const ac = React.useRef<AbortController>();
  const [q, setQ] = React.useState('');

  function onChange(next: string) {
    setQ(next);
    ac.current?.abort();
    ac.current = new AbortController();
    stimulate(next, { abortSignal: ac.current.signal });
  }

  React.useEffect(() => {
    if (!q || !results) return;
    db.tables.recent.collection.upsertOne({ id: `${Date.now()}-${q}`, q, at: Date.now() });
    results.forEach((r, i) => db.tables.results.collection.upsertOne({ id: `${q}-${i}`, q, title: r.title }));
  }, [q, results]);

  const recent = useSelectEntitiesByIndexKey(db.tables.recent, 'byTimeDesc', 0) || EMPTY;
  const cached = useSelectEntitiesByIndexKey(db.tables.results, 'byQuery', q) || EMPTY;

  return (
    <div>
      <input placeholder="Type to search" onChange={e => onChange(e.target.value)} />

      <h4>Results</h4>
      <ul>
        {(results || cached).map(r => <li key={r.title}>{r.title}</li>)}
      </ul>

      <h4>Recent</h4>
      <ol>
        {recent.map(r => <li key={r.id}>{r.q}</li>)}
      </ol>
    </div>
  );
}
```

You now have a responsive, cancellable flow with a queryable, reactive cache powered by OIMDB.


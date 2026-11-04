---
id: react-patterns
title: React Patterns with CNStra
sidebar_label: React Patterns
slug: /frontend/react-patterns
---

Common patterns to use CNStra from React.

```ts setup
import { useEffect, useMemo, useRef } from 'react';
import { collateral } from '@cnstra/core';
import { useCNS } from '@cnstra/react';

const userRequested = collateral<{ userId: string }>();
const searchRequested = collateral<string>();
```

## Stimulate on mount or on deps change

```tsx
function UserProfile({ userId }: { userId: string }) {
  const cns = useCNS();
  useEffect(() => {
    cns.stimulate(userRequested.createSignal({ userId }));
  }, [cns, userId]);
  return null;
}
```

## Keep UI responsive with abort

Use the `AbortSignal` supported by CNStra to cancel in-flight runs.

```tsx
function SearchBox() {
  const cns = useCNS();
  const controller = useRef<AbortController | null>(null);

  function onSearch(q: string) {
    controller.current?.abort();
    controller.current = new AbortController();
    cns.stimulate(searchRequested.createSignal(q), { abortSignal: controller.current.signal });
  }

  return <input onChange={e => onSearch(e.target.value)} />;
}
```

## Derive UI lists via OIMDB

Use OIMDB for queryable derived state (dashboards, analytics) and subscribe via hooks. Build an index once over the collection, then read it by key: the hook takes the index itself and re-renders when its bucket changes.

```tsx
import { OIMDB, createOIMEntitySlotCollectionStoreAggregate, createOIMSlotCollectionIndexStoreAggregate } from '@oimdb/core';
import { useOIMEntitiesByKey } from '@oimdb/react';

type TLogEntry = { id: string; type: string; message: string };

const db = new OIMDB();
const logs = createOIMEntitySlotCollectionStoreAggregate<TLogEntry>(db);
const logsByType = createOIMSlotCollectionIndexStoreAggregate(logs, { columns: ['type'] });

function WarningList() {
  const warnings = useOIMEntitiesByKey(logsByType, 'warning');
  return <ul>{warnings.map(entry => <li key={entry.id}>{entry.message}</li>)}</ul>;
}
```

## Testing

- Render components inside `CNSProvider` with a CNS built from test neurons
- Prefer unit tests for neurons and a smaller set of integration tests for flows

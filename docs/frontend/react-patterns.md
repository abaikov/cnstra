---
id: react-patterns
title: React Patterns with CNStra
sidebar_label: React Patterns
slug: /frontend/react-patterns
---

Common patterns to use CNStra from React.

## Stimulate on mount or on deps change

```tsx
const [result, stimulate] = useNeuron(myNeuron);
useEffect(() => {
  stimulate({ userId });
}, [userId]);
```

## Keep UI responsive with abort

Use the `AbortSignal` supported by CNStra to cancel in-flight runs.

```tsx
const controller = useRef<AbortController>();
const [data, stimulate] = useNeuron(searchNeuron);

function onSearch(q: string) {
  controller.current?.abort();
  controller.current = new AbortController();
  stimulate(q, { abortSignal: controller.current.signal });
}
```

## Derive UI lists via OIMDB

Use OIMDB for queryable derived state (dashboards, analytics) and subscribe via hooks. Build an index once, then read it reactively with the matching hook (index hooks take the **index object**, not a string name).

```tsx
import { useSelectEntitiesByIndexKeySetBased } from '@oimdb/react';

// logs = createOIMCollectionKit<LogEntry, string>(queue, { selectPk: l => l.id });
// Derived set-based index keyed by the entry's `type` field:
const logsByType = logs.indexFactory.derivedSetIndex(log => log.type);

function WarningList() {
  const items =
    useSelectEntitiesByIndexKeySetBased(logs.collection, logsByType, 'warning') ?? [];
  return <ul>{items.map(l => l && <li key={l.id}>{l.message}</li>)}</ul>;
}
```

## Error and loading states

```tsx
const [user, stimulate, status] = useNeuron(fetchUserNeuron);
// status: { loading: boolean, error?: unknown }
```

## Testing

- Mock `useNeuron` outputs for components
- Prefer unit tests for neurons and a smaller set of integration tests for flows

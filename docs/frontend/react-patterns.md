---
id: react-patterns
title: React Patterns with CNStra
sidebar_label: React Patterns
slug: /frontend/react-patterns
---

Common patterns to use CNStra from React.

```ts setup
import { useEffect, useMemo, useRef } from 'react';
import { cnsCollateral } from '@cnstra/core';
import { useCNS } from '@cnstra/react';

const userRequested = cnsCollateral<{ userId: string }>();
const searchRequested = cnsCollateral<string>();
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

Use OIMDB for queryable derived state (dashboards, analytics) and subscribe via hooks. Build an index once, then hold its bucket and read it reactively with the hooks (they take the **index store slot**, not a string name).

```tsx
import { OIMDB, createOIMEntityContentService, createOIMSlotCollectionIndexService, createOIMSlotCollectionService } from '@oimdb/core';
import { useOIMSlotsByKeys, useOIMValue } from '@oimdb/react';

type TLogEntry = { id: string; type: string; message: string };

const db = new OIMDB();
const logService = createOIMSlotCollectionService({ slotContentService: createOIMEntityContentService<TLogEntry>() });
const logs = logService.createStoreSlot(db);
// Derived index keyed by the entry's `type` field:
const logsByTypeService = createOIMSlotCollectionIndexService({ entityService: logService, columns: ['type'] });
const logsByType = logsByTypeService.createIndexStoreSlot(logs);

function WarningList() {
  const [warnings] = useOIMSlotsByKeys(logsByType, ['warning']);
  const items = useOIMValue(useMemo(() => ({
    sourceSlots: [warnings],
    derive: () => Array.from(logsByTypeService.slotContentService.getBucketMemberSlots(warnings), slot => slot.entity),
  }), [warnings]));
  return <ul>{items.map(l => l && <li key={l.id}>{l.message}</li>)}</ul>;
}
```

## Testing

- Render components inside `CNSProvider` with a CNS built from test neurons
- Prefer unit tests for neurons and a smaller set of integration tests for flows

---
id: react
title: React Integration
sidebar_label: React
slug: /examples/react
---

Use `@cnstra/react` to bind neurons to components.

```tsx
import { useNeuron } from '@cnstra/react';
import { fetchUser } from '../concepts/core-primitives';

export function UserName({ userId }: { userId: string }) {
  const [user, stimulate] = useNeuron(fetchUser);

  React.useEffect(() => {
    stimulate({ userId });
  }, [userId]);

  return <span>{user?.userName ?? 'Loading...'}</span>;
}
```

Features:
- Hooks to stimulate neurons
- Suspense-friendly patterns
- Strong typing end-to-end

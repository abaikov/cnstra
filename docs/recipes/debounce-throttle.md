---
id: debounce-throttle
title: "Debounce & Throttle"
sidebar_label: Debounce & Throttle
slug: /recipes/debounce-throttle
---

Use UI-layer strategies with AbortController or custom gates.

```ts
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: AbortController | undefined;

function debouncedStimulate(input: string) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    inFlight?.abort();
    inFlight = new AbortController();
    cns.stimulate(search.createSignal(input), { abortSignal: inFlight.signal });
  }, 300);
}
```

For throttle, guard calls in a time window or use queue limits.

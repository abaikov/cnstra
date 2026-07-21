---
id: benchmark
title: React State Management Benchmark - Performance Comparison
sidebar_label: Benchmark
slug: /frontend/benchmark
description: Benchmark of Cnstra + OIMDB vs MobX, Effector, Zustand, and Redux Toolkit across three planes — React throughput (production build), the pure data layer, and steady-state memory. In our setup, fine-grained stores tie under React; the main divide is fine vs coarse; OIMDB/Cnstra measured fastest on the data layer and lightest in memory. Numbers are a single-machine snapshot — treat them as directional.
keywords: [React state management benchmark, performance comparison, Cnstra, OIMDB, MobX, Effector, Zustand, Redux Toolkit, fine-grained reactivity, data layer benchmark]
---

## Overview

We compared **Cnstra + OIMDB** against **MobX**, **Effector**, **Zustand**, and **Redux Toolkit**. These are our results on one machine with the library versions we tested; read them as directional, not as universal rankings. The summary up front:

- **Among fine-grained (per-key) stores, React's commit cost dominates and they effectively tie** at ~33–36 µs/update. The 1–3 µs spread between them did **not reproduce** across our runs — treat it as a coin flip.
- **The clearest difference we saw is fine-grained vs coarse.** Coarse stores (copy the whole record + re-run all selectors per update) landed at 1230–5430 µs/update — **~35–160× slower** in our runs — and React does *not* hide this.
- **On the pure data layer (no React), OIMDB/Cnstra measured fastest** (0.25–0.48 µs/update), roughly 2–3× faster than MobX in our runs, while coarse stores were 95–302 µs.
- **On memory, Cnstra/OIMDB had the lightest footprint we measured** (25.8–28.1 MB steady-state). Atomic Effector was ~3.5× heavier (89.7 MB) — the price of a store + event per entity.

**🔗 [Interactive Benchmark Results](https://abaikov.github.io/cnstra-oimdb-bench/)** | **📦 [Benchmark Source Code](https://github.com/abaikov/cnstra-oimdb-bench)**

## Three measurement planes (and why)

The three planes answer different questions, so we report all of them:

- **React throughput (production build)** — the cost of one update in a real React app (`flushSync`, no frame floor). **Production build only** (`vite build` + `preview`): a dev build of React adds ~2× overhead (`jsxDEV`/validation) and distorts everything.
- **Data-layer micro (no React)** — the pure cost of a store update: 1 subscriber per entity, `notify` confirms delivery.
- **Steady-state memory** — heap after GC in the production app, with an identical DOM (50,162 nodes for every adapter), so the difference is the store layer, not the view.

## Table 1 — React throughput, production (µs/update, lower is better)

1500 components, best-of-N.

| Adapter | µs/update | upd/s | re-renders/update |
|---|---:|---:|---:|
| MobX (deep/in-place) | 33.0 | 30,300 | 1 |
| MobX (ids-based) | 33.3 | 30,060 | 1 |
| Oimdb (no cnstra) | 33.4 | 29,940 | 1 |
| Cnstra + Oimdb (in-place) | 33.9 | 29,470 | 1 |
| Cnstra + Oimdb (ids-based) | 34.2 | 29,210 | 1 |
| Effector (atomic stores) | 36.1 | 27,700 | 1 |
| *— tier boundary —* | | | |
| Effector (ids-based) | 1,230 | 813 | 1 |
| Zustand (ids-based) | 2,372 | 420 | 1 |
| Redux Toolkit (ids-based) | 5,430 | 184 | 1 |

The top six (all **fine-grained**) are within noise of each other. The bottom three (all **coarse**) are ~35–160× slower — a gap large enough that it held consistently across our runs.

## Table 2 — Data layer, no React (µs/update)

1 subscriber per entity; `notify = 200000` for all.

| Layer | µs/update |
|---|---:|
| oimdb in-place upsert+flush | 0.25 |
| oimdb merge upsert+flush | 0.34 |
| cnstra → oimdb (full stimulate) | 0.48 |
| mobx deep in-place + reaction | 0.67 |
| mobx map.set + reaction | 0.74 |
| effector atomic + watch | 0.89 |
| zustand setState + N selectors | 95 |
| effector record + useStoreMap | 248 |
| redux dispatch + N selectors | 302 |

This is the one plane where fine-grained stores separate at all — and OIMDB/Cnstra came out ahead in our runs. Note that adding the full Cnstra orchestration on top of OIMDB (0.34 → 0.48 µs) read as a small, fixed cost, not a multiplier.

## Table 3 — Steady-state heap, production, after GC (MB, lower is better)

Identical DOM across all adapters (50,162 nodes), so this isolates the store layer.

| Adapter | heap MB |
|---|---:|
| Cnstra + Oimdb (in-place) | 25.8 |
| Cnstra + Oimdb (ids-based) | 28.1 |
| Oimdb (no cnstra) | 28.1 |
| Zustand (ids-based) | 30.2 |
| MobX (ids-based) | 31.5 |
| MobX (deep/in-place) | 37.4 |
| Redux Toolkit (ids-based) | 37.7 |
| Effector (ids-based) | 42.0 |
| Effector (atomic stores) | 89.7 |

Memory is where the speed trade-offs become visible:

- **Cnstra/OIMDB were the lightest we measured** (25.8–28.1 MB). The in-place updater also avoids per-update allocations, so it was the leanest in this run.
- **Atomic Effector — 89.7 MB, ~3.5× heavier than anyone else.** That's the cost of a store + event *per entity*: thousands of Effector units. Atomic Effector buys its fast-tier update speed (Table 1/2) **with memory** — name this trade-off explicitly before reaching for it.
- **MobX deep (37.4 MB) is heavier than MobX ids (31.5 MB)** — deep observables wrap every field (proxies/atoms), so the "native" idiom costs more memory than the normalized one.
- **Redux / Effector-ids sit at ~38–42 MB.**

## What the variants are (not duplicates)

Several variants per framework are **different data-access idioms**, not repeats:

- **Cnstra + Oimdb (ids-based)** — the default: a merge updater (each upsert creates a new entity object) + `useSyncExternalStore` hooks. "Like everyone else."
- **Cnstra + Oimdb (in-place)** — `createInPlaceEntityUpdater` (mutate the object in place, no allocation) + `*Signal` hooks (re-render by key subscription, read the mutated object). Fastest on the data layer.
- **Oimdb (no cnstra)** — pure OIMDB, writing directly to the collection without CNS orchestration. Included to isolate Cnstra's cost (34.2 vs 33.4 → orchestration ≈ noise).
- **MobX (ids-based)** — `observable.map`, replace the whole entity, `useObserver` per hook (normalized store, "like everyone else").
- **MobX (deep/in-place)** — idiomatic MobX: deep observables, mutate a field in place, components in `observer()` (read observables directly in JSX). MobX's best case.
- **Effector (ids-based)** — idiomatic: `Record` stores + `useStoreMap`, incremental indexes. Coarse (copies the `Record` per update).
- **Effector (atomic stores)** — a store + event per entity (maximally granular). Fast tier.
- **Zustand** — single store, manual normalization, per-component shallow selectors. Coarse.
- **Redux Toolkit** — `createEntityAdapter` + memoized selectors (Immer). Coarse.

## Findings

### 1. React noise drowns out good frameworks

In production React, every **fine-grained** (per-key) store — OIMDB, Cnstra, both MobX variants, atomic Effector — collapses into 33–36 µs. The 1–3 µs spread does not reproduce: paired runs gave a coin flip (OIMDB faster in 4/10, MobX in 6/10, median +1 µs). **The cost of the React commit itself dominates and zeroes out the differences between store layers** — their React numbers carry no signal.

### 2. Only two things are distinguishable

- **Fine vs coarse.** Coarse stores (Effector-ids, Zustand, Redux) copy the entire record and re-run all N selectors per update → 1230 / 2372 / 5430 µs, **35–160× slower**. React does **not** hide this.
- **The data layer (no React).** There the store cost shows: OIMDB/Cnstra measured fastest (0.25–0.48 µs), ~2–3× faster than MobX (0.67–0.74) in our runs, and coarse stores were 95–302 µs. This is the one plane where fine-grained frameworks separate — and OIMDB came out ahead here.

### 3. Re-renders/update = 1 for everyone

All frameworks are equally precise about React invalidation. The difference is purely the **CPU cost of the update**, not the volume of rendering.

## What this means in practice

- If you're already using a **fine-grained** store (OIMDB/Cnstra, MobX, atomic Effector), don't expect a React-visible speedup from switching between them — React dominates. Choose on ergonomics, architecture, and the data-layer cost (which matters off the render path: workers, sync engines, large in-memory derivations).
- The decision that **does** move React throughput by orders of magnitude is **fine-grained vs coarse**. Coarse normalization (copy-the-record + re-run-all-selectors) is what costs 35–160×.
- In our setup Cnstra + OIMDB sat in the **top tier under React**, measured **fastest on the data layer**, and had the **lightest memory footprint** — with the orchestration overhead showing up as noise. (One machine, fixed versions — your mileage may vary.)
- **Watch the memory trade-off.** Granularity isn't free: atomic Effector wins a fast update tier but pays ~3.5× the heap (a unit per entity), and MobX's deep/native idiom costs more memory than its normalized one. Speed, memory, and ergonomics pull in different directions — pick deliberately.

## Why coarse stores are slow

Coarse stores (Zustand/Redux/Effector-ids as benchmarked) update a single normalized record (`Record<ID, T>` or equivalent) and then re-run every subscribing selector to find what changed. Cost scales with the number of subscribers/selectors, not with the number of changed entities. OIMDB instead maintains `Map<Key, Set<PK>>` indexes incrementally and notifies only the affected keys, so an update touches O(changed) work regardless of how many components are mounted.

## Methodology

- **React plane**: production build (`vite build` + `preview`), `flushSync` per update (no frame floor / no batching across updates), 1500 mounted components, best-of-N with warmup.
- **Data-layer plane**: no React; 1 subscriber per entity; `notify = 200000` across all adapters to confirm delivery.
- **Memory plane**: steady-state heap measured after GC in the production build, with an identical DOM (50,162 nodes) across all adapters so the delta reflects the store layer, not the view.
- All adapters ran on the **same single machine and environment**, with the library versions available at the time. We did **not** test across different hardware, OS, browsers, or library versions, so treat the absolute numbers as a snapshot rather than a general result. The large gaps (fine-vs-coarse, the memory spread) are big enough that we'd expect them to hold directionally elsewhere, but we haven't verified that. Sub-3 µs differences inside the fine-grained tier are within noise and should not be read as rankings.

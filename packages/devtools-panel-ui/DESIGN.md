# CNStra DevTools Panel — Design Decisions

This document justifies every element of the redesigned DevTools panel: what it
is, where it lives, why it's there, and how a user flows through it. It also
records what was **removed** and why. The redesign answers the owner's core
complaint — the panel was cluttered and confusing — by collapsing three-plus
columns and two useless views into **one coherent surface: an observability /
runs viewer** (the mental model is Sentry's issues list or a CI runs list).

---

## 1. What the tool actually is

The panel observes a live CNStra network: every stimulation ("run") that flows
through the neuron graph, its per-step waterfall, and aggregate throughput. The
job is **"find a run, understand it, act on it (retry / clone)."** That is a
runs viewer. Everything below is designed around that single job. There is no
separate "app" to configure, no topology to author — so there is no reason for a
landing page, a sidebar of debug widgets, or a graph canvas.

## 2. Information architecture (the final layout)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TOP BAR (one row):  🧠 CNStra ● app-name │ search │ Runs Waterfall Chart │
│                     [metric input — chart only]      ~ heartbeat ~   N runs │
├───────────────┬──────────────────────────────────────────────────────────┤
│ FACET RAIL    │  MAIN AREA                                                 │
│ (~200px)      │  active-filter chips (only when filters are set)           │
│  Collaterals  │  ┌────────────────────────────────────────────────────┐   │
│  | Neurons    │  │  Runs list  ·  Waterfall  ·  Chart                  │   │
│  STATUS chips │  │                                                     │   │
│  JOB TYPE chips│ │                                                     │   │
└───────────────┴──────────────────────────────────────────────────────────┘
```

Two regions only: **one top bar** and **one secondary column** (the facet rail).
The rest is the main viewing area. This is the whole panel.

---

## 3. Every element, and why it's placed where it is

### Top bar (single row) — `ExplorerPage.tsx`

The top bar carries identity, global search, mode selection, and vital signs in
a single glanceable strip. One row, left-to-right in order of "who/where →
what → how":

- **`🧠 CNStra` brand + connection dot + app name** (far left). This is the
  *identity + health* block that used to be a whole sidebar card. It answers "am
  I connected, and to what?" A colored dot (green = connected, yellow =
  connecting, red = disconnected) plus the connected app's name, both pulled
  from the existing `socket.connectionStatus` and `selection` state. Folding it
  into the bar reclaims the entire left column the sidebar wasted. The brand uses
  the **branded pixel font**; the app name uses the clean body font.
- **Search box.** Free-text `stimulationId` search — the fastest path to a known
  run. Placed immediately after identity because "search" is the primary verb of
  a runs viewer. Debounced; drives `query.text`.
- **View tabs — `Runs · Waterfall · Chart`.** The three modes of looking at
  runs: the list, a single run's steps, and aggregate throughput. The **active
  tab is bright yellow** (owner ask) so the current mode is unmistakable.
- **Metric-path input — shown only when Chart is active.** It's meaningless in
  Runs/Waterfall, so it doesn't occupy the bar there (it collapses to nothing).
  This kills the "wasteful near-empty" feeling the owner hated.
- **Heartbeat ECG monitor** (`HeartbeatMonitor.tsx`, unchanged). The panel's
  vital sign — one PQRST beat per new run. Positioned right-of-center as an
  ambient "is anything happening?" indicator that needs no reading.
- **`N runs` count** (far right, **bright yellow, bold**). The single most
  important scalar in a runs viewer — how many runs match the current filter.
  Yellow + bold makes it the loudest number on screen.

### Facet rail (~200px, the ONLY secondary column) — `ExplorerPage.tsx`

This is the **primary filter/navigation**, not decoration. It's deliberately
compact and allowed to look sparse when there are few facet values — that is
correct behavior for a tight rail, not a bug, and it never becomes a giant empty
column.

- **`Collaterals | Neurons` lens switch** (top). Flips the facet dimension
  between "entry collateral (job type)" and "neuron that was activated" — the two
  ways you slice runs. Active side = violet.
- **`STATUS` chips.** Filter by run status (completed / failed / running). Each
  chip shows its count. Section label is a **pixel-font heading in bright
  yellow**.
- **`JOB TYPE` chips** (labeled `Neuron` under the Neurons lens). The dominant
  navigation axis — "show me the `userLogin` runs." Also count-bearing, click to
  filter, click again to clear.

Chips are the whole filter model: clicking one patches the query, refetches, and
updates the URL (shareable / back-forwardable).

### Main area

- **Active-filter chips** (thin strip at the top of the main area). A removable
  breadcrumb of currently-applied filters. It renders **only when filters are
  set** (`display:none` otherwise) so it never wastes a row. This replaces the
  old always-present filter clutter.
- **Runs list** (default). A windowed, virtualized list (only visible rows in the
  DOM — usable at 20k+ runs). Each row: a status dot, the entry collateral name,
  time, hop count, and status. Click a row → its Waterfall. This is the home
  screen of the tool.
- **Waterfall.** The selected run's attempts and per-step tasks (neuron ·
  dendrite → output), with errors highlighted. Hosts the **Retry** (resume a
  failed run's frontier) and **Clone** (fresh run from entry) actions, plus their
  feedback toast (below).
- **Chart.** See §5.

---

## 4. Fonts (owner: "branded font for headings only")

- The global body/data font is now a **clean, readable terminal mono**
  (`--font-body`: JetBrains Mono / SF Mono / Menlo / Consolas …), antialiased.
- The **branded pixel font** (`Px437_IBM_Conv`, `--font-primary`) is applied
  **only** to `h1–h4`, the `.brand`, and section headings (`.exp-heading`) — via
  CSS selectors in `theme.css`, not inline per element. It renders crisp
  (`font-smoothing: none`) while body text stays smooth.

So: brand, `STATUS` / `JOB TYPE` labels, and the `THROUGHPUT` chart title are
pixel-font; every list row, chip, value, and input is clean mono. The pixel font
is now a deliberate accent, not the default.

## 5. Chart — from "giant unlabeled bars" to a legible throughput chart

The old chart was full-height ambiguous stacked slabs. The new Chart
(`chartView`) is a proper small-multiple throughput histogram:

- **Title** (`THROUGHPUT`, pixel-font heading) + subtitle (`runs per bucket ·
  peak N`).
- **Legend**: green = completed, red = failed, purple = running (or, in metric
  mode, yellow = the summed payload metric).
- **Y-axis scale**: the peak value at the top, `0` at the bottom.
- **Faint gridlines** at 25 / 50 / 75 / 100% for reference.
- **Thin, centered bars with small gaps** (each bar capped in width, its slot
  centering it) instead of edge-to-edge slabs.
- **Hover tooltips** (`title`) on every bar: time + completed/failed/running
  breakdown.
- **X-axis**: first and last bucket timestamps.
- A **Count / Metric toggle** appears only once a metric path is set; the input
  itself lives in the top bar (chart-only).

Now a viewer can actually read "how many runs, of what outcome, when."

## 6. Map — REMOVED (decision + justification)

**Decision: removed the Map view entirely.**

The Map was a proportional activation heat-map: tiles per neuron / entry
collateral, sized and colored by run count, click-to-filter. Every one of those
properties is **already provided by the facet rail**, which shows the exact same
dimension, the exact same counts (`name · count`), and filters on the exact same
click. The Map was therefore a **second, noisier rendering of data the left rail
already shows** — pure redundancy, and the owner found it actively confusing
("еще хуже, я вообще не понимаю что происходит").

The owner's instruction was explicit: make it genuinely useful *or* remove it.
Making it "useful" would mean either duplicating the facet rail (no new
information) or inventing a relationship the data doesn't have (the tiles have no
spatial meaning — position is just flex-wrap order, so "heat map" implies a
structure that isn't there). For an observability runs viewer, the honest,
less-cluttered choice is to **delete it** and let the facet rail be the single
place you see "where runs concentrate." This drops the view tabs to a clean
three (Runs · Waterfall · Chart) — list, drill-down, aggregate — which is the
complete and non-overlapping set of ways to look at runs.

`'map'` was removed from the `TCNSExplorerView` union and the tab bar; a stale
`?view=map` URL now falls back to the Runs list.

## 7. Removed — and why

| Removed | Why |
|---|---|
| **Left sidebar** (`Sidebar.tsx`) | Its "Select an app to…" debug cards, Connected-Apps card, connection block, and nav buttons were a whole wasted column. Identity + connection are folded into the top bar; app selection is automatic. |
| **Network Topology graph** (`TopologyView.tsx`, `CNSGraph.tsx`, `cns-graph.css`) | The cytoscape graph "didn't help at all" (owner). It's not part of the runs-viewer job. Removing it also removes the heaviest dependency surface from the default view. |
| **Debug panels** (`PerformanceMonitor`, `SignalDebugger`, `ContextStoreMonitor`, `AnalyticsDashboard`, `NeuronDetailsPanel`) | Only ever mounted by the sidebar / topology. Orphaned once those were removed. |
| **`stimulationIngest.ts`** (+ its `WebSocketToOIMDB` test) | It polled a snapshot every 2s **solely** to feed `db.stimulations` / `db.responses`, which only the removed graph / signal-debugger read. The Explorer has its own data path (`explorerController`), so this poll became dead weight. Verified via grep that no remaining runtime code reads those collections. |
| **The extra nav click to reach the Explorer** | The Explorer is now the landing route; there is nothing to click into. |
| **Map view** | See §6. |
| **e2e specs** `graph`, `sidepanel`, `statsbar`, `frontier` | They asserted against the removed graph / sidebar. Removed with the features they tested. Explorer/panel/replay specs were rewritten for the new IA. |

## 8. Landing + reload always show the Explorer

- `main.tsx` navigates `/` → `/explorer` on boot; the router's default is the
  Explorer.
- `selection.selectApp` no longer navigates to `/apps/:appId` — selecting an app
  only updates the identity indicator. Nothing ever leaves `/explorer`.
- A bare reload of the panel URL (empty hash → pathname `/`) re-lands on the
  Explorer. Covered by an e2e that does `goto('/') → reload()` and asserts the
  roster is visible with **no click**.

## 9. Retry / Clone always give visible feedback

Previously Clone did nothing visible. Now (`explorerController`):

- **Clone** resolves the server's `newStimulationId` and shows a transient green
  toast **"Cloned → new run &lt;id&gt;"**, then refetches so the new run appears at
  the top of the roster.
- **Retry** shows **"Retry accepted — resuming this run"** and refreshes the
  run's detail.
- **Failures** show a red toast with the server's reason.
- The toast auto-dismisses after 6s (`actionNotice`), and each new action clears
  the previous notice/error first.

Covered by jest (controller sets `actionNotice` on clone/retry success and
`actionError` on rejection) and by an e2e that clicks Clone and asserts the
"Cloned → new run" toast appears.

## 10. Palette / yellow

The Evangelion/MAGI terminal palette is preserved (dark bg, lime green, teal,
violet, pink; red reserved for errors). The muted olive yellow was replaced with
the **bright terminal yellow `#F5C344`** (`--infection-yellow`, `--pus-yellow`,
`--text-warning`) and given prominent, tasteful placement: the facet section
labels (`STATUS`, `JOB TYPE`), the `N runs` count, the active view-tab accent,
attempt headers, and the `THROUGHPUT` axis peak. Yellow now reads as the panel's
signature accent rather than a rare olive tint.

## 11. Verification

- `npx tsc --noEmit` → 0 errors.
- `npm test` (jest) → 8 suites, 75 tests, all green.
- `npm run e2e` (Playwright) → 4 specs, all green.
- `npm run build` → succeeds.
- Screenshots: `e2e/.artifacts/redesign.png` (Runs), `e2e/.artifacts/redesign-chart.png` (Chart).

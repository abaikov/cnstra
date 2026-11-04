# CNStra DevTools Panel — Design

The panel is a CNStra application itself. One CNS instance owns every mutation
of the panel state; OIMDB holds that state in slots; Exodra machines read the
slots and stimulate the CNS. The job of the panel is "find a stimulation,
understand it, act on it" across five tabs: stimulations, neurons, tasks,
collaterals, scheduled.

## 1. Layers

| layer | files | owns |
|---|---|---|
| model | `src/model/*` | the OIMDB database, the CNS instance, the sync receptors, navigation |
| view | `src/view/*` | Exodra machines; read slots, stimulate `ExplorerAxon` collaterals |
| transport | `src/app/controllers/socket.ts`, `src/model/createDevToolsSyncTransport.ts`, `src/explorer/explorerClient.ts` | the connection to the devtools server: reads through `@cnstra/sync`, actions as typed messages |

`src/main.ts` wires them: it opens the devtools socket, builds the sync
transport, calls `createDevToolsDB`, and renders `ExplorerMachine` with an
Exodra DOM backend whose context carries `devTools`, `cns` and the OIMDB Exodra
plugin. The socket reports status and user interface configuration by
stimulating `ExplorerAxon.connectionChanged` and `ExplorerAxon.uiConfigReceived`.

## 2. Model — `createDevTools`

`createDevTools({ batchTransduceFn, actionClient, transportKind, isReadOnly?, getNowMs? })`
returns `{ db, cns, neurons, models, readExplorerQuery, dispose }`. The CNS
instance is built by `createCNSOIMDBHomeostatSchema` from three synced domain
models and the panel's own neurons; `neurons` names every neuron the panel
builds (the receptor neurons and the domain neurons) and is what `cns-mcp.ts`
registers. `models` keeps one flat name per handle the view reads.

### Entry axons

The view and the transport stimulate two axons that no neuron owns:

- **`explorerUiAxon`**: `queryPatched`, `tabSelected`, `entityOpened`,
  `navigatedBack`, `crumbSelected`, `stimulationRetryRequested`,
  `stimulationCloneRequested`, `stimulationCommandRequested`,
  `stimulationLaunchRequested`, `launchPayloadRejected`,
  `cancelConfirmationRequested`, `listNextPageRequested`, `listNewestRequested`.
- **`devToolsTransportAxon`**: `connectionChanged`, `uiConfigReceived`.

### Synced domain models

Each aggregate is one `defineCNSHomeostatModel(axon)` definition. The schema
generates its collections, receptive fields and answer writes; the model's
`homeostatDendrites` sit on exactly one neuron, its owner.

| model | axon | collections | receptors → buckets / summaries | owner |
|---|---|---|---|---|
| `stimulationModel` (`defineStimulationModel`) | `stimulationAxon` | `stimulations` by stimulation id | `stimulationPage` → bucket `stimulations`, summary `{ total, nextCursor }`; `stimulationSnapshot` → bucket `stimulations`; `stimulationFacets` → summary; `stimulationDetail` → summary | `stimulationNeuron` |
| `scheduledStimulationModel` (`defineScheduledStimulationModel`) | none | `scheduledStimulations` by stimulation id | `scheduledPage` → bucket `scheduledStimulations`, summary: the page without its rows | `scheduledStimulationNeuron` |
| `topologyModel` (`defineTopologyModel`) | none | none | `apps` → summary; `topology` → summary | `topologyNeuron` |

`models` maps them to the names the view reads: `stimulations`,
`stimulationPages`, `stimulationPageCursors`, `stimulationSnapshots`,
`stimulationFacets`, `stimulationDetails`, `scheduledStimulations`,
`scheduledPages`, `scheduledPageSummaries`, `apps`, `topology`, and each
receptor's homeostasis aggregate (`stimulationPageHomeostasis`,
`stimulationDetailHomeostasis`, and so on). Every summary and bucket is keyed
by its receptor's key, so a detail is read under `stimulationDetailKeyOf(id)`.

An answer equal to what the model holds wakes nobody (`isCNSHomeostatSameValue`).

### Domain neurons

Each neuron is the only writer of the models it owns and emits past events only.

| neuron | owns | reacts to | emits |
|---|---|---|---|
| `connectionNeuron` | `connection` | `connectionChanged`, `uiConfigReceived` | `connectionStatusChanged`, `uiConfigApplied` |
| `explorerNavigationNeuron` | the URL hash, `listPagings` | the five navigation events, `listNextPageRequested`, `listNewestRequested`, `uiConfigApplied` (default time window) | `explorerQueryChanged` |
| `stimulationNeuron` | `stimulationModel` | its sync dendrites; its own `stimulationsChanged`; `retryAccepted`, `cloneAccepted`, `launchAccepted` (invalidation) | `stimulationsChanged` |
| `explorerActionNeuron` | nothing but its own in-flight flag; retry, clone, command and launch through the action client, one action at a time | `stimulationRetryRequested`, `stimulationCloneRequested`, `stimulationCommandRequested`, `stimulationLaunchRequested` | `retryAccepted`, `retryRejected`, `retryRefused`, `cloneAccepted`, `cloneRejected`, `cloneRefused`, `commandAccepted`, `commandRejected`, `commandRefused`, `launchAccepted`, `launchRejected`, `launchRefused` |
| `scheduledStimulationNeuron` | `scheduledStimulationModel` | its sync dendrites; `commandAccepted`, `launchAccepted` (invalidation) | nothing |
| `topologyNeuron` | `topologyModel` | its sync dendrites | nothing |
| `actionFeedbackNeuron` | `actionFeedback` | the four requests (pending), every action outcome, `launchPayloadRejected`, `cancelConfirmationRequested`, its own `noticeExpired` | `noticeExpired`, six seconds after a notice |

The URL hash is read and written through `window.location.hash` by
`explorerNavigationNeuron` alone, so two navigations in one turn compose. The
view reads it through the browser location slot (`readExplorerQuery`).

`isReadOnly` is written once into `connection` and kept by every later write.
An action is refused as `busy` while another action runs, and as `notAllowed`
when the panel is read-only or, for retry and clone, when the server user
interface configuration turns it off. A `busy` refusal leaves `pending` alone.
The action neurons are listed before `actionFeedbackNeuron`, so they read
`pending` before the request sets it.

A page or snapshot answer whose rows changed what `stimulations` held returns
`stimulationsChanged` from `afterWrite`; on it the stimulation neuron asks again
the detail of each changed row whose detail is already held.

### Sync receptors

| name | key | stale time |
|---|---|---|
| `apps` | scope | 5 seconds |
| `topology` | scope | 5 seconds |
| `stimulationPage` | filter, since cursor, cursor, limit | 2 seconds |
| `stimulationFacets` | filter, metric path | 2 seconds |
| `stimulationSnapshot` | filter, limit | 2 seconds |
| `stimulationDetail` | stimulation id | 2 seconds; never again once settled |
| `scheduledPage` | neuron, collateral, cursor, limit | 2 seconds |

Keys are built only in `src/model/explorerSyncKeys.ts`. A failed fetch backs off
by the shared refractory policy (500 milliseconds doubling to 8 seconds, 20 %
jitter). The firing policy fires only while `connection.isOnline` and the
document is visible. `CNSStimulationDetailRefetchPolicy` stops refetching a
detail whose latest attempt completed with a settled `ECNSStimulationStatus`.

### OIMDB slots and release policies

| model | kind | release policy |
|---|---|---|
| `connection`, `actionFeedback` | entity single slot, held | never released |
| `listPagings` | entity collection by list name | default |
| browser location, browser visibility | single slot from `@oimdb/browser` | location held by the model; visibility read by the firing policy |
| collections, buckets and summaries of the three models | generated by the schema | the binding's default |
| homeostat correction records | slot collection | after unhold, kept 30 seconds |

Each receptor has one receptive field on the bucket or summary it answers; a
slot's first reader starts its receptor. A key nobody reads is never fetched.

The view reads models only through `CNSExplorerReads`.

## 3. Transport

- **Reads.** `createDevToolsSyncTransport` returns the batch transduce function
  for the receptors. Over the socket it is a `CNSHomeostatTransductionChannel`
  sending `sync.request` and receiving `sync.response`; with
  `?transport=polling` it is a `CNSHomeostatTransductionFetch` on
  `GET /__cnstra/sync`. When the socket leaves `connected`, pending requests
  fail at once.
- **Actions.** `CNSExplorerActionClient` sends `stimulation.retry`,
  `stimulation.clone`, `stimulation.command` and `stimulation.launch` with a
  request id and resolves on the matching `accepted` / `rejected` message.
- **Demo.** `?transport=demo` runs a CNStra application inside the page
  (`src/demo`) behind the same socket interface.

## 4. View — Exodra machines

`ExplorerMachine` lays out two columns:

- left: `ConnectionBadgeMachine`, `TabsMachine`, the filter machines
  (`StatusFilterMachine`, `EntryToggleMachine`, `SearchMachine`, two
  `TypeaheadMachine`s, `TimeRangeMachine`, `FilterChipsMachine`), then
  `TabListMachine` showing the list of the current tab;
- right: `GraphsMachine` (throughput chart from the time facets; selecting a
  range patches `since` / `until`), `BreadcrumbMachine`, and `DetailsMachine`
  showing the stimulation, neuron, collateral or task detail of the selection.

Each machine reads slots inside `withOIMEffects`, so an effect reruns only when
a slot it read changed. Handlers only stimulate `ExplorerAxon` collaterals;
no machine writes a slot. Lists render through `WindowedListMachine`: fixed
52-pixel rows, only the visible window plus overscan in the DOM, keyed
reconciliation through `@exodra/list-reconcile`.

## 5. Stimulation paging — head and frozen tail

The roster is sorted newest first and paged by keyset cursors
(`stimulationRowsOf` in `src/view/explorerData.ts`).

- Before the user scrolls, the list reads one page of 50 with no bounds; it
  stays live through its stale time.
- Scrolling near the end appends the last page's `nextCursor` to the paging
  cursors. From then on the list reads a **head** — the rows at or newer than
  the first cursor, up to 200 — and one **tail** page per cursor, each holding
  the rows strictly older than its cursor. A tail page is defined by its key
  alone, so new stimulations never shift it.
- Rows are merged in order and deduplicated by stimulation id.
- When the head itself has a `nextCursor`, more than 200 stimulations arrived
  above it: the list shows "newer runs above — show the newest", which resets
  paging to the single first page and scrolls to the top.
- Changing the filter resets paging to the first page.
- While a requested page is loading, the list keeps the rows it already shows.

Scheduled stimulations page by cursor in the same windowed list, without a
head.

## 6. Graph exposed to AI tools

`cns-mcp.ts` builds the same model under Node with a transport that serves
nothing and exposes `devTools.cns` to `@cnstra/mcp` (the `cnstra` server in the
repository `.mcp.json`).

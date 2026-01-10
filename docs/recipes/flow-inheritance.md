---
id: flow-inheritance
title: Flow Inheritance with Modalities and Afferent Paths
sidebar_label: Flow Inheritance
slug: /recipes/flow-inheritance
description: Learn how to use modalities and afferent paths in CNStra to track signal flow hierarchy, eliminate code duplication, and route signals by context. Complete guide with examples for TypeScript state management and reactive programming patterns.
keywords: [modality, afferent path, flow inheritance, signal tracing, hierarchical flow, flow context, signal origin tracking, modalityDendrite, CNStra patterns, TypeScript state management, reactive programming, signal routing, flow tracking, code reuse, path families, neural network patterns, event flow, signal processing hierarchy]
---

Modalities and afferent paths are not just for debugging: they are a **flow inheritance mechanism**.

You select a modality + afferent path **once** when starting a stimulation, and that context is available to every neuron response in the flow via `response.stimulation.options` / `ctx.stimulation.options`. This lets you reuse the same flow but override **one step** (or a few steps) for a specific scenario (onboarding, automation, retry, admin mode, etc.) without copying the whole pipeline.

![Two Brains - Neural network pattern for flow inheritance in CNStra](/img/two_brains.png)

## Core Concepts

**Modality** — a group of related afferent paths that describe the hierarchy of signal processing.

**Afferent Path** — the path a signal takes through the system. Paths can have parent paths, creating a hierarchy.

**modalityDendrite** — a factory helper that automatically routes signals to different handlers based on the modality and afferent path specified during stimulation. This eliminates the need for manual path checking in response handlers.

## Biological Foundation

These abstractions mirror two ideas from neuroscience:

- **Modalities**: families of related signal sources (vision, hearing, touch…)
- **Afferent paths**: hierarchical “routes” a signal takes through processing layers

In neuroscience, a **sensory modality** refers to a type of sensory information, such as visual, auditory, somatosensory, olfactory, and gustatory.

**Afferent pathways** (ascending pathways) carry sensory information from the periphery toward the central nervous system. These pathways are hierarchical (relay levels) and can do parallel processing, convergence, and divergence.

Very rough visual example:
```
Retina → LGN → V1 → V2 → (streams)
```

### Why This Matters for CNStra

In CNStra, modalities and afferent paths solve a common problem in software architecture: **multiple different triggers leading to similar reactions**.

#### The Problem: Duplicate Flows

Consider a scenario where two different external triggers can lead to nearly identical processing:

- A **user clicks a button** to create a deck with a card
- An **onboarding flow starts** and needs to create the same deck with a card

Without modalities and afferent paths, you'd need to duplicate the entire flow:

```ts
// ❌ Without modalities - duplicated flows
const deckFromClick = neuron(deckAxon)
  .dendrite({
    collateral: uiAxon.createCardWithDeckButtonClicked,
    response: (payload, axon) => {
      // Create deck logic...
    },
  });

const deckFromOnboarding = neuron(deckAxon)
  .dendrite({
    collateral: onboardingAxon.started,
    response: (payload, axon) => {
      // Same create deck logic duplicated...
    },
  });
```

This leads to code duplication, maintenance burden, and makes it hard to see all the ways your system can be triggered.

#### The Solution: Path Families

With modalities and afferent paths, you create **path families** that allow:

1. **Reusing reactions** — the same neuron can handle multiple triggers
2. **Unique responses per path** — you can still customize behavior based on the afferent path
3. **Clear visibility** — you can see all external triggers a neuron responds to

Minimal shape:

```ts
const click = afferentPath();
const clickDeck = afferentPath(click);
const userInteractionModality = modality({ click, clickDeck });

neuron(deckAxon).modalityDendrite({
  collateral: uiAxon.createCardWithDeckButtonClicked,
  modality: userInteractionModality,
  afferentPaths: new Map([[clickDeck, handler]]),
  output: (result, axon) => axon.createdAtCreateCardWithDeckButtonClicked.createSignal(result),
});
```

```ts
// ✅ With modalities - shared flow with path awareness using modalityDendrite
import { collateral, neuron, afferentPath, modality } from '@cnstra/core';

// Define collaterals
const uiAxon = {
  createCardWithDeckButtonClicked: collateral<{
    deckTitle: string;
    cardTitle: string;
  }>(),
};

const onboardingAxon = {
  started: collateral<{
    deckTitle: string;
    cardTitle: string;
  }>(),
};

const deckAxon = {
  createdAtCreateCardWithDeckButtonClicked: collateral<{
    deckId: string;
    cardTitle: string;
  }>(),
};

// Create afferent paths as objects (no names - identity-based)
const click = afferentPath();
const onboarding = afferentPath();
const clickDeck = afferentPath(click);
const onboardingDeck = afferentPath(onboarding);

const userInteractionModality = modality({
  click,
  onboarding,
  clickDeck,
  onboardingDeck,
});

// Shared deck creation logic
function createDeck(payload: { deckTitle: string; cardTitle: string }) {
  return 'deck-' + Math.random().toString(36).slice(2);
}

function trackOnboardingProgress(event: string) {
  console.log(`Onboarding: ${event}`);
}

const deck = neuron(deckAxon)
  .modalityDendrite({
    collateral: uiAxon.createCardWithDeckButtonClicked,
    modality: userInteractionModality,
    afferentPaths: new Map([
      [clickDeck, (payload, axon) => {
        const deckId = createDeck(payload);
        return {
          deckId,
          cardTitle: payload.cardTitle,
        };
      }],
      [onboardingDeck, (payload, axon) => {
        const deckId = createDeck(payload);
        // Special handling for onboarding path
        trackOnboardingProgress('deck-created');
        return {
          deckId,
          cardTitle: payload.cardTitle,
        };
      }],
    ]),
    default: (payload, axon) => {
      // Fallback for other paths
      const deckId = createDeck(payload);
      return {
        deckId,
        cardTitle: payload.cardTitle,
      };
    },
    output: (result, axon) => {
      return axon.createdAtCreateCardWithDeckButtonClicked.createSignal(result);
    },
  })
  .modalityDendrite({
    collateral: onboardingAxon.started,
    modality: userInteractionModality,
    afferentPaths: new Map([
      [onboardingDeck, (payload, axon) => {
        // Convert onboarding payload to deck creation format
        const deckId = createDeck({
          deckTitle: payload.deckTitle,
          cardTitle: payload.cardTitle,
        });
        trackOnboardingProgress('deck-created');
        return {
          deckId,
          cardTitle: payload.cardTitle,
        };
      }],
    ]),
    output: (result, axon) => {
      return axon.createdAtCreateCardWithDeckButtonClicked.createSignal(result);
    },
  });
```

#### Benefits

- **No code duplication** — shared reactions across different triggers using `modalityDendrite`
- **True flow inheritance** — one stimulation context propagates through the whole flow; each step can switch behavior based on the same selected path
- **Scenario overrides** — override one step for “onboarding” (or any scenario) without rewriting the entire flow
- **Clear architecture** — path families document the supported scenarios/entrypoints
- **Type-safe routing** — handlers are matched by object reference, ensuring correct path selection

![Eye Wired - Visual system hierarchy example for afferent paths](/img/eye_wired.png)

This biological inspiration makes CNStra's abstractions not just intuitive, but practically powerful for modeling real-world software systems where multiple entry points lead to shared processing flows.

## Flow Inheritance: Override One Step (Without Duplicating the Flow)

The key idea: **every response sees the same selected afferent path** (from the stimulation options). So you can implement a “default flow”, and override only the step that changes for a specific scenario.

Example: the flow is `createDeck → createCard → trackAnalytics`. For onboarding we only want to change analytics, everything else stays identical.

```ts
import { CNS, collateral, neuron, afferentPath, modality } from '@cnstra/core';

const uiAxon = {
  createCardWithDeck: collateral<{ deckTitle: string; cardTitle: string }>(),
};

const axon = {
  deckCreated: collateral<{ deckId: string; cardTitle: string }>(),
  cardCreated: collateral<{ cardId: string }>(),
};

// Paths = scenarios (identity-based)
const normal = afferentPath();
const onboarding = afferentPath();
const scenarios = modality({ normal, onboarding });

const createDeck = neuron(axon).modalityDendrite({
  collateral: uiAxon.createCardWithDeck,
  modality: scenarios,
  // Same step shape, potentially different behavior per scenario
  afferentPaths: new Map([
    [normal, payload => ({ deckId: `deck-${payload.deckTitle}`, cardTitle: payload.cardTitle })],
    [onboarding, payload => ({ deckId: `deck-${payload.deckTitle}`, cardTitle: payload.cardTitle })],
  ]),
  output: (result, axon) => axon.deckCreated.createSignal(result),
});

const createCard = neuron(axon).modalityDendrite({
  collateral: axon.deckCreated,
  modality: scenarios,
  afferentPaths: new Map([
    [normal, payload => ({ cardId: `card-${payload.cardTitle}` })],
    [onboarding, payload => ({ cardId: `card-${payload.cardTitle}` })],
  ]),
  output: (result, axon) => axon.cardCreated.createSignal(result),
});

// ✅ Only this step differs per scenario (the “override”)
const trackAnalytics = neuron({}).modalityDendrite({
  collateral: axon.cardCreated,
  modality: scenarios,
  afferentPaths: new Map([
    [normal, payload => {
      track('card_created', { cardId: payload.cardId });
    }],
    [onboarding, payload => {
      track('onboarding_card_created', { cardId: payload.cardId });
    }],
  ]),
  output: () => undefined,
});

const cns = new CNS([createDeck, createCard, trackAnalytics]);

// Start the same flow with different inherited context:
await cns
  .stimulate(uiAxon.createCardWithDeck.createSignal({ deckTitle: 'A', cardTitle: 'B' }), {
    modality: scenarios,
    afferentPath: scenarios.afferentPaths.onboarding,
  })
  .waitUntilComplete();

function track(event: string, props: Record<string, string>) {
  console.log(event, props);
}
```

## Creating Modalities and Afferent Paths

CNStra provides factory functions to create modalities and afferent paths. These are identity-based objects (not named strings), which means they are compared by object reference, not by name.

### Creating Afferent Paths

Use the `afferentPath()` function to create an afferent path. You can optionally specify a parent path to create a hierarchy:

```ts
import { afferentPath } from '@cnstra/core';

// Create a root path (no parent)
const root = afferentPath();

// Create a child path
const child = afferentPath(root);

// Create a grandchild path
const grandchild = afferentPath(child);
```

This creates a hierarchy:
```
root
  └── child
      └── grandchild
```

### Creating Modalities

Use the `modality()` function to group related afferent paths together. Pass an object where keys are meaningful names (for your own reference) and values are the afferent path objects:

```ts
import { afferentPath, modality } from '@cnstra/core';

// Create afferent paths
const ui = afferentPath();
const deck = afferentPath(ui);
const card = afferentPath(deck);

// Create a modality grouping these paths
const userInteractionModality = modality({
  ui,
  deck,
  card,
});
```

The keys in the modality object (`ui`, `deck`, `card`) are for your convenience when debugging or logging. At runtime, paths are compared by object reference, not by these keys.

```ts
import { afferentPath, modality } from '@cnstra/core';

// Step 1: Create afferent paths with hierarchy
const click = afferentPath();
const onboarding = afferentPath();
const clickDeck = afferentPath(click);
const onboardingDeck = afferentPath(onboarding);
const clickCard = afferentPath(clickDeck);
const onboardingCard = afferentPath(onboardingDeck);

// Step 2: Group them into a modality
const userInteractionModality = modality({
  click,
  onboarding,
  clickDeck,
  onboardingDeck,
  clickCard,
  onboardingCard,
});

// The modality now contains all paths, accessible by key:
console.log(userInteractionModality.afferentPaths.click === click); // true
console.log(userInteractionModality.afferentPaths.clickDeck === clickDeck); // true
```

### Important Notes

1. **Identity-based**: Afferent paths are compared by object reference (`path1 === path2`), not by name
2. **Parent relationships**: When creating a path with a parent, the parent-child relationship is stored in `path.parentAfferentPath`
3. **Modality keys**: The keys in the modality object are for your convenience only; they don't affect runtime behavior
4. **No names at runtime**: Paths don't have string names at runtime - use the modality's keys for debugging/logging

## Using Modalities in Stimulation

When starting a stimulation, you can specify a modality and initial afferent path in the options. These values are available in each response through `onResponse`:

```ts
await cns.stimulate(signal, {
  modality: userInteractionModality,
  afferentPath: userInteractionModality.afferentPaths.clickDeck,
  onResponse: response => {
    const { modality, afferentPath } = response.stimulation.options ?? {};
    console.log('modality match:', modality === userInteractionModality);
    console.log('afferentPath:', afferentPath);
  },
}).waitUntilComplete();
```

## Using modalityDendrite Helper

The `modalityDendrite` helper is the recommended way to handle modality-based routing. It automatically selects the correct handler based on the modality and afferent path specified during stimulation.

### Basic Usage

```ts
const click = afferentPath();
const onboarding = afferentPath();
const userModality = modality({
  click,
  onboarding,
});

const createNeuron = neuron({ output: collateral<{ id: string }>() })
  .modalityDendrite({
    collateral: input,
    modality: userModality,
    afferentPaths: new Map([
      [click, (payload, axon) => {
        return { id: `click-${payload.source}` };
      }],
      [onboarding, (payload, axon) => {
        return { id: `onboarding-${payload.source}` };
      }],
    ]),
    output: (result, axon) => {
      return axon.output.createSignal(result);
    },
  });
```

### Using Default Handlers

You can provide default handlers at different levels:

```ts
const click = afferentPath();
const onboarding = afferentPath();
const unknown = afferentPath();
const userModality = modality({
  click,
  onboarding,
  unknown,
});

const createNeuron = neuron({ output: collateral<{ id: string }>() })
  .modalityDendrite({
    collateral: input,
    modality: userModality,
    afferentPaths: new Map([
      [click, (payload, axon) => {
        return { id: `click-${payload.source}` };
      }],
      // onboarding path not specified - will use modality default
    ]),
    default: (payload, axon) => {
      // Handler for paths in this modality that don't have specific handlers
      return { id: `default-${payload.source}` };
    },
    output: (result, axon) => {
      return axon.output.createSignal(result);
    },
  });

// When stimulating with unknown path, default handler is used
await cns.stimulate(input.createSignal({ source: 'test' }), {
  modality: userModality,
  afferentPath: unknown, // Uses default handler
});
```

### Multiple Modalities

A single `modalityDendrite` can handle multiple modalities:

```ts
const uiModality = modality({ interaction: afferentPath() });
const apiModality = modality({ request: afferentPath() });

neuron({ output })
  .modalityDendrite({
    collateral: input,
    modalities: [
      { modality: uiModality, afferentPaths: new Map([[uiModality.afferentPaths.interaction, onUI]]) },
      { modality: apiModality, afferentPaths: new Map([[apiModality.afferentPaths.request, onAPI]]) },
    ],
    default: onDefault,
    output: (result, axon) => axon.output.createSignal(result),
  });
```

## Best Practices

1. **Use meaningful variable names**: Variable names for afferent paths should reflect their purpose (e.g., `const uiPath = afferentPath()`)
2. **Create hierarchies logically**: Parent paths should represent a higher level of abstraction
3. **Group related paths**: Combine related paths into a single modality
4. **Use for scenario overrides**: Treat afferent paths as “scenario selectors” that let you override a step (or a subtree) without duplicating the whole flow
5. **Don't overcomplicate**: Don't create overly deep hierarchies without need
6. **Use object references**: Always compare afferent paths by object reference (`path === card`), not by name

![Skulls Connected - Network connections representing flow inheritance patterns](/img/skulls_connected.png)

## Conclusion

Modalities and afferent paths provide a powerful **flow inheritance** mechanism: one selected context (modality + afferent path) is shared across the entire stimulation, so every step can react consistently to the same “scenario”.

- **Override one step** (or a few steps) for onboarding/retry/admin/etc. without rewriting the whole pipeline
- **Reuse the same flow** across different entrypoints/triggers while keeping behavior explicit and deterministic
- **Route deterministically** with `modalityDendrite` (object-reference matching, no stringly-typed switches)
- **Improve observability** as a side effect (clearer tracing, analytics, and debugging)

Use them when you want “one flow, many scenarios” — shared logic by default, with targeted overrides where needed.










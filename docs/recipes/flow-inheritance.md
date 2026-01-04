---
id: flow-inheritance
title: Flow Inheritance with Modalities and Afferent Paths
sidebar_label: Flow Inheritance
slug: /recipes/flow-inheritance
description: Learn how to use modalities and afferent paths to track and inherit flow context through your CNStra network. Perfect for tracing signal origins and understanding hierarchical data flow.
keywords: [modality, afferent path, flow inheritance, signal tracing, hierarchical flow, flow context, signal origin tracking]
---

Modalities and afferent paths allow you to track the hierarchy of signal flow through your CNStra network. This is a powerful tool for understanding signal origins and the context of their processing.

## Core Concepts

**Modality** — a group of related afferent paths that describe the hierarchy of signal processing.

**Afferent Path** — the path a signal takes through the system. Paths can have parent paths, creating a hierarchy.

## Biological Foundation

The concepts of modalities and afferent paths in CNStra are directly inspired by how the brain processes sensory information. Understanding the biological basis helps clarify why these abstractions are powerful.

### Sensory Modalities in the Brain

In neuroscience, a **sensory modality** refers to a type of sensory information, such as:
- **Visual** (sight) — processed through the retina → optic nerve → visual cortex
- **Auditory** (hearing) — processed through the cochlea → auditory nerve → auditory cortex
- **Somatosensory** (touch) — processed through skin receptors → spinal cord → somatosensory cortex
- **Olfactory** (smell) — processed through olfactory receptors → olfactory bulb → olfactory cortex
- **Gustatory** (taste) — processed through taste buds → cranial nerves → gustatory cortex

Each modality has its own dedicated pathways and cortical areas, but they can also interact and influence each other (multimodal integration).

### Afferent Pathways

**Afferent pathways** (also called ascending pathways) carry sensory information from the periphery toward the central nervous system. These pathways are hierarchical:

1. **Primary afferent neurons** — receive input from sensory receptors (e.g., photoreceptors in the eye, mechanoreceptors in the skin)
2. **Secondary neurons** — relay stations in the spinal cord or brainstem (e.g., dorsal horn, cochlear nucleus)
3. **Tertiary neurons** — project to thalamic nuclei (e.g., lateral geniculate nucleus for vision, medial geniculate nucleus for hearing)
4. **Quaternary neurons** — project from thalamus to primary sensory cortices

Each level processes and transforms the information before passing it to the next level, creating a hierarchical processing stream.

### Hierarchical Processing

The brain processes information hierarchically within each modality:

**Visual System Example:**
```
Retina (photoreceptors)
  └── Lateral Geniculate Nucleus (LGN)
      └── Primary Visual Cortex (V1)
          └── Secondary Visual Cortex (V2)
              ├── Ventral Stream (what pathway)
              │   └── Inferior Temporal Cortex
              └── Dorsal Stream (where pathway)
                  └── Posterior Parietal Cortex
```

**Somatosensory System Example:**
```
Skin receptors
  └── Spinal cord (dorsal horn)
      └── Brainstem nuclei
          └── Thalamus (ventral posterior nucleus)
              └── Primary Somatosensory Cortex (S1)
                  └── Secondary Somatosensory Cortex (S2)
```

### Parallel Processing and Convergence

Multiple afferent pathways can converge on the same target, and a single pathway can branch to multiple targets. This allows:
- **Parallel processing** — different aspects of the same stimulus processed simultaneously
- **Convergence** — integration of information from multiple sources
- **Divergence** — distribution of information to multiple processing areas

### Why This Matters for CNStra

In CNStra, modalities and afferent paths solve a common problem in software architecture: **multiple different triggers leading to similar reactions**.

#### The Problem: Duplicate Flows

Consider a scenario where two different external triggers can lead to nearly identical processing:

- A **user clicks a button** to create a deck with a card
- An **onboarding flow starts** and needs to create the same deck with a card

Without modalities and afferent paths, you'd need to duplicate the entire flow:

```ts
// ❌ Without modalities - duplicated flows
const deckFromClick = neuron('deck-from-click', deckAxon)
  .dendrite({
    collateral: uiAxon.createCardWithDeckButtonClicked,
    response: (payload, axon) => {
      // Create deck logic...
    },
  });

const deckFromOnboarding = neuron('deck-from-onboarding', deckAxon)
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

```ts
// ✅ With modalities - shared flow with path awareness
const userInteractionModality = modality('user-interaction', {
  click: afferentPath('click'),
  onboarding: afferentPath('onboarding'),
  deck: afferentPath('deck', 'click'), // or 'onboarding'
  card: afferentPath('card', 'deck'),
});

const deck = neuron('deck', deckAxon)
  .dendrite({
    collateral: uiAxon.createCardWithDeckButtonClicked,
    response: (payload, axon, ctx) => {
      // Shared deck creation logic
      const deckId = createDeck(payload);
      
      // Can still customize based on path if needed
      if (ctx.stimulation?.afferentPath?.name === 'onboarding') {
        // Special handling for onboarding path
        trackOnboardingProgress('deck-created');
      }
      
      return axon.createdAtCreateCardWithDeckButtonClicked.createSignal({
        deckId,
        cardTitle: payload.cardTitle,
      });
    },
  })
  .dendrite({
    collateral: onboardingAxon.started,
    response: (payload, axon) => {
      // Same shared logic, different trigger
      return deck.dendrites[0].response(payload, axon, ctx);
    },
  });
```

#### Benefits

- **No code duplication** — shared reactions across different triggers
- **Path-specific customization** — unique reactions when needed via `response.afferentPath`
- **Better system understanding** — in each neuron, you can see all external sources it responds to
- **Clearer architecture** — path families document the ways your system can be stimulated

This biological inspiration makes CNStra's abstractions not just intuitive, but practically powerful for modeling real-world software systems where multiple entry points lead to shared processing flows.

## Example: Cards and Decks

Let's consider an example of a learning application with cards and decks. We have a hierarchy: user enters app → deck is created → card is created.

```ts
import { CNS, collateral, neuron, afferentPath, modality } from '@cnstra/core';

// Define collaterals
const uiAxon = {
  userEntersApp: collateral<{
    userId: string;
    deckTitle: string;
    cardTitle: string;
  }>('ui:user-enters-app'),
  createCardWithDeckButtonClicked: collateral<{
    deckTitle: string;
    cardTitle: string;
  }>('ui:create-card-with-deck-button-clicked'),
};

const deckAxon = {
  createdAtUserEntersApp: collateral<{
    deckId: string;
    cardTitle: string;
    userId: string;
  }>('ui:user-enters-app:deck:created'),
  createdAtCreateCardWithDeckButtonClicked: collateral<{
    deckId: string;
    cardTitle: string;
  }>('ui:create-card-with-deck-button-clicked:deck:created'),
};

// Create a modality to track the flow
const userInteractionModality = modality('user-interaction', {
  ui: afferentPath('ui'),
  deck: afferentPath('deck', 'ui'),
  card: afferentPath('card', 'deck'),
});

// Neuron for creating a deck
const deck = neuron('deck', deckAxon)
  .dendrite({
    collateral: uiAxon.userEntersApp,
    response: (payload, axon) => {
      const deckId = 'deck-' + Math.random().toString(36).slice(2);
      return axon.createdAtUserEntersApp.createSignal({
        deckId,
        cardTitle: payload.cardTitle,
        userId: payload.userId,
      });
    },
  })
  .dendrite({
    collateral: uiAxon.createCardWithDeckButtonClicked,
    response: (payload, axon) => {
      const deckId = 'deck-' + Math.random().toString(36).slice(2);
      return axon.createdAtCreateCardWithDeckButtonClicked.createSignal({
        deckId,
        cardTitle: payload.cardTitle,
      });
    },
  });

// Neuron for creating a card
const card = neuron('card', {})
  .dendrite({
    collateral: deckAxon.createdAtCreateCardWithDeckButtonClicked,
    response: payload => {
      console.log('card title', payload.cardTitle);
      // create a card
    },
  })
  .dendrite({
    collateral: deckAxon.createdAtUserEntersApp,
    response: payload => {
      console.log('card title', payload.cardTitle);
      // create a card
    },
  });

const cns = new CNS([deck, card]);
```

## Using Modalities in Stimulation

When starting a stimulation, you can specify a modality and initial afferent path in the options. These values are available in each response through `onResponse`:

```ts
// Start stimulation with modality and initial path
const stimulation = cns.stimulate(
  uiAxon.userEntersApp.createSignal({
    userId: 'user-123',
    deckTitle: 'Deck 1',
    cardTitle: 'Card 1',
  }),
  {
    modality: userInteractionModality,
    afferentPath: userInteractionModality.afferentPaths.ui,
    onResponse: (response) => {
      // Modality and path are available in each response
      if (response.modality) {
        console.log('Modality:', response.modality.name);
      }
      if (response.afferentPath) {
        console.log('Afferent Path:', response.afferentPath.name);
        if (response.afferentPath.parentAfferentPathName) {
          console.log('Parent Path:', response.afferentPath.parentAfferentPathName);
        }
      }
      
      // You can track which neuron processed the signal
      if (response.outputSignal) {
        console.log('Neuron:', response.outputSignal.neuronName);
        console.log('Collateral:', response.outputSignal.collateralName);
      }
    },
  }
);

await stimulation.waitUntilComplete();
```

## Hierarchical Path Structure

Afferent paths can form a hierarchy through parent relationships:

```ts
const complexModality = modality('complex-flow', {
  // Root path
  root: afferentPath('root'),
  
  // First level paths
  level1: afferentPath('level1', 'root'),
  
  // Second level paths
  level2a: afferentPath('level2a', 'level1'),
  level2b: afferentPath('level2b', 'level1'),
  
  // Third level path
  level3: afferentPath('level3', 'level2a'),
});
```

This structure allows tracking complex processing hierarchies:

```
root
  └── level1
      ├── level2a
      │   └── level3
      └── level2b
```

## Tracking Flow in Responses

The modality and afferent path specified in stimulation options are available through response types. You can use them to track the flow:

```ts
// Save modality and path for use in handlers
const currentModality = userInteractionModality;
const currentPath = userInteractionModality.afferentPaths.ui;

await cns.stimulate(signal, {
  modality: currentModality,
  afferentPath: currentPath,
  onResponse: (response) => {
    // Modality and path are available through stimulation options
    // response.modality and response.afferentPath contain values from options
    
    if (response.modality && response.afferentPath) {
      // Build full path from root
      const fullPath = buildPathHierarchy(
        response.afferentPath,
        response.modality
      );
      console.log('Signal path:', fullPath);
      // Output: "Signal path: ui -> deck -> card"
    }
  },
});

function buildPathHierarchy(
  path: typeof userInteractionModality.afferentPaths.ui,
  modality: typeof userInteractionModality
): string {
  const parts: string[] = [path.name];
  let current = path;
  
  while (current.parentAfferentPathName) {
    const parent = modality.afferentPaths[
      current.parentAfferentPathName as keyof typeof modality.afferentPaths
    ];
    if (parent) {
      parts.unshift(parent.name);
      current = parent;
    } else {
      break;
    }
  }
  
  return parts.join(' -> ');
}
```

## Practical Applications

### 1. Logging and Debugging

Modalities and paths help understand where a signal came from:

```ts
await cns.stimulate(signal, {
  modality: userInteractionModality,
  afferentPath: userInteractionModality.afferentPaths.ui,
  onResponse: (response) => {
    const path = response.afferentPath?.name || 'unknown';
    const neuron = response.outputSignal?.neuronName || 'unknown';
    console.log(`[${path}] ${neuron} processed signal`);
  },
});
```

### 2. Analytics and Monitoring

Track which paths are most active:

```ts
const pathStats = new Map<string, number>();

await cns.stimulate(signal, {
  modality: userInteractionModality,
  afferentPath: userInteractionModality.afferentPaths.ui,
  onResponse: (response) => {
    if (response.afferentPath) {
      const path = response.afferentPath.name;
      pathStats.set(path, (pathStats.get(path) || 0) + 1);
    }
  },
});

// Analyze statistics
console.log('Path statistics:', Object.fromEntries(pathStats));
```

### 3. Conditional Processing via onResponse

Use paths to make decisions in response handlers:

```ts
await cns.stimulate(signal, {
  modality: userInteractionModality,
  afferentPath: userInteractionModality.afferentPaths.ui,
  onResponse: (response) => {
    const path = response.afferentPath;
    
    if (path?.name === 'deck' && response.outputSignal) {
      // Special processing for signals from deck
      console.log('Deck signal processed:', response.outputSignal.payload);
    }
    
    if (path?.name === 'card') {
      // Processing for signals from card
      console.log('Card signal processed');
    }
  },
});
```

## Multiple Modalities

You can use different modalities for different types of flows:

```ts
const uiModality = modality('ui', {
  interaction: afferentPath('interaction'),
  navigation: afferentPath('navigation'),
});

const apiModality = modality('api', {
  request: afferentPath('request'),
  response: afferentPath('response', 'request'),
});

// Use the appropriate modality for each type of stimulation
await cns.stimulate(uiSignal, {
  modality: uiModality,
  afferentPath: uiModality.afferentPaths.interaction,
});

await cns.stimulate(apiSignal, {
  modality: apiModality,
  afferentPath: apiModality.afferentPaths.request,
});
```

## Best Practices

1. **Use meaningful names**: Modality and path names should reflect their purpose
2. **Create hierarchies logically**: Parent paths should represent a higher level of abstraction
3. **Group related paths**: Combine related paths into a single modality
4. **Use for debugging**: Modalities are especially useful when debugging complex flows
5. **Don't overcomplicate**: Don't create overly deep hierarchies without need

## Conclusion

Modalities and afferent paths provide a powerful mechanism for tracking and understanding data flow through your CNStra network. They are especially useful for:

- Debugging complex flows
- Analytics and monitoring
- Conditional processing based on context
- Documenting system architecture

Use them to create more transparent and understandable signal processing systems.









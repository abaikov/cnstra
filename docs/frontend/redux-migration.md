---
id: redux-migration
title: Migrating from Redux to OIMDB
sidebar_label: Redux Migration
slug: /frontend/redux-migration
description: Production-ready Redux adapter for OIMDB that enables seamless integration between OIMDB's reactive in-memory database and Redux state management. Gradually migrate from Redux to OIMDB or use both systems side-by-side with automatic two-way synchronization.
keywords: [Redux migration, Redux adapter, OIMDB Redux, state management migration, Redux to OIMDB, two-way sync, gradual migration, Redux compatibility]
---

# @oimdb/redux-adapter

> **⚠️ Experimental**: This package is experimental. Functionality is not guaranteed and the API may change in future versions. Use at your own risk.

Production-ready Redux adapter for OIMDB that enables seamless integration between OIMDB's reactive in-memory database and Redux state management. This package allows you to gradually migrate from Redux to OIMDB or use both systems side-by-side with automatic two-way synchronization.

## 🚀 Installation

```bash
npm install @oimdb/redux-adapter @oimdb/core redux
```

## ✨ Key Features

- **🔄 Two-Way Synchronization**: Automatic sync between OIMDB and Redux in both directions

- **📦 Production Ready**: Battle-tested, optimized for large datasets with efficient change detection

- **🔄 Gradual Migration**: Integrate OIMDB into existing Redux projects without breaking changes

- **🎯 Flexible State Mapping**: Custom mappers for any Redux state structure

- **⚡ Performance Optimized**: Efficient diffing algorithms and batched updates

- **🔌 Redux Compatible**: Works seamlessly with existing Redux middleware and tools

## 🎯 Use Cases

### 1. **Replace Redux Entirely**

Use OIMDB as your primary state management with Redux as a compatibility layer for existing code.

### 2. **Gradual Migration**

Migrate from Redux to OIMDB incrementally, one collection at a time, without disrupting your application.

### 3. **Hybrid Approach**

Use OIMDB for complex relational data and Redux for simple UI state, with automatic synchronization.

## 📦 What's Included

- **OIMDBReduxAdapter**: Main adapter class for creating Redux reducers and middleware from OIMDB collections

- **Automatic Middleware**: Built-in middleware for automatic event queue flushing after Redux actions

- **Default Mappers**: RTK Entity Adapter-style mappers for collections and indexes

- **Utility Functions**: `findUpdatedInRecord` and `findUpdatedInArray` for efficient change detection

- **Type-Safe**: Full TypeScript support with comprehensive type definitions

## 🔧 Basic Usage

### Simple One-Way Sync (OIMDB → Redux)

```typescript
import { OIMDBReduxAdapter } from '@oimdb/redux-adapter';
import { OIMReactiveCollection, OIMEventQueue } from '@oimdb/core';
import { createStore, combineReducers, applyMiddleware } from 'redux';

interface User {
    id: string;
    name: string;
    email: string;
}

// Create OIMDB collection
const queue = new OIMEventQueue();
const users = new OIMReactiveCollection<User, string>(queue, {
    selectPk: (user) => user.id
});

// Create Redux adapter
const adapter = new OIMDBReduxAdapter(queue);

// Create Redux reducer from OIMDB collection
const usersReducer = adapter.createCollectionReducer(users);

// Create middleware for automatic flushing
const middleware = adapter.createMiddleware();

// Create Redux store with middleware
const store = createStore(
    combineReducers({
        users: usersReducer,
    }),
    applyMiddleware(middleware)
);

// Set store in adapter (can be done later)
adapter.setStore(store);

// OIMDB changes automatically sync to Redux
users.upsertOne({ id: '1', name: 'John', email: 'john@example.com' });
queue.flush(); // Triggers Redux update

// Redux state is automatically updated
const state = store.getState();
console.log(state.users.entities['1']); // { id: '1', name: 'John', email: 'john@example.com' }
```

### Two-Way Sync (OIMDB ↔ Redux)

Enable bidirectional synchronization by providing a child reducer. The middleware automatically flushes the queue after each action, so manual `queue.flush()` is not needed:

```typescript
import { 
    OIMDBReduxAdapter,
    TOIMDBReduxDefaultCollectionState,
    TOIMDBReduxCollectionReducerChildOptions 
} from '@oimdb/redux-adapter';
import { Action } from 'redux';
import { createStore, applyMiddleware } from 'redux';

// Child reducer handles custom Redux actions
const childReducer = (
    state: TOIMDBReduxDefaultCollectionState<User, string> | undefined,
    action: Action
): TOIMDBReduxDefaultCollectionState<User, string> => {
    if (state === undefined) {
        return { entities: {}, ids: [] };
    }
    
    if (action.type === 'UPDATE_USER_NAME') {
        const { id, name } = action.payload;
        return {
            ...state,
            entities: {
                ...state.entities,
                [id]: { ...state.entities[id], name }
            }
        };
    }
    
    return state;
};

const childOptions: TOIMDBReduxCollectionReducerChildOptions<User, string, TOIMDBReduxDefaultCollectionState<User, string>> = {
    reducer: childReducer,
    getPk: (user) => user.id,
    // extractEntities is optional - default implementation handles TOIMDBReduxDefaultCollectionState
    // linkedIndexes is optional - automatically updates indexes when entity fields change
};

// Create reducer with child
const usersReducer = adapter.createCollectionReducer(users, childOptions);

// Create store with middleware
const store = createStore(
    usersReducer,
    applyMiddleware(adapter.createMiddleware())
);

adapter.setStore(store);

// Redux actions automatically sync back to OIMDB
// Middleware automatically flushes queue after dispatch
store.dispatch({
    type: 'UPDATE_USER_NAME',
    payload: { id: '1', name: 'John Updated' }
});

// No manual queue.flush() needed - middleware handles it!
// OIMDB collection is automatically updated
const user = users.getOneByPk('1');
console.log(user?.name); // 'John Updated'
```

### Linked Indexes

Automatically update indexes when entity array fields change in **both directions**:

- **Redux → OIMDB**: When Redux state changes via child reducer, linked indexes are updated

- **OIMDB → Redux**: When OIMDB collection changes directly, linked indexes are updated automatically

The entity's PK (obtained via `getPk`) becomes the index key, and the array field values become the index values. Index updates are triggered when the array field changes **by reference** (`===` comparison). No need to create separate index reducers:

```typescript
import { 
    OIMDBReduxAdapter,
    TOIMDBReduxDefaultCollectionState,
    TOIMDBReduxCollectionReducerChildOptions 
} from '@oimdb/redux-adapter';
import { OIMReactiveIndexManualArrayBased } from '@oimdb/core';

interface Deck {
    id: string;
    cardIds: string[]; // Array of card IDs
    name: string;
}

const decksCollection = new OIMReactiveCollection<Deck, string>(queue, {
    selectPk: (deck) => deck.id
});

// Use ArrayBased index for full array replacements (recommended for redux-adapter)
// The adapter optimizes ArrayBased indexes by skipping diff computation
const cardsByDeckIndex = new OIMReactiveIndexManualArrayBased<string, string>(queue);

const childReducer = (
    state: TOIMDBReduxDefaultCollectionState<Deck, string> | undefined,
    action: Action
): TOIMDBReduxDefaultCollectionState<Deck, string> => {
    if (state === undefined) {
        return { entities: {}, ids: [] };
    }
    
    if (action.type === 'UPDATE_DECK_CARDS') {
        const { deckId, cardIds } = action.payload;
        const deck = state.entities[deckId];
        if (deck) {
            return {
                ...state,
                entities: {
                    ...state.entities,
                    [deckId]: { ...deck, cardIds } // Update cardIds array
                }
            };
        }
    }
    
    return state;
};

const childOptions: TOIMDBReduxCollectionReducerChildOptions<
    Deck,
    string,
    TOIMDBReduxDefaultCollectionState<Deck, string>
> = {
    reducer: childReducer,
    getPk: (deck) => deck.id,
    linkedIndexes: [
        {
            index: cardsByDeckIndex,
            fieldName: 'cardIds', // Array field containing PKs
        },
    ],
};

const decksReducer = adapter.createCollectionReducer(
    decksCollection,
    childOptions
);

// When deck.cardIds changes (by reference), the index is automatically updated:
// - index[deck.id] = deck.cardIds
// - Old values removed, new values added automatically
// - Works in both directions: Redux → OIMDB and OIMDB → Redux
// No need to create a separate index reducer!

// Example: Update via Redux
store.dispatch({
    type: 'UPDATE_DECK_CARDS',
    payload: { deckId: 'deck1', cardIds: ['card1', 'card2', 'card3'] }
});

// Index automatically updated: cardsByDeckIndex['deck1'] = ['card1', 'card2', 'card3']

// Example: Update via OIMDB
decksCollection.upsertOne({
    id: 'deck1',
    cardIds: ['card4', 'card5'], // New array reference
    name: 'Deck 1'
});

queue.flush(); // Triggers OIMDB_UPDATE action

// Index automatically updated: cardsByDeckIndex['deck1'] = ['card4', 'card5']
```

### Custom State Structure

Use custom mappers for any Redux state structure:

```typescript
// Array-based state
type ArrayBasedState = {
    users: User[];
};

const arrayMapper = (collection: OIMReactiveCollection<User, string>) => {
    return {
        users: collection.getAll()
    };
};

const arrayReducer = adapter.createCollectionReducer(users, undefined, arrayMapper);

// Custom extractor for array-based state
const childOptions: TOIMDBReduxCollectionReducerChildOptions<User, string, ArrayBasedState> = {
    reducer: (state, action) => {
        // Your custom reducer logic
        return state;
    },
    extractEntities: (prevState, nextState, collection, getPk) => {
        const prevIds = (prevState?.users ?? []).map(u => getPk(u));
        const nextIds = nextState.users.map(u => getPk(u));
        
        // Use utility function for efficient diffing
        const { findUpdatedInArray } = require('@oimdb/redux-adapter');
        const diff = findUpdatedInArray(prevIds, nextIds);
        
        // Sync changes to OIMDB
        if (diff.added.length > 0 || diff.updated.length > 0) {
            const toUpsert = nextState.users.filter(u => 
                diff.added.includes(getPk(u)) || diff.updated.includes(getPk(u))
            );
            collection.upsertMany(toUpsert);
        }
        
        if (diff.removed.length > 0) {
            collection.removeManyByPks(diff.removed);
        }
    },
    getPk: (user) => user.id
};
```

## 🔄 Migration Strategy

### Phase 1: Add OIMDB Alongside Redux

Start by adding OIMDB for new features while keeping existing Redux code unchanged:

```typescript
const adapter = new OIMDBReduxAdapter(queue);
const middleware = adapter.createMiddleware();

const store = createStore(
    combineReducers({
        // Existing Redux reducers
        ui: uiReducer,
        auth: authReducer,
        
        // New OIMDB-backed reducers
        users: adapter.createCollectionReducer(usersCollection),
        posts: adapter.createCollectionReducer(postsCollection),
    }),
    applyMiddleware(middleware)
);

adapter.setStore(store);
```

### Phase 2: Migrate Existing Redux Reducers

Gradually replace Redux reducers with OIMDB collections, using child reducers to maintain compatibility:

```typescript
// Old Redux reducer
const oldUsersReducer = (state, action) => {
    // ... existing logic
};

// New OIMDB-backed reducer with compatibility layer
const adapter = new OIMDBReduxAdapter(queue);
const newUsersReducer = adapter.createCollectionReducer(
    usersCollection,
    {
        reducer: oldUsersReducer, // Reuse existing reducer logic
        getPk: (user) => user.id
    }
);

const store = createStore(
    newUsersReducer,
    applyMiddleware(adapter.createMiddleware())
);

adapter.setStore(store);
```

### Phase 3: Full OIMDB Migration

Once all collections are migrated, you can remove Redux entirely and use OIMDB directly with React hooks or other reactive patterns.

## 🛠️ Advanced Usage

### Custom Mappers

```typescript
const customMapper: TOIMDBReduxCollectionMapper<User, string, CustomState> = (
    collection,
    updatedKeys,
    currentState
) => {
    // Your custom mapping logic
    // Only process entities in updatedKeys for performance
    const entities: Record<string, User> = {};
    const ids: string[] = [];
    
    if (currentState) {
        // Reuse existing state
        Object.assign(entities, currentState.entities);
        ids.push(...currentState.ids);
    }
    
    // Update only changed entities
    for (const id of updatedKeys) {
        const entity = collection.getOneByPk(id);
        if (entity) {
            entities[id] = entity;
            if (!ids.includes(id)) {
                ids.push(id);
            }
        } else {
            delete entities[id];
            const index = ids.indexOf(id);
            if (index > -1) {
                ids.splice(index, 1);
            }
        }
    }
    
    return { entities, ids };
};
```

### Index Reducers

#### Simple One-Way Sync (OIMDB → Redux)

```typescript
import { OIMReactiveIndexManualArrayBased } from '@oimdb/core';

// Create index (ArrayBased recommended for redux-adapter - optimized performance)
const userRolesIndex = new OIMReactiveIndexManualArrayBased<string, string>(queue);

// Create reducer for index
const adapter = new OIMDBReduxAdapter(queue);
const rolesReducer = adapter.createIndexReducer(userRolesIndex);

// Use in Redux store with middleware
const store = createStore(
    combineReducers({
        users: usersReducer,
        userRoles: rolesReducer,
    }),
    applyMiddleware(adapter.createMiddleware())
);

adapter.setStore(store);
```

#### Two-Way Sync (OIMDB ↔ Redux) for Indexes

Enable bidirectional synchronization for indexes by providing a child reducer:

```typescript
import { 
    OIMDBReduxAdapter,
    TOIMDBReduxDefaultIndexState,
    TOIMDBReduxIndexReducerChildOptions 
} from '@oimdb/redux-adapter';
import { Action } from 'redux';
import { createStore, applyMiddleware } from 'redux';

// Child reducer handles custom Redux actions
const childReducer = (
    state: TOIMDBReduxDefaultIndexState<string, string> | undefined,
    action: Action
): TOIMDBReduxDefaultIndexState<string, string> => {
    if (state === undefined) {
        return { entities: {} };
    }
    
    if (action.type === 'UPDATE_INDEX_KEY') {
        const { key, ids } = action.payload;
        return {
            ...state,
            entities: {
                ...state.entities,
                [key]: { id: key, ids }
            }
        };
    }
    
    return state;
};

const childOptions: TOIMDBReduxIndexReducerChildOptions<
    string,
    string,
    TOIMDBReduxDefaultIndexState<string, string>
> = {
    reducer: childReducer,
    // extractIndexState is optional - default implementation handles TOIMDBReduxDefaultIndexState
};

// Create reducer with child
const indexReducer = adapter.createIndexReducer(userRolesIndex, childOptions);

// Create store with middleware
const store = createStore(
    indexReducer,
    applyMiddleware(adapter.createMiddleware())
);

adapter.setStore(store);

// Redux actions automatically sync back to OIMDB
// Middleware automatically flushes queue after dispatch
store.dispatch({
    type: 'UPDATE_INDEX_KEY',
    payload: { key: 'role1', ids: ['user1', 'user2', 'user3'] }
});

// No manual queue.flush() needed - middleware handles it!
// OIMDB index is automatically updated
const pks = userRolesIndex.index.getPksByKey('role1'); // Returns TPk[] for ArrayBased
console.log(pks); // ['user1', 'user2', 'user3']
```

## 📊 Performance

The adapter is optimized for large datasets:

- **Efficient Diffing**: Uses optimized algorithms to detect changes

- **Batched Updates**: Changes are coalesced and applied in batches

- **Selective Updates**: Only changed entities are processed

- **Memory Efficient**: Reuses state objects when possible

### Index Performance Optimization

The adapter intelligently handles different index types for optimal performance:

- **ArrayBased Indexes** (using `setPks`): When linked indexes use ArrayBased indexes, the adapter directly sets the new array without computing diffs. This eliminates unnecessary array comparisons and `getPksByKey` calls, providing significant performance improvements, especially with many linked indexes.

- **SetBased Indexes** (using `addPks`/`removePks`): For SetBased indexes, the adapter computes diffs to apply incremental updates, which is more efficient than full replacements for Set-based data structures.

**Recommendation**: For redux-adapter, prefer **ArrayBased indexes** for linked indexes, as they provide the best performance when replacing entire arrays (which is the common pattern when syncing from Redux state).

**Example:**

```typescript
// ArrayBased index - direct assignment (fast, recommended for redux-adapter)
const cardsByDeckIndex = new OIMReactiveIndexManualArrayBased<string, string>(queue);

// When deck.cardIds changes, adapter simply does:
// index.setPks(deckId, newCardIds) - no diff computation needed!

// SetBased index - incremental updates (efficient for Sets)
const tagsByUserIndex = new OIMReactiveIndexManualSetBased<string, string>(queue);

// When user.tags changes, adapter computes diff and uses:
// index.addPks(userId, toAdd) and index.removePks(userId, toRemove)
```

## 🔍 Utility Functions

### `findUpdatedInRecord`

Efficiently find differences between two entity records (dictionaries):

```typescript
import { findUpdatedInRecord } from '@oimdb/redux-adapter';

const oldEntities = { '1': user1, '2': user2 };
const newEntities = { '1': user1Updated, '3': user3 };

const diff = findUpdatedInRecord(oldEntities, newEntities);
// diff.added = Set(['3'])
// diff.updated = Set(['1'])
// diff.removed = Set(['2'])
// diff.all = Set(['1', '2', '3'])
```

### `findUpdatedInArray`

Efficiently find differences between two arrays of primary keys:

```typescript
import { findUpdatedInArray } from '@oimdb/redux-adapter';

const oldIds = ['1', '2', '3'];
const newIds = ['1', '3', '4'];

const diff = findUpdatedInArray(oldIds, newIds);
// diff.added = ['4']
// diff.updated = ['1', '3']
// diff.removed = ['2']
// diff.all = ['1', '2', '3', '4']
```

## 🎨 TypeScript Support

Full type safety with comprehensive TypeScript definitions:

```typescript
import type {
    TOIMDBReduxCollectionMapper,
    TOIMDBReduxIndexMapper,
    TOIMDBReduxDefaultCollectionState,
    TOIMDBReduxDefaultIndexState,
    TOIMDBReduxCollectionReducerChildOptions,
    TOIMDBReduxLinkedIndex,
    TOIMDBReduxIndexReducerChildOptions,
    TOIMDBReduxUpdatedEntitiesResult,
    TOIMDBReduxUpdatedArrayResult,
} from '@oimdb/redux-adapter';
```

## 📚 API Reference

### `OIMDBReduxAdapter`

Main adapter class for integrating OIMDB with Redux. Creates Redux reducers from OIMDB collections and provides middleware for automatic event queue flushing.

#### Methods

- `createCollectionReducer<TEntity, TPk, TState>(collection, child?, mapper?)`: Create reducer for a collection

- `createIndexReducer<TIndexKey, TPk, TState>(index, child?, mapper?)`: Create reducer for an index (supports both SetBased and ArrayBased indexes)

- `createMiddleware()`: Create Redux middleware that automatically flushes the event queue after each action

- `setStore(store)`: Set Redux store (can be called later)

- `flushSilently()`: Flush the event queue without triggering OIMDB_UPDATE dispatch (used internally by middleware)

#### Constructor Options

- `defaultCollectionMapper`: Default mapper for all collections

- `defaultIndexMapper`: Default mapper for all indexes

#### Automatic Flushing

The middleware created by `createMiddleware()` automatically calls `flushSilently()` after every Redux action. This ensures that:

- Events triggered by child reducers are processed synchronously

- No manual `queue.flush()` is needed when updating OIMDB from Redux

- OIMDB_UPDATE dispatch is not triggered unnecessarily (preventing loops)

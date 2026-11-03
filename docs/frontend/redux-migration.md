---
id: redux-migration
title: Migrating from Redux to OIMDB
sidebar_label: Redux Migration
slug: /frontend/redux-migration
description: Experimental Redux adapter for OIMDB that enables integration between OIMDB's reactive in-memory database and Redux state management. Gradually migrate from Redux to OIMDB or use both systems side-by-side with automatic two-way synchronization.
keywords: [Redux migration, Redux adapter, OIMDB Redux, state management migration, Redux to OIMDB, two-way sync, gradual migration, Redux compatibility]
---

# @oimdb/redux-adapter

> **⚠️ Experimental**: This package is experimental. Functionality is not guaranteed and the API may change in future versions. Use at your own risk.

Experimental Redux adapter for OIMDB that enables integration between OIMDB's reactive in-memory database and Redux state management. This package allows you to gradually migrate from Redux to OIMDB or use both systems side-by-side with automatic two-way synchronization.

## 🚀 Installation

```bash
npm install @oimdb/redux-adapter @oimdb/core redux
```

## ✨ Key Features

- **🔄 Two-Way Synchronization**: Automatic sync between OIMDB and Redux in both directions

- **📦 Optimized**: Designed for large datasets with efficient change detection

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

- **OIMReduxAdapter**: Main adapter class for creating Redux reducers and middleware from OIMDB entity collections and bucket indexes

- **Automatic Middleware**: Built-in middleware that flushes the OIMDB channel after each Redux action

- **Default Mappers**: RTK Entity Adapter-style mappers for collections and indexes (`mapOIMCollection`, `mapOIMKeyedIndex`, `mapOIMGlobalIndex`)

- **Utility Function**: `diffOIMEntityKeys` for efficient change detection between two entity records

- **Type-Safe**: Full TypeScript support with comprehensive type definitions

## 🔧 Basic Usage

The examples on this page share this setup: an `OIMDB`, a user collection created by its service, a bucket collection that groups users by team, and one adapter over the `db`.

```ts setup
import {
    OIMDB,
    OIMSetBucketContentService,
    createOIMEntityContentService,
    createOIMSlotCollectionService,
    type TOIMEntitySlot,
} from '@oimdb/core';
import { OIMReduxAdapter, type TOIMReduxKeyedIndex } from '@oimdb/redux-adapter';
import type { Reducer } from 'redux';

type TUser = { id: string; name: string; teamId: string };
type TUserSlot = TOIMEntitySlot<TUser>;
type TPost = { id: string; title: string };

const db = new OIMDB();

const userService = createOIMSlotCollectionService({ slotContentService: createOIMEntityContentService<TUser>() });
const users = userService.createStoreSlot(db);

const postService = createOIMSlotCollectionService({ slotContentService: createOIMEntityContentService<TPost>() });
const posts = postService.createStoreSlot(db);

const byTeamService = createOIMSlotCollectionService({ slotContentService: new OIMSetBucketContentService<TUserSlot>() });
const byTeam = byTeamService.createStoreSlot(db);
const keyedIndex: TOIMReduxKeyedIndex<string, string, TUser> = {
    bucketService: byTeamService, bucketStoreSlot: byTeam, entityService: userService, entityStoreSlot: users,
};

const adapter = new OIMReduxAdapter({ channelMap: db });

declare const uiReducer: Reducer<{ theme: string }>;
declare const authReducer: Reducer<{ token: string | null }>;
```

`channelMap` is the `db`: the adapter's effects, its once-per-frame `OIMDB_UPDATE` dispatch and its middleware's flush all run on the `db`'s default channel.

### Simple One-Way Sync (OIMDB → Redux)

```typescript
import { applyMiddleware, combineReducers, createStore } from 'redux';
import type { TOIMReduxDefaultCollectionState } from '@oimdb/redux-adapter';

// Create Redux reducer from the OIMDB collection
const usersReducer = adapter.createCollectionReducer<
    TUser, string, TOIMReduxDefaultCollectionState<TUser, string>
>(userService, users);

// Create Redux store with the adapter's middleware
const store = createStore(
    combineReducers({
        users: usersReducer,
    }),
    applyMiddleware(adapter.createMiddleware())
);

// Set store in adapter (can be done later)
adapter.setStore(store);

// OIMDB changes automatically sync to Redux
userService.writeSlotContentByKey(users, 'u1', { id: 'u1', name: 'John', teamId: 'eng' });
db.flush(); // Triggers Redux update

// Redux state is automatically updated
const state = store.getState();
console.log(state.users?.entities['u1']); // { id: 'u1', name: 'John', teamId: 'eng' }
```

### Two-Way Sync (OIMDB ↔ Redux)

Enable bidirectional synchronization by providing a child reducer. The middleware automatically flushes the channel after each action, so a manual `db.flush()` is not needed:

```typescript
import { applyMiddleware, createStore, type Action } from 'redux';
import type {
    TOIMReduxCollectionReducerChildOptions,
    TOIMReduxDefaultCollectionState,
} from '@oimdb/redux-adapter';

type TUsersState = TOIMReduxDefaultCollectionState<TUser, string>;
type TUpdateUserName = Action<'UPDATE_USER_NAME'> & { payload: { id: string; name: string } };

// Child reducer handles custom Redux actions
const childReducer = (state: TUsersState | undefined, action: Action): TUsersState => {
    if (state === undefined) {
        return { entities: {}, ids: [] };
    }

    if (action.type === 'UPDATE_USER_NAME') {
        const { id, name } = (action as TUpdateUserName).payload;
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

const childOptions: TOIMReduxCollectionReducerChildOptions<TUser, string, TUsersState> = {
    reducer: childReducer,
    selectKey: (user) => user.id,
};

// Create reducer with child
const usersReducer = adapter.createCollectionReducer<TUser, string, TUsersState>(userService, users, childOptions);

// Create store with middleware
const store = createStore(
    usersReducer,
    applyMiddleware(adapter.createMiddleware())
);

adapter.setStore(store);

// Redux actions automatically sync back to OIMDB
// Middleware automatically flushes the channel after dispatch
store.dispatch({
    type: 'UPDATE_USER_NAME',
    payload: { id: 'u1', name: 'John Updated' }
});

// OIMDB collection is automatically updated
const user = userService.peekSlotByKey(users, 'u1')?.entity;
console.log(user?.name); // 'John Updated'
```

`selectKey` tells the adapter how to read an entity's key back out of Redux state (it defaults to `.id`). A child reducer can also take `extractEntities(prevState, nextState, entityService, entityStoreSlot, selectKey)` when its state is not the default `entities` + `ids` shape.

### Linked Indexes

The child options also accept `linkedIndexes` (`TOIMReduxLinkedIndex`: `bucketService`, `bucketStoreSlot`, `linkedEntityService`, `linkedEntityStoreSlot`, `fieldName`), which keep a bucket in step with an array field of the entity.

Do **not** combine `linkedIndexes` with this adapter's middleware. The linked-index write happens while the adapter handles `OIMDB_UPDATE`, which is dispatched inside the channel's flush, and OIMDB refuses every write for the whole of a flush. The refusal goes to the channel's error policy and the index change is lost, not delayed. Keep such a bucket in step from your own write path instead, as in [Index Reducers](#index-reducers).

### Custom State Structure

Use custom mappers for any Redux state structure:

```typescript
import type { TOIMReduxCollectionMapper } from '@oimdb/redux-adapter';

// Array-based state
type TArrayBasedState = {
    users: TUser[];
};

const arrayMapper: TOIMReduxCollectionMapper<TUser, string, TArrayBasedState> = (entityService, entityStoreSlot) => {
    const list: TUser[] = [];
    for (const slot of entityService.getSlots(entityStoreSlot)) {
        if (slot.entity !== undefined) list.push(slot.entity);
    }
    return { users: list };
};

const arrayReducer = adapter.createCollectionReducer(userService, users, undefined, arrayMapper);
```

A collection mapper is `(entityService, entityStoreSlot, updatedKeys, currentState)`.

## 🔄 Migration Strategy

### Phase 1: Add OIMDB Alongside Redux

Start by adding OIMDB for new features while keeping existing Redux code unchanged:

```typescript
import { applyMiddleware, combineReducers, createStore } from 'redux';
import type { TOIMReduxDefaultCollectionState } from '@oimdb/redux-adapter';

const store = createStore(
    combineReducers({
        // Existing Redux reducers
        ui: uiReducer,
        auth: authReducer,

        // New OIMDB-backed reducers
        users: adapter.createCollectionReducer<TUser, string, TOIMReduxDefaultCollectionState<TUser, string>>(userService, users),
        posts: adapter.createCollectionReducer<TPost, string, TOIMReduxDefaultCollectionState<TPost, string>>(postService, posts),
    }),
    applyMiddleware(adapter.createMiddleware())
);

adapter.setStore(store);
```

### Phase 2: Migrate Existing Redux Reducers

Gradually replace Redux reducers with OIMDB collections, using child reducers to maintain compatibility:

```typescript
import { applyMiddleware, createStore, type Action } from 'redux';
import type { TOIMReduxDefaultCollectionState } from '@oimdb/redux-adapter';

type TUsersState = TOIMReduxDefaultCollectionState<TUser, string>;

// Old Redux reducer
const oldUsersReducer = (state: TUsersState = { entities: {}, ids: [] }, action: Action): TUsersState => {
    // ... existing logic
    return state;
};

// New OIMDB-backed reducer with compatibility layer
const newUsersReducer = adapter.createCollectionReducer<TUser, string, TUsersState>(
    userService,
    users,
    {
        reducer: oldUsersReducer, // Reuse existing reducer logic
        selectKey: (user) => user.id
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
import type { TOIMReduxCollectionMapper } from '@oimdb/redux-adapter';

type TCustomState = { entities: Record<string, TUser>; ids: string[] };

const customMapper: TOIMReduxCollectionMapper<TUser, string, TCustomState> = (
    entityService,
    entityStoreSlot,
    updatedKeys,
    currentState
) => {
    // Your custom mapping logic
    // Only process entities in updatedKeys for performance
    const entities: Record<string, TUser> = {};
    const ids: string[] = [];

    if (currentState) {
        // Reuse existing state
        Object.assign(entities, currentState.entities);
        ids.push(...currentState.ids);
    }

    // Update only changed entities
    for (const id of updatedKeys) {
        const entity = entityService.getSlotByKey(entityStoreSlot, id).entity;
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

An index is registered as a small object rather than a bare index, because the adapter needs the entity collection the bucket members belong to. The setup above builds `keyedIndex`: users bucketed by team. `createKeyedIndexReducer` mirrors an index addressed by a key; `createGlobalIndexReducer` does the same for one bucket over the whole population (`TOIMReduxGlobalIndex`).

#### Simple One-Way Sync (OIMDB → Redux)

```typescript
import { applyMiddleware, combineReducers, createStore } from 'redux';
import type { TOIMReduxDefaultCollectionState, TOIMReduxDefaultIndexState } from '@oimdb/redux-adapter';

// Create reducer for index
const usersByTeamReducer = adapter.createKeyedIndexReducer<
    string, string, TOIMReduxDefaultIndexState<string, string>, TUser
>(keyedIndex);

// Use in Redux store with middleware
const store = createStore(
    combineReducers({
        users: adapter.createCollectionReducer<TUser, string, TOIMReduxDefaultCollectionState<TUser, string>>(userService, users),
        usersByTeam: usersByTeamReducer,
    }),
    applyMiddleware(adapter.createMiddleware())
);

adapter.setStore(store);

userService.writeSlotContentByKey(users, 'u1', { id: 'u1', name: 'Alice', teamId: 'eng' });
const alice = userService.holdSlotByKey(users, 'u1');
const eng = byTeamService.holdSlotByKey(byTeam, 'eng');
byTeamService.slotContentService.writeSlotContent(eng, [alice]);
eng.owner.unholdSlot(eng);
alice.owner.unholdSlot(alice);
db.flush();
```

A write to a user files it in no bucket: whoever writes the entity also writes the bucket it belongs to.

#### Two-Way Sync (OIMDB ↔ Redux) for Indexes

Enable bidirectional synchronization for indexes by providing a child reducer:

```typescript
import { applyMiddleware, createStore, type Action } from 'redux';
import type {
    TOIMReduxDefaultIndexState,
    TOIMReduxIndexReducerChildOptions,
} from '@oimdb/redux-adapter';

type TByTeamState = TOIMReduxDefaultIndexState<string, string>;
type TUpdateIndexKey = Action<'UPDATE_INDEX_KEY'> & { payload: { key: string; ids: string[] } };

// Child reducer handles custom Redux actions
const childReducer = (state: TByTeamState | undefined, action: Action): TByTeamState => {
    if (state === undefined) {
        return { entities: {} };
    }

    if (action.type === 'UPDATE_INDEX_KEY') {
        const { key, ids } = (action as TUpdateIndexKey).payload;
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

const childOptions: TOIMReduxIndexReducerChildOptions<string, string, TByTeamState, TUser> = {
    reducer: childReducer,
};

// Create reducer with child
const indexReducer = adapter.createKeyedIndexReducer<string, string, TByTeamState, TUser>(keyedIndex, childOptions);

// Create store with middleware
const store = createStore(
    indexReducer,
    applyMiddleware(adapter.createMiddleware())
);

adapter.setStore(store);

// Redux actions automatically sync back to OIMDB
// Middleware automatically flushes the channel after dispatch
store.dispatch({
    type: 'UPDATE_INDEX_KEY',
    payload: { key: 'eng', ids: ['u1', 'u2', 'u3'] }
});

// OIMDB bucket is automatically updated
const engBucket = byTeamService.peekSlotByKey(byTeam, 'eng');
if (engBucket !== undefined) {
    console.log(Array.from(byTeamService.slotContentService.getBucketMemberSlots(engBucket), slot => slot.key)); // ['u1', 'u2', 'u3']
}
```

A child reducer whose state is not the default shape can take `extractIndexState(prevState, nextState, keyedIndex)`.

## 📊 Performance

The adapter is optimized for large datasets:

- **Watches identities, not the store**: Each entity and bucket reports its own change; an entity that never moves is never touched

- **Batched Updates**: Changes are coalesced and dispatched once per frame

- **Selective Updates**: Only changed entities are processed

- **Memory Efficient**: Reuses state objects when possible

### Bucket Content Services

How a bucket holds its members is decided by the bucket collection's `slotContentService`, which you choose when you create it with `createOIMSlotCollectionService`:

- `OIMSetBucketContentService` keeps members in a set (insertion order, no duplicates).

- `OIMPositionalArrayBucketContentService` (the default) keeps them at positions the caller places.

- `OIMSortedArrayBucketContentService` keeps them in a sorter's order.

Whichever you pick, a bucket is written the same way, with `bucketService.slotContentService.writeSlotContent(bucketSlot, slots)`, so the adapter treats every bucket collection alike.

## 🔍 Utility Functions

### `diffOIMEntityKeys`

Efficiently find differences between two entity records (dictionaries). Keys are compared as strings, and an entry counts as updated when its value changed by reference:

```typescript
import { diffOIMEntityKeys } from '@oimdb/redux-adapter';

const ann: TUser = { id: '1', name: 'Ann', teamId: 'eng' };
const bob: TUser = { id: '2', name: 'Bob', teamId: 'eng' };
const cid: TUser = { id: '3', name: 'Cid', teamId: 'design' };

const oldEntities = { '1': ann, '2': bob };
const newEntities = { '1': { ...ann, name: 'Ann B.' }, '3': cid };

const diff = diffOIMEntityKeys(oldEntities, newEntities);
// diff.added = Set(['3'])
// diff.updated = Set(['1'])
// diff.removed = Set(['2'])
// diff.all = Set(['3', '1', '2'])
```

## 🎨 TypeScript Support

Full type safety with comprehensive TypeScript definitions:

```typescript
import type {
    TOIMReduxAdapterOptions,
    TOIMReduxCollectionMapper,
    TOIMReduxIndexMapper,
    TOIMReduxGlobalIndexMapper,
    TOIMReduxDefaultCollectionState,
    TOIMReduxDefaultIndexState,
    TOIMReduxDefaultGlobalIndexState,
    TOIMReduxCollectionReducerChildOptions,
    TOIMReduxIndexReducerChildOptions,
    TOIMReduxGlobalIndexReducerChildOptions,
    TOIMReduxGlobalIndex,
    TOIMReduxLinkedIndex,
    TOIMReduxEntityKeysDiff,
    TOIMReduxUpdateAction,
} from '@oimdb/redux-adapter';
```

## 📚 API Reference

### `OIMReduxAdapter`

Main adapter class for integrating OIMDB with Redux. Creates Redux reducers from OIMDB entity collections and bucket indexes and provides middleware that flushes the OIMDB channel after each action.

#### Methods

- `createCollectionReducer<TEntity, TPk, TState>(entityService, entityStoreSlot, child?, mapper?)`: Create reducer for an entity collection

- `createKeyedIndexReducer<TIndexKey, TPk, TState, TEntity>(keyedIndex, child?, mapper?)`: Create reducer for an index addressed by a key

- `createGlobalIndexReducer<TPk, TState, TEntity>(globalIndex, child?, mapper?)`: Create reducer for one bucket over the whole population

- `createMiddleware()`: Create Redux middleware that flushes the channel after each action

- `setStore(store)`: Set Redux store (can be called later); dispatches at once if anything moved before the store existed

- `dispose()`: Drop every subscription the adapter holds

#### Constructor Options

- `channelMap`: the `OIMDB` (or any `IOIMChannelMap`) whose default channel the adapter runs on

#### Automatic Flushing

The middleware created by `createMiddleware()` flushes the channel (the same thing `db.flush()` does) after every Redux action. The effect:

- Writes made by child reducers are processed synchronously, and projections re-run

- No manual `db.flush()` is needed when updating OIMDB from Redux

- The flush drains the whole pending frame, so an action that wrote back costs one extra `OIMDB_UPDATE` dispatch

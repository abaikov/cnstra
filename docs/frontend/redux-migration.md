---
id: redux-migration
title: Migrating from Redux to OIMDB
sidebar_label: Redux Migration
slug: /frontend/redux-migration
description: Production-ready Redux adapter for OIMDB that enables seamless integration between OIMDB's reactive in-memory database and Redux state management. Gradually migrate from Redux to OIMDB or use both systems side-by-side with automatic two-way synchronization.
keywords: [Redux migration, Redux adapter, OIMDB Redux, state management migration, Redux to OIMDB, two-way sync, gradual migration, Redux compatibility]
---

# @oimdb/redux-adapter

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

- **OIMDBReducerFactory**: Main factory for creating Redux reducers from OIMDB collections
- **Default Mappers**: RTK Entity Adapter-style mappers for collections and indexes
- **Utility Functions**: `findUpdatedInRecord` and `findUpdatedInArray` for efficient change detection
- **Type-Safe**: Full TypeScript support with comprehensive type definitions

## 🔧 Basic Usage

### Simple One-Way Sync (OIMDB → Redux)

```typescript
import { OIMDBReducerFactory } from '@oimdb/redux-adapter';
import { OIMReactiveCollection, OIMEventQueue } from '@oimdb/core';
import { createStore, combineReducers } from 'redux';

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

// Create Redux reducer factory
const factory = new OIMDBReducerFactory(queue);

// Create Redux reducer from OIMDB collection
const usersReducer = factory.createCollectionReducer(users);

// Create Redux store
const store = createStore(
    combineReducers({
        users: usersReducer,
    })
);

// Set store in factory (can be done later)
factory.setStore(store);

// OIMDB changes automatically sync to Redux
users.upsertOne({ id: '1', name: 'John', email: 'john@example.com' });
queue.flush(); // Triggers Redux update

// Redux state is automatically updated
const state = store.getState();
console.log(state.users.entities['1']); // { id: '1', name: 'John', email: 'john@example.com' }
```

### Two-Way Sync (OIMDB ↔ Redux)

Enable bidirectional synchronization by providing a child reducer:

```typescript
import { 
    OIMDBReducerFactory,
    TOIMDefaultCollectionState,
    TOIMCollectionReducerChildOptions 
} from '@oimdb/redux-adapter';
import { Action } from 'redux';

// Child reducer handles custom Redux actions
const childReducer = (
    state: TOIMDefaultCollectionState<User, string> | undefined,
    action: Action
): TOIMDefaultCollectionState<User, string> => {
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

const childOptions: TOIMCollectionReducerChildOptions<User, string, TOIMDefaultCollectionState<User, string>> = {
    reducer: childReducer,
    getPk: (user) => user.id
    // extractEntities is optional - default implementation handles TOIMDefaultCollectionState
};

// Create reducer with child
const usersReducer = factory.createCollectionReducer(users, undefined, childOptions);

// Redux actions automatically sync back to OIMDB
store.dispatch({
    type: 'UPDATE_USER_NAME',
    payload: { id: '1', name: 'John Updated' }
});
queue.flush();

// OIMDB collection is automatically updated
const user = users.getOneByPk('1');
console.log(user?.name); // 'John Updated'
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

const arrayReducer = factory.createCollectionReducer(users, arrayMapper);

// Custom extractor for array-based state
const childOptions: TOIMCollectionReducerChildOptions<User, string, ArrayBasedState> = {
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
const store = createStore(
    combineReducers({
        // Existing Redux reducers
        ui: uiReducer,
        auth: authReducer,
        
        // New OIMDB-backed reducers
        users: factory.createCollectionReducer(usersCollection),
        posts: factory.createCollectionReducer(postsCollection),
    })
);
```

### Phase 2: Migrate Existing Redux Reducers

Gradually replace Redux reducers with OIMDB collections, using child reducers to maintain compatibility:

```typescript
// Old Redux reducer
const oldUsersReducer = (state, action) => {
    // ... existing logic
};

// New OIMDB-backed reducer with compatibility layer
const newUsersReducer = factory.createCollectionReducer(
    usersCollection,
    undefined,
    {
        reducer: oldUsersReducer, // Reuse existing reducer logic
        getPk: (user) => user.id
    }
);
```

### Phase 3: Full OIMDB Migration

Once all collections are migrated, you can remove Redux entirely and use OIMDB directly with React hooks or other reactive patterns.

## 🛠️ Advanced Usage

### Custom Mappers

```typescript
const customMapper: TOIMCollectionMapper<User, string, CustomState> = (
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

```typescript
import { OIMReactiveIndexManual } from '@oimdb/core';

// Create index
const userRolesIndex = new OIMReactiveIndexManual<string, string>(queue);

// Create reducer for index
const rolesReducer = factory.createIndexReducer(userRolesIndex);

// Use in Redux store
const store = createStore(
    combineReducers({
        users: usersReducer,
        userRoles: rolesReducer,
    })
);
```

## 📊 Performance

The adapter is optimized for large datasets:

- **Efficient Diffing**: Uses optimized algorithms to detect changes
- **Batched Updates**: Changes are coalesced and applied in batches
- **Selective Updates**: Only changed entities are processed
- **Memory Efficient**: Reuses state objects when possible

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
    TOIMCollectionMapper,
    TOIMIndexMapper,
    TOIMDefaultCollectionState,
    TOIMDefaultIndexState,
    TOIMCollectionReducerChildOptions,
    TOIMUpdatedEntitiesResult,
    TOIMUpdatedArrayResult,
} from '@oimdb/redux-adapter';
```

## 📚 API Reference

### `OIMDBReducerFactory`

Main factory class for creating Redux reducers.

#### Methods

- `createCollectionReducer<TEntity, TPk, TState>(collection, mapper?, child?)`: Create reducer for a collection
- `createIndexReducer<TIndexKey, TPk, TState>(index, mapper?)`: Create reducer for an index
- `setStore(store)`: Set Redux store (can be called later)

#### Constructor Options

- `defaultCollectionMapper`: Default mapper for all collections
- `defaultIndexMapper`: Default mapper for all indexes


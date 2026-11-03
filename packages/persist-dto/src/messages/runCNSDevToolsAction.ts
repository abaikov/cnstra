import type {
    TCNSDevToolsAction,
    TCNSDevToolsActionMiddleware,
    TCNSLaunchRunAction,
    TCNSResumeRunAction,
} from './TCNSDevToolsAction';

/**
 * Run an action through a chain, in order. Resolves to `true` when some link
 * acted, `false` when the chain ran out — the caller turns that into the
 * panel's "rejected" answer instead of a button that does nothing.
 *
 * Calling `next()` twice from one link is a programming error, not a retry, so
 * it throws rather than quietly running the rest of the chain again.
 */
export const runCNSDevToolsAction = async (
    chain: readonly TCNSDevToolsActionMiddleware[],
    action: TCNSDevToolsAction
): Promise<boolean> => {
    let handled = true;

    const dispatch = async (index: number): Promise<void> => {
        if (index === chain.length) {
            // Nobody acted: every link passed the action along.
            handled = false;
            return;
        }

        let called = false;
        await chain[index](action, () => {
            if (called) {
                throw new Error(
                    '[@cnstra/persist-dto] a DevTools action middleware called next() twice'
                );
            }
            called = true;
            return dispatch(index + 1);
        });
    };

    await dispatch(0);
    return handled;
};

/**
 * Author a link that only cares about **Retry**. Anything else passes straight
 * through, so a chain of these needs no `switch` on the action type.
 */
export const onCNSResume = (
    handle: (
        action: TCNSResumeRunAction,
        next: () => Promise<void>
    ) => Promise<void>
): TCNSDevToolsActionMiddleware => {
    return (action, next) =>
        action.type === 'resume' ? handle(action, next) : next();
};

/** Author a link that only cares about **Clone/Replay**. */
export const onCNSLaunch = (
    handle: (
        action: TCNSLaunchRunAction,
        next: () => Promise<void>
    ) => Promise<void>
): TCNSDevToolsActionMiddleware => {
    return (action, next) =>
        action.type === 'launch' ? handle(action, next) : next();
};

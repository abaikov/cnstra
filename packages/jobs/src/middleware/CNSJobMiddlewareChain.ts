export class CNSJobMiddlewareChain {
    static compose<TContext, TResult>(
        middlewares: ReadonlyArray<(context: TContext, next: () => Promise<TResult>) => Promise<TResult>>,
        terminal: (context: TContext) => Promise<TResult>
    ): (context: TContext) => Promise<TResult> {
        return context => {
            const dispatch = (index: number): Promise<TResult> => {
                const middleware = middlewares[index];
                try {
                    if (!middleware) return Promise.resolve(terminal(context));
                    let called = false;
                    return Promise.resolve(
                        middleware(context, () => {
                            if (called) return Promise.reject(new Error('[@cnstra/jobs] middleware called next() twice'));
                            called = true;
                            return dispatch(index + 1);
                        })
                    );
                } catch (error) {
                    return Promise.reject(error);
                }
            };
            return dispatch(0);
        };
    }
}

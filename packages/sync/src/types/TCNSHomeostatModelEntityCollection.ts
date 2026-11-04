export type TCNSHomeostatModelEntityCollection<TEntity extends object, THandle> = {
    readonly handle: THandle;
    peekEntity(id: string | number): TEntity | undefined;
    writeEntity(entity: TEntity): boolean;
};

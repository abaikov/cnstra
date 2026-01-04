export type TCNSAfferentPath<
    TName extends string,
    TParentAfferentPathName extends string
> = {
    name: TName;
    parentAfferentPathName?: TParentAfferentPathName;
};

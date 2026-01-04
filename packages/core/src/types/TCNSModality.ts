import { TCNSAfferentPath } from './TCNSAfferentPath';

export type TCNSModality<
    TName extends string,
    TAfferentPathName extends string,
    TParentAfferentPathName extends string
> = {
    name: TName;
    afferentPaths: {
        [P in TAfferentPathName]: TCNSAfferentPath<P, TParentAfferentPathName>;
    };
};

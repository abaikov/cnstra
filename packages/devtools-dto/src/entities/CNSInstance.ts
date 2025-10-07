import type { DevToolsAppId } from './DevToolsApp';

export type CNSId = string; // `${appId}:${cnsName}`

export interface CNSInstance {
    cnsId: CNSId;
    appId: DevToolsAppId;
    cnsName: string;
}

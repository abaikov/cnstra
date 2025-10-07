import { DevToolsApp } from '../entities/DevToolsApp';

export interface AppsActiveMessage {
    type: 'apps:active';
    apps: DevToolsApp[];
}

export interface AppDisconnectedMessage {
    type: 'app:disconnected';
    appId: string;
}

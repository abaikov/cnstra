export type DevToolsAppId = string;

export interface DevToolsApp {
    appId: DevToolsAppId; // "ecommerce-app"
    appName: string; // human friendly
    version: string; // app version
    /** Timestamp when this app was first seen by the server */
    firstSeenAt: number;
    /** Timestamp when this app last sent a message to the server */
    lastSeenAt: number;
}

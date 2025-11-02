export type TCNSDevToolsOptions = {
    /** Optional explicit CNS instance id; if omitted, will be derived as `${appId}:${devToolsInstanceName || 'cns'}` */
    cnsId?: string;
    /** Legacy fields kept for backward compatibility */
    devToolsInstanceId?: string;
    devToolsInstanceName?: string;

    /** When true, print detailed console logs for init/topology, responses and commands */
    consoleLogEnabled?: boolean;

    takeDataSnapshot?: () => object | Promise<object>;
};

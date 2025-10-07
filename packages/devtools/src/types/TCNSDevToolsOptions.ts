export type TCNSDevToolsOptions = {
    /** Optional explicit CNS instance id; if omitted, will be derived as `${appId}:${devToolsInstanceName || 'cns'}` */
    cnsId?: string;
    /** Legacy fields kept for backward compatibility */
    devToolsInstanceId?: string;
    devToolsInstanceName?: string;

    takeDataSnapshot?: () => object | Promise<object>;
};

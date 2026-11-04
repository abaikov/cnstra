export type TCNSDevToolsHttpRequest = {
    method: string;
    url: URL;
    accept: string | undefined;
    contentType: string | undefined;
    readBody(): Promise<string>;
};

export type TCNSPollingFetch = (input: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

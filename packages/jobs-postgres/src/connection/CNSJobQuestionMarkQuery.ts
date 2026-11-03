export class CNSJobQuestionMarkQuery {
    static convert(text: string, params: readonly unknown[]): { text: string; params: unknown[] } {
        const ordered: unknown[] = [];
        const converted = text.replace(/\?/g, '\\?').replace(/\$(\d+)/g, (_, position: string) => {
            ordered.push(params[Number(position) - 1]);
            return '?';
        });
        return { text: converted, params: ordered };
    }
}

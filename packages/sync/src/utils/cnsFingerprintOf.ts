export function cnsFingerprintOf(text: string): string {
    let fingerprint = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        fingerprint ^= text.charCodeAt(index);
        fingerprint = Math.imul(fingerprint, 0x01000193) >>> 0;
    }
    return fingerprint.toString(16).padStart(8, '0');
}

export type TCNSDebouncedProgressRecordingStrategyOptions = {
    /** Write once responses go quiet for this long (default 250ms). */
    debounceMs?: number;
    /** ...but never wait longer than this between writes (default 2000ms). */
    maxStalenessMs?: number;
};

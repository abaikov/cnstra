export type TCNSOptions = {
    /**
     * Automatically cleanup context stores when the stimulation is finished.
     * Default is false.
     *
     * CAN AFFECT PERFORMANCE!
     * Better to use only to solve problems with memory quickly.
     */
    autoCleanupContexts?: boolean;
};

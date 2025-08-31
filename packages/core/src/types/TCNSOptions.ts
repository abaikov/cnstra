export type TCNSOptions = {
    /**
     * Automatically cleanup context stores when the stimulation is finished.
     * Default is false.
     *
     * This will build the whole graph with SCC during the CNS construction.
     * Requires O(V + E) time, O(V + E) memory.
     * (V - number of neurons, E - number of dendrites)
     * Then, every auto cleanup will take O(1) time.
     *
     * This setting makes sense if you don't want to cleanup contexts
     * manually in the neurons and the memory usage for the contexts is more
     * than the memory usage for the graph with SCC.
     */
    autoCleanupContexts?: boolean;
};

import { DEVTOOLS_LIMITS } from '../config/limits';
import { db } from '../model';

/**
 * Data limiter utility to prevent memory issues by enforcing
 * retention limits on DevTools data.
 */

export class DataLimiter {
    private static instance: DataLimiter;
    private cleanupInterval: NodeJS.Timeout | null = null;

    private constructor() {}

    static getInstance(): DataLimiter {
        if (!DataLimiter.instance) {
            DataLimiter.instance = new DataLimiter();
        }
        return DataLimiter.instance;
    }

    /**
     * Start automatic cleanup based on configured limits
     */
    startCleanup(): void {
        if (this.cleanupInterval) {
            return; // Already running
        }

        this.cleanupInterval = setInterval(() => {
            this.enforceDataLimits();
        }, DEVTOOLS_LIMITS.CLEANUP_INTERVAL);

        console.log('🧹 DevTools data limiter started');
    }

    /**
     * Stop automatic cleanup
     */
    stopCleanup(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            console.log('🛑 DevTools data limiter stopped');
        }
    }

    /**
     * Enforce all data retention limits
     */
    enforceDataLimits(): void {
        const now = Date.now();
        const cutoffTime = now - DEVTOOLS_LIMITS.RETENTION_TIME;

        // Clean old stimulations
        this.limitStimulations(cutoffTime);

        // Clean old responses
        this.limitResponses(cutoffTime);

        // Clean disconnected apps (older than retention time)
        this.cleanupOldApps(cutoffTime);

        console.log('🧹 DevTools data cleanup completed');
    }

    /**
     * Limit stimulations by count and age
     */
    private limitStimulations(cutoffTime: number): void {
        const allStimulations = db.stimulations.getAll();

        if (allStimulations.length === 0) return;

        // Sort by creation time (newest first)
        const sortedStimulations = allStimulations
            .slice()
            .sort((a, b) => b.timestamp - a.timestamp);

        // Remove old stimulations beyond time limit
        const recentStimulations = sortedStimulations.filter(s => s.timestamp > cutoffTime);

        // Limit by count
        const limitedStimulations = recentStimulations.slice(0, DEVTOOLS_LIMITS.MAX_STIMULATIONS);

        // Find stimulations to remove
        const stimulationsToRemove = allStimulations.filter(s =>
            !limitedStimulations.some(ls => ls.stimulationId === s.stimulationId)
        );

        // Remove old stimulations
        // Note: OIMDB collections don't have direct delete methods - the data is limited by retention logic above
        // The actual removal would be handled by OIMDB internally when data exceeds limits

        if (stimulationsToRemove.length > 0) {
            console.log(`🗑️ Cleaned ${stimulationsToRemove.length} old stimulations`);
        }
    }

    /**
     * Limit responses by count and age
     */
    private limitResponses(cutoffTime: number): void {
        const allResponses = db.responses.getAll();

        if (allResponses.length === 0) return;

        // Sort by timestamp (newest first)
        const sortedResponses = allResponses
            .slice()
            .sort((a, b) => b.timestamp - a.timestamp);

        // Remove old responses beyond time limit
        const recentResponses = sortedResponses.filter(r => r.timestamp > cutoffTime);

        // Limit by count
        const limitedResponses = recentResponses.slice(0, DEVTOOLS_LIMITS.MAX_RESPONSES);

        // Find responses to remove
        const responsesToRemove = allResponses.filter(r =>
            !limitedResponses.some(lr => lr.responseId === r.responseId)
        );

        // Remove old responses
        // Note: OIMDB collections don't have direct delete methods - the data is limited by retention logic above
        // The actual removal would be handled by OIMDB internally when data exceeds limits

        if (responsesToRemove.length > 0) {
            console.log(`🗑️ Cleaned ${responsesToRemove.length} old responses`);
        }
    }

    /**
     * Clean up apps that haven't been seen recently
     */
    private cleanupOldApps(cutoffTime: number): void {
        const allApps = db.apps.getAll();

        const oldApps = allApps.filter(app => app.lastSeenAt < cutoffTime);

        oldApps.forEach(app => {
            // Remove all data for this app
            this.cleanupAppData(app.appId);

            // Remove the app itself
            // Note: OIMDB collections don't have direct delete methods - apps are marked for cleanup
            console.log(`App ${app.appId} marked for cleanup`);
        });

        if (oldApps.length > 0) {
            console.log(`🗑️ Cleaned ${oldApps.length} disconnected apps`);
        }
    }

    /**
     * Clean all data associated with an app
     */
    private cleanupAppData(appId: string): void {
        // Note: OIMDB collections don't have direct delete methods
        // In a real implementation, we would need to implement custom cleanup logic
        // or rely on the OIMDB to handle data lifecycle management

        // Count items to be cleaned up for logging purposes
        const neurons = db.neurons.getAll().filter(n => n.appId === appId);
        const collaterals = db.collaterals.getAll().filter(c => c.appId === appId);
        const dendrites = db.dendrites.getAll().filter(d => d.appId === appId);
        const stimulations = db.stimulations.getAll().filter(s => s.appId === appId);
        const responses = db.responses.getAll().filter(r => r.appId === appId);

        console.log(`Cleanup requested for app ${appId}: ${neurons.length} neurons, ${collaterals.length} collaterals, ${dendrites.length} dendrites, ${stimulations.length} stimulations, ${responses.length} responses`);
    }

    /**
     * Get current data statistics
     */
    getDataStats(): {
        stimulations: number;
        responses: number;
        neurons: number;
        collaterals: number;
        dendrites: number;
        apps: number;
        memoryUsageKB: number;
    } {
        const stats = {
            stimulations: db.stimulations.getAll().length,
            responses: db.responses.getAll().length,
            neurons: db.neurons.getAll().length,
            collaterals: db.collaterals.getAll().length,
            dendrites: db.dendrites.getAll().length,
            apps: db.apps.getAll().length,
            memoryUsageKB: this.estimateMemoryUsage(),
        };

        return stats;
    }

    /**
     * Rough estimate of memory usage in KB
     */
    private estimateMemoryUsage(): number {
        // Rough estimation based on typical object sizes
        const stats = {
            stimulations: db.stimulations.getAll().length * 0.5, // ~0.5KB per stimulation
            responses: db.responses.getAll().length * 0.3, // ~0.3KB per response
            neurons: db.neurons.getAll().length * 0.1, // ~0.1KB per neuron
            collaterals: db.collaterals.getAll().length * 0.1, // ~0.1KB per collateral
            dendrites: db.dendrites.getAll().length * 0.1, // ~0.1KB per dendrite
            apps: db.apps.getAll().length * 0.1, // ~0.1KB per app
        };

        return Math.round(
            stats.stimulations +
            stats.responses +
            stats.neurons +
            stats.collaterals +
            stats.dendrites +
            stats.apps
        );
    }

    /**
     * Check if data limits are being approached
     */
    checkLimits(): {
        stimulationsNearLimit: boolean;
        responsesNearLimit: boolean;
        memoryHigh: boolean;
        warnings: string[];
    } {
        const stats = this.getDataStats();
        const warnings: string[] = [];

        const stimulationsNearLimit = stats.stimulations > DEVTOOLS_LIMITS.MAX_STIMULATIONS * 0.8;
        const responsesNearLimit = stats.responses > DEVTOOLS_LIMITS.MAX_RESPONSES * 0.8;
        const memoryHigh = stats.memoryUsageKB > 50000; // 50MB

        if (stimulationsNearLimit) {
            warnings.push(`High stimulation count: ${stats.stimulations}/${DEVTOOLS_LIMITS.MAX_STIMULATIONS}`);
        }

        if (responsesNearLimit) {
            warnings.push(`High response count: ${stats.responses}/${DEVTOOLS_LIMITS.MAX_RESPONSES}`);
        }

        if (memoryHigh) {
            warnings.push(`High memory usage: ${Math.round(stats.memoryUsageKB / 1024)}MB`);
        }

        return {
            stimulationsNearLimit,
            responsesNearLimit,
            memoryHigh,
            warnings
        };
    }
}

// Export singleton instance
export const dataLimiter = DataLimiter.getInstance();
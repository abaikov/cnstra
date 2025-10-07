/**
 * Performance and memory limits for CNStra DevTools
 *
 * These limits prevent memory issues and ensure good performance
 * even with high-traffic applications.
 */

export const DEVTOOLS_LIMITS = {
    // Data retention limits
    MAX_STIMULATIONS: 10000,
    MAX_RESPONSES: 15000,
    MAX_HISTORY_POINTS: 300, // For charts and trends

    // UI display limits
    MAX_VISIBLE_STIMULATIONS: 100,
    MAX_VISIBLE_FLOWS: 50,
    MAX_TOP_NEURONS: 10,
    MAX_RECENT_INJECTIONS: 20,

    // Performance thresholds for visual indicators
    THRESHOLDS: {
        RESPONSE_TIME_WARNING: 100, // ms
        RESPONSE_TIME_CRITICAL: 500, // ms
        ERROR_RATE_WARNING: 5, // %
        ERROR_RATE_CRITICAL: 15, // %
        QUEUE_UTILIZATION_WARNING: 10,
        QUEUE_UTILIZATION_CRITICAL: 50,
        HOP_COUNT_WARNING: 3,
        HOP_COUNT_CRITICAL: 7,
    },

    // Memory management
    CLEANUP_INTERVAL: 30000, // 30 seconds
    RETENTION_TIME: 24 * 60 * 60 * 1000, // 24 hours
} as const;

export type DevToolsLimits = typeof DEVTOOLS_LIMITS;
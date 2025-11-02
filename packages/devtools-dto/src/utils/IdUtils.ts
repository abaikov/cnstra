import { NeuronId } from '../entities/Neuron';
import { DendriteId } from '../entities/Dendrite';
import { CollateralId } from '../entities/Collateral';
import { DevToolsAppId } from '../entities/DevToolsApp';

/**
 * Centralized utilities for formatting and parsing DevTools entity IDs.
 *
 * ID Format Conventions:
 * - NeuronId: `${cnsId}:${neuronName}` (e.g., "myApp:myNeuron")
 * - CollateralId: `${neuronId}:${collateralName}` (e.g., "myApp:myNeuron:userCreated")
 * - DendriteId: `${cnsId}:${neuronName}:d:${collateralName}` (e.g., "myApp:myNeuron:d:userCreated")
 * - CNS ID: `${appId}:${cnsName}` or just appId for single-CNS apps
 */
export const IdUtils = {
    /**
     * Format a neuron ID from CNS ID and neuron name.
     * @example formatNeuronId("myApp:core", "userProcessor") => "myApp:core:userProcessor"
     */
    formatNeuronId(cnsId: string, neuronName: string): NeuronId {
        if (!cnsId) throw new Error('cnsId is required');
        if (!neuronName) throw new Error('neuronName is required');
        return `${cnsId}:${neuronName}` as NeuronId;
    },

    /**
     * Parse a neuron ID into CNS ID and neuron name.
     * @example parseNeuronId("myApp:core:userProcessor") => { cnsId: "myApp:core", neuronName: "userProcessor" }
     */
    parseNeuronId(id: NeuronId): { cnsId: string; neuronName: string } {
        if (!id) throw new Error('neuronId is required');
        const parts = id.split(':');
        if (parts.length < 2) {
            throw new Error(
                `Invalid neuronId format: "${id}". Expected format: "cnsId:neuronName"`
            );
        }
        const neuronName = parts.pop()!;
        const cnsId = parts.join(':');
        return { cnsId, neuronName };
    },

    /**
     * Extract neuron name from a neuron ID (last segment after :).
     * @example extractNeuronName("myApp:core:userProcessor") => "userProcessor"
     */
    extractNeuronName(id: NeuronId): string {
        return this.parseNeuronId(id).neuronName;
    },

    /**
     * Extract CNS ID from a neuron ID (all segments except last).
     * @example extractCnsIdFromNeuronId("myApp:core:userProcessor") => "myApp:core"
     */
    extractCnsIdFromNeuronId(id: NeuronId): string {
        return this.parseNeuronId(id).cnsId;
    },

    /**
     * Format a collateral ID from neuron ID and collateral name.
     * @example formatCollateralId("myApp:core:userService", "user-created") => "myApp:core:userService:user-created"
     */
    formatCollateralId(
        neuronId: NeuronId,
        collateralName: string
    ): CollateralId {
        if (!neuronId) throw new Error('neuronId is required');
        if (!collateralName) throw new Error('collateralName is required');
        return `${neuronId}:${collateralName}` as CollateralId;
    },

    /**
     * Parse a collateral ID into neuron ID and collateral name.
     * @example parseCollateralId("myApp:core:userService:user-created") =>
     *   { neuronId: "myApp:core:userService", collateralName: "user-created" }
     */
    parseCollateralId(id: CollateralId): {
        neuronId: NeuronId;
        collateralName: string;
    } {
        if (!id) throw new Error('collateralId is required');
        const lastColonIndex = id.lastIndexOf(':');
        if (lastColonIndex === -1) {
            throw new Error(
                `Invalid collateralId format: "${id}". Expected format: "neuronId:collateralName"`
            );
        }
        const neuronId = id.substring(0, lastColonIndex) as NeuronId;
        const collateralName = id.substring(lastColonIndex + 1);
        return { neuronId, collateralName };
    },

    /**
     * Format a dendrite ID from CNS ID, neuron name, and collateral name.
     * Spaces in collateral names are replaced with hyphens.
     * @example formatDendriteId("myApp:core", "userProcessor", "user:created") => "myApp:core:userProcessor:d:user:created"
     */
    formatDendriteId(
        cnsId: string,
        neuronName: string,
        collateralName: string
    ): DendriteId {
        if (!cnsId) throw new Error('cnsId is required');
        if (!neuronName) throw new Error('neuronName is required');
        if (!collateralName) throw new Error('collateralName is required');
        return `${cnsId}:${neuronName}:d:${collateralName}`.replace(
            /\s+/g,
            '-'
        ) as DendriteId;
    },

    /**
     * Parse a dendrite ID into its components.
     * @example parseDendriteId("myApp:core:userProcessor:d:user:created") =>
     *   { cnsId: "myApp:core", neuronName: "userProcessor", collateralName: "user:created" }
     */
    parseDendriteId(id: DendriteId): {
        cnsId: string;
        neuronName: string;
        collateralName: string;
    } {
        if (!id) throw new Error('dendriteId is required');
        const match = id.match(/^(.+):([^:]+):d:(.+)$/);
        if (!match) {
            throw new Error(
                `Invalid dendriteId format: "${id}". Expected format: "cnsId:neuronName:d:collateralName"`
            );
        }
        const [, cnsId, neuronName, collateralName] = match;
        return { cnsId, neuronName, collateralName };
    },

    /**
     * Normalize a collateral name by removing optional prefixes.
     * Handles both "app:collateral:name" and plain "name" formats.
     * @example normalizeCollateralName("myApp:collateral:userCreated") => "userCreated"
     * @example normalizeCollateralName("userCreated") => "userCreated"
     */
    normalizeCollateralName(collateralName?: string): string {
        if (!collateralName) return '';
        return collateralName.replace(/^.*:collateral:/, '');
    },

    /**
     * Check if a neuron ID matches a given neuron name (handles prefixed IDs).
     * @example matchesNeuronName("myApp:core:userProcessor", "userProcessor") => true
     */
    matchesNeuronName(neuronId: NeuronId, neuronName: string): boolean {
        try {
            return this.extractNeuronName(neuronId) === neuronName;
        } catch {
            return neuronId === neuronName;
        }
    },

    /**
     * Format a CNS ID from app ID and CNS name.
     * @example formatCnsId("myApp", "core") => "myApp:core"
     */
    formatCnsId(appId: DevToolsAppId, cnsName: string): string {
        if (!appId) throw new Error('appId is required');
        if (!cnsName) throw new Error('cnsName is required');
        return `${appId}:${cnsName}`;
    },

    /**
     * Parse CNS ID into app ID and CNS name.
     * For single-CNS apps (no colon), returns the whole ID as appId with 'cns' as cnsName.
     * @example parseCnsId("myApp:core") => { appId: "myApp", cnsName: "core" }
     * @example parseCnsId("myApp") => { appId: "myApp", cnsName: "cns" }
     */
    parseCnsId(cnsId: string): { appId: DevToolsAppId; cnsName: string } {
        if (!cnsId) throw new Error('cnsId is required');
        const colonIndex = cnsId.indexOf(':');
        if (colonIndex === -1) {
            // Single-CNS app
            return { appId: cnsId as DevToolsAppId, cnsName: 'cns' };
        }
        const appId = cnsId.substring(0, colonIndex) as DevToolsAppId;
        const cnsName = cnsId.substring(colonIndex + 1);
        return { appId, cnsName };
    },
};

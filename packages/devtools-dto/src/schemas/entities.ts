import { z } from 'zod';

export const CNSAppDTOSchema = z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
});

// Topology is identified by NAME within a cns (names are unique per cns). The wire
// carries no derived `cnsId:name` ids — the panel keys these by the composite
// (cnsId, name) and builds any graph node-id string only at render.
export const CNSNeuronDTOSchema = z.object({
    name: z.string(),
    cnsId: z.string(),
    appId: z.string(),
});

export const CNSCollateralDTOSchema = z.object({
    name: z.string(),
    /** Owner (emitting) neuron by name; absent ⇒ an entry/external collateral (no axon owns it). */
    ownerNeuronName: z.string().optional(),
    cnsId: z.string(),
    appId: z.string(),
});

export const CNSDendriteDTOSchema = z.object({
    /** Subscriber neuron by name. */
    neuronName: z.string(),
    /** Subscribed collateral by name. */
    collateralName: z.string(),
    cnsId: z.string(),
    appId: z.string(),
});

export type TCNSAppDTO = z.infer<typeof CNSAppDTOSchema>;
export type TCNSNeuronDTO = z.infer<typeof CNSNeuronDTOSchema>;
export type TCNSCollateralDTO = z.infer<typeof CNSCollateralDTOSchema>;
export type TCNSDendriteDTO = z.infer<typeof CNSDendriteDTOSchema>;

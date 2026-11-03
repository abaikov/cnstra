import {
    CNSAppDTOSchema,
    CNSCollateralDTOSchema,
    CNSDendriteDTOSchema,
    CNSNeuronDTOSchema,
} from '.././entities';
import {
    CNSAppCommandDTOSchema,
    CNSStimulationLaunchCommandDTOSchema,
    CNSStimulationResumeCommandDTOSchema,
} from '.././app-commands';
import { CNSServerMessageDTOSchema } from '.././server-messages';

/**
 * These schemas ARE the contract between the app, the server and the panel. They
 * are the only runtime validation in the devtools stack, and nothing else checks
 * that the three agree — so what each one accepts and rejects is pinned here.
 */

describe('topology entities', () => {
    it('accepts a well-formed app', () => {
        expect(
            CNSAppDTOSchema.safeParse({
                id: 'app-1',
                name: 'orders',
                version: '1.0.0',
            }).success
        ).toBe(true);
    });

    it('rejects an app with a missing field rather than filling in a default', () => {
        const parsed = CNSAppDTOSchema.safeParse({
            id: 'app-1',
            name: 'orders',
        });
        expect(parsed.success).toBe(false);
    });

    it('identifies topology by name, never by a derived id', () => {
        const parsed = CNSNeuronDTOSchema.safeParse({
            name: 'validateOrder',
            cnsId: 'cns-1',
            appId: 'app-1',
        });
        expect(parsed.success).toBe(true);
        // The old id-based shape must not sneak back in as an accepted extra.
        expect(Object.keys(parsed.success ? parsed.data : {})).not.toContain('id');
    });

    it('lets a collateral have no owner — an entry collateral has none', () => {
        expect(
            CNSCollateralDTOSchema.safeParse({
                name: 'order.created',
                cnsId: 'cns-1',
                appId: 'app-1',
            }).success
        ).toBe(true);
    });

    it('requires both ends of a dendrite', () => {
        expect(
            CNSDendriteDTOSchema.safeParse({
                neuronName: 'charge',
                cnsId: 'cns-1',
                appId: 'app-1',
            }).success
        ).toBe(false);
    });
});

describe('app commands', () => {
    const resume = {
        type: 'cns.stimulation.resume' as const,
        requestId: 'r1',
        stimulationId: 'order-42',
        stimulationAttemptId: 'order-42#2',
        attemptNumber: 2,
        entry: { collateralName: 'input', payload: null },
        progress: { tasks: [] },
    };

    const launch = {
        type: 'cns.stimulation.launch' as const,
        requestId: 'r1',
        stimulationId: 'order-42-clone-1-a',
        stimulationAttemptId: 'order-42-clone-1-a#1',
        entry: { collateralName: 'input', payload: null },
    };

    it('accepts a resume command', () => {
        expect(CNSStimulationResumeCommandDTOSchema.safeParse(resume).success).toBe(
            true
        );
    });

    it('rejects attempt number zero — attempts are 1-based', () => {
        expect(
            CNSStimulationResumeCommandDTOSchema.safeParse({
                ...resume,
                attemptNumber: 0,
            }).success
        ).toBe(false);
    });

    it('rejects a fractional attempt number', () => {
        expect(
            CNSStimulationResumeCommandDTOSchema.safeParse({
                ...resume,
                attemptNumber: 1.5,
            }).success
        ).toBe(false);
    });

    it('carries clone provenance when the server sends it', () => {
        const parsed = CNSStimulationLaunchCommandDTOSchema.safeParse({
            ...launch,
            replayOf: 'order-42#1',
        });
        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data.replayOf).toBe('order-42#1');
    });

    it('still accepts a command with no provenance — the field is optional', () => {
        expect(CNSStimulationLaunchCommandDTOSchema.safeParse(launch).success).toBe(
            true
        );
    });

    it('discriminates the two commands by type', () => {
        const asResume = CNSAppCommandDTOSchema.safeParse(resume);
        const asLaunch = CNSAppCommandDTOSchema.safeParse(launch);

        expect(asResume.success && asResume.data.type).toBe(
            'cns.stimulation.resume'
        );
        expect(asLaunch.success && asLaunch.data.type).toBe(
            'cns.stimulation.launch'
        );
    });

    it('rejects an unknown command type instead of passing it through', () => {
        expect(
            CNSAppCommandDTOSchema.safeParse({ ...resume, type: 'cns.stimulation.nope' })
                .success
        ).toBe(false);
    });

    it('rejects a launch command that is missing the entry signal', () => {
        const { entry: _entry, ...withoutEntry } = launch;
        expect(
            CNSStimulationLaunchCommandDTOSchema.safeParse(withoutEntry).success
        ).toBe(false);
    });
});

describe('panel action replies', () => {
    it('parses every launch and command reply the server sends', () => {
        const replies = [
            { type: 'stimulation.launch.accepted', requestId: 'r', newStimulationId: 'checkout-1' },
            { type: 'stimulation.launch.rejected', requestId: 'r', reason: 'no runtime accepted the launch' },
            { type: 'stimulation.command.accepted', requestId: 'r', stimulationId: 's1' },
            { type: 'stimulation.command.rejected', requestId: 'r', stimulationId: 's1', reason: 'job is running' },
        ];
        expect(replies.map(reply => CNSServerMessageDTOSchema.safeParse(reply).success)).toEqual([true, true, true, true]);
    });

    it('rejects a launch acceptance without the new stimulation id', () => {
        expect(CNSServerMessageDTOSchema.safeParse({ type: 'stimulation.launch.accepted', requestId: 'r' }).success).toBe(false);
    });
});

import { z } from 'zod';

export const CNS_DEVTOOLS_PANEL_CONFIG_ELEMENT_ID = 'cnstra-devtools-config';

export const CNSDevToolsPanelConfigSchema = z.object({
    basePath: z.string(),
    transport: z.enum(['polling', 'socket']),
    readOnly: z.boolean(),
});

export type TCNSDevToolsPanelConfig = z.infer<typeof CNSDevToolsPanelConfigSchema>;

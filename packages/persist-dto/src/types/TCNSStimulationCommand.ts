export type TCNSStimulationCommand = { name: 'cancel' } | { name: 'runNow' } | { name: 'prioritize'; priority: number };

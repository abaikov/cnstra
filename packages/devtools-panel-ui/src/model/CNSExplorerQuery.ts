import type { TCNSExplorerQuery } from '../types/TCNSExplorerQuery';
import type { TCNSExplorerTab } from '../types/TCNSExplorerTab';
import { DEFAULT_EXPLORER_QUERY } from './constants/DEFAULT_EXPLORER_QUERY';
import { EXPLORER_TABS } from './constants/EXPLORER_TABS';

export class CNSExplorerQuery {
    public static encode(query: TCNSExplorerQuery): string {
        const parameters = new URLSearchParams();
        if (query.scopeName) parameters.set('scope', query.scopeName);
        if (query.status) parameters.set('status', query.status);
        if (query.entryCollateralName) parameters.set('col', query.entryCollateralName);
        if (query.neuronName) parameters.set('neuron', query.neuronName);
        if (query.text) parameters.set('q', query.text);
        if (query.since != null) parameters.set('since', String(query.since));
        if (query.until != null) parameters.set('until', String(query.until));
        if (query.entryOnly) parameters.set('entry', '1');
        if (query.tab !== DEFAULT_EXPLORER_QUERY.tab) parameters.set('tab', query.tab);
        if (query.selected) parameters.set('sel', query.selected);
        if (query.selectedNeuron) parameters.set('sn', query.selectedNeuron);
        if (query.selectedCollateral) parameters.set('sc', query.selectedCollateral);
        if (query.selectedTask) parameters.set('st', query.selectedTask);
        if (query.navTrail?.length) parameters.set('nav', query.navTrail.join('~'));
        if (query.metricPath) parameters.set('metric', query.metricPath);
        return parameters.toString();
    }

    public static decode(search: string): TCNSExplorerQuery {
        const parameters = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
        const tab = parameters.get('tab');
        return {
            scopeName: parameters.get('scope') ?? undefined,
            status: parameters.get('status') ?? undefined,
            entryCollateralName: parameters.get('col') ?? undefined,
            neuronName: parameters.get('neuron') ?? undefined,
            text: parameters.get('q') ?? undefined,
            since: CNSExplorerQuery.numberOf(parameters, 'since'),
            until: CNSExplorerQuery.numberOf(parameters, 'until'),
            entryOnly: parameters.get('entry') === '1' ? true : undefined,
            tab: CNSExplorerQuery.isExplorerTab(tab) ? tab : DEFAULT_EXPLORER_QUERY.tab,
            selected: parameters.get('sel') ?? undefined,
            selectedNeuron: parameters.get('sn') ?? undefined,
            selectedCollateral: parameters.get('sc') ?? undefined,
            selectedTask: parameters.get('st') ?? undefined,
            navTrail: parameters.get('nav')?.split('~').filter(Boolean) ?? undefined,
            metricPath: parameters.get('metric') ?? undefined,
        };
    }

    private static numberOf(parameters: URLSearchParams, name: string): number | undefined {
        const value = parameters.get(name);
        if (value == null) return undefined;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    private static isExplorerTab(value: string | null): value is TCNSExplorerTab {
        return EXPLORER_TABS.some(tab => tab === value);
    }
}

import type { TCNSTypeaheadOptions } from '../../types/TCNSTypeaheadOptions';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';

export const collateralTypeaheadOptions: TCNSTypeaheadOptions = {
    placeholder: 'filter by collateral…',
    namesOf: c => [...new Set((CNSExplorerReads.topologyOf(c)?.collaterals ?? []).map(collateral => collateral.name))].sort(),
    patchOf: name => ({ entryCollateralName: name, tab: 'collaterals' }),
};

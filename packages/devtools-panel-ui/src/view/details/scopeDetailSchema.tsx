import type { TExoAttrPort, TExoChildrenPort, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';

export const scopeDetailSchema = exoJsx<{ card: TExoChildrenPort; scheduled: TExoChildrenPort; headingTone: TExoAttrPort; heading: TExoTextPort; caption: TExoTextPort; emptyHidden: TExoAttrPort; empty: TExoTextPort; rows: TExoChildrenPort }>($ => (
    <div class="exp-detail">
        <$.card />
        <$.scheduled />
        <div class="exp-detail-section">
            <div class="exp-detail-section-head">
                <div class="exp-heading eyebrow" data-tone={$.headingTone}>{$.heading}</div>
                <span class="exp-detail-caption">{$.caption}</span>
            </div>
            <div class="exp-detail-empty" hidden={$.emptyHidden}>{$.empty}</div>
            <div class="exp-detail-rows"><$.rows /></div>
        </div>
    </div>
));

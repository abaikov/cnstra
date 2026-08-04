// Shared inline-style constants for the "Rotting Flesh" panels, previously
// copy-pasted (as PANEL / EMPTY / PANEL_STYLE / SECTION_H) across UI files.

/** A standard panel container (infected border + glow). */
export const PANEL =
    'background:var(--bg-panel);border:2px solid var(--border-infected);border-radius:var(--radius-sm);' +
    'padding:var(--spacing-sm);font-size:var(--font-size-xs);color:var(--text-primary);' +
    'font-family:var(--font-primary);box-shadow:0 0 10px var(--shadow-infection);width:100%';

/** An empty/"not available" panel (muted, centered). */
export const EMPTY_PANEL =
    'background:var(--bg-panel);border:2px solid var(--border-primary);border-radius:var(--radius-sm);' +
    'padding:var(--spacing-sm);font-size:var(--font-size-xs);color:var(--text-muted);text-align:center';

/** A small bold section heading. */
export const SECTION_H =
    'margin-bottom:var(--spacing-xs);font-size:11px;font-weight:bold';

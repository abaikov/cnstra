export function rememberCNSHomeostasisSlotQueryValue<THomeostasisState, TSlotQuery>(
    slotQueryByHomeostasisState: Map<THomeostasisState, TSlotQuery>,
    slotQuery: TSlotQuery,
    previousHomeostasisState: THomeostasisState | undefined,
    homeostasisState: THomeostasisState
): THomeostasisState {
    if (homeostasisState !== previousHomeostasisState) slotQueryByHomeostasisState.set(homeostasisState, slotQuery);
    return homeostasisState;
}

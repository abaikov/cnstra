export type TCNSMobXHomeostatEntryMemberHold<TEntry> = {
    holdMembers(entry: TEntry): void;
    unholdMembers(entry: TEntry): void;
};

import type { PublicBackgroundCard, PublicNarrativeAssets, PublicNarrativeCharacter } from "@reroll/shared";
export interface DecisionHistoryEntry {
    id: string;
    choiceLabel: string;
    choiceDescription: string;
    background: string;
    rollLabels: string[];
}
export interface DecisionHistoryGroup {
    age: number;
    ageStageLabel: string;
    entries: DecisionHistoryEntry[];
}
export declare function TalentArchive({ cards }: {
    cards: PublicBackgroundCard[];
}): import("react/jsx-runtime").JSX.Element;
export declare function FateArchiveContent({ assets, characters, decisions, headingId }: {
    assets?: PublicNarrativeAssets;
    characters: PublicNarrativeCharacter[];
    decisions: DecisionHistoryGroup[];
    headingId?: string;
}): import("react/jsx-runtime").JSX.Element;

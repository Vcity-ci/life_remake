import type { PublicNarrativeAssets, PublicNarrativeCharacter } from "@reroll/shared";
export declare function NarrativeAssetsArchive({ assets, characters }: {
    assets?: PublicNarrativeAssets;
    characters?: PublicNarrativeCharacter[];
}): import("react/jsx-runtime").JSX.Element;
export declare function NarrativeAssetChanges({ current, previous }: {
    current?: PublicNarrativeAssets;
    previous?: PublicNarrativeAssets;
}): import("react/jsx-runtime").JSX.Element | null;

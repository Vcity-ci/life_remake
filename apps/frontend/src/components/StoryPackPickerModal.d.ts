import React from "react";
import type { PublicStoryPackOption } from "@reroll/shared";
interface StoryPackPickerModalProps {
    worldName: string;
    storyPacks: PublicStoryPackOption[];
    selectedId: string;
    onSelect: (storyPackId: string) => void;
    onConfirm: () => void;
    onClose: () => void;
}
export declare function StoryPackPickerModal({ worldName, storyPacks, selectedId, onSelect, onConfirm, onClose }: StoryPackPickerModalProps): React.JSX.Element;
export {};

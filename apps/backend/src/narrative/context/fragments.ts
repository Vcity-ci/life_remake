import { createHash } from "node:crypto";
import type { NarrativeContextFragment, NarrativeContextLayer, NarrativeContextPlacement, NarrativeContextSection } from "./types.js";

export function estimateNarrativeTokens(content: string): number {
  const normalized = content.trim();
  if (!normalized) return 0;
  const nonAscii = normalized.match(/[^\x00-\x7F]/g)?.length ?? 0;
  const ascii = normalized.length - nonAscii;
  return Math.max(1, Math.ceil(nonAscii + ascii / 4));
}

export function narrativeContentId(prefix: string, content: string): string {
  return `${prefix}:${createHash("sha1").update(content.trim()).digest("hex").slice(0, 12)}`;
}

export function narrativeContextFragment(input: {
  id: string;
  layer: NarrativeContextLayer;
  section: NarrativeContextSection;
  sourceType: string;
  sourceIds?: string[];
  priority: number;
  content: string;
  required?: boolean;
  placement?: NarrativeContextPlacement;
  expiresAfterTurn?: boolean;
  groupId?: string;
  activationReason?: string;
  injectionPosition?: string;
  worldCardActivationKind?: "direct" | "related" | "sticky";
  worldCardStickyTurns?: number;
  worldCardCooldownTurns?: number;
  worldCardLastActivatedSequence?: number;
  worldCardRemainingStickyTurns?: number;
  worldCardRemainingCooldownTurns?: number;
  order: number;
}): NarrativeContextFragment | undefined {
  const content = input.content.trim();
  if (!content) return undefined;
  return {
    ...input,
    content,
    sourceIds: Array.from(new Set(input.sourceIds ?? [input.id])),
    estimatedTokens: estimateNarrativeTokens(content),
    required: input.required ?? false,
    placement: input.placement ?? "user_context"
  } satisfies NarrativeContextFragment;
}

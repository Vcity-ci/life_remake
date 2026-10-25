import { randomUUID } from "node:crypto";
import type { NarrativeCharacterRelationship, NarrativeDynamicCharacter } from "@reroll/shared";
import type { InternalRunState } from "./engine.js";

export interface NarrativeParticipant {
  characterRef: string;
  name: string;
  factionId?: string;
  role?: string;
  description?: string;
  recurring: boolean;
  relationship?: Pick<NarrativeCharacterRelationship, "stance" | "summary">;
}

export function formatNarrativeRelationship(relationship?: Pick<NarrativeCharacterRelationship, "stance" | "summary">): string | undefined {
  if (!relationship) return undefined;
  const labels = { friendly: "友善", guarded: "戒备", hostile: "敌对", indebted: "承情", dependent: "依赖", competitive: "竞争" };
  return [relationship.stance ? labels[relationship.stance] : undefined, relationship.summary].filter(Boolean).join("：") || undefined;
}

/** The player lives in the run; this projection distinguishes them from NPCs. */
export function narrativeProtagonistAnchor(run: InternalRunState): string {
  return run.personaPrompt || run.narrative.opening?.profile?.summary || "本局玩家人物";
}

export function registerNarrativeParticipants(
  run: InternalRunState, participants: Array<Omit<NarrativeParticipant, "characterRef"> & { characterRef?: string }> | undefined, sourceEventId: string, factIds: string[] = [], candidates: NarrativeParticipant[] = [], updateState = true
): Array<{ character: NarrativeDynamicCharacter; relationship?: NarrativeParticipant["relationship"] }> {
  const stored: Array<{ character: NarrativeDynamicCharacter; relationship?: NarrativeParticipant["relationship"] }> = [];
  for (const participant of participants ?? []) {
    const characterRef = participant.characterRef ?? "new";
    const referenced = characterRef === "new" ? undefined
      : run.narrative.dynamicCharacters.find((entry) => entry.id === characterRef);
    const candidate = candidates.find((entry) => entry.characterRef === characterRef);
    if (characterRef !== "new" && !referenced && !candidate) throw new Error("dynamic_scene_character_reference_invalid");
    const existing = referenced;
    if (!existing && !participant.recurring) continue;
    const character: NarrativeDynamicCharacter = existing ?? {
      id: candidate?.characterRef ?? `character:${randomUUID()}`,
      name: participant.name, factionId: participant.factionId, role: participant.role, description: participant.description,
      pendingDetails: !participant.role && !participant.description,
      relatedFactIds: [], relatedRouteIds: [], introducedAge: run.age, lastSeenAge: run.age, importance: "recurring", status: "active"
    };
    character.lastSeenAge = run.age;
    if (updateState) {
      if (participant.role) character.role = participant.role;
      if (participant.description) character.description = participant.description;
      if (participant.factionId !== undefined) character.factionId = participant.factionId || undefined;
    }
    character.relatedFactIds = Array.from(new Set([...character.relatedFactIds, ...factIds])).slice(-8);
    if (updateState && participant.relationship) character.relationship = {
      ...character.relationship,
      ...participant.relationship,
      relatedFactIds: Array.from(new Set([...(character.relationship?.relatedFactIds ?? []), ...factIds])).slice(-8),
      lastChangedAge: run.age
    };
    if (!existing) run.narrative.dynamicCharacters.push(character);
    stored.push({ character, relationship: updateState ? participant.relationship : undefined });
  }
  run.narrative.activeCharacterIds = Array.from(new Set([...run.narrative.activeCharacterIds, ...stored.map(({ character }) => character.id)]))
    .filter((id) => !run.narrative.dynamicCharacters.some((character) => character.id === id && character.status !== "active"));
  return stored;
}

import { createHash } from "node:crypto";
import type { NarrativeCharacterRelationship, NarrativeDynamicCharacter } from "@reroll/shared";
import type { InternalRunState } from "./engine.js";

export interface NarrativeParticipant {
  characterRef: string;
  name: string;
  factionId?: string;
  role: string;
  description: string;
  recurring: boolean;
  relationship?: Pick<NarrativeCharacterRelationship, "stance" | "summary">;
}

/** The player lives in the run; this projection distinguishes them from NPCs. */
export function narrativeProtagonistAnchor(run: InternalRunState): string {
  return run.narrative.sessionPremise?.protagonistAnchor || run.personaPrompt || run.narrative.opening?.profile?.summary || "本局玩家人物";
}

export function registerNarrativeParticipants(
  run: InternalRunState, participants: Array<Omit<NarrativeParticipant, "characterRef"> & { characterRef?: string }> | undefined, sourceEventId: string, factIds: string[] = [], candidates: NarrativeParticipant[] = []
): Array<{ character: NarrativeDynamicCharacter; relationship?: NarrativeParticipant["relationship"] }> {
  const stored: Array<{ character: NarrativeDynamicCharacter; relationship?: NarrativeParticipant["relationship"] }> = [];
  for (const participant of participants ?? []) {
    const characterRef = participant.characterRef ?? "new";
    const referenced = characterRef === "new" ? undefined
      : run.narrative.dynamicCharacters.find((entry) => entry.id === characterRef);
    const candidate = candidates.find((entry) => entry.characterRef === characterRef);
    if (characterRef !== "new" && !referenced && !candidate) throw new Error("dynamic_scene_character_reference_invalid");
    const existing = referenced ?? run.narrative.dynamicCharacters.find((entry) =>
      entry.name === participant.name && entry.factionId === participant.factionId);
    if (!existing && !participant.recurring) continue;
    const character: NarrativeDynamicCharacter = existing ?? {
      id: candidate?.characterRef ?? `character:${createHash("sha256").update(`${run.runId}:${sourceEventId}:${participant.name}:${participant.factionId ?? "none"}`).digest("hex").slice(0, 16)}`,
      name: participant.name, factionId: participant.factionId, role: participant.role, description: participant.description,
      relatedFactIds: [], relatedRouteIds: [], introducedAge: run.age, lastSeenAge: run.age, importance: "recurring", status: "active"
    };
    character.lastSeenAge = run.age;
    character.status = "active";
    if (participant.role) character.role = participant.role;
    if (participant.description) character.description = participant.description;
    character.relatedFactIds = Array.from(new Set([...character.relatedFactIds, ...factIds])).slice(-8);
    if (participant.relationship) character.relationship = {
      ...participant.relationship,
      relatedFactIds: Array.from(new Set([...(character.relationship?.relatedFactIds ?? []), ...factIds])).slice(-8),
      lastChangedAge: run.age
    };
    if (!existing) run.narrative.dynamicCharacters.push(character);
    stored.push({ character, relationship: participant.relationship });
  }
  run.narrative.activeCharacterIds = Array.from(new Set([...run.narrative.activeCharacterIds, ...stored.map(({ character }) => character.id)])).slice(-12);
  return stored;
}

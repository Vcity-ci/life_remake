import { createHash } from "node:crypto";
import type { NarrativeDynamicCharacter } from "@reroll/shared";
import type { InternalRunState } from "../engine.js";
import type { NarrativeParticipant } from "../narrative-characters.js";

/** Round-local identities; they enter the saved archive only after the round succeeds. */
export interface NarrativeRoundHandoff {
  sourceEventId: string;
  characters: NarrativeParticipant[];
  identityAliases?: Record<string, string>;
}

export function prepareRoundParticipants(
  run: InternalRunState, sourceEventId: string, participants: NarrativeParticipant[], candidates: NarrativeParticipant[] = []
): NarrativeParticipant[] {
  const directory = [...run.narrative.dynamicCharacters.map((entry) => ({ ...entry, characterRef: entry.id })), ...candidates];
  return participants.map((participant) => {
    if (participant.characterRef !== "new") {
      const candidate = candidates.find((entry) => entry.characterRef === participant.characterRef);
      return candidate ? { ...participant, description: participant.description || candidate.description } : participant;
    }
    const existing = directory.find((entry) => entry.name === participant.name && (entry.factionId || undefined) === (participant.factionId || undefined));
    const characterRef = existing?.characterRef ?? `character:${createHash("sha256")
      .update(`${run.runId}:${sourceEventId}:${participant.name}:${participant.factionId ?? "none"}`).digest("hex").slice(0, 16)}`;
    const prepared = { ...participant, characterRef };
    directory.push(prepared);
    return prepared;
  });
}

export function roundCharacterDirectory(run: InternalRunState, handoff?: NarrativeRoundHandoff): NarrativeDynamicCharacter[] {
  const entries = new Map(run.narrative.dynamicCharacters.map((entry) => [entry.id, entry]));
  for (const participant of handoff?.characters ?? []) {
    if (entries.has(participant.characterRef)) continue;
    entries.set(participant.characterRef, {
      id: participant.characterRef, name: participant.name, factionId: participant.factionId,
      role: participant.role, description: participant.description,
      relatedFactIds: [], relatedRouteIds: [], introducedAge: run.age, lastSeenAge: run.age,
      importance: "recurring", status: "active"
    });
  }
  return [...entries.values()];
}

export function roundIdentityState(run: InternalRunState, handoff?: NarrativeRoundHandoff) {
  return { ...run.narrative, dynamicCharacters: roundCharacterDirectory(run, handoff) };
}

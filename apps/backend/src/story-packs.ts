import fs from "node:fs/promises";
import path from "node:path";
import type {
  NarrativeStoryPackDefinition,
  NarrativeWorldDefinition,
  PublicStoryPackOption
} from "@reroll/shared";
import { resolveProjectRoot } from "./project-root.js";

const storyPackRoot = path.resolve(resolveProjectRoot(import.meta.url), "data", "narratives", "story-packs");

async function jsonFiles(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const target = path.resolve(root, entry.name);
      if (entry.isDirectory()) return jsonFiles(target);
      return entry.isFile() && entry.name.endsWith(".json") ? [target] : [];
    }));
    return nested.flat().sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function stringList(value: unknown, min = 0): value is string[] {
  return Array.isArray(value) && value.length >= min && value.every(nonEmpty);
}

export function validateNarrativeStoryPack(
  value: NarrativeStoryPackDefinition,
  world: NarrativeWorldDefinition
): NarrativeStoryPackDefinition {
  if (Object.prototype.hasOwnProperty.call(value, "worldCards")) {
    throw new Error(`${value?.id ?? "unknown"}_story_pack_embedded_world_cards_not_supported`);
  }
  if (!value || value.version !== 1 || !nonEmpty(value.id) || value.id.length > 160 || !nonEmpty(value.revision) || value.worldId !== world.worldId) {
    throw new Error("story_pack_identity_invalid");
  }
  if (!nonEmpty(value.name) || !nonEmpty(value.tagline) || !nonEmpty(value.summary) ||
      !nonEmpty(value.routePromise) || !nonEmpty(value.entryLens) ||
      !stringList(value.originSeeds, 1) || !stringList(value.stakeAxes, 1) ||
      !Array.isArray(value.acts) || value.acts.length !== 3) {
    throw new Error(`${value.id}_story_pack_content_invalid`);
  }
  const forceIds = new Set([
    ...(world.socialForces ?? []).map((force) => force.id),
    ...(world.narrativeFactions ?? []).map((force) => force.id)
  ]);
  if (value.focusForceIds?.some((id) => !forceIds.has(id))) {
    throw new Error(`${value.id}_story_pack_force_reference_invalid`);
  }
  const knownCardIds = new Set((world.worldCards ?? []).map((card) => card.id));
  const invalidPackCardRef = value.worldCardRefs?.find((id) => !knownCardIds.has(id));
  if (invalidPackCardRef) {
    throw new Error(`${value.id}_story_pack_world_card_reference_invalid:${invalidPackCardRef}`);
  }
  const actIds = new Set<string>();
  for (const act of value.acts) {
    if (!nonEmpty(act.id) || !act.id.startsWith(`${value.id}.`) || actIds.has(act.id) ||
        !nonEmpty(act.label) || !nonEmpty(act.objective) || !nonEmpty(act.dramaticQuestion) ||
        !nonEmpty(act.pressureDirection) || !nonEmpty(act.payoffMeaning) ||
        act.focusForceIds?.some((id) => !forceIds.has(id)) ||
        act.worldCardRefs?.some((id) => !knownCardIds.has(id))) {
      throw new Error(`${value.id}_story_pack_act_invalid:${act?.id ?? "unknown"}`);
    }
    actIds.add(act.id);
  }
  for (const polarity of ["good", "normal", "bad"] as const) {
    if (!stringList(value.endingDirections?.[polarity], 1)) {
      throw new Error(`${value.id}_story_pack_ending_invalid:${polarity}`);
    }
  }
  return structuredClone(value);
}

export async function loadNarrativeStoryPacksForWorld(
  world: NarrativeWorldDefinition
): Promise<NarrativeStoryPackDefinition[]> {
  if (world.version < 10) return [];
  const files = await jsonFiles(storyPackRoot);
  const packs: NarrativeStoryPackDefinition[] = [];
  const ids = new Set<string>();
  for (const file of files) {
    try {
      const raw = JSON.parse(await fs.readFile(file, "utf8")) as NarrativeStoryPackDefinition;
      if (raw.worldId !== world.worldId) continue;
      const pack = validateNarrativeStoryPack(raw, world);
      if (ids.has(pack.id)) throw new Error(`story_pack_id_duplicate:${pack.id}`);
      ids.add(pack.id);
      packs.push(pack);
    } catch (error) {
      console.error("[story-pack:load]", { file, error });
    }
  }
  return packs.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

export async function loadNarrativeStoryPack(
  world: NarrativeWorldDefinition,
  storyPackId: string
): Promise<NarrativeStoryPackDefinition | null> {
  const packs = await loadNarrativeStoryPacksForWorld(world);
  return packs.find((pack) => pack.id === storyPackId) ?? null;
}

export function toPublicStoryPackOption(pack: NarrativeStoryPackDefinition): PublicStoryPackOption {
  return {
    id: pack.id,
    revision: pack.revision,
    worldId: pack.worldId,
    name: pack.name,
    tagline: pack.tagline,
    summary: pack.summary
  };
}

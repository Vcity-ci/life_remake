import type {
  EndingBlueprint,
  NarrativeMainlineActDefinition,
  NarrativeStoryPackSnapshot,
  NarrativeWorldDefinition,
  ResolvedNarrativeExperience
} from "@reroll/shared";
import { validateNarrativeWorldFactContract } from "./content.js";

const readinessStages: NarrativeMainlineActDefinition["readinessStage"][] = ["opening", "pressure", "climax"];

function endingDirection(
  storyPack: NarrativeStoryPackSnapshot,
  polarity: EndingBlueprint["polarity"]
): string {
  return storyPack.endingDirections[polarity].join("；");
}

export function resolveNarrativeExperience(
  world: NarrativeWorldDefinition,
  storyPack: NarrativeStoryPackSnapshot
): ResolvedNarrativeExperience {
  if (world.worldId !== storyPack.worldId) throw new Error("story_pack_world_mismatch");
  const forceLabels = new Map((world.socialForces ?? []).map((force) => [force.id, force.label]));
  const mainlineActs = storyPack.acts.map((act, index): NarrativeMainlineActDefinition => {
    const focus = [...new Set([...(act.focusForceIds ?? []), ...(storyPack.focusForceIds ?? [])])]
      .map((id) => forceLabels.get(id))
      .filter((label): label is string => Boolean(label));
    return {
      id: act.id,
      label: act.label,
      prompt: [
        `${act.objective} 核心问题：${act.dramaticQuestion} 压力方向：${act.pressureDirection} 本幕收束应体现：${act.payoffMeaning}`,
        focus.length ? `可优先关联的世界力量：${focus.join("、")}。` : ""
      ].filter(Boolean).join(" "),
      readinessStage: readinessStages[index]
    };
  });
  const endingBlueprints = world.endingBlueprints.map((blueprint) => ({
    ...blueprint,
    premise: `${blueprint.premise} 本局路线：${storyPack.routePromise}`,
    payoffFocus: `${blueprint.payoffFocus} 路线结果方向：${endingDirection(storyPack, blueprint.polarity)}`
  }));
  const resolved: ResolvedNarrativeExperience = {
    ...structuredClone(world),
    storyPack: structuredClone(storyPack),
    mainlineActs,
    mainlineSkeleton: {
      premise: storyPack.routePromise,
      opening: storyPack.acts[0].objective,
      pressure: storyPack.acts[1].objective,
      climax: storyPack.acts[2].objective,
      payoff: storyPack.acts[2].payoffMeaning,
      goodEndingDirection: storyPack.endingDirections.good.join("；"),
      badEndingDirection: storyPack.endingDirections.bad.join("；")
    },
    storyPatterns: [],
    // World cards belong to the world snapshot. Story packs may only reference
    // them, which prevents the same lore from being repeated in two modules.
    worldCards: [...(world.worldCards ?? [])],
    endingGuide: [world.endingGuide, `所选人生路线：${storyPack.name}。${storyPack.routePromise}`].filter(Boolean).join(" "),
    endingBlueprints
  };
  return validateNarrativeWorldFactContract(resolved) as ResolvedNarrativeExperience;
}

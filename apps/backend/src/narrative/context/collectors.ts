import { narrativeContentId, narrativeContextFragment } from "./fragments.js";
import { legacyNarrativePlanFragment } from "./legacy-adapter.js";
import { projectNarrativeStoryHistory } from "../story-history.js";
import { formatNarrativeProtagonistParts } from "./formatter.js";
import { formatNarrativeDialogue, formatNarrativeExperience } from "../../narrative-memory.js";
import type {
  NarrativeContextFragment,
  NarrativeContextLayer,
  NarrativeContextProvider,
  NarrativeContextProviderInput,
  NarrativeContextSection
} from "./types.js";

interface FragmentInput {
  id: string;
  layer: NarrativeContextLayer;
  section: NarrativeContextSection;
  sourceType: string;
  sourceIds?: string[];
  priority: number;
  content: string;
  required?: boolean;
  expiresAfterTurn?: boolean;
  activationReason?: string;
  injectionPosition?: string;
  worldCardActivationKind?: "direct" | "related" | "sticky";
  worldCardStickyTurns?: number;
  worldCardCooldownTurns?: number;
  worldCardLastActivatedSequence?: number;
  worldCardRemainingStickyTurns?: number;
  worldCardRemainingCooldownTurns?: number;
}

function fragment(input: FragmentInput): NarrativeContextFragment[] {
  const value = narrativeContextFragment({ ...input, order: 0 });
  return value ? [value] : [];
}

const legacyProvider: NarrativeContextProvider = {
  id: "legacy-plan",
  collect: ({ plan }) => plan && !plan.task ? legacyNarrativePlanFragment(plan) : []
};

const stableProvider: NarrativeContextProvider = {
  id: "stable-character",
  collect: ({ plan }) => {
    if (!plan?.task) return [];
    return [
      ...(plan.talents ?? []).flatMap((talent) => fragment({ id: narrativeContentId("talent", talent), layer: "stable", section: "talents", sourceType: "talent", priority: 90, content: talent })),
      ...(plan.seedHints ?? []).flatMap((hint) => fragment({ id: narrativeContentId("seed-hint", hint), layer: "stable", section: "seedHints", sourceType: "seed-hint", priority: 35, content: hint })),
      ...(plan.origin && !plan.protagonist && !plan.storyHistory?.summary?.originCovered ? fragment({ id: "stable:origin", layer: "stable", section: "origin", sourceType: "origin", priority: 85, content: plan.origin }) : []),
      ...(plan.worldCoreContext ? fragment({ id: "stable:world-core", layer: "stable", section: "world", sourceType: "world-core", priority: 98, content: plan.worldCoreContext, required: true }) : []),
      ...(plan.storyBible ? fragment({ id: "stable:world-snapshot", layer: "stable", section: "worldSituation", sourceType: "world-snapshot", priority: 96, content: plan.storyBible, required: true }) : []),
      ...(plan.actBackground ? fragment({ id: "stable:act-world", layer: "stable", section: "actWorld", sourceType: "act-world", priority: 100, content: plan.actBackground, required: true }) : [])
    ];
  }
};

const storyProvider: NarrativeContextProvider = {
  id: "story-runtime",
  collect: ({ plan }) => {
    if (!plan?.task) return [];
    return [
      ...(plan.mainlineSkeleton ? fragment({ id: "runtime:mainline", layer: "runtime", section: "mainline", sourceType: "mainline", priority: 100, content: plan.mainlineSkeleton, required: true }) : []),
      ...(plan.routeGuidance ? fragment({ id: "active:route", layer: "active", section: "route", sourceType: "route", priority: 100, content: plan.routeGuidance, required: true }) : []),
      ...(plan.authorNote ? fragment({
        id: "active:author-note",
        layer: "active",
        section: "authorNote",
        sourceType: "author-note",
        priority: 96,
        content: plan.authorNote,
        expiresAfterTurn: true
      }) : [])
    ];
  }
};

const loreProvider: NarrativeContextProvider = {
  id: "world-lore",
  collect: ({ plan }) => {
    if (!plan?.task) return [];
    const sources = plan.activeLoreSources?.length
      ? plan.activeLoreSources
      : plan.activeLore.map((text) => ({ id: narrativeContentId("lore", text), text }));
    return [
      ...sources.flatMap((lore) => fragment({ id: `recall:lore:${lore.id}`, layer: "recall", section: "lore", sourceType: "lore", sourceIds: [`lore:${lore.id}`], priority: 72, content: lore.text })),
      ...(plan.activeSocialForces ?? []).flatMap((force) => fragment({
        id: `recall:force:${force.id}`, layer: "recall", section: "lore", sourceType: "social-force",
        sourceIds: [`force:${force.id}`], priority: 80,
        content: [`相关势力：${force.label}。${force.summary}`, force.methods.length ? `行动方式：${force.methods.join("、")}` : ""].filter(Boolean).join("；")
      }))
    ];
  }
};

const worldCardProvider: NarrativeContextProvider = {
  id: "world-cards",
  collect: ({ plan }) => !plan?.task ? [] : (plan.activeWorldCardSources ?? []).flatMap((card) => {
    const role = card.contextRole ?? (card.placement === "example" ? "style" :
      card.placement === "world" && card.activationReason === "constant" && card.stickyTurns === 0 && card.cooldownTurns === 0 ? "foundation" : "knowledge");
    const target = role === "foundation"
      ? { layer: "stable" as const, section: "world" as const, priority: 86 }
      : role === "situation"
        ? { layer: "stable" as const, section: "worldSituation" as const, priority: 84 }
      : role === "style"
        ? { layer: "recall" as const, section: "styleExamples" as const, priority: 78 }
        : { layer: "recall" as const, section: "lore" as const, priority: 80 };
    return fragment({
      id: `recall:world-card:${card.id}|${card.stickyTurns}|${card.cooldownTurns}|${card.activationKind}`,
      layer: target.layer,
      section: target.section,
      sourceType: "world-card",
      sourceIds: [`world-card:${card.id}`],
      priority: target.priority,
      content: card.title ? `${card.title}：${card.text}` : card.text,
      activationReason: card.activationReason,
      injectionPosition: card.placement,
      worldCardActivationKind: card.activationKind,
      worldCardStickyTurns: card.stickyTurns,
      worldCardCooldownTurns: card.cooldownTurns,
      worldCardLastActivatedSequence: card.lastActivatedSequence,
      worldCardRemainingStickyTurns: card.remainingStickyTurns,
      worldCardRemainingCooldownTurns: card.remainingCooldownTurns
    });
  })
};

const characterProvider: NarrativeContextProvider = {
  id: "characters",
  collect: ({ plan }) => {
    if (!plan?.task) return [];
    const values: NarrativeContextFragment[] = [];
    for (const character of plan.recall?.characters ?? []) {
      const rendered = plan.activeCharacters.find((entry) => entry.startsWith(`${character.id}=`))
        ?? `${character.id}=${character.name}${character.role ? `（${character.role}）` : ""}${character.description ? "：" + character.description : ""}${character.condition ? "；处境：" + character.condition : ""}${character.relationship ? "；关系：" + character.relationship : ""}`;
      values.push(...fragment({ id: `active:character:${character.id}`, layer: "active", section: "characters", sourceType: "character", sourceIds: [`character:${character.id}`], priority: 88, content: rendered,
        required: ["background", "rendering", "dynamic", "decision"].includes(plan.task) }));
    }
    const knownIds = new Set((plan.recall?.characters ?? []).map((entry) => entry.id));
    for (const character of plan.activeCharacters.filter((entry) => !Array.from(knownIds).some((id) => entry.startsWith(`${id}=`)))) {
      values.push(...fragment({ id: narrativeContentId("active-character", character), layer: "active", section: "characters", sourceType: "character", priority: 75, content: character }));
    }
    return values;
  }
};

const storyHistoryProvider: NarrativeContextProvider = {
  id: "story-history",
  collect: ({ plan, historyMessages = [] }) => {
    if (!plan?.task) return [];
    if (!plan.storyHistory) return !plan.protagonist && plan.effectiveBackground ? fragment({
      id: "runtime:effective-background", layer: "runtime", section: "storyHistory", sourceType: "effective-background", priority: 92,
      content: `人物重要经历（已发生的历史背景）：${plan.effectiveBackground}`, required: true
    }) : [];
    const projected = projectNarrativeStoryHistory(plan.storyHistory, historyMessages);
    return [
      ...(projected.summary && !plan.protagonist ? fragment({
        id: `runtime:story-summary:${projected.summary.id}`, layer: "runtime", section: "storyHistory", sourceType: "story-summary",
        sourceIds: projected.summary.coveredEpisodeIds, priority: 92,
        content: `人物重要经历（已压缩背景）：${projected.summary.text}`, required: true
      }) : []),
      ...projected.changes.flatMap((episode) => fragment({
        id: `runtime:story-change:${episode.id}`, layer: "runtime", section: "storyHistory", sourceType: "story-change",
        sourceIds: [episode.id], priority: 92,
        content: formatNarrativeExperience(episode, formatNarrativeDialogue({ ...episode, narrative: episode.narrative ?? "" })),
        required: true
      })),
      ...(projected.changes.some((episode) => episode.id === plan.storyHistory!.latestSituationId) ? fragment({
        id: "runtime:latest-situation", layer: "runtime", section: "storyHistory", sourceType: "latest-situation",
        priority: 92, content: "【最新已提交处境】见以上最后一段。", required: true
      }) : [])
    ];
  }
};

const protagonistProvider: NarrativeContextProvider = {
  id: "current-protagonist",
  collect: ({ plan }) => {
    if (!plan?.protagonist) return [];
    const summary = plan.storyHistory?.summary;
    const parts = formatNarrativeProtagonistParts(plan);
    return [
      ...fragment({ id: "stable:protagonist", layer: "stable", section: "protagonist", sourceType: "protagonist-identity",
        priority: 100, required: true, content: parts.identity }),
      ...fragment({ id: "stable:protagonist-experience", layer: "stable", section: "protagonist", sourceType: "story-summary",
        sourceIds: summary?.coveredEpisodeIds ?? [], priority: 100, required: true, content: parts.experience }),
      ...fragment({ id: "active:protagonist", layer: "active", section: "protagonist", sourceType: "protagonist",
        priority: 100, required: true, content: parts.currentState })
    ];
  }
};

const factProvider: NarrativeContextProvider = {
  id: "facts",
  collect: ({ plan }) => {
    if (!plan?.task) return [];
    const detailed = new Set([...(plan.recall?.facts ?? []).map((entry) => entry.id), ...(plan.recall?.resolvedFacts ?? []).map((entry) => entry.id)]);
    return [
      ...(plan.factDirectory ?? []).filter((fact) => !detailed.has(fact.id)).flatMap((fact) => fragment({ id: `active:fact-directory:${fact.id}`, layer: "active", section: "factDirectory", sourceType: "fact-directory", sourceIds: [`fact:${fact.id}`], priority: 55, content: `${fact.id}=${fact.label}` })),
      ...(plan.recall?.facts ?? []).flatMap((fact) => fragment({ id: `active:fact:${fact.id}`, layer: "active", section: "facts", sourceType: "fact", sourceIds: [`fact:${fact.id}`], priority: 95,
        content: plan.task === "planning" ? JSON.stringify({ id: fact.id, kind: "fact", label: fact.label }) : `${fact.id}：${fact.label}` })),
      ...(plan.recall?.resolvedFacts ?? []).flatMap((fact) => fragment({ id: `recall:resolved-fact:${fact.id}`, layer: "recall", section: "resolvedFacts", sourceType: "resolved-fact", sourceIds: [`fact:${fact.id}`], priority: plan.task === "ending" ? 90 : 45, content: `${fact.id}：${fact.label}` }))
    ];
  }
};

const assetProvider: NarrativeContextProvider = {
  id: "narrative-assets",
  collect: ({ plan }) => {
    if (!plan?.task) return [];
    if (plan.recall?.assetSources?.length) return plan.recall.assetSources.flatMap((asset) => fragment({
      id: `recall:${asset.kind}:${asset.id}`,
      layer: "recall",
      section: asset.kind === "location" ? "locations" : "abilities",
      sourceType: asset.kind,
      sourceIds: [`${asset.kind}:${asset.id}`],
      priority: asset.text.includes("当前所在") ? 82 : 52,
      required: ["background", "rendering", "dynamic", "decision"].includes(plan.task ?? ""),
      content: asset.text
    }));
    return plan.assetContext ? fragment({ id: narrativeContentId("assets", plan.assetContext), layer: "recall", section: "assets", sourceType: "assets", priority: 60, content: plan.assetContext }) : [];
  }
};

const memoryProvider: NarrativeContextProvider = {
  id: "narrative-memory",
  collect: ({ plan }) => {
    if (!plan?.task) return [];
    const sources = plan.recall?.memorySources?.length
      ? plan.recall.memorySources
      : (plan.recall?.memories ?? []).map((text) => ({ id: narrativeContentId("memory", text), text }));
    return [
      ...sources.flatMap((memory) => fragment({ id: `recall:memory:${memory.id}`, layer: "recall", section: "memories", sourceType: "memory", sourceIds: [memory.id], priority: 65, content: memory.text })),
      ...(plan.memoryDigests ?? []).flatMap((digest) => fragment({
        id: `recall:digest:${digest.id}`,
        layer: "recall",
        section: "digests",
        sourceType: "memory-digest",
        sourceIds: digest.sourceIds,
        priority: digest.id.startsWith("act:") ? 78 : digest.id.startsWith("route:") ? 72 : 60,
        content: digest.text
      }))
    ];
  }
};

const endingProvider: NarrativeContextProvider = {
  id: "ending",
  collect: ({ plan, task }) => !plan?.task || task !== "ending" ? [] : [
    ...(plan.ending ? fragment({ id: "active:ending-brief", layer: "active", section: "ending", sourceType: "ending-brief", priority: 100, content: plan.ending, required: true }) : []),
    ...(plan.endingGuide ? fragment({ id: "active:ending-guide", layer: "active", section: "ending", sourceType: "ending-guide", priority: 90, content: `结局文风：${plan.endingGuide}` }) : [])
  ]
};

const taskProvider: NarrativeContextProvider = {
  id: "current-task",
  collect: ({ taskPrompt }) => fragment({ id: "task:current", layer: "task", section: "task", sourceType: "task", sourceIds: ["task:current"], priority: 100, content: taskPrompt, required: true, expiresAfterTurn: true })
};

/** Explicit provider order mirrors a prompt manager while keeping world packs data-only. */
export const defaultNarrativeContextProviders: NarrativeContextProvider[] = [
  legacyProvider,
  stableProvider,
  storyProvider,
  worldCardProvider,
  loreProvider,
  characterProvider,
  protagonistProvider,
  storyHistoryProvider,
  factProvider,
  assetProvider,
  memoryProvider,
  endingProvider,
  taskProvider
];

export function collectNarrativePlanFragments(
  input: NarrativeContextProviderInput,
  providers: NarrativeContextProvider[] = defaultNarrativeContextProviders
): NarrativeContextFragment[] {
  return providers.flatMap((provider) => provider.collect(input)).map((entry, order) => ({ ...entry, order }));
}

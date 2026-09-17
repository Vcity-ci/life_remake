import { narrativeContentId, narrativeContextFragment } from "./fragments.js";
import { legacyNarrativePlanFragment } from "./legacy-adapter.js";
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
      ...(plan.persona ? fragment({ id: "stable:persona", layer: "stable", section: "persona", sourceType: "persona", priority: 100, content: plan.persona, required: true }) : []),
      ...(plan.talents ?? []).flatMap((talent) => fragment({ id: narrativeContentId("talent", talent), layer: "stable", section: "talents", sourceType: "talent", priority: 90, content: talent })),
      ...(plan.seedHints ?? []).flatMap((hint) => fragment({ id: narrativeContentId("seed-hint", hint), layer: "stable", section: "seedHints", sourceType: "seed-hint", priority: 35, content: hint })),
      ...(plan.origin ? fragment({ id: "stable:origin", layer: "stable", section: "origin", sourceType: "origin", priority: 85, content: plan.origin }) : [])
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
      ...(plan.actHandoff ?? []).flatMap((handoff) => fragment({ id: narrativeContentId("act-handoff", handoff), layer: "active", section: "handoff", sourceType: "act-handoff", priority: 92, content: handoff })),
      ...(plan.actCanon ?? []).flatMap((canon) => fragment({
        id: `active:act-canon:${canon.actId}`,
        layer: "active",
        section: "handoff",
        sourceType: "act-canon",
        sourceIds: [`event:${canon.sourceEventId}`, ...canon.factIds.map((id) => `fact:${id}`)],
        priority: 94,
        content: canon.text
      })),
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
    return sources.flatMap((lore) => fragment({ id: `recall:lore:${lore.id}`, layer: "recall", section: "lore", sourceType: "lore", sourceIds: [`lore:${lore.id}`], priority: 72, content: lore.text }));
  }
};

const worldCardProvider: NarrativeContextProvider = {
  id: "world-cards",
  collect: ({ plan }) => !plan?.task ? [] : (plan.activeWorldCardSources ?? []).flatMap((card) => {
    const target = card.placement === "world"
      ? { layer: "stable" as const, section: "lore" as const, priority: 86 }
      : card.placement === "example"
        ? { layer: "recall" as const, section: "styleExamples" as const, priority: 78 }
        : card.placement === "author_note"
          ? { layer: "active" as const, section: "authorNote" as const, priority: 92 }
          : { layer: "recall" as const, section: "lore" as const, priority: 80 };
    return fragment({
      id: `recall:world-card:${card.id}|${card.stickyTurns}|${card.cooldownTurns}|${card.activationKind}`,
      layer: target.layer,
      section: target.section,
      sourceType: "world-card",
      sourceIds: [`world-card:${card.id}`],
      priority: target.priority,
      content: card.text,
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
        ?? `${character.id}=${character.name}（${character.factionId ?? "无阵营"}，${character.role}）${character.description ? "：" + character.description : ""}${character.relationship ? "；关系：" + character.relationship : ""}`;
      values.push(...fragment({ id: `active:character:${character.id}`, layer: "active", section: "characters", sourceType: "character", sourceIds: [`character:${character.id}`], priority: 88, content: rendered }));
    }
    const knownIds = new Set((plan.recall?.characters ?? []).map((entry) => entry.id));
    for (const character of plan.activeCharacters.filter((entry) => !Array.from(knownIds).some((id) => entry.startsWith(`${id}=`)))) {
      values.push(...fragment({ id: narrativeContentId("active-character", character), layer: "active", section: "characters", sourceType: "character", priority: 75, content: character }));
    }
    return values;
  }
};

const factProvider: NarrativeContextProvider = {
  id: "facts",
  collect: ({ plan }) => {
    if (!plan?.task) return [];
    const detailed = new Set([...(plan.recall?.facts ?? []).map((entry) => entry.id), ...(plan.recall?.resolvedFacts ?? []).map((entry) => entry.id)]);
    return [
      ...(plan.factDirectory ?? []).filter((fact) => !detailed.has(fact.id)).flatMap((fact) => fragment({ id: `active:fact-directory:${fact.id}`, layer: "active", section: "factDirectory", sourceType: "fact-directory", sourceIds: [`fact:${fact.id}`], priority: 55, content: `${fact.id}=${fact.label}` })),
      ...(plan.recall?.facts ?? []).flatMap((fact) => fragment({ id: `active:fact:${fact.id}`, layer: "active", section: "facts", sourceType: "fact", sourceIds: [`fact:${fact.id}`], priority: 95, content: `${fact.id}：${fact.label}` })),
      ...(plan.recall?.resolvedFacts ?? []).flatMap((fact) => fragment({ id: `recall:resolved-fact:${fact.id}`, layer: "recall", section: "resolvedFacts", sourceType: "resolved-fact", sourceIds: [`fact:${fact.id}`], priority: plan.task === "ending" ? 90 : 45, content: fact.label }))
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
    ...(plan.ending ? fragment({ id: "active:ending-brief", layer: "active", section: "ending", sourceType: "ending-brief", priority: 100, content: plan.ending, required: true }) : [])
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

import fs from "node:fs/promises";
import { resolvePromptPack } from "./narrative-prompts.js";
import path from "node:path";
import { createDefaultGameplayTuning } from "@reroll/shared";
import { resolveProjectRoot } from "./project-root.js";
import type {
  BackgroundCard,
  ContentBundle,
  DifficultyConfig,
  EventDefinition,
  ItemDefinition,
  NarrativeComponentCatalog,
  NarrativeWorldCardDefinition,
  NarrativeWorldDefinition,
  StoryDirectionDefinition,
  WorldConfig
} from "@reroll/shared";

export interface WorldlineSetting {
  id: string;
  mainlineId: string;
  eraName: string;
  timeframe: string;
  coreConflict: string;
  socialOrder: string;
  taboos: string[];
  mainlineStages: Array<{ stage: string; ageRange: string; goal: string }>;
  storyDirections: StoryDirectionDefinition[];
  factionTone: string;
}

interface FactionSetting {
  id: string;
  name: string;
  values: string[];
  behavior: string;
  eventBias: string[];
  intelStyle: string;
}

interface FactionEventSetting {
  worldId: string;
  factionId: string;
  events: Array<string | EventDefinition>;
}

type EventMetadata = Partial<Pick<
  EventDefinition,
  | "kind"
  | "tags"
  | "minAge"
  | "maxAge"
  | "cooldownYears"
  | "baseWeight"
  | "outcomeProfileId"
  | "storyRole"
  | "storyPosition"
  | "focusTags"
  | "requiresFlags"
  | "setsFlags"
  | "clearsFlags"
  | "blocksFlags"
  | "primaryStat"
  | "secondaryStat"
  | "storyDirectionIds"
  | "opensThreads"
  | "resolvesThreads"
  | "followUpIds"
  | "narrativeBeat"
  | "narrativeCharacterIds"
  | "requiresFactIds"
  | "modifiesFactIds"
  | "reclaimableFactIds"
  | "factEffect"
  | "decisionFactEffects"
  | "promptHook"
>>;

interface EventMetadataSetting {
  worldId: string;
  factionId: string;
  defaults?: EventMetadata;
  events: EventMetadata[];
}

const projectRoot = resolveProjectRoot(import.meta.url);
const dataRoot = path.resolve(projectRoot, "data");
const skillsRoot = path.resolve(projectRoot, "skills");
const storageRoot = path.resolve(projectRoot, "storage");
const contentPath = path.resolve(storageRoot, "custom-content.json");
const backupDir = path.resolve(storageRoot, "backups");
const skillPromptPath = path.resolve(skillsRoot, "ai-gm", "prompt-pack.json");

const worldlineDir = path.resolve(dataRoot, "settings", "worldlines");
const factionPath = path.resolve(dataRoot, "settings", "factions", "factions.json");
const factionEventPath = path.resolve(dataRoot, "events", "faction-events.json");
const eventMetadataPath = path.resolve(dataRoot, "events", "event-metadata.json");
const narrativeWorldDir = path.resolve(dataRoot, "narratives");
const narrativeWorldCardDir = path.resolve(narrativeWorldDir, "world-cards");
const itemPath = path.resolve(dataRoot, "items.json");
let ensureStorageSeedPromise: Promise<void> | null = null;
let contentBundleCache: ContentBundle | null = null;
let contentBundleLoadPromise: Promise<ContentBundle> | null = null;
let worldlineIndexCache: Map<string, WorldlineSetting> | null = null;
let worldlineIndexLoadPromise: Promise<Map<string, WorldlineSetting>> | null = null;
let factionsCache: FactionSetting[] | null = null;
let factionsLoadPromise: Promise<FactionSetting[]> | null = null;
let factionEventsAllCache: FactionEventSetting[] | null = null;
let factionEventsLoadPromise: Promise<FactionEventSetting[]> | null = null;
let eventMetadataCache: EventMetadataSetting[] | null = null;
let eventMetadataLoadPromise: Promise<EventMetadataSetting[]> | null = null;
const narrativeWorldCache = new Map<string, NarrativeWorldDefinition | null>();
const narrativeWorldLoadPromises = new Map<string, Promise<NarrativeWorldDefinition | null>>();
let itemDefinitionsCache: ItemDefinition[] | null = null;
let itemDefinitionsLoadPromise: Promise<ItemDefinition[]> | null = null;

async function readJsonFile<T>(targetPath: string): Promise<T> {
  const raw = await fs.readFile(targetPath, "utf8");
  return JSON.parse(raw) as T;
}

interface NarrativeWorldCardCatalog {
  worldId: string;
  cards: NarrativeWorldCardDefinition[];
}

async function nestedJsonFiles(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
      const target = path.resolve(root, entry.name);
      if (entry.isDirectory()) return nestedJsonFiles(target);
      return entry.isFile() && entry.name.endsWith(".json") ? [target] : [];
    }));
    return files.flat().sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function loadNarrativeWorldCardCatalog(worldId: string): Promise<NarrativeWorldCardDefinition[]> {
  const files = await nestedJsonFiles(path.resolve(narrativeWorldCardDir, worldId));
  const cards: NarrativeWorldCardDefinition[] = [];
  for (const file of files) {
    const catalog = await readJsonFile<NarrativeWorldCardCatalog>(file);
    if (catalog.worldId !== worldId || !Array.isArray(catalog.cards)) {
      throw new Error(`${worldId}_world_card_catalog_invalid:${path.basename(file)}`);
    }
    cards.push(...catalog.cards);
  }
  return cards;
}

async function loadSeedWorlds(): Promise<WorldConfig[]> {
  const worldsDir = path.resolve(dataRoot, "worlds");
  const names = await fs.readdir(worldsDir);
  const files = names.filter((name) => name.endsWith(".json"));
  const chunks = await Promise.all(
    files.map((name) => readJsonFile<WorldConfig[] | WorldConfig>(path.resolve(worldsDir, name)))
  );
  return chunks.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
}

async function loadSeedBundle(): Promise<ContentBundle> {
  const [worlds, cards, difficulties, promptPack] = await Promise.all([
    loadSeedWorlds(),
    readJsonFile<BackgroundCard[]>(path.resolve(dataRoot, "cards.json")),
    readJsonFile<DifficultyConfig[]>(path.resolve(dataRoot, "difficulties.json")),
    readJsonFile<Record<string, string>>(skillPromptPath)
  ]);

  return {
    worlds: worlds.sort((a, b) => a.id.localeCompare(b.id)),
    cards,
    difficulties,
    promptPack,
    gameplayTuning: createDefaultGameplayTuning()
  };
}

function normalizePromptPack(promptPack?: Record<string, string>): Record<string, string> {
  return resolvePromptPack(promptPack);
}

const legacyBuiltinCardDescriptions: Readonly<Record<string, string>> = {
  c_street_sense: "你对他人情绪和局势变化有基础敏感度。",
  c_hard_study: "长线投入学习时，你更容易稳步进步。",
  c_family_trade: "家中有稳定技能或营生渠道。",
  r_public_speaker: "你在公共表达和说服方面具备优势。",
  r_lucky_break: "关键时刻更容易遇到转机。",
  r_patron_network: "你更容易接触到高质量资源和人脉。",
  e_strategist: "你能跨周期规划关键选择，降低长期失误率。",
  e_noble_lineage: "出身背景显著提升起步资源。",
  l_destiny_weaver: "你在高风险节点更容易转化危机为机遇。",
  l_crown_aura: "你的存在本身会影响他人的判断和追随。"
};

function mergeBuiltinCardCatalog(cards: BackgroundCard[], seedCards: BackgroundCard[]): BackgroundCard[] {
  if (seedCards.length === 0) return cards;
  const existingById = new Map(cards.map((card) => [card.id, card]));
  const builtinIds = new Set(seedCards.map((card) => card.id));
  const builtins = seedCards.map((seed) => {
    const existing = existingById.get(seed.id);
    if (!existing) return seed;
    const isLegacyBuiltin = !existing.narrative && legacyBuiltinCardDescriptions[seed.id] === existing.description;
    if (isLegacyBuiltin) {
      return { ...seed };
    }
    // Preserve administrator-authored card mechanics and prose, while making
    // the new narrator metadata available to older built-in card snapshots.
    return { ...existing, narrative: existing.narrative ?? seed.narrative };
  });
  return [...builtins, ...cards.filter((card) => !builtinIds.has(card.id))];
}

function normalizeContentBundle(parsed: ContentBundle, seedCards: BackgroundCard[] = []): ContentBundle {
  return {
    worlds: [...parsed.worlds].sort((a, b) => a.id.localeCompare(b.id)),
    cards: mergeBuiltinCardCatalog(parsed.cards, seedCards),
    difficulties: parsed.difficulties,
    promptPack: normalizePromptPack(parsed.promptPack),
    gameplayTuning: parsed.gameplayTuning ?? createDefaultGameplayTuning()
  };
}

async function ensureStorageSeed(): Promise<void> {
  if (ensureStorageSeedPromise) return ensureStorageSeedPromise;
  ensureStorageSeedPromise = (async () => {
    await fs.mkdir(storageRoot, { recursive: true });
    try {
      await fs.access(contentPath);
    } catch {
      const seed = await loadSeedBundle();
      await fs.writeFile(contentPath, JSON.stringify(seed, null, 2), "utf8");
      await writeBackup(seed, "seed");
      contentBundleCache = seed;
    }
  })();

  try {
    await ensureStorageSeedPromise;
  } catch (error) {
    ensureStorageSeedPromise = null;
    throw error;
  }
}

async function writeBackup(bundle: ContentBundle, reason: string): Promise<void> {
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `content-${reason}-${stamp}.json`;
  await fs.writeFile(path.resolve(backupDir, filename), JSON.stringify(bundle, null, 2), "utf8");
}

export async function readContentBundle(): Promise<ContentBundle> {
  await ensureStorageSeed();
  if (contentBundleCache) return contentBundleCache;
  if (contentBundleLoadPromise) return contentBundleLoadPromise;

  contentBundleLoadPromise = (async () => {
    const raw = await fs.readFile(contentPath, "utf8");
    const parsed = JSON.parse(raw) as ContentBundle;
    const seed = await loadSeedBundle();
    const normalized = normalizeContentBundle(parsed, seed.cards);
    if (JSON.stringify(parsed.cards) !== JSON.stringify(normalized.cards)) {
      await writeBackup(parsed, "talent-catalog-migration");
      await fs.writeFile(contentPath, JSON.stringify(normalized, null, 2), "utf8");
    }
    contentBundleCache = normalized;
    return normalized;
  })();

  try {
    return await contentBundleLoadPromise;
  } finally {
    contentBundleLoadPromise = null;
  }
}

export async function writeContentBundle(next: ContentBundle): Promise<ContentBundle> {
  await ensureStorageSeed();
  const seed = await loadSeedBundle();
  const normalized = normalizeContentBundle(next, seed.cards);
  await fs.writeFile(contentPath, JSON.stringify(normalized, null, 2), "utf8");
  await writeBackup(normalized, "update");
  contentBundleCache = normalized;
  contentBundleLoadPromise = null;
  return normalized;
}

export async function loadWorlds(): Promise<WorldConfig[]> {
  const bundle = await readContentBundle();
  return bundle.worlds;
}

export async function loadCards(): Promise<BackgroundCard[]> {
  const bundle = await readContentBundle();
  return bundle.cards;
}

export async function loadDifficulties(): Promise<DifficultyConfig[]> {
  const bundle = await readContentBundle();
  return bundle.difficulties;
}

export async function loadPromptPack(): Promise<Record<string, string>> {
  const bundle = await readContentBundle();
  return bundle.promptPack;
}

export async function loadWorldlineSetting(worldId: string): Promise<WorldlineSetting | null> {
  try {
    if (worldlineIndexCache) return worldlineIndexCache.get(worldId) ?? null;
    if (!worldlineIndexLoadPromise) {
      worldlineIndexLoadPromise = (async () => {
        const files = await fs.readdir(worldlineDir);
        const targets = files.filter((f) => f.endsWith(".json"));
        const chunks = await Promise.all(
          targets.map((name) => readJsonFile<WorldlineSetting[]>(path.resolve(worldlineDir, name)))
        );
        const index = new Map<string, WorldlineSetting>();
        for (const list of chunks) {
          for (const item of list) {
            index.set(item.id, item);
          }
        }
        worldlineIndexCache = index;
        return index;
      })();
    }
    const index = await worldlineIndexLoadPromise;
    return index.get(worldId) ?? null;
  } catch {
    worldlineIndexCache = null;
    return null;
  } finally {
    worldlineIndexLoadPromise = null;
  }
}

export async function loadFactions(): Promise<FactionSetting[]> {
  try {
    if (factionsCache) return factionsCache;
    if (!factionsLoadPromise) {
      factionsLoadPromise = readJsonFile<FactionSetting[]>(factionPath).then((items) => {
        factionsCache = items;
        return items;
      });
    }
    return await factionsLoadPromise;
  } catch {
    return [];
  } finally {
    factionsLoadPromise = null;
  }
}

export async function loadFactionEvents(worldId: string): Promise<FactionEventSetting[]> {
  try {
    if (factionEventsAllCache) {
      return factionEventsAllCache.filter((x) => x.worldId === worldId);
    }
    if (!factionEventsLoadPromise) {
      factionEventsLoadPromise = readJsonFile<FactionEventSetting[]>(factionEventPath).then((items) => {
        factionEventsAllCache = items;
        return items;
      });
    }
    const all = await factionEventsLoadPromise;
    return all.filter((x) => x.worldId === worldId);
  } catch {
    return [];
  } finally {
    factionEventsLoadPromise = null;
  }
}

async function loadEventMetadata(): Promise<EventMetadataSetting[]> {
  try {
    if (eventMetadataCache) return eventMetadataCache;
    if (!eventMetadataLoadPromise) {
      eventMetadataLoadPromise = readJsonFile<EventMetadataSetting[]>(eventMetadataPath).then((items) => {
        eventMetadataCache = items;
        return items;
      });
    }
    return await eventMetadataLoadPromise;
  } catch {
    return [];
  } finally {
    eventMetadataLoadPromise = null;
  }
}

function mergeNarrativeComponentCatalog(
  definition: NarrativeWorldDefinition,
  catalog: NarrativeComponentCatalog | null,
  worldId: string
): NarrativeWorldDefinition | null {
  if (!catalog) return { ...definition, components: [], componentEventBindings: [] };
  if (catalog.version !== 1 || catalog.worldId !== worldId) return null;

  const componentTypes = new Set(["plot", "character", "relationship", "object", "promise", "consequence"]);
  const componentStatuses = new Set(["introduced", "active", "escalated", "payable", "resolved"]);
  const narrativeEventIds = new Set(definition.eventBindings.map((binding) => binding.eventId));
  const componentIds = new Set<string>();
  for (const component of catalog.components) {
    if (!component.id?.trim() || !component.label?.trim() || !component.introHint?.trim() ||
      !component.activeHint?.trim() || !component.escalationHint?.trim() || !component.payoffHint?.trim() ||
      componentIds.has(component.id) || !Number.isFinite(component.priority) || !componentTypes.has(component.type)) {
      return null;
    }
    componentIds.add(component.id);
  }

  const eventIds = new Set<string>();
  for (const binding of catalog.eventBindings) {
    if (!binding.eventId?.trim() || eventIds.has(binding.eventId) || !narrativeEventIds.has(binding.eventId) || !Array.isArray(binding.transitions)) {
      return null;
    }
    eventIds.add(binding.eventId);
    if (binding.transitions.some((transition) => !componentIds.has(transition.componentId) || !componentStatuses.has(transition.status))) {
      return null;
    }
  }

  return {
    ...definition,
    components: catalog.components,
    componentEventBindings: catalog.eventBindings
  };
}

/**
 * World-act facts are engine contracts. A missing reference would otherwise
 * become an unreachable closure condition only after a long-running game.
 */
export function validateNarrativeWorldFactContract(
  definition: NarrativeWorldDefinition
): NarrativeWorldDefinition {
  if (definition.version >= 8 && !(definition.worldCards?.length)) {
    throw new Error(`${definition.worldId}_world_cards_required`);
  }
  const factIds = new Set<string>();
  for (const fact of definition.mainlineFacts ?? []) {
    if (!fact.id?.trim() || factIds.has(fact.id)) {
      throw new Error(`${definition.worldId}_mainline_fact_definition_invalid:${fact.id || "unknown"}`);
    }
    factIds.add(fact.id);
  }

  const actIds = new Set<string>();
  for (const act of definition.mainlineActs ?? []) {
    if (!act.id?.trim() || actIds.has(act.id)) {
      throw new Error(`${definition.worldId}_mainline_act_definition_invalid:${act.id || "unknown"}`);
    }
    actIds.add(act.id);
    const references = Array.from(new Set([
      ...(act.requiredFactIds ?? []),
      ...(act.introduceFactIds ?? []),
      ...(act.resolveFactIds ?? []),
      ...(act.factId ? [act.factId] : [])
    ]));
    const unresolved = references.find((id) => !factIds.has(id));
    if (unresolved) {
      throw new Error(`${definition.worldId}_mainline_act_fact_reference_invalid:${act.id}:${unresolved}`);
    }
  }
  const routeIds = new Set((definition.routeArcs ?? []).map((route) => route.directionId));
  const factionIds = new Set([
    ...(definition.socialForces ?? []).map((force) => force.id),
    ...(definition.narrativeFactions ?? []).map((faction) => faction.id)
  ]);
  if (definition.version >= 9) {
    const core = definition.worldCore;
    const palette = definition.narrativePalette;
    if (!core?.identity?.trim() || !core.powerStructure?.trim() || !core.everydayLife?.trim() ||
        !core.tone?.trim() || !core.laws?.length || !(definition.socialForces?.length) ||
        !palette?.sceneModes?.length || !palette.conflictSources?.length ||
        !palette.actionVocabulary?.length || !palette.scalePossibilities?.length ||
        (definition.version === 9 && !(definition.storyPatterns?.length))) {
      throw new Error(`${definition.worldId}_narrative_world_core_invalid`);
    }
  }
  const cardIds = new Set<string>();
  const cardKinds = new Set([
    "world_rule", "setting", "geography", "institution", "culture", "faction", "character", "location", "ability",
    "social_role", "practice", "conflict", "consequence", "motif", "style_example"
  ]);
  const cardTasks = new Set(["background", "planning", "horizon", "rendering", "dynamic", "decision"]);
  const cardBeats = new Set(["setup", "escalation", "pressure", "climax", "payoff", "ending"]);
  const factStatuses = new Set(["open", "resolved", "blocked"]);
  const cardPlacements = new Set(["world", "scenario", "example", "author_note"]);
  const selectiveLogics = new Set(["and_any", "and_all", "not_any", "not_all"]);
  const validCardKey = (value: string): boolean => {
    const key = value.trim();
    if (!key || key.length > 120) return false;
    if (!key.startsWith("/")) return true;
    const end = key.lastIndexOf("/");
    if (end <= 0) return false;
    try {
      new RegExp(key.slice(1, end), key.slice(end + 1));
      return true;
    } catch {
      return false;
    }
  };
  for (const card of definition.worldCards ?? []) {
    const keys = [...(card.activation?.keys ?? []), ...(card.activation?.secondaryKeys ?? [])];
    if (!card.id?.trim() || cardIds.has(card.id) || card.id.includes("|") || !card.content?.trim() ||
        !Number.isFinite(card.priority) || card.priority < 0 || card.priority > 100 || !cardKinds.has(card.kind) ||
        (card.placement !== undefined && !cardPlacements.has(card.placement)) ||
        (card.order !== undefined && !Number.isFinite(card.order)) ||
        (card.stickyTurns !== undefined && (!Number.isInteger(card.stickyTurns) || card.stickyTurns < 0 || card.stickyTurns > 8)) ||
        (card.cooldownTurns !== undefined && (!Number.isInteger(card.cooldownTurns) || card.cooldownTurns < 0 || card.cooldownTurns > 16)) ||
        (card.activation?.scanDepth !== undefined && (!Number.isInteger(card.activation.scanDepth) || card.activation.scanDepth < 0 || card.activation.scanDepth > 12)) ||
        (card.activation?.selectiveLogic !== undefined && !selectiveLogics.has(card.activation.selectiveLogic)) ||
        keys.some((key) => !validCardKey(key)) ||
        card.activation?.tasks?.some((task) => !cardTasks.has(task)) ||
        card.activation?.beats?.some((beat) => !cardBeats.has(beat)) ||
        card.activation?.factStatuses?.some((status) => !factStatuses.has(status))) {
      throw new Error(`${definition.worldId}_world_card_definition_invalid:${card.id || "unknown"}`);
    }
    cardIds.add(card.id);
    if (card.activation?.actIds?.some((id) => !actIds.has(id)) ||
        card.activation?.routeIds?.some((id) => !routeIds.has(id)) ||
        card.activation?.factionIds?.some((id) => !factionIds.has(id))) {
      throw new Error(`${definition.worldId}_world_card_activation_reference_invalid:${card.id}`);
    }
  }
  for (const card of definition.worldCards ?? []) {
    const unresolved = card.relatedCardIds?.find((id) => !cardIds.has(id));
    if (unresolved) throw new Error(`${definition.worldId}_world_card_relation_invalid:${card.id}:${unresolved}`);
  }
  return definition;
}

export async function loadNarrativeWorldDefinition(worldId: string): Promise<NarrativeWorldDefinition | null> {
  if (narrativeWorldCache.has(worldId)) {
    return narrativeWorldCache.get(worldId) ?? null;
  }
  const pending = narrativeWorldLoadPromises.get(worldId);
  if (pending) return pending;

  const load = Promise.all([
    readJsonFile<NarrativeWorldDefinition>(path.resolve(narrativeWorldDir, `${worldId}.story.json`)),
    readJsonFile<NarrativeComponentCatalog>(path.resolve(narrativeWorldDir, `${worldId}.components.json`)).catch(() => null),
    loadNarrativeWorldCardCatalog(worldId)
  ])
    .then(([definition, catalog, authoredWorldCards]) => {
      if (definition.version >= 10 && (definition.worldCards?.length ?? 0) > 0) {
        throw new Error(`${worldId}_inline_world_cards_not_supported`);
      }
      const definitionWithCards = authoredWorldCards.length
        ? { ...definition, worldCards: [...(definition.worldCards ?? []), ...authoredWorldCards] }
        : definition;
      const merged = (definitionWithCards.version === 1 || definitionWithCards.version === 2 || definitionWithCards.version === 3 || definitionWithCards.version === 4 || definitionWithCards.version === 5 || definitionWithCards.version === 6 || definitionWithCards.version === 7 || definitionWithCards.version === 8 || definitionWithCards.version === 9 || definitionWithCards.version === 10) && definitionWithCards.worldId === worldId
        ? mergeNarrativeComponentCatalog(definitionWithCards, definitionWithCards.version >= 8 ? null : catalog, worldId)
        : null;
      const valid = merged ? validateNarrativeWorldFactContract(merged) : null;
      narrativeWorldCache.set(worldId, valid);
      return valid;
    })
    .catch((error) => {
      // Keep malformed authoring data out of the runtime without exposing
      // internal validation details to the player-facing API.
      if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
        console.error(`[narrative-world:load:${worldId}]`, error);
      }
      narrativeWorldCache.set(worldId, null);
      return null;
    })
    .finally(() => {
      narrativeWorldLoadPromises.delete(worldId);
    });
  narrativeWorldLoadPromises.set(worldId, load);
  return load;
}

function defaultTagsForFaction(factionId: string): string[] {
  const profiles: Record<string, string[]> = {
    guardian: ["charisma", "physique", "guardian"],
    ambition: ["intelligence", "family", "ambition"],
    broker: ["family", "fortune", "broker"],
    mentor: ["intelligence", "charisma", "mentor"],
    institution: ["intelligence", "family", "institution"],
    outsider: ["fortune", "physique", "outsider"]
  };
  return profiles[factionId] ?? [factionId];
}

function normalizeEventDefinition(
  worldId: string,
  factionId: string,
  source: string | EventDefinition,
  index: number,
  metadata?: EventMetadata
): EventDefinition {
  const defaults: EventDefinition = {
    id: `${worldId}_${factionId}_${String(index + 1).padStart(2, "0")}`,
    worldId,
    factionId,
    title: "",
    kind: "any",
    tags: defaultTagsForFaction(factionId),
    minAge: 5,
    cooldownYears: 8,
    baseWeight: 10,
    outcomeProfileId: factionId,
    promptHook: ""
  };
  const metadataStatTags = [metadata?.primaryStat, metadata?.secondaryStat]
    .filter((stat): stat is NonNullable<typeof stat> => Boolean(stat));
  if (typeof source !== "string") {
    return {
      ...defaults,
      ...metadata,
      ...source,
      worldId,
      factionId: source.factionId ?? factionId,
      tags: Array.from(new Set([
        ...defaults.tags,
        ...metadataStatTags,
        ...(metadata?.tags ?? []),
        ...(metadata?.focusTags ?? []),
        ...source.tags
      ])),
      promptHook: source.promptHook || metadata?.promptHook || source.title
    };
  }
  const title = source.trim();
  return {
    ...defaults,
    ...metadata,
    title,
    tags: Array.from(new Set([...defaults.tags, ...metadataStatTags, ...(metadata?.tags ?? []), ...(metadata?.focusTags ?? [])])),
    promptHook: metadata?.promptHook || title
  };
}

function applyNarrativeEventBinding(
  definition: EventDefinition,
  narrativeWorld: NarrativeWorldDefinition | null
): EventDefinition {
  const binding = narrativeWorld?.eventBindings.find((item) => item.eventId === definition.id);
  const componentBinding = narrativeWorld?.componentEventBindings?.find((item) => item.eventId === definition.id);
  const inferredSceneArchetypeId = (() => {
    if (binding?.sceneArchetypeId) return binding.sceneArchetypeId;
    const beat = binding?.beat ?? definition.narrativeBeat;
    const profile = definition.outcomeProfileId;
    if (beat === "setup") return profile === "duty" || profile === "care" ? "ally_request" : "third_party_request";
    if (beat === "escalation") return "hidden_evidence";
    if (beat === "pressure") return profile === "burden" || profile === "care" || profile === "teaching"
      ? "relationship_fracture"
      : "institutional_obstruction";
    if (beat === "climax") return "public_commitment";
    if (beat === "payoff") return "witness_return";
    return definition.sceneArchetypeId;
  })();
  const routeThreadIds = (definition.storyDirectionIds ?? []).flatMap((directionId) => (
    narrativeWorld?.routeArcs?.find((arc) => arc.directionId === directionId)?.coreThreadIds ?? []
  ));
  if (!binding && !componentBinding && routeThreadIds.length === 0) return definition;
  const threadIds = Array.from(new Set([
    ...(definition.narrativeThreadIds ?? []),
    ...routeThreadIds,
    ...(binding?.opensThreads ?? []),
    ...(binding?.resolvesThreads ?? [])
  ]));
  const componentTransitions = componentBinding?.transitions ?? definition.narrativeComponentTransitions ?? [];
  const componentById = new Map((narrativeWorld?.components ?? []).map((component) => [component.id, component]));
  const threadById = new Map((narrativeWorld?.threads ?? []).map((thread) => [thread.id, thread]));
  const factKindForComponent = (componentId: string) => {
    const type = componentById.get(componentId)?.type;
    if (type === "promise") return "commitment" as const;
    if (type === "consequence") return "cost" as const;
    if (type === "relationship" || type === "character") return "relationship_change" as const;
    if (type === "object") return "stake" as const;
    return "open_question" as const;
  };
  const introducedFacts = componentTransitions
    .filter((transition) => transition.status === "introduced")
    .map((transition) => ({
      id: `component:${transition.componentId}`,
      kind: factKindForComponent(transition.componentId),
      label: transition.fact?.trim() || componentById.get(transition.componentId)?.label || transition.componentId,
      priority: componentById.get(transition.componentId)?.priority ?? 1,
      threadId: componentById.get(transition.componentId)?.threadIds?.[0] ?? threadIds[0],
      routeIds: definition.storyDirectionIds,
      characterIds: binding?.characterIds
    }));
  const payoffFactIds = componentTransitions
    .filter((transition) => transition.status === "resolved")
    .map((transition) => `component:${transition.componentId}`);
  const openedThreadIds = Array.from(new Set([
    ...(definition.opensThreads ?? []),
    ...(binding?.opensThreads ?? []),
    ...(binding?.beat === "setup" ? threadIds : [])
  ]));
  const resolvedThreadIds = Array.from(new Set([
    ...(definition.resolvesThreads ?? []),
    ...(binding?.resolvesThreads ?? [])
  ]));
  const threadFacts = openedThreadIds.map((threadId) => ({
    id: `thread:${threadId}`,
    kind: "open_question" as const,
    label: threadById.get(threadId)?.label || "一条会持续影响后续人生的主线已经开启。",
    priority: 2,
    threadId,
    routeIds: definition.storyDirectionIds,
    characterIds: binding?.characterIds
  }));
  const resolvedThreadFactIds = resolvedThreadIds.map((threadId) => `thread:${threadId}`);
  const continuationThreadIds = threadIds.filter((threadId) => !openedThreadIds.includes(threadId) && !resolvedThreadIds.includes(threadId));
  const continuationFactIds = continuationThreadIds.map((threadId) => `thread:${threadId}`);
  const factEffect = definition.factEffect ?? (threadFacts.length || introducedFacts.length || payoffFactIds.length || resolvedThreadFactIds.length
    ? {
        introduce: [...threadFacts, ...introducedFacts],
        modifyFactIds: continuationFactIds,
        resolveFactIds: [...payoffFactIds, ...resolvedThreadFactIds]
      }
    : threadIds.length > 0
      ? { modifyFactIds: continuationFactIds }
      : undefined);
  const relatedFactIds = Array.from(new Set(componentTransitions.map((transition) => `component:${transition.componentId}`)));
  const defaultDecisionFactEffects: NonNullable<EventDefinition["decisionFactEffects"]> | undefined = (definition.kind === "milestone" || threadIds.length > 0 || Boolean(binding))
    ? {
        safe: {
          introduce: [{
            id: `decision:${definition.id}:safe`,
            kind: "commitment",
            label: "人物选择保全既有承诺，并承担由此留下的后续责任。",
            priority: 2,
            threadId: threadIds[0],
            routeIds: definition.storyDirectionIds,
            characterIds: binding?.characterIds
          }],
          modifyFactIds: relatedFactIds
        },
        balanced: {
          introduce: [{
            id: `decision:${definition.id}:balanced`,
            kind: "commitment",
            label: "人物以交换条件推进主线，承诺和代价都将留在后续故事中。",
            priority: 2,
            threadId: threadIds[0],
            routeIds: definition.storyDirectionIds,
            characterIds: binding?.characterIds
          }, {
            id: `cost:${definition.id}:balanced`,
            kind: "cost",
            label: "这次权衡留下了必须兑现的代价。",
            priority: 2,
            threadId: threadIds[0],
            routeIds: definition.storyDirectionIds
          }],
          modifyFactIds: relatedFactIds
        },
        risky: {
          introduce: [{
            id: `decision:${definition.id}:risky`,
            kind: "commitment",
            label: "人物押上已有筹码，作出不可逆的冒险承诺。",
            priority: 3,
            threadId: threadIds[0],
            routeIds: definition.storyDirectionIds,
            characterIds: binding?.characterIds
          }, {
            id: `cost:${definition.id}:risky`,
            kind: "cost",
            label: "这次冒险留下了更沉重的后续代价。",
            priority: 3,
            threadId: threadIds[0],
            routeIds: definition.storyDirectionIds
          }, {
            id: `relationship:${definition.id}:risky`,
            kind: "relationship_change",
            label: "人物与相关人物之间的信任和立场因此发生了变化。",
            priority: 2,
            threadId: threadIds[0],
            routeIds: definition.storyDirectionIds,
            characterIds: binding?.characterIds
          }],
          modifyFactIds: relatedFactIds
        }
      }
    : undefined;
  return {
    ...definition,
    narrativeBeat: binding?.beat ?? definition.narrativeBeat,
    sceneArchetypeId: inferredSceneArchetypeId,
    narrativeThreadIds: threadIds,
    narrativeCharacterIds: Array.from(new Set([
      ...(definition.narrativeCharacterIds ?? []),
      ...(binding?.characterIds ?? [])
    ])),
    narrativeComponentTransitions: componentTransitions,
    opensThreads: Array.from(new Set([
      ...(definition.opensThreads ?? []),
      ...(binding?.opensThreads ?? [])
    ])),
    resolvesThreads: Array.from(new Set([
      ...(definition.resolvesThreads ?? []),
      ...(binding?.resolvesThreads ?? [])
    ])),
    promptHook: binding?.sceneHint?.trim() || definition.promptHook,
    factEffect,
    decisionFactEffects: definition.decisionFactEffects ?? defaultDecisionFactEffects,
    reclaimableFactIds: Array.from(new Set([
      ...(definition.reclaimableFactIds ?? []),
      ...resolvedThreadFactIds
    ]))
  };
}

function validateNarrativeFactContract(worldId: string, definitions: EventDefinition[]): EventDefinition[] {
  const byId = new Map(definitions.map((event) => [event.id, event]));
  const knownFacts = new Set<string>();
  for (const definition of definitions) {
    for (const fact of definition.factEffect?.introduce ?? []) knownFacts.add(fact.id);
  }
  for (const definition of definitions) {
    const references = [
      ...(definition.requiresFactIds ?? []),
      ...(definition.modifiesFactIds ?? []),
      ...(definition.reclaimableFactIds ?? []),
      ...(definition.factEffect?.modifyFactIds ?? []),
      ...(definition.factEffect?.resolveFactIds ?? []),
      ...(definition.factEffect?.blockFactIds ?? [])
    ];
    for (const effect of Object.values(definition.decisionFactEffects ?? {})) {
      references.push(
        ...(effect?.modifyFactIds ?? []),
        ...(effect?.resolveFactIds ?? []),
        ...(effect?.blockFactIds ?? [])
      );
      for (const fact of effect?.introduce ?? []) knownFacts.add(fact.id);
    }
    if (!definition.id || !definition.storyDirectionIds?.length || !definition.narrativeBeat) {
      throw new Error(`${worldId}_event_contract_invalid:${definition.id || "unknown"}`);
    }
    if (references.some((id) => !knownFacts.has(id))) {
      throw new Error(`${worldId}_event_fact_reference_invalid:${definition.id}`);
    }
    if (definition.followUpIds?.some((id) => !byId.has(id))) {
      throw new Error(`${worldId}_event_follow_up_invalid:${definition.id}`);
    }
  }
  return definitions;
}

function validateNarrativeEndingBlueprintContract(
  worldId: string,
  narrativeWorld: NarrativeWorldDefinition
): void {
  const requiredEndingPolarities = ["good", "normal", "bad"] as const;
  if (narrativeWorld.version >= 9) {
    const missingEndings = requiredEndingPolarities.filter((polarity) => !narrativeWorld.endingBlueprints.some((blueprint) => blueprint.polarity === polarity));
    if (missingEndings.length > 0 || narrativeWorld.endingBlueprints.length !== requiredEndingPolarities.length) {
      throw new Error(`${worldId}_ending_blueprint_contract_invalid:world:${missingEndings.join(",")}`);
    }
    return;
  }
  for (const route of narrativeWorld.routeArcs ?? []) {
    const missingEndings = requiredEndingPolarities.filter((polarity) => !narrativeWorld.endingBlueprints.some((blueprint) => (
      blueprint.directionId === route.directionId && blueprint.polarity === polarity
    )));
    if (missingEndings.length > 0) {
      throw new Error(`${worldId}_ending_blueprint_contract_invalid:${route.directionId}:${missingEndings.join(",")}`);
    }
  }
}

export async function loadEventDefinitions(worldId: string): Promise<EventDefinition[]> {
  const [groups, metadataGroups, narrativeWorld] = await Promise.all([
    loadFactionEvents(worldId),
    loadEventMetadata(),
    loadNarrativeWorldDefinition(worldId)
  ]);
  const metadataByFaction = new Map<string, EventMetadataSetting>(
    metadataGroups
      .filter((group) => group.worldId === worldId)
      .map((group): [string, EventMetadataSetting] => [`${group.worldId}:${group.factionId}`, group])
  );
  const definitions = groups.flatMap((group) =>
    group.events
      .map((event, index) => applyNarrativeEventBinding(
        normalizeEventDefinition(
          group.worldId,
          group.factionId,
          event,
          index,
          (() => {
            const metadata = metadataByFaction.get(`${group.worldId}:${group.factionId}`);
            return metadata ? { ...metadata.defaults, ...metadata.events[index] } : undefined;
          })()
        ),
        narrativeWorld
      ))
      .filter((event) => event.title.trim().length > 0)
  );
  // Dynamic scenes use the world package directly. Old static material remains
  // available to content tooling but cannot make a world fail to load.
  if (narrativeWorld) validateNarrativeEndingBlueprintContract(worldId, narrativeWorld);
  return definitions;
}

export async function loadItemDefinitions(): Promise<ItemDefinition[]> {
  try {
    if (itemDefinitionsCache) return itemDefinitionsCache;
    if (!itemDefinitionsLoadPromise) {
      itemDefinitionsLoadPromise = readJsonFile<ItemDefinition[]>(itemPath).then((items) => {
        itemDefinitionsCache = items.filter((item) => item.id && item.name && Array.isArray(item.effects));
        return itemDefinitionsCache;
      });
    }
    return await itemDefinitionsLoadPromise;
  } catch {
    return [];
  } finally {
    itemDefinitionsLoadPromise = null;
  }
}

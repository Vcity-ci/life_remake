import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BackgroundCard, ContentBundle, DifficultyConfig, WorldConfig } from "@reroll/shared";

interface WorldlineSetting {
  id: string;
  eraName: string;
  timeframe: string;
  coreConflict: string;
  socialOrder: string;
  taboos: string[];
  mainlineStages: Array<{ stage: string; ageRange: string; goal: string }>;
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
  events: string[];
}

interface TalentPromptHook {
  id: string;
  name: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  description: string;
  modifiers: Partial<Record<"intelligence" | "charisma" | "family" | "fortune", number>>;
  tags: string[];
  promptHooks: {
    narrativeBias: string;
    eventAffinity: string[];
    riskTone: string;
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");
const dataRoot = path.resolve(projectRoot, "data");
const storageRoot = path.resolve(projectRoot, "storage");
const contentPath = path.resolve(storageRoot, "custom-content.json");
const backupDir = path.resolve(storageRoot, "backups");
const skillPromptPath = path.resolve(projectRoot, "skills", "ai-gm", "prompt-pack.json");

const worldlineDir = path.resolve(dataRoot, "settings", "worldlines");
const factionPath = path.resolve(dataRoot, "settings", "factions", "factions.json");
const factionEventPath = path.resolve(dataRoot, "events", "faction-events.json");
const talentPromptPath = path.resolve(dataRoot, "talents", "talent-cards.json");

async function readJsonFile<T>(targetPath: string): Promise<T> {
  const raw = await fs.readFile(targetPath, "utf8");
  return JSON.parse(raw) as T;
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
    promptPack
  };
}

async function ensureStorageSeed(): Promise<void> {
  await fs.mkdir(storageRoot, { recursive: true });
  try {
    await fs.access(contentPath);
  } catch {
    const seed = await loadSeedBundle();
    await fs.writeFile(contentPath, JSON.stringify(seed, null, 2), "utf8");
    await writeBackup(seed, "seed");
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
  const raw = await fs.readFile(contentPath, "utf8");
  const parsed = JSON.parse(raw) as ContentBundle;
  parsed.worlds = [...parsed.worlds].sort((a, b) => a.id.localeCompare(b.id));
  return parsed;
}

export async function writeContentBundle(next: ContentBundle): Promise<ContentBundle> {
  await ensureStorageSeed();
  const normalized: ContentBundle = {
    worlds: [...next.worlds].sort((a, b) => a.id.localeCompare(b.id)),
    cards: next.cards,
    difficulties: next.difficulties,
    promptPack: next.promptPack
  };
  await fs.writeFile(contentPath, JSON.stringify(normalized, null, 2), "utf8");
  await writeBackup(normalized, "update");
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
    const files = await fs.readdir(worldlineDir);
    const targets = files.filter((f) => f.endsWith(".json"));
    for (const name of targets) {
      const items = await readJsonFile<WorldlineSetting[]>(path.resolve(worldlineDir, name));
      const found = items.find((x) => x.id === worldId);
      if (found) return found;
    }
    return null;
  } catch {
    return null;
  }
}

export async function loadFactions(): Promise<FactionSetting[]> {
  try {
    return await readJsonFile<FactionSetting[]>(factionPath);
  } catch {
    return [];
  }
}

export async function loadFactionEvents(worldId: string): Promise<FactionEventSetting[]> {
  try {
    const all = await readJsonFile<FactionEventSetting[]>(factionEventPath);
    return all.filter((x) => x.worldId === worldId);
  } catch {
    return [];
  }
}

export async function loadTalentPromptHooks(): Promise<TalentPromptHook[]> {
  try {
    return await readJsonFile<TalentPromptHook[]>(talentPromptPath);
  } catch {
    return [];
  }
}

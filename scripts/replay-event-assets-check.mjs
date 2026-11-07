import fs from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import { synchronizePresetEventAssets } from '../apps/backend/src/ai.ts';
import { applyEventAssetChanges } from '../apps/backend/src/narrative/event-assets.ts';
import { loadPromptPack } from '../apps/backend/src/content.ts';

// Opt-in replay: reads a captured test batch and never writes to the game store.
const source = path.resolve(process.argv[2]);
const run = JSON.parse(await fs.readFile(source, 'utf8'));
const batch = run.narrative.assetBuffer;
if (!batch?.rounds.length) throw new Error('replay_requires_pending_asset_batch');
const output = path.join(process.cwd(), 'storage', `verification-event-assets-${Date.now()}`);
await fs.mkdir(output, { recursive: true });
const world = JSON.parse(await fs.readFile('data/worlds/ancient.json', 'utf8'));
const context = { apiKey: (await fs.readFile('Material/ak.txt', 'utf8')).trim(), promptPack: await loadPromptPack(),
  providerConfig: { provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash',
    apiPath: '/chat/completions', temperature: .9, maxTokens: 18240, timeoutMs: 60000, reasoningEffort: 'minimal' } };
let calls = 0;
const original = OpenAI.Chat.Completions.prototype.create;
OpenAI.Chat.Completions.prototype.create = async function(request, ...args) {
  const started = Date.now(), result = await original.call(this, request, ...args);
  await fs.writeFile(path.join(output, `model-${++calls}.json`), JSON.stringify({ milliseconds: Date.now() - started, request, result }, null, 2));
  return result;
};
const changes = await synchronizePresetEventAssets(run, world, batch, context);
const changed = applyEventAssetChanges(run, batch, changes);
await fs.writeFile(path.join(output, 'verification-result.json'), JSON.stringify({ source, calls, changed, changes,
  characters: run.narrative.dynamicCharacters, assets: run.narrative.assets }, null, 2));
console.log(JSON.stringify({ output, calls, changed, introductions: changes.introductions.length, updates: changes.updates.length }));

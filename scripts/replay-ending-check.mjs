import fs from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import { generateEndingNarrative } from '../apps/backend/src/ai.ts';
import { loadNarrativeWorldDefinition, loadPromptPack, loadWorlds } from '../apps/backend/src/content.ts';
import { resolveNarrativeExperience } from '../apps/backend/src/narrative-experience.ts';
import { buildNarrativePromptPlan } from '../apps/backend/src/narrative.ts';

// Re-render an already confirmed ending without changing its history, grade or saved game.
if (!process.argv[2] || !process.argv[3]) throw new Error('usage: replay-ending-check.mjs run.json output-directory');
const source = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]);
const run = JSON.parse(await fs.readFile(source, 'utf8'));
if (!run.ended) throw new Error('ending_replay_requires_ended_run');
// Reproduce the first ending request. A previously rendered ending is output,
// not evidence for its own replacement.
const oldEndingIds = new Set(run.narrative.episodes.filter(entry => entry.turnKind === 'ending').map(entry => entry.id));
if (run.narrative.memoryDigests.some(digest => digest.coveredEpisodeIds.some(id => oldEndingIds.has(id))))
  throw new Error('ending_replay_requires_pre_ending_summary');
const oldEndingMemoryIds = new Set(run.narrative.episodes.filter(entry => oldEndingIds.has(entry.id)).flatMap(entry => entry.memoryIds));
run.narrative.episodes = run.narrative.episodes.filter(entry => !oldEndingIds.has(entry.id));
run.narrative.memoryEntries = run.narrative.memoryEntries.filter(entry => !oldEndingMemoryIds.has(entry.id));
const world = (await loadWorlds()).find(entry => entry.id === run.worldId);
const base = await loadNarrativeWorldDefinition(run.worldId);
if (!world || !base || !run.storyPackSnapshot) throw new Error('ending_replay_world_missing');
await fs.mkdir(output, { recursive: true });
let calls = 0;
const original = OpenAI.Chat.Completions.prototype.create;
OpenAI.Chat.Completions.prototype.create = async function(request, ...args) {
  const started = Date.now(), result = await original.call(this, request, ...args);
  await fs.writeFile(path.join(output, `model-${++calls}.json`), JSON.stringify({ milliseconds: Date.now() - started, request, result }, null, 2));
  return result;
};
const definition = resolveNarrativeExperience(base, run.storyPackSnapshot);
const after = await generateEndingNarrative(run, world, {
  apiKey: (await fs.readFile('Material/ak.txt', 'utf8')).trim(), promptPack: await loadPromptPack(),
  providerConfig: { provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash',
    apiPath: '/chat/completions', temperature: .9, maxTokens: 6000, timeoutMs: 60000, reasoningEffort: 'minimal' },
  narrativePlan: buildNarrativePromptPlan(run, definition, null, 'ending')
});
await fs.writeFile(path.join(output, 'comparison.md'), [
  '# 同一实际历史的结局渲染对照', `来源：${source}。已确认等级：${run.narrative.endingPolarity}。重放排除此前结局输出，保留其余实际历史。`,
  '## 修改前', run.endingSummary ?? '', '## 当前请求的实际返回', after
].join('\n\n') + '\n');
await fs.writeFile(path.join(output, 'verification-result.json'), JSON.stringify({ source, calls,
  polarity: run.narrative.endingPolarity, before: run.endingSummary, after }, null, 2));
console.log(JSON.stringify({ output, calls, polarity: run.narrative.endingPolarity, characters: after.length }));

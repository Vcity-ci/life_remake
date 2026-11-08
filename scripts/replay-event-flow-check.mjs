import fs from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import { generateNarrativeActWorldCard, observeNarrativeAct, planNextEventFlow } from '../apps/backend/src/ai.ts';
import { bindEventFlowText } from '../apps/backend/src/narrative/event-flow.ts';
import { loadNarrativeWorldDefinition, loadPromptPack } from '../apps/backend/src/content.ts';
import { resolveNarrativeExperience } from '../apps/backend/src/narrative-experience.ts';
import { buildNarrativePromptPlan } from '../apps/backend/src/narrative.ts';

// Read-only model replay against captured test inputs; never saves a game or rerolls.
const root = process.cwd();
const source = path.resolve(process.argv[2]);
const output = path.join(root, 'storage', `verification-event-flow-replay-${Date.now()}`);
await fs.mkdir(output, { recursive: true });
const read = async file => JSON.parse(await fs.readFile(path.join(source, file), 'utf8'));
const run = await read('run-015.json');
const world = JSON.parse(await fs.readFile(path.join(root, 'data/worlds/ancient.json'), 'utf8'));
const definition = resolveNarrativeExperience(await loadNarrativeWorldDefinition(run.worldId), run.storyPackSnapshot);
const ctx = { apiKey: (await fs.readFile(path.join(root, 'Material/ak.txt'), 'utf8')).trim(),
  promptPack: await loadPromptPack(), providerConfig: { provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash', apiPath: '/chat/completions', temperature: .9, maxTokens: 18240, timeoutMs: 60000, reasoningEffort: 'minimal' },
  narrativePlan: buildNarrativePromptPlan(run, definition, null, 'planning') };
let calls = 0;
const original = OpenAI.Chat.Completions.prototype.create;
OpenAI.Chat.Completions.prototype.create = async function(request, ...args) {
  const started = Date.now(), result = await original.call(this, request, ...args);
  await fs.writeFile(path.join(output, `model-${++calls}.json`), JSON.stringify({ milliseconds: Date.now() - started, request, result }, null, 2));
  return result;
};
const act = definition.mainlineActs.find(act => act.id === run.narrative.actRuntime.actId);
const card = await generateNarrativeActWorldCard(run, world, { callId: 'replay:act', source: 'scene', worldId: run.worldId,
  currentAge: run.age, backgroundAgeRange: { fromAge: run.age + 1, toAge: run.age + 1 }, act, capabilities: [],
  storyPatterns: [], socialForces: [], focusReferences: [], statTiers: {}, clock: run.narrative.sceneClock }, ctx);
const preparationCalls = calls;
const observedRun = await read('run-023.json');
const capture = await read('model-0053.json');
const task = capture.request.messages.map(message => message.content).find(text => text.includes('实际历史（含本次完整事件）：'));
const available = JSON.parse(task.split('\n').find(line => line.startsWith('本幕可用的后续事件组（候选，尚未发生）：')).split('：').slice(1).join('：'));
const previous = { id: 'map-delivery', label: '交付边道图', narrativeRole: '道具交付',
  result: bindEventFlowText(observedRun.storyPackSnapshot.eventFlow.groups.find(group => group.id === 'map-delivery').events.at(-1).outcome.result,
    observedRun.narrative.eventFlow.bindings) };
const recentStory = task.split('实际历史（含本次完整事件）：\n')[1];
const observation = await observeNarrativeAct(observedRun, world, { callId: 'replay:group', actId: act.id,
  sourceEventId: 'replay:map-delivery', outline: observedRun.narrative.actRuntime.outline,
  recentStory, eventFlow: previous },
  { ...ctx, narrativePlan: buildNarrativePromptPlan(observedRun, definition, null, 'observation') });
const observationCalls = calls - preparationCalls;
const nextFlowId = observation.decision === 'ongoing' ? await planNextEventFlow(observedRun, world, {
  callId: 'replay:group', actId: act.id, outline: observedRun.narrative.actRuntime.outline, recentStory, previous, candidates: available
}, ctx) : undefined;
const summary = { source, preparationCalls, observationCalls, continuationCalls: calls - preparationCalls - observationCalls, nextFlowId,
  preservedBindings: card.flowBindings.every(binding => !run.narrative.eventFlow.bindings[binding.roleId] ||
    run.narrative.eventFlow.bindings[binding.roleId] === binding.name),
  opening: run.narrative.eventFlow?.flowId ?? card.eventFlows?.openingFlowId, observation };
await fs.writeFile(path.join(output, 'verification-result.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ output, ...summary }));

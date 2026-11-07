import fs from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import { prepareNarrativeOutcomeRequest, memoryCurationTool } from '../apps/backend/src/ai.ts';

// Reuse captured period dialogue unchanged. Never saves a game or reads asset archives.
const source = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
await fs.mkdir(output, { recursive: true });
const run = JSON.parse(await fs.readFile(path.join(source, 'latest-run.json'), 'utf8'));
const world = JSON.parse(await fs.readFile('data/worlds/ancient.json', 'utf8'));
const apiKey = (await fs.readFile('Material/ak.txt', 'utf8')).trim();
const client = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com', timeout: 60000 });
const results = [];
for (const name of process.argv.slice(4)) {
  const capture = JSON.parse(await fs.readFile(path.join(source, name), 'utf8'));
  const task = capture.request.messages.at(-1).content;
  const ctx = { promptPack: {}, narrativePlan: { task: 'curation', storyBible: '', activeLore: [],
    plotEssentials: [], activeThreads: [], activeCharacters: [], scene: '', authorNote: '', ending: '' } };
  const prepared = prepareNarrativeOutcomeRequest(run, world, ctx, memoryCurationTool({}), task.replace(/^【当前任务】\n/, ''), { task: 'curation' });
  const request = { ...capture.request, ...(process.env.NARRATIVE_MEMORY_TEMPERATURE ? { temperature: Number(process.env.NARRATIVE_MEMORY_TEMPERATURE) } : {}), messages: [{ role: 'system', content: prepared.conversation.headCore },
    ...prepared.history.map(message => ({ role: message.role, content: message.content }))], tools: prepared.tools };
  const started = Date.now();
  const result = await client.chat.completions.create(request);
  const summary = JSON.parse(result.choices[0].message.tool_calls[0].function.arguments).summary;
  const before = JSON.parse(capture.result.choices[0].message.tool_calls[0].function.arguments).summary;
  await fs.writeFile(path.join(output, name), JSON.stringify({ milliseconds: Date.now() - started, request, result }, null, 2));
  results.push({ source: name, beforeCharacters: before.length, afterCharacters: summary.length,
    inputTokens: result.usage.prompt_tokens, outputTokens: result.usage.completion_tokens, summary });
}
await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));

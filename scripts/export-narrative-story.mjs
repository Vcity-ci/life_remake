import fs from 'node:fs/promises';
import path from 'node:path';

const source = path.resolve(process.argv[2]);
const run = JSON.parse(await fs.readFile(source, 'utf8'));
const flowId = process.argv[3];
const flow = flowId ? run.storyPackSnapshot?.eventFlow?.groups.find(group => group.id === flowId) : undefined;
if (flowId && !flow) throw new Error('export_event_group_missing');
let records = run.turnRecords;
if (flow) {
  const sources = new Set(run.narrative.eventFlow.completed.filter(entry => entry.flowId === flowId).map(entry => entry.sourceEventId));
  const turns = new Set(run.narrative.episodes.filter(entry => sources.has(entry.sourceEventId)).map(entry => entry.turnId));
  const sequences = records.filter(record => turns.has(record.turnId)).map(record => record.sequence);
  if (!sequences.length) throw new Error('export_event_group_has_no_committed_records');
  // Include the choice backgrounds between committed units, without guessing from prose.
  records = records.filter(record => record.sequence >= Math.min(...sequences) && record.sequence <= Math.max(...sequences));
}
const parts = [`# ${flow?.label ?? run.storyPackSnapshot?.name ?? run.worldId}：实测正文`,
  `存档：${run.runId}。${run.age}岁，${run.ended ? '已结束' : '未结束'}，状态 ${run.outcome}。`];
for (const turn of records) {
  parts.push(`## ${turn.sequence} · ${turn.age}岁 · ${turn.kind}`, turn.narrative);
  if (turn.choice) parts.push(...turn.choice.options.map(option => `- ${option.label}：${option.description}`));
  if (turn.decisionResult) parts.push(`本次检定：${turn.decisionResult.roll.decision}，${turn.decisionResult.roll.success ? '成功' : '失败'}。`);
}
if (!flow && run.endingSummary) parts.push('## 结局', run.endingSummary);
const output = path.join(path.dirname(source), flow ? `story-${flow.id}.md` : 'story.md');
await fs.writeFile(output, parts.join('\n\n') + '\n');
console.log(output);

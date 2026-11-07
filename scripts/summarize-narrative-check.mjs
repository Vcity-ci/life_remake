import fs from 'node:fs/promises';
import path from 'node:path';

// Summarize captured integration evidence without reading provider credentials.
const directory = path.resolve(process.argv[2]);
const files = await fs.readdir(directory);
const run = JSON.parse(await fs.readFile(path.join(directory, 'latest-run.json'), 'utf8'));
const captures = [];
for (const file of files.filter(file => /^model-\d+\.json$/.test(file)).sort()) {
  captures.push({ file, ...JSON.parse(await fs.readFile(path.join(directory, file), 'utf8')) });
}
const calls = {};
const backgroundRequests = new Map();
const observations = [];
const cards = [];
const corrections = [];
for (const capture of captures) {
  const call = capture.result.choices?.[0]?.message?.tool_calls?.[0]?.function;
  const name = call?.name ?? 'ending_text';
  const tally = calls[name] ??= { count: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, milliseconds: 0 };
  tally.count++;
  tally.inputTokens += capture.result.usage?.prompt_tokens ?? 0;
  tally.cachedInputTokens += capture.result.usage?.prompt_cache_hit_tokens ?? 0;
  tally.outputTokens += capture.result.usage?.completion_tokens ?? 0;
  tally.milliseconds += capture.milliseconds;
  if (!call) continue;
  let result;
  try { result = JSON.parse(call.arguments); } catch { continue; }
  const task = capture.request.messages?.filter(message => message.role === 'user').at(-1)?.content ?? '';
  if (task.includes('originalToolArguments')) {
    try {
      const detail = JSON.parse(task.split('\n').at(-1));
      corrections.push({ file: capture.file, tool: name, reason: detail.reason, rule: detail.validation?.rule });
    } catch { corrections.push({ file: capture.file, tool: name }); }
  }
  if (name === 'render_background_prose') {
    const mode = task.includes('过渡生活：') ? 'transition'
      : task.includes('准备不足项：') ? 'preparation'
      : task.includes('这一阶段的普通生活：') ? 'life_interval' : 'early_life';
    backgroundRequests.set(result.narrative, { mode, file: capture.file,
      deficits: task.split('\n').find(line => line.startsWith('准备不足项：')) });
  }
  if (name === 'observe_act_closure') observations.push({ file: capture.file, ...result });
  if (name === 'plan_act_world_card') cards.push({ file: capture.file, ...result });
}
const snapshotByTurn = new Map();
const lifeSchedules = new Map();
for (const file of files.filter(file => /^run-\d+\.json$/.test(file)).sort()) {
  const snapshot = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'));
  const interval = snapshot.narrative.eventFlow?.lifeInterval;
  if (interval) lifeSchedules.set(`${interval.actId}:${interval.flowId}:${interval.nodeId}`, interval);
  for (const turn of snapshot.turnRecords) {
    if (!snapshotByTurn.has(turn.turnId)) snapshotByTurn.set(turn.turnId, {
      actId: snapshot.narrative.actRuntime?.actId, flowId: snapshot.narrative.eventFlow?.flowId
    });
  }
}
const ordinaryIntervals = [];
const story = [];
for (const [index, turn] of run.turnRecords.entries()) {
  story.push({ sequence: turn.sequence, age: turn.age, kind: turn.kind, narrative: turn.narrative,
    ...(turn.decisionResult ? { roll: turn.decisionResult.roll } : {}) });
  if (turn.kind !== 'passage') continue;
  const context = snapshotByTurn.get(turn.turnId) ?? {};
  const input = backgroundRequests.get(turn.narrative);
  const previousAge = run.turnRecords[index - 1]?.age ?? 0;
  const previous = ordinaryIntervals.at(-1);
  if (previous && previous.throughSequence === turn.sequence - 1 && previous.mode === input?.mode && previous.actId === context.actId) {
    previous.toAge = turn.age;
    previous.years += turn.age - previousAge;
    previous.throughSequence = turn.sequence;
    previous.statsAfter = turn.statsSnapshot;
  } else ordinaryIntervals.push({ mode: input?.mode ?? 'unknown', ...context, fromAge: previousAge,
    toAge: turn.age, years: turn.age - previousAge, fromSequence: turn.sequence, throughSequence: turn.sequence,
    statsBefore: run.turnRecords[index - 1]?.statsSnapshot, statsAfter: turn.statsSnapshot });
}
const serverLog = await fs.readFile(path.join(directory, 'server.log'), 'utf8').catch(() => '');
const summary = { runId: run.runId, ended: run.ended, outcome: run.outcome, age: run.age,
  endingPolarity: run.narrative.endingPolarity, records: story.length,
  completedFlows: run.narrative.eventFlow?.completedFlows,
  lifeSchedules: [...lifeSchedules.values()],
  ordinaryIntervals, calls, corrections, errorLines: serverLog.split('\n').filter(line => /Error:|reason:/.test(line)),
  cards, observations, story, ending: run.endingSummary };
await fs.writeFile(path.join(directory, 'audit.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ runId: summary.runId, ended: summary.ended, age: summary.age,
  endingPolarity: summary.endingPolarity, records: summary.records, ordinaryIntervals, calls,
  corrections, errorLines: summary.errorLines }, null, 2));

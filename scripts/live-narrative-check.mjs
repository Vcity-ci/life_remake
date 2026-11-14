import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Opt-in integration runner. Credentials stay in memory; the game store and
// captured requests are isolated from the player's session and saved games.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.includes('--server')) {
  const { default: OpenAI } = await import('openai');
  let sequence = 0;
  for (const prototype of [OpenAI.Chat.Completions.prototype, OpenAI.Responses.prototype]) {
    const original = prototype.create;
    prototype.create = async function(request, ...args) {
      const number = ++sequence, started = Date.now();
      const result = await original.call(this, request, ...args);
      await fs.writeFile(path.join(process.env.NARRATIVE_CHECK_OUTPUT, `model-${String(number).padStart(4, '0')}.json`),
        JSON.stringify({ milliseconds: Date.now() - started, request, result }, null, 2));
      return result;
    };
  }
  if (process.env.NARRATIVE_CHECK_RESUME) {
    const { resolveAnonymousSession, saveRun } = await import(pathToFileURL(path.join(root, 'apps/backend/src/store.ts')).href);
    const { session, token } = await resolveAnonymousSession();
    const run = JSON.parse(await fs.readFile(path.resolve(root, process.env.NARRATIVE_CHECK_RESUME), 'utf8'));
    // Opt-in development replay: committed text stays intact, while the isolated
    // fixture uses current authored units. This never changes the player's save.
    if (process.env.NARRATIVE_CHECK_CURRENT_MATERIAL === '1') {
      const current = JSON.parse(await fs.readFile(path.join(root, 'data/narratives/event-flows', `${run.storyPackSnapshot.id}.json`), 'utf8'));
      if (![20, 21, 22].includes(run.narrative.version) || current.id !== run.storyPackSnapshot.eventFlow.id || run.choiceExecution)
        throw new Error('verification_material_replay_invalid');
      run.storyPackSnapshot.eventFlow = current;
      const { eventFlowRuntimeVersion } = await import(pathToFileURL(path.join(root, 'apps/backend/src/narrative/event-flow.ts')).href);
      run.narrative.version = eventFlowRuntimeVersion(current);
      if (!run.narrative.actRuntime?.outline) {
        const { loadNarrativeWorldDefinition } = await import(pathToFileURL(path.join(root, 'apps/backend/src/content.ts')).href);
        const { loadNarrativeStoryPack } = await import(pathToFileURL(path.join(root, 'apps/backend/src/story-packs.ts')).href);
        run.storyPackSnapshot = await loadNarrativeStoryPack(await loadNarrativeWorldDefinition(run.worldId), current.id);
      }
      const { eventFlowRoles } = await import(pathToFileURL(path.join(root, 'apps/backend/src/narrative/event-flow.ts')).href);
      const card = run.narrative.actRuntime.outline;
      if (card) card.flowBindings = eventFlowRoles(current, card.actId).map(role => {
        const name = run.narrative.eventFlow.bindings[role.id];
        if (!name) throw new Error('verification_material_binding_missing:' + role.id);
        return { roleId: role.id, name };
      });
      // Explicit isolated replay of a corrected IF boundary. Preserve the
      // committed action, roll and prose; only repeat its pending observation.
      if (process.env.NARRATIVE_CHECK_REOBSERVE === '1') {
        if (!run.pendingActFinalization || run.choiceExecution) throw new Error('verification_observation_replay_invalid');
        const { loadNarrativeWorldDefinition } = await import(pathToFileURL(path.join(root, 'apps/backend/src/content.ts')).href);
        const { loadNarrativeStoryPack } = await import(pathToFileURL(path.join(root, 'apps/backend/src/story-packs.ts')).href);
        const material = await loadNarrativeStoryPack(await loadNarrativeWorldDefinition(run.worldId), current.id);
        run.storyPackSnapshot = material;
        const act = material.acts.find(act => act.id === run.pendingActFinalization.actId);
        if (!card || !act) throw new Error('verification_observation_act_missing');
        card.objective = act.objective;
        card.closureMeaning = act.payoffMeaning;
        delete run.pendingActFinalization.observation;
      }
    }
    await saveRun(run, session.id);
    process.send?.({ cookie: `reroll_session=${token}` });
  }
  await import(pathToFileURL(path.join(root, 'apps/backend/src/index.ts')).href);
} else {
  const output = path.resolve(process.env.NARRATIVE_CHECK_OUTPUT ?? path.join(root, 'storage', `verification-${Date.now()}`));
  await fs.mkdir(output, { recursive: true });
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'life-remake-check-'));
  await fs.symlink(path.join(root, 'data'), path.join(sandbox, 'data'), 'junction');
  await fs.symlink(path.join(root, 'skills'), path.join(sandbox, 'skills'), 'junction');
  const port = process.env.NARRATIVE_CHECK_PORT ?? '4018';
  const server = spawn(process.execPath, ['--import', pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href,
    fileURLToPath(import.meta.url), '--server'], { cwd: sandbox,
    env: { ...process.env, PORT: port, DEPLOY_MODE: 'local', DEBUG_MODEL_CALLS: '0', NARRATIVE_CHECK_OUTPUT: output },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  let serverLog = '';
  for (const stream of [server.stdout, server.stderr]) stream.on('data', data => { serverLog += data.toString(); });
  const base = `http://127.0.0.1:${port}`;
  let cookie = '';
  server.on('message', message => { if (typeof message.cookie === 'string') cookie = message.cookie; });
  let verifiedRunId;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function call(route, body) {
    const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: {
      'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const token = response.headers.get('set-cookie');
    if (token) cookie = token.split(';')[0];
    const payload = await response.json();
    if (!response.ok) throw new Error(`${route}: ${JSON.stringify(payload)}`);
    return payload;
  }
  try {
    for (let attempt = 0; ; attempt++) {
      try { await fetch(base + '/health'); break; } catch { if (attempt > 60) throw new Error(serverLog); await delay(500); }
    }
    const bootstrap = await call('/api/meta/bootstrap');
    const key = (await fs.readFile(path.join(root, 'Material', 'ak.txt'), 'utf8')).trim();
    await call('/api/game/env', { clientId: 'narrative-verification', localApiKey: key,
      localProviderConfig: { provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash',
        apiPath: '/chat/completions', temperature: 0.9, maxTokens: 18240, timeoutMs: 60000, reasoningEffort: 'minimal', directorMode: 'auto' } });
    const total = bootstrap.talentPointTotal;
    const stats = { intelligence: 0, charisma: 0, family: 0, fortune: 0, physique: 0 };
    const order = ['physique', 'intelligence', 'charisma', 'family', 'fortune'];
    for (let i = 0; i < total; i++) {
      const available = order.filter(key => stats[key] < 10);
      if (!available.length) throw new Error('allocation_overflow');
      stats[available[i % available.length]]++;
    }
    const cardIds = bootstrap.cardPool.slice(0, bootstrap.startAllocation.selectedCardMin).map(card => card.id);
    const pack = process.env.NARRATIVE_CHECK_PACK ?? 'ancient.frontier-commander';
    const pathChoices = JSON.parse(process.env.NARRATIVE_CHECK_CHOICES ?? '{}');
    const sovereign = pack === 'ancient.sovereign-rise';
    // Explicit authored node/action pairs, not a positional or global risk fallback.
    // NARRATIVE_CHECK_CHOICES overrides individual actions for branch replays.
    const sovereignOptions = { 'join-choice': 'disciplined', 'scattered-choice': 'regroup', 'ally-choice': 'mutual',
      'offer-choice': 'accept', 'regional-choice': 'self-rule', 'future-choice': 'west', 'reduced-choice': 'last-campaign',
      'rise-choice': 'safe', 'scattered-gather': 'balanced', 'county-choice': 'balanced', 'offer-negotiation': 'safe',
      'road-choice': 'safe', 'warlord-choice': 'balanced', 'lost-defense': 'safe',
      'capital-founding-action': 'safe', 'realm-campaign': 'safe', 'realm-counterstroke': 'safe', 'last-choice': 'safe',
      'west-defense': 'safe', 'reduced-breakout': 'safe' };
    const frontierOptions = { 'ridge-warning': 'balanced', 'captive-way-out': 'safe',
      'wolves-breakout': 'balanced', 'flood-crossing': 'balanced', 'campaign-first-defense': 'balanced',
      'campaign-raid': 'balanced', 'service-direction': 'remain', 'war-decision': 'balanced',
      'last-defense': 'safe', 'postwar-choice': 'retire' };
    let payload = process.env.NARRATIVE_CHECK_RESUME ? await call('/api/game/current') : await call('/api/game/start', { clientId: 'narrative-verification', worldId: 'ancient',
      storyPackId: pack, difficultyId: bootstrap.difficulties[0].id,
      personaPrompt: sovereign ? '你出身西洲乡里小户，性情直率，珍惜家人与同伴，有改变乱世的志向。' : '你是边地军户的孩子，性情直率，珍惜家人与同伴。', talentPointTotal: total, stats, selectedCardIds: cardIds });
    verifiedRunId = payload.run.runId;
    const stepBudget = Number(process.env.NARRATIVE_CHECK_STEPS ?? 100);
    if (!Number.isInteger(stepBudget) || stepBudget < 1) throw new Error('verification_step_budget_invalid');
    for (let turn = 0; turn < stepBudget; turn++) {
      const run = payload.run;
      const store = JSON.parse(await fs.readFile(path.join(sandbox, 'storage/anonymous-game-store.json'), 'utf8'));
      const internal = store.runs.find(entry => entry.run.runId === run.runId)?.run;
      await fs.writeFile(path.join(output, 'latest-run.json'), JSON.stringify(internal, null, 2));
      await fs.writeFile(path.join(output, `run-${String(turn).padStart(3, '0')}.json`), JSON.stringify(internal, null, 2));
      await fs.writeFile(path.join(output, 'latest-public.json'), JSON.stringify(payload, null, 2));
      console.log(JSON.stringify({ turn, age: run.age, phase: run.phase, ended: run.ended,
        version: internal?.narrative.version, act: internal?.narrative.actRuntime?.actId, choice: Boolean(run.nextMilestoneChoice),
        flow: internal?.narrative.eventFlow?.flowId, eventIndex: internal?.narrative.eventFlow?.eventIndex,
        characters: internal?.narrative.dynamicCharacters.length, locations: internal?.narrative.assets?.locations.length,
        abilities: internal?.narrative.assets?.abilities.length, records: internal?.turnRecords.length }));
      if (process.env.NARRATIVE_CHECK_STOP_FLOW && internal?.narrative.eventFlow?.completedFlows.some(entry => entry.flowId === process.env.NARRATIVE_CHECK_STOP_FLOW)) {
        console.log('PILOT_COMPLETE ' + output); break;
      }
      if (run.ended || run.phase === 'ended' || run.ending) { console.log('COMPLETE ' + output); break; }
      const body = { runId: run.runId, requestId: `verification:${turn}:${Date.now()}` };
      if (run.survivalCrisis) Object.assign(body, { action: 'resolve_survival', survivalChoice: 'seek_help', survivalCrisisId: run.survivalCrisis.id });
      else if (run.growthFocus?.options?.length && !run.growthFocus.selectedId) Object.assign(body, { action: 'select_growth_focus', growthFocusId: run.growthFocus.options[0].id });
      else if (run.nextMilestoneChoice) {
        const choice = run.nextMilestoneChoice;
        const flowState = internal.narrative.eventFlow;
        const group = internal.storyPackSnapshot?.eventFlow?.groups.find(group => group.id === flowState?.flowId);
        const node = group?.events[flowState?.eventIndex];
        const desired = pathChoices[node?.id] ?? (sovereign ? sovereignOptions[node?.id] : frontierOptions[node?.id]);
        const optionIndex = internal.nextMilestoneChoice.options.findIndex(option => option.id === desired);
        if (optionIndex < 0) throw new Error(`verification_choice_not_configured:${node?.id}:${desired}`);
        const option = choice.options[optionIndex];
        await fs.appendFile(path.join(output, 'choices.jsonl'), JSON.stringify({ nodeId: node?.id, mode: choice.mode ?? 'check', optionId: desired, action: internal.nextMilestoneChoice.options[optionIndex].description }) + '\n');
        Object.assign(body, { action: 'decide', decision: option.optionId ?? option.id, decisionAge: choice.age, sceneId: choice.sceneId, sceneRevision: choice.revision });
      } else if (run.actPlanning?.status === 'failed') Object.assign(body, { action: 'prepare_act' });
      else Object.assign(body, { action: 'consume' });
      try {
        payload = await call('/api/game/step', body);
        if (JSON.stringify(payload.run) === JSON.stringify(run)) { await delay(2000); turn--; }
      }
      catch (error) { await fs.writeFile(path.join(output, 'failed-step.json'), JSON.stringify({ body, error: String(error) })); throw error; }
      if (turn === stepBudget - 1) throw new Error('verification_step_budget_reached');
    }
  } finally {
    server.kill();
    if (verifiedRunId) {
      const store = JSON.parse(await fs.readFile(path.join(sandbox, 'storage/anonymous-game-store.json'), 'utf8'));
      const final = store.runs.find(entry => entry.run.runId === verifiedRunId)?.run;
      if (final) {
        const story = final.turnRecords.map(turn => `[${turn.age}岁] ${turn.narrative ?? turn.text ?? JSON.stringify(turn)}`).join('\n\n');
        await fs.writeFile(path.join(output, 'story.txt'), story + (final.endingSummary ? `\n\n[结局·${final.narrative.endingPolarity}]\n${final.endingSummary}` : ''));
        await fs.writeFile(path.join(output, 'latest-run.json'), JSON.stringify(final, null, 2));
        await fs.writeFile(path.join(output, 'verification-result.json'), JSON.stringify({ runId: verifiedRunId,
          completed: final.ended === true, age: final.age, records: final.turnRecords.length,
          actId: final.narrative.actRuntime?.actId,
          ...(process.env.NARRATIVE_CHECK_CURRENT_MATERIAL === '1' ? { currentMaterialReplay: true } : {}),
          ...(process.env.NARRATIVE_CHECK_REOBSERVE === '1' ? { reobservedMaterialBoundary: true } : {}),
          ...(process.env.NARRATIVE_CHECK_STOP_FLOW ? { pilotFlow: process.env.NARRATIVE_CHECK_STOP_FLOW,
            pilotCompleted: final.narrative.eventFlow?.completedFlows.some(entry => entry.flowId === process.env.NARRATIVE_CHECK_STOP_FLOW) ?? false } : {}) }, null, 2));
      }
    }
    await fs.writeFile(path.join(output, 'server.log'), serverLog);
    console.log('ARTIFACTS ' + output);
  }
}

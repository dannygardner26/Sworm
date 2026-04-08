/// <reference types="node" />
/**
 * Agent runner — spawned by AIAgentWorm in a terminal window.
 * Usage: npx tsx src/agent/runner.ts --provider <name> --cwd <dir> --prompt <text> [--model <model>] [--system <prompt>]
 */

import { AgentRuntime } from './runtime.js';
import { createAgentTools, createTeamTools } from './tools.js';
import type { AgentConfig } from './types.js';

// Parse CLI args
function parseArgs(): AgentConfig & { providerName: string; modelOverride?: string } {
  const args = process.argv.slice(2);
  let provider = '';
  let model: string | undefined;
  let cwd = process.cwd();
  let prompt = '';
  let systemPrompt: string | undefined;
  let agentId: string | undefined;
  let teamId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--provider':
        provider = args[++i];
        break;
      case '--model':
        model = args[++i];
        break;
      case '--cwd':
        cwd = args[++i];
        break;
      case '--prompt':
        prompt = args[++i];
        break;
      case '--system':
        systemPrompt = args[++i];
        break;
      case '--agent-id':
        agentId = args[++i];
        break;
      case '--team-id':
        teamId = args[++i];
        break;
    }
  }

  if (!provider) {
    console.error('--provider is required');
    process.exit(1);
  }
  if (!prompt) {
    console.error('--prompt is required');
    process.exit(1);
  }

  return {
    provider,
    providerName: provider,
    modelOverride: model,
    model,
    systemPrompt,
    userPrompt: prompt,
    workingDir: cwd,
    agentId,
    teamId,
  };
}

async function main() {
  const config = parseArgs();

  console.log(`\x1b[36m[Sworm Agent]\x1b[0m Provider: ${config.providerName}`);
  console.log(`\x1b[36m[Sworm Agent]\x1b[0m Working dir: ${config.workingDir}`);
  console.log(`\x1b[36m[Sworm Agent]\x1b[0m Task: ${config.userPrompt}`);
  console.log('---');

  // Lazy-load the provider registry (will be available after providers branch merges)
  let llmProvider;
  try {
    const { ProviderRegistry } = await import('../providers/registry.js');
    const registry = new ProviderRegistry();
    llmProvider = await registry.get(config.providerName, config.modelOverride);
  } catch (e) {
    console.error(
      `\x1b[31m[Sworm Agent]\x1b[0m Failed to load provider "${config.providerName}": ${e}`,
    );
    console.error('Make sure ~/.sworm/providers.yaml is configured correctly.');
    process.exit(1);
  }

  const tools = [
    ...createAgentTools(config.workingDir),
    ...(config.agentId && config.teamId ? createTeamTools(config.agentId, config.teamId) : []),
  ];

  const runtime = new AgentRuntime(config, llmProvider, tools, (output) => {
    switch (output.type) {
      case 'text':
        console.log(`\x1b[37m${output.content}\x1b[0m`);
        break;
      case 'tool_call':
        console.log(`\x1b[33m> ${output.content}\x1b[0m`);
        break;
      case 'tool_result':
        console.log(`\x1b[90m${output.content}\x1b[0m`);
        break;
      case 'error':
        console.error(`\x1b[31m${output.content}\x1b[0m`);
        break;
      case 'done':
        console.log(`\n\x1b[32m${output.content}\x1b[0m`);
        break;
    }
  });

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    console.log('\n\x1b[36m[Sworm Agent]\x1b[0m Stopping...');
    runtime.stop();
  });

  await runtime.run();
}

main().catch((e) => {
  console.error(`\x1b[31m[Sworm Agent] Fatal error:\x1b[0m`, e);
  process.exit(1);
});

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import type { AgentTool } from './types.js';

/**
 * Team tools injected into agents that are running in a team context.
 * Requires agentId (the worm's own ID) and teamId.
 */
export function createTeamTools(agentId: string, teamId: string): AgentTool[] {
  return [
    {
      name: 'team_message',
      description: "Send a message or task to an agent running on a team member's machine",
      parameters: {
        type: 'object',
        properties: {
          peer: { type: 'string', description: "Target peer's display name or peer ID" },
          message: { type: 'string', description: 'What to tell their agent' },
          agent_id: {
            type: 'string',
            description: 'Worm ID of the specific agent to target (optional — omit to reach any running agent)',
          },
          await_response: {
            type: 'boolean',
            description: 'Wait for acknowledgement before continuing (default: false)',
          },
        },
        required: ['peer', 'message'],
      },
      async execute(args) {
        try {
          const { loadTeam } = await import('../team/team-store.js');
          const { loadIdentity } = await import('../team/identity.js');
          const { RelayClient } = await import('../team/relay-client.js');
          const { randomUUID } = await import('node:crypto');

          const t = loadTeam(teamId);
          if (!t) return { output: '', error: `Team "${teamId}" not found` };

          const identity = loadIdentity();
          if (!identity) return { output: '', error: 'No local identity found' };

          const peerArg = args.peer as string;
          const target = t.members.find(
            (m) =>
              m.peerId === peerArg ||
              m.displayName.toLowerCase() === peerArg.toLowerCase(),
          );
          if (!target) {
            return { output: '', error: `Peer "${peerArg}" not found in team "${t.name}"` };
          }
          if (!target.encryptionPublicKey) {
            return {
              output: '',
              error: `No encryption key for ${target.displayName}. Ask them to run: sworm team connect ${teamId}`,
            };
          }

          const client = new RelayClient(identity, teamId, { relayUrl: t.relayUrl });
          try {
            await client.connect();
          } catch {
            return { output: '', error: `Could not connect to relay at ${t.relayUrl}` };
          }

          if (!client.isOnline(target.peerId)) {
            client.disconnect();
            return {
              output: '',
              error: `${target.displayName} is offline — they must be running \`sworm team connect ${teamId}\` to receive agent messages`,
            };
          }

          const msg = {
            type: 'agent_message' as const,
            fromAgentId: agentId,
            toAgentId: args.agent_id as string | undefined,
            content: args.message as string,
            messageId: randomUUID(),
          };

          client.sendEncrypted(target.peerId, msg, target.encryptionPublicKey);
          await new Promise((r) => setTimeout(r, 300));
          client.disconnect();

          const targetLabel = args.agent_id ? ` (agent: ${args.agent_id})` : '';
          return { output: `Message sent to ${target.displayName}${targetLabel}` };
        } catch (e) {
          return { output: '', error: String(e) };
        }
      },
    },
  ];
}

export function createAgentTools(workingDir: string): AgentTool[] {
  const absDir = resolve(workingDir);

  // Security: ensure path is within working directory
  function safePath(filePath: string): string {
    const abs = resolve(absDir, filePath);
    if (!abs.startsWith(absDir)) throw new Error(`Path escapes working directory: ${filePath}`);
    return abs;
  }

  return [
    {
      name: 'file_read',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to working directory' },
        },
        required: ['path'],
      },
      async execute(args) {
        try {
          const content = readFileSync(safePath(args.path as string), 'utf-8');
          return { output: content };
        } catch (e) {
          return { output: '', error: String(e) };
        }
      },
    },
    {
      name: 'file_write',
      description: 'Write content to a file (creates or overwrites)',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to working directory' },
          content: { type: 'string', description: 'Content to write' },
        },
        required: ['path', 'content'],
      },
      async execute(args) {
        try {
          writeFileSync(safePath(args.path as string), args.content as string, 'utf-8');
          return { output: `Written to ${args.path}` };
        } catch (e) {
          return { output: '', error: String(e) };
        }
      },
    },
    {
      name: 'file_list',
      description: 'List files in a directory',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path relative to working directory (default: ".")',
          },
          recursive: { type: 'boolean', description: 'List recursively (default: false)' },
        },
      },
      async execute(args) {
        try {
          const dir = safePath((args.path as string) ?? '.');
          const entries: string[] = [];

          function listDir(d: string, prefix: string) {
            for (const entry of readdirSync(d)) {
              if (entry === 'node_modules' || entry === '.git') continue;
              const full = join(d, entry);
              const rel = prefix ? `${prefix}/${entry}` : entry;
              const stat = statSync(full);
              entries.push(stat.isDirectory() ? `${rel}/` : rel);
              if (stat.isDirectory() && args.recursive) {
                listDir(full, rel);
              }
            }
          }

          listDir(dir, '');
          return { output: entries.join('\n') };
        } catch (e) {
          return { output: '', error: String(e) };
        }
      },
    },
    {
      name: 'shell_exec',
      description: 'Execute a shell command in the working directory',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
        },
        required: ['command'],
      },
      async execute(args) {
        try {
          const output = execSync(args.command as string, {
            cwd: absDir,
            timeout: (args.timeout as number) ?? 30000,
            encoding: 'utf-8',
            maxBuffer: 1024 * 1024,
          });
          return { output: output ?? '' };
        } catch (e: unknown) {
          const err = e as { stdout?: string; stderr?: string };
          return { output: err.stdout ?? '', error: err.stderr ?? String(e) };
        }
      },
    },
  ];
}

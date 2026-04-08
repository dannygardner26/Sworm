import type { Command } from 'commander';
import chalk from 'chalk';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import Table from 'cli-table3';
import { getOrCreateIdentity, loadIdentity, rotateEncryptionKey } from '../../team/identity.js';
import {
  saveTeam,
  loadTeam,
  listTeams,
  deleteTeam,
  removeMember,
  updateMemberRole,
  type MemberRole,
} from '../../team/team-store.js';
import { createInvite, parseInvite } from '../../team/invite.js';
import {
  loadPermissions,
  savePermissions,
  getPermissionsPath,
  type TeamAction,
} from '../../team/permission-checker.js';
import { RelayClient } from '../../team/relay-client.js';
import { MessageHandler } from '../../team/message-handler.js';
import { FormationBroadcaster } from '../../team/formation-broadcaster.js';
import { enqueue, flush, queueSize } from '../../team/offline-queue.js';
import { appendAuditLog, getAuditLogPath } from '../../team/audit-log.js';
import { checkPermission } from '../../team/permission-checker.js';
import { mkdirSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { printSuccess, printError, printInfo } from '../output.js';
import type { Swarm } from '../../core/swarm.js';

export function teamCommand(program: Command, getSwarm?: () => Swarm): void {
  const team = program
    .command('team')
    .description('Manage team collaboration');

  // ── team init ────────────────────────────────────────────────────────────
  team
    .command('init <name>')
    .description('Create a new team')
    .action((name: string) => {
      const identity = getOrCreateIdentity();
      const id = randomUUID();
      const now = Date.now();

      saveTeam({
        id,
        name,
        createdAt: now,
        ownerPeerId: identity.peerId,
        myPeerId: identity.peerId,
        relayUrl: 'wss://relay.sworm.dev',
        members: [
          {
            peerId: identity.peerId,
            displayName: 'You',
            role: 'owner',
            publicKeyPem: identity.publicKeyPem,
            joinedAt: now,
          },
        ],
      });

      printSuccess(`Team ${chalk.bold(name)} created.`);
      console.log(chalk.dim(`  Team ID : ${id}`));
      console.log(chalk.dim(`  Peer ID : ${identity.peerId}`));
      console.log(chalk.dim(`\n  Share an invite: ${chalk.white('sworm team invite ' + id)}\n`));
    });

  // ── team status ──────────────────────────────────────────────────────────
  team
    .command('status [team-id]')
    .description('Show team members, last known formations, and last seen times')
    .action((teamId?: string) => {
      const teams = teamId ? [loadTeam(teamId)].filter(Boolean) : listTeams();

      if (teams.length === 0) {
        printInfo('No teams found. Create one with: sworm team init <name>');
        return;
      }

      for (const t of teams as NonNullable<(typeof teams)[number]>[]) {
        console.log(chalk.bold(`\n  Team: ${t.name}`) + chalk.dim(`  (${t.id})`));
        console.log(chalk.dim(`  Relay: ${t.relayUrl}\n`));

        const table = new Table({
          head: [
            chalk.white('Peer ID'),
            chalk.white('Name'),
            chalk.white('Role'),
            chalk.white('Formation'),
            chalk.white('Last Seen'),
          ],
          style: { head: [], border: [] },
        });

        for (const m of t.members) {
          const isMe = m.peerId === t.myPeerId;
          const roleColor =
            m.role === 'owner'
              ? chalk.yellow
              : m.role === 'admin'
                ? chalk.cyan
                : m.role === 'member'
                  ? chalk.green
                  : chalk.dim;

          const formation = m.lastKnownFormation
            ? chalk.cyan(m.lastKnownFormation)
            : chalk.dim('—');

          const lastSeen = m.lastSeenAt
            ? chalk.dim(new Date(m.lastSeenAt).toLocaleString())
            : isMe
              ? chalk.dim('(you)')
              : chalk.dim('never');

          const queued = queueSize(t.id, m.peerId);
          const queueLabel = queued > 0 ? chalk.yellow(` (${queued} queued)`) : '';

          table.push([
            isMe ? chalk.bold(m.peerId) + chalk.dim(' (you)') : m.peerId + queueLabel,
            m.displayName,
            roleColor(m.role),
            formation,
            lastSeen,
          ]);
        }

        console.log(table.toString());
      }
      console.log(chalk.dim('  Tip: run `sworm team connect <team-id>` for live updates\n'));
    });

  // ── team invite ──────────────────────────────────────────────────────────
  team
    .command('invite <team-id>')
    .description('Generate an invite link for the team')
    .option('--role <role>', 'Role to assign to the invitee (viewer|member|admin)', 'member')
    .option('--ttl <hours>', 'Invite validity in hours', '24')
    .option('--qr', 'Render the invite token as a QR code in the terminal')
    .action(async (teamId: string, opts: { role: string; ttl: string; qr?: boolean }) => {
      const t = loadTeam(teamId);
      if (!t) {
        printError(`Team "${teamId}" not found.`);
        process.exit(1);
      }

      const identity = loadIdentity();
      if (!identity) {
        printError('No local identity found. Run `sworm team init` first.');
        process.exit(1);
      }

      const validRoles: MemberRole[] = ['viewer', 'member', 'admin', 'owner'];
      const role = opts.role as MemberRole;
      if (!validRoles.includes(role)) {
        printError(`Invalid role "${role}". Choose from: ${validRoles.join(', ')}`);
        process.exit(1);
      }

      const me = t.members.find((m) => m.peerId === identity.peerId);
      const ttlMs = parseFloat(opts.ttl) * 60 * 60 * 1000;
      const { token, expiresAt } = createInvite(t.id, t.name, identity.peerId, {
        role,
        ttlMs,
        inviterEncryptionPublicKey: identity.encryptionPublicKeyPem,
        inviterDisplayName: me?.displayName,
      });

      printSuccess('Invite token generated:');
      console.log(chalk.bold(`\n  ${token}\n`));
      console.log(chalk.dim(`  Role    : ${role}`));
      console.log(chalk.dim(`  Expires : ${new Date(expiresAt).toLocaleString()}`));
      console.log(chalk.dim(`\n  Recipient runs: ${chalk.white('sworm team join ' + token)}\n`));

      if (opts.qr) {
        try {
          const qrcode = await import('qrcode-terminal');
          console.log(chalk.dim('  QR code (scan to copy token):'));
          qrcode.default.generate(token, { small: true }, (qr: string) => {
            for (const line of qr.split('\n')) console.log('  ' + line);
          });
        } catch {
          printError('qrcode-terminal is not installed. Run: npm install qrcode-terminal');
        }
      }
    });

  // ── team join ────────────────────────────────────────────────────────────
  team
    .command('join <token>')
    .description('Join a team using an invite token')
    .option('--name <name>', 'Your display name for this team')
    .action((token: string, opts: { name?: string }) => {
      let payload;
      try {
        payload = parseInvite(token);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      const existing = loadTeam(payload.teamId);
      if (existing) {
        printInfo(`You are already in team "${existing.name}".`);
        return;
      }

      const identity = getOrCreateIdentity();
      const displayName = opts.name ?? `Peer-${identity.peerId.slice(0, 6)}`;
      const now = Date.now();

      // Build initial member list — always include self, plus the inviter if we have their enc key
      const members: Parameters<typeof saveTeam>[0]['members'] = [
        {
          peerId: identity.peerId,
          displayName,
          role: payload.role,
          publicKeyPem: identity.publicKeyPem,
          joinedAt: now,
        },
      ];

      // Add the inviter as a stub member so we can encrypt to them immediately
      if (payload.inviterEncryptionPublicKey && payload.createdBy !== identity.peerId) {
        members.push({
          peerId: payload.createdBy,
          displayName: payload.inviterDisplayName ?? `Peer-${payload.createdBy.slice(0, 6)}`,
          role: 'owner',
          publicKeyPem: '',
          joinedAt: now,
          encryptionPublicKey: payload.inviterEncryptionPublicKey,
        });
      }

      saveTeam({
        id: payload.teamId,
        name: payload.teamName,
        createdAt: now,
        ownerPeerId: payload.createdBy,
        myPeerId: identity.peerId,
        relayUrl: 'wss://relay.sworm.dev',
        members,
      });

      printSuccess(`Joined team ${chalk.bold(payload.teamName)} as ${chalk.cyan(payload.role)}.`);
      console.log(chalk.dim(`  Your peer ID : ${identity.peerId}`));
      console.log(chalk.dim(`  Team ID      : ${payload.teamId}\n`));
      if (payload.inviterEncryptionPublicKey) {
        printInfo(`Inviter's encryption key cached — you can send them encrypted messages immediately.`);
      }
      printInfo('Full member sync will be available once you connect to the relay.');
    });

  // ── team leave ───────────────────────────────────────────────────────────
  team
    .command('leave <team-id>')
    .description('Leave a team and remove local data')
    .action((teamId: string) => {
      const t = loadTeam(teamId);
      if (!t) {
        printError(`Team "${teamId}" not found.`);
        process.exit(1);
      }
      deleteTeam(teamId);
      printSuccess(`Left team ${chalk.bold(t.name)}.`);
    });

  // ── team revoke ──────────────────────────────────────────────────────────
  team
    .command('revoke <team-id> <peer-id>')
    .description('Remove a member from the team')
    .action((teamId: string, peerId: string) => {
      try {
        const updated = removeMember(teamId, peerId);
        printSuccess(`Revoked access for ${chalk.bold(peerId)} from team ${chalk.bold(updated.name)}.`);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── team role ────────────────────────────────────────────────────────────
  team
    .command('role <team-id> <peer-id> <role>')
    .description('Change a member\'s role (viewer|member|admin|owner)')
    .action((teamId: string, peerId: string, role: string) => {
      const validRoles: MemberRole[] = ['viewer', 'member', 'admin', 'owner'];
      if (!validRoles.includes(role as MemberRole)) {
        printError(`Invalid role "${role}". Choose from: ${validRoles.join(', ')}`);
        process.exit(1);
      }
      try {
        const updated = updateMemberRole(teamId, peerId, role as MemberRole);
        const member = updated.members.find((m) => m.peerId === peerId);
        printSuccess(`${member?.displayName ?? peerId} is now ${chalk.cyan(role)} in ${chalk.bold(updated.name)}.`);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── team permissions ─────────────────────────────────────────────────────
  const perms = team
    .command('permissions')
    .description('View or edit remote action permissions');

  perms
    .command('show')
    .description('Show current permission config')
    .action(() => {
      const config = loadPermissions();
      console.log(chalk.bold('\n  Default permissions:\n'));

      const actions: TeamAction[] = [
        'remote_spawn',
        'remote_note',
        'remote_formation_status',
        'remote_agent_message',
      ];
      for (const action of actions) {
        const val = config.defaults[action];
        const colored =
          val === 'allow' ? chalk.green(val) : val === 'deny' ? chalk.red(val) : chalk.yellow(val);
        console.log(`    ${action.padEnd(30)} ${colored}`);
      }

      if (config.overrides.length > 0) {
        console.log(chalk.bold('\n  Peer overrides:\n'));
        for (const o of config.overrides) {
          console.log(`    ${chalk.cyan(o.peer)}`);
          for (const action of actions) {
            if (o[action] !== undefined) {
              const val = o[action]!;
              const colored =
                val === 'allow'
                  ? chalk.green(val)
                  : val === 'deny'
                    ? chalk.red(val)
                    : chalk.yellow(val);
              console.log(`      ${action.padEnd(28)} ${colored}`);
            }
          }
        }
      }

      console.log(chalk.dim(`\n  Config file: ${getPermissionsPath()}\n`));
    });

  perms
    .command('set <action> <value>')
    .description('Set a default permission (allow|deny|ask)')
    .option('--peer <peer-id>', 'Apply to a specific peer instead of the default')
    .action((action: string, value: string, opts: { peer?: string }) => {
      const validActions: TeamAction[] = [
        'remote_spawn',
        'remote_note',
        'remote_formation_status',
        'remote_agent_message',
      ];
      if (!validActions.includes(action as TeamAction)) {
        printError(`Unknown action "${action}". Valid: ${validActions.join(', ')}`);
        process.exit(1);
      }
      if (!['allow', 'deny', 'ask'].includes(value)) {
        printError(`Invalid value "${value}". Use: allow, deny, or ask`);
        process.exit(1);
      }

      const config = loadPermissions();
      if (opts.peer) {
        const idx = config.overrides.findIndex((o) => o.peer === opts.peer);
        if (idx === -1) {
          config.overrides.push({ peer: opts.peer!, [action]: value });
        } else {
          config.overrides[idx] = { ...config.overrides[idx], [action]: value };
        }
        savePermissions(config);
        printSuccess(`Set ${chalk.bold(action)} = ${chalk.cyan(value)} for peer ${chalk.bold(opts.peer)}`);
      } else {
        config.defaults[action as TeamAction] = value as 'allow' | 'deny' | 'ask';
        savePermissions(config);
        printSuccess(`Set default ${chalk.bold(action)} = ${chalk.cyan(value)}`);
      }
    });

  // ── team whoami ──────────────────────────────────────────────────────────
  team
    .command('whoami')
    .description('Show your local peer identity')
    .action(() => {
      const identity = getOrCreateIdentity();
      console.log(chalk.bold('\n  Your Sworm identity:\n'));
      console.log(`  Peer ID : ${chalk.cyan(identity.peerId)}`);
      console.log(chalk.dim(`\n  Public key (first line):`));
      console.log(chalk.dim(`  ${identity.publicKeyPem.split('\n')[1]}\n`));
    });

  // ── team check ───────────────────────────────────────────────────────────
  team
    .command('check <peer-id> <action>')
    .description('Check what permission a peer has for an action')
    .action((peerId: string, action: string) => {
      const validActions: TeamAction[] = [
        'remote_spawn',
        'remote_note',
        'remote_formation_status',
        'remote_agent_message',
      ];
      if (!validActions.includes(action as TeamAction)) {
        printError(`Unknown action "${action}". Valid: ${validActions.join(', ')}`);
        process.exit(1);
      }
      const result = checkPermission(peerId, action as TeamAction);
      const colored =
        result === 'allow'
          ? chalk.green(result)
          : result === 'deny'
            ? chalk.red(result)
            : chalk.yellow(result);
      console.log(`  ${chalk.bold(peerId)} — ${action}: ${colored}`);
    });

  // ── team connect ─────────────────────────────────────────────────────────
  team
    .command('connect <team-id>')
    .description('Connect to the relay — receive notes and broadcast formation status')
    .option('--relay <url>', 'Relay URL override (e.g. ws://relay.example.com:7891)')
    .action(async (teamId: string, opts: { relay?: string }) => {
      const t = loadTeam(teamId);
      if (!t) { printError(`Team "${teamId}" not found.`); process.exit(1); }

      const identity = getOrCreateIdentity();
      const relayUrl = opts.relay ?? t.relayUrl;

      const client = new RelayClient(identity, teamId, { relayUrl });
      const broadcaster = new FormationBroadcaster(client);

      // ── Spawn request handling ───────────────────────────────────────────
      let spawnPromptActive = false;
      const rl = createInterface({ input: process.stdin, output: process.stdout });

      const handleSpawnRequest = async (fromPeer: string, msg: import('../../team/messages.js').AgentSpawnRequestMessage) => {
        const fromMember = loadTeam(teamId)?.members.find((m) => m.peerId === fromPeer);
        const fromName = fromMember?.displayName ?? fromPeer;
        const permission = checkPermission(fromPeer, 'remote_spawn');

        appendAuditLog({ teamId, fromPeer, action: 'remote_spawn_request', detail: msg.formation, outcome: 'pending' });

        let status: 'ok' | 'denied' | 'error' = 'denied';
        let reason: string | undefined;

        if (permission === 'deny') {
          reason = 'Remote spawn is denied by local policy';
          console.log(chalk.red(`\n  [spawn] Auto-denied request from ${fromName}: policy is deny\n`));
        } else if (permission === 'ask') {
          if (spawnPromptActive) {
            reason = 'Another spawn request is already pending';
            console.log(chalk.yellow(`\n  [spawn] Request from ${fromName} dropped — another prompt is active\n`));
          } else {
            spawnPromptActive = true;
            console.log(
              chalk.bold(`\n  🔔 Remote spawn request from ${chalk.cyan(fromName)}\n`) +
              `     Formation : ${chalk.bold(msg.formation)}\n`,
            );
            const answer = await new Promise<string>((resolve) =>
              rl.question('  Allow? (y/N): ', resolve),
            );
            spawnPromptActive = false;
            if (answer.trim().toLowerCase() === 'y') {
              status = 'ok';
            } else {
              reason = 'Declined by user';
              console.log(chalk.dim('  Declined.\n'));
            }
          }
        } else {
          // allow
          status = 'ok';
          console.log(chalk.dim(`\n  [spawn] Auto-approved request from ${fromName} (policy: allow)\n`));
        }

        if (status === 'ok') {
          if (!getSwarm) {
            status = 'error';
            reason = 'Spawn not available in this context';
          } else {
            const swarm = getSwarm();
            try {
              console.log(chalk.dim(`  Deploying ${chalk.bold(msg.formation)}...`));
              await swarm.deploy(msg.formation);
              console.log(chalk.green(`  ✔ Deployed ${chalk.bold(msg.formation)} for ${fromName}\n`));
            } catch (err) {
              status = 'error';
              reason = err instanceof Error ? err.message : String(err);
              console.log(chalk.red(`  ✘ Deploy failed: ${reason}\n`));
            }
          }
        }

        // Send ack back (encrypted if we have their key)
        const ackMsg: import('../../team/messages.js').AgentSpawnAckMessage = {
          type: 'agent_spawn_ack',
          requestId: msg.requestId,
          status,
          reason,
        };
        const encKey = loadTeam(teamId)?.members.find((m) => m.peerId === fromPeer)?.encryptionPublicKey;
        if (encKey) {
          client.sendEncrypted(fromPeer, ackMsg, encKey);
        }

        const auditAction =
          status === 'ok' ? 'remote_spawn_approved' :
          status === 'error' ? 'remote_spawn_error' :
          'remote_spawn_denied';
        appendAuditLog({ teamId, fromPeer, action: auditAction, detail: msg.formation, outcome: reason ?? status });
      };

      // ── Message handler ──────────────────────────────────────────────────
      const handler = new MessageHandler(identity, teamId, {
        onNote(fromPeer, msg) {
          const ts = chalk.dim(new Date().toLocaleTimeString());
          const name = loadTeam(teamId)?.members.find((m) => m.peerId === fromPeer)?.displayName ?? fromPeer;
          const priority = msg.priority === 'urgent' ? chalk.red(' [URGENT]') : '';
          console.log(`\n  ${ts} Note from ${chalk.cyan(name)}${priority}:\n  ${chalk.bold(msg.text)}\n`);
          appendAuditLog({ teamId, fromPeer, action: 'remote_note_received', detail: msg.text.slice(0, 80), outcome: 'received' });
        },
        onPresence(fromPeer, msg) {
          const ts = chalk.dim(new Date().toLocaleTimeString());
          const name = loadTeam(teamId)?.members.find((m) => m.peerId === fromPeer)?.displayName ?? fromPeer;
          const icon = msg.status === 'online' ? chalk.green('●') : chalk.dim('○');
          const formation = msg.formation ? chalk.dim(` — ${msg.formation}`) : '';
          console.log(`  ${ts} ${icon} ${chalk.cyan(name)} is ${msg.status}${formation}`);
        },
        onFormationStatus(fromPeer, msg) {
          const ts = chalk.dim(new Date().toLocaleTimeString());
          const name = loadTeam(teamId)?.members.find((m) => m.peerId === fromPeer)?.displayName ?? fromPeer;
          if (msg.formation) {
            console.log(
              `  ${ts} ${chalk.cyan(name)} deployed ${chalk.bold(msg.formation)}` +
              chalk.dim(` (${msg.wormCount} worm${msg.wormCount !== 1 ? 's' : ''})`),
            );
          } else {
            console.log(`  ${ts} ${chalk.cyan(name)} killed their formation`);
          }
        },
        onSpawnRequest(fromPeer, msg) {
          handleSpawnRequest(fromPeer, msg).catch((err) => {
            console.error(chalk.red(`  [spawn] Error: ${err instanceof Error ? err.message : String(err)}`));
          });
        },
        onKeyRotation(fromPeer, msg) {
          const ts = chalk.dim(new Date().toLocaleTimeString());
          const name = loadTeam(teamId)?.members.find((m) => m.peerId === fromPeer)?.displayName ?? fromPeer;
          console.log(`  ${ts} ${chalk.yellow('⟳')} ${chalk.cyan(name)} rotated their encryption key`);
          // Key is persisted by MessageHandler via updateMemberEncryptionKey
          void msg;
        },
        onAgentMessage(fromPeer, msg) {
          const permission = checkPermission(fromPeer, 'remote_agent_message');
          if (permission === 'deny') {
            console.log(chalk.red(`\n  [agent-msg] Auto-denied from ${fromPeer}: policy is deny\n`));
            appendAuditLog({ teamId, fromPeer, action: 'remote_agent_message', detail: msg.content.slice(0, 80), outcome: 'denied' });
            return;
          }

          const ts = chalk.dim(new Date().toLocaleTimeString());
          const name = loadTeam(teamId)?.members.find((m) => m.peerId === fromPeer)?.displayName ?? fromPeer;
          const target = msg.toAgentId ? chalk.dim(` → agent ${msg.toAgentId}`) : '';
          console.log(`\n  ${ts} ${chalk.magenta('[agent-msg]')} from ${chalk.cyan(name)}${target}:`);
          console.log(`  ${chalk.bold(msg.content)}\n`);

          // Deliver to the target agent's inbox file
          const agentIds: string[] = [];
          if (msg.toAgentId) {
            agentIds.push(msg.toAgentId);
          } else if (getSwarm) {
            agentIds.push(...getSwarm().getAgentWormIds());
          }

          if (agentIds.length === 0) {
            console.log(chalk.dim('  (no running agents to deliver to)\n'));
            appendAuditLog({ teamId, fromPeer, action: 'remote_agent_message', detail: msg.content.slice(0, 80), outcome: 'no_agents' });
            return;
          }

          const inboxDir = join(homedir(), '.sworm', 'agent-inbox');
          mkdirSync(inboxDir, { recursive: true });
          const line = JSON.stringify({ content: msg.content, fromAgentId: msg.fromAgentId, messageId: msg.messageId }) + '\n';
          for (const agentId of agentIds) {
            appendFileSync(join(inboxDir, `${agentId}.jsonl`), line, 'utf-8');
          }
          console.log(chalk.dim(`  Delivered to ${agentIds.length} agent(s): ${agentIds.join(', ')}\n`));
          appendAuditLog({ teamId, fromPeer, action: 'remote_agent_message', detail: msg.content.slice(0, 80), outcome: 'delivered' });
        },
      });

      client.on('envelope', (env) => handler.handle(env));

      // When a peer comes online, flush any queued messages for them
      client.on('peer_online', (peerId) => {
        const ts = chalk.dim(new Date().toLocaleTimeString());
        const name = t.members.find((m) => m.peerId === peerId)?.displayName ?? peerId;
        console.log(`  ${ts} ${chalk.green('●')} ${chalk.cyan(name)} came online`);

        const queued = flush(teamId, peerId);
        if (queued.length > 0) {
          console.log(chalk.dim(`  Flushing ${queued.length} queued message(s) to ${name}...`));
          for (const env of queued) client.sendEnvelope(env);
        }
      });

      client.on('peer_offline', (peerId) => {
        const ts = chalk.dim(new Date().toLocaleTimeString());
        const name = t.members.find((m) => m.peerId === peerId)?.displayName ?? peerId;
        console.log(`  ${ts} ${chalk.dim('○')} ${chalk.cyan(name)} went offline`);
      });

      client.on('disconnected', () => {
        console.log(chalk.yellow('  ⚡ Relay disconnected — reconnecting...'));
      });

      client.on('connected', () => {
        // Broadcast presence + encryption key on every (re)connect
        client.sendBroadcast({
          type: 'presence',
          status: 'online',
          encryptionPublicKey: identity.encryptionPublicKeyPem,
        });
        // Broadcast current formation status so teammates see our state immediately
        broadcaster.broadcastCurrent();
      });

      try {
        await client.connect();
      } catch {
        printError(`Could not reach relay at ${chalk.bold(relayUrl)}`);
        printInfo('Is the relay running? Start one with: sworm relay');
        process.exit(1);
      }

      printSuccess(`Connected to relay as ${chalk.bold(identity.peerId)}`);
      console.log(chalk.dim(`  Team  : ${t.name}`));
      console.log(chalk.dim(`  Relay : ${relayUrl}`));
      console.log(chalk.dim('\n  Listening for messages... (Ctrl+C to disconnect)\n'));
      const spawnNote = getSwarm
        ? chalk.dim('  Remote spawn: enabled (will prompt for approval based on permissions)\n')
        : chalk.dim('  Remote spawn: disabled in this context\n');
      console.log(spawnNote);
      console.log(chalk.dim(`  Audit log: ${getAuditLogPath()}\n`));

      const shutdown = () => {
        rl.close();
        client.sendBroadcast({ type: 'presence', status: 'offline' });
        setTimeout(() => { client.disconnect(); process.exit(0); }, 300);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });

  // ── team set-formation ────────────────────────────────────────────────────
  team
    .command('set-formation <team-id> [name]')
    .description('Manually broadcast your current formation to teammates (use while connected)')
    .option('--worms <count>', 'Number of active worms', '0')
    .action(async (teamId: string, name: string | undefined, opts: { worms: string }) => {
      const t = loadTeam(teamId);
      if (!t) { printError(`Team "${teamId}" not found.`); process.exit(1); }

      const identity = getOrCreateIdentity();
      const client = new RelayClient(identity, teamId, { relayUrl: t.relayUrl });

      try {
        await client.connect();
      } catch {
        printError(`Could not reach relay at ${chalk.bold(t.relayUrl)}`);
        process.exit(1);
      }

      client.sendBroadcast({
        type: 'formation_status',
        formation: name ?? null,
        wormCount: parseInt(opts.worms, 10) || 0,
      });

      await new Promise((r) => setTimeout(r, 300));
      client.disconnect();

      if (name) {
        printSuccess(`Broadcast formation ${chalk.bold(name)} to team.`);
      } else {
        printSuccess('Broadcast formation cleared to team.');
      }
    });

  // ── team note ────────────────────────────────────────────────────────────
  team
    .command('note <team-id> <peer-id> <text>')
    .description('Send a note to a team member (queued if they are offline)')
    .option('--relay <url>', 'Relay URL override')
    .option('--urgent', 'Mark as urgent')
    .action(async (teamId: string, peerId: string, text: string, opts: { relay?: string; urgent?: boolean }) => {
      const t = loadTeam(teamId);
      if (!t) { printError(`Team "${teamId}" not found.`); process.exit(1); }

      const target = t.members.find((m) => m.peerId === peerId);
      if (!target) { printError(`Peer "${peerId}" is not in team "${t.name}".`); process.exit(1); }

      if (!target.encryptionPublicKey) {
        printError(`No encryption key for ${chalk.bold(target.displayName)}.`);
        printInfo(`Ask them to run: sworm team connect ${teamId}`);
        process.exit(1);
      }

      const identity = getOrCreateIdentity();
      const relayUrl = opts.relay ?? t.relayUrl;
      const client = new RelayClient(identity, teamId, { relayUrl });
      const priorityLabel = opts.urgent ? chalk.red(' [URGENT]') : '';

      try {
        await client.connect();
      } catch {
        printError(`Could not reach relay at ${chalk.bold(relayUrl)}`);
        printInfo('Is the relay running? Start one with: sworm relay');
        process.exit(1);
      }

      const noteMsg = { type: 'note' as const, text, priority: opts.urgent ? 'urgent' as const : 'normal' as const };

      if (!client.isOnline(peerId)) {
        // Build and queue the envelope without sending
        const { deriveSharedSecret: dss, encrypt: enc } = await import('../../team/crypto.js');
        const { randomUUID } = await import('node:crypto');
        const secret = dss(identity.encryptionPrivateKeyPem, target.encryptionPublicKey);
        const { nonce, ciphertext } = enc(JSON.stringify(noteMsg), secret);
        enqueue(teamId, peerId, {
          id: randomUUID(),
          teamId,
          fromPeer: identity.peerId,
          toPeer: peerId,
          timestamp: Date.now(),
          encrypted: true,
          nonce,
          payload: ciphertext,
        });
        client.disconnect();
        printInfo(`${chalk.cyan(target.displayName)} is offline — note queued (${queueSize(teamId, peerId)} queued).`);
        printInfo(`It will be delivered next time you run \`sworm team connect ${teamId}\` while they're online.`);
        return;
      }

      client.sendEncrypted(peerId, noteMsg, target.encryptionPublicKey);
      await new Promise((r) => setTimeout(r, 300));
      client.disconnect();
      printSuccess(`Note sent to ${chalk.bold(target.displayName)}${priorityLabel}`);
    });

  // ── team spawn ────────────────────────────────────────────────────────────
  team
    .command('spawn <team-id> <peer-id> <formation>')
    .description('Request to deploy a formation on a team member\'s machine')
    .option('--relay <url>', 'Relay URL override')
    .option('--timeout <seconds>', 'How long to wait for a response', '30')
    .action(async (
      teamId: string,
      peerId: string,
      formation: string,
      opts: { relay?: string; timeout: string },
    ) => {
      const t = loadTeam(teamId);
      if (!t) { printError(`Team "${teamId}" not found.`); process.exit(1); }

      const target = t.members.find((m) => m.peerId === peerId);
      if (!target) { printError(`Peer "${peerId}" is not in team "${t.name}".`); process.exit(1); }

      if (!target.encryptionPublicKey) {
        printError(`No encryption key for ${chalk.bold(target.displayName)}.`);
        printInfo(`Ask them to run: sworm team connect ${teamId}`);
        process.exit(1);
      }

      const identity = getOrCreateIdentity();
      const relayUrl = opts.relay ?? t.relayUrl;
      const timeoutMs = parseFloat(opts.timeout) * 1_000;
      const requestId = randomUUID();

      const client = new RelayClient(identity, teamId, { relayUrl });

      try {
        await client.connect();
      } catch {
        printError(`Could not reach relay at ${chalk.bold(relayUrl)}`);
        process.exit(1);
      }

      if (!client.isOnline(peerId)) {
        client.disconnect();
        printError(`${chalk.bold(target.displayName)} is offline — cannot send spawn request.`);
        printInfo('Ask them to run: sworm team connect ' + teamId);
        process.exit(1);
      }

      // Listen for the ack before sending (avoid race)
      const ackPromise = new Promise<import('../../team/messages.js').AgentSpawnAckMessage>(
        (resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Timed out waiting for response')), timeoutMs);
          const handler = new MessageHandler(identity, teamId, {
            onSpawnAck(_from, msg) {
              if (msg.requestId === requestId) {
                clearTimeout(timer);
                resolve(msg);
              }
            },
          });
          client.on('envelope', (env) => handler.handle(env));
        },
      );

      client.sendEncrypted(
        peerId,
        {
          type: 'agent_spawn_request',
          formation,
          requestId,
          requestedBy: identity.peerId,
        },
        target.encryptionPublicKey,
      );

      printInfo(`Spawn request sent to ${chalk.bold(target.displayName)} — waiting for response...`);

      try {
        const ack = await ackPromise;
        client.disconnect();

        if (ack.status === 'ok') {
          printSuccess(`${chalk.bold(target.displayName)} deployed ${chalk.bold(formation)}.`);
        } else if (ack.status === 'denied') {
          printError(`Request denied: ${ack.reason ?? 'no reason given'}`);
          process.exit(1);
        } else {
          printError(`Deploy failed on ${target.displayName}'s machine: ${ack.reason ?? 'unknown error'}`);
          process.exit(1);
        }
      } catch (err) {
        client.disconnect();
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── team rotate-key ──────────────────────────────────────────────────────
  team
    .command('rotate-key <team-id>')
    .description('Generate a new encryption keypair and broadcast it to online teammates')
    .option('--relay <url>', 'Relay URL override')
    .action(async (teamId: string, opts: { relay?: string }) => {
      const t = loadTeam(teamId);
      if (!t) { printError(`Team "${teamId}" not found.`); process.exit(1); }

      const newIdentity = rotateEncryptionKey();
      printSuccess('New encryption keypair generated.');

      const relayUrl = opts.relay ?? t.relayUrl;
      const client = new RelayClient(newIdentity, teamId, { relayUrl });

      try {
        await client.connect();
      } catch {
        printError(`Could not reach relay at ${chalk.bold(relayUrl)}`);
        printInfo('Key was rotated locally. Teammates will learn the new key when you next connect.');
        return;
      }

      // Broadcast to all online peers
      client.sendBroadcast({
        type: 'key_rotation',
        newEncryptionPublicKey: newIdentity.encryptionPublicKeyPem,
      });

      // Also update presence so peers cache the new key via the existing presence flow
      client.sendBroadcast({
        type: 'presence',
        status: 'online',
        encryptionPublicKey: newIdentity.encryptionPublicKeyPem,
      });

      await new Promise((r) => setTimeout(r, 300));
      client.disconnect();

      printSuccess('New key broadcast to all online teammates.');
      console.log(chalk.dim('  Offline teammates will get it next time they receive a message from you.\n'));
    });

  // ── team agent-msg ───────────────────────────────────────────────────────
  team
    .command('agent-msg <team-id> <peer-id> <message>')
    .description("Send a message directly to an agent running on a team member's machine")
    .option('--relay <url>', 'Relay URL override')
    .option('--agent <agent-id>', 'Target a specific agent worm by ID')
    .action(async (
      teamId: string,
      peerId: string,
      message: string,
      opts: { relay?: string; agent?: string },
    ) => {
      const t = loadTeam(teamId);
      if (!t) { printError(`Team "${teamId}" not found.`); process.exit(1); }

      const target = t.members.find((m) => m.peerId === peerId);
      if (!target) { printError(`Peer "${peerId}" is not in team "${t.name}".`); process.exit(1); }

      if (!target.encryptionPublicKey) {
        printError(`No encryption key for ${chalk.bold(target.displayName)}.`);
        printInfo(`Ask them to run: sworm team connect ${teamId}`);
        process.exit(1);
      }

      const identity = getOrCreateIdentity();
      const relayUrl = opts.relay ?? t.relayUrl;
      const client = new RelayClient(identity, teamId, { relayUrl });

      try {
        await client.connect();
      } catch {
        printError(`Could not reach relay at ${chalk.bold(relayUrl)}`);
        process.exit(1);
      }

      if (!client.isOnline(peerId)) {
        client.disconnect();
        printError(`${chalk.bold(target.displayName)} is offline — they must be running \`sworm team connect ${teamId}\`.`);
        process.exit(1);
      }

      const msg: import('../../team/messages.js').AgentMessageMessage = {
        type: 'agent_message',
        fromAgentId: identity.peerId,
        toAgentId: opts.agent,
        content: message,
        messageId: randomUUID(),
      };

      client.sendEncrypted(peerId, msg, target.encryptionPublicKey);
      await new Promise((r) => setTimeout(r, 300));
      client.disconnect();

      const agentLabel = opts.agent ? chalk.dim(` → agent ${opts.agent}`) : '';
      printSuccess(`Agent message sent to ${chalk.bold(target.displayName)}${agentLabel}`);
    });

  // ── team audit ────────────────────────────────────────────────────────────
  team
    .command('audit')
    .description('Show the local audit log of cross-machine actions')
    .option('-n, --lines <n>', 'Show last N lines', '20')
    .action(async (opts: { lines: string }) => {
      const { readFileSync, existsSync } = await import('node:fs');
      const path = getAuditLogPath();
      if (!existsSync(path)) {
        printInfo('No audit log yet. Actions are logged when you receive remote requests.');
        return;
      }
      const lines = readFileSync(path, 'utf-8').trim().split('\n');
      const n = parseInt(opts.lines, 10) || 20;
      const tail = lines.slice(-n);
      console.log(chalk.bold(`\n  Audit log (last ${tail.length} entries):\n`));
      for (const line of tail) {
        // Colour the outcome field
        const coloured = line
          .replace(/\boutcome:ok\b/, `outcome:${chalk.green('ok')}`)
          .replace(/\boutcome:denied\b/, `outcome:${chalk.red('denied')}`)
          .replace(/\boutcome:error\b/, `outcome:${chalk.red('error')}`)
          .replace(/\boutcome:pending\b/, `outcome:${chalk.yellow('pending')}`)
          .replace(/\boutcome:received\b/, `outcome:${chalk.cyan('received')}`);
        console.log(`  ${chalk.dim(coloured)}`);
      }
      console.log(chalk.dim(`\n  Full log: ${path}\n`));
    });
}

import { describe, it, expect } from 'vitest';
import { runHooks, HookError } from '../src/core/hooks.js';
import type { HookContext } from '../src/core/hooks.js';

const ctx: HookContext = { formation: 'pilot' };

describe('runHooks', () => {
  it('runs a successful command and returns output', async () => {
    const results = await runHooks(['node -e "process.stdout.write(\'ok\')"'], 'pre', ctx);
    expect(results).toHaveLength(1);
    expect(results[0].stdout).toBe('ok');
    expect(results[0].stderr).toBe('');
  });

  it('returns an empty array when given no commands', async () => {
    const results = await runHooks([], 'pre', ctx);
    expect(results).toHaveLength(0);
  });

  it('runs multiple commands sequentially', async () => {
    const order: number[] = [];
    const results = await runHooks(
      [
        'node -e "process.stdout.write(\'1\')"',
        'node -e "process.stdout.write(\'2\')"',
        'node -e "process.stdout.write(\'3\')"',
      ],
      'post',
      ctx,
      () => {},
    );
    expect(results.map((r) => r.stdout)).toEqual(['1', '2', '3']);
  });

  it('throws HookError when a command exits non-zero', async () => {
    await expect(
      runHooks(['node -e "process.exit(1)"'], 'pre', ctx),
    ).rejects.toBeInstanceOf(HookError);
  });

  it('HookError carries the phase and command', async () => {
    const cmd = 'node -e "process.exit(42)"';
    try {
      await runHooks([cmd], 'pre', ctx);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HookError);
      const hookErr = err as HookError;
      expect(hookErr.phase).toBe('pre');
      expect(hookErr.command).toBe(cmd);
    }
  });

  it('aborts remaining commands after first failure', async () => {
    const executed: string[] = [];
    await expect(
      runHooks(
        ['node -e "process.exit(1)"', 'node -e "process.stdout.write(\'should not run\')"'],
        'pre',
        ctx,
        (cmd) => executed.push(cmd),
      ),
    ).rejects.toBeInstanceOf(HookError);
    expect(executed).toHaveLength(1);
  });

  it('interpolates ${formation} into commands', async () => {
    const results = await runHooks(
      ['node -e "process.stdout.write(\'${formation}\')"'],
      'pre',
      { formation: 'my-formation' },
    );
    expect(results[0].stdout).toBe('my-formation');
  });

  it('interpolates extra context keys', async () => {
    const results = await runHooks(
      ['node -e "process.stdout.write(\'${env}\')"'],
      'pre',
      { formation: 'pilot', env: 'staging' },
    );
    expect(results[0].stdout).toBe('staging');
  });

  it('replaces unknown interpolation keys with empty string', async () => {
    const results = await runHooks(
      ['node -e "process.stdout.write(\'${unknown}\')"'],
      'pre',
      ctx,
    );
    expect(results[0].stdout).toBe('');
  });

  it('calls onCommand before each command executes', async () => {
    const seen: string[] = [];
    await runHooks(
      ['node -e "1"', 'node -e "2"'],
      'post',
      ctx,
      (cmd) => seen.push(cmd),
    );
    expect(seen).toHaveLength(2);
  });

  it('exposes SWORM_FORMATION env var to the command', async () => {
    const results = await runHooks(
      ['node -e "process.stdout.write(process.env.SWORM_FORMATION)"'],
      'pre',
      { formation: 'debug' },
    );
    expect(results[0].stdout).toBe('debug');
  });

  it('exposes extra context keys as SWORM_* env vars', async () => {
    const results = await runHooks(
      ['node -e "process.stdout.write(process.env.SWORM_ENV ?? \'\')"'],
      'pre',
      { formation: 'pilot', env: 'prod' },
    );
    expect(results[0].stdout).toBe('prod');
  });
});

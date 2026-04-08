import type { Swarm } from '../core/swarm.js';

const DEFAULT_FORMATION = 'pilot';

/**
 * Runs a keybinding action against the swarm (everything except `voice-activate`,
 * which is handled by the voice listener for push-to-talk).
 */
export async function handleSwarmHotkeyAction(
  swarm: Swarm,
  action: string,
  args?: Record<string, unknown>,
): Promise<void> {
  switch (action) {
    case 'voice-activate':
      return;
    case 'toggle-visibility':
      await swarm.toggleVisibility();
      return;
    case 'focus-worm': {
      const num = (args?.number as number) ?? 0;
      if (num > 0) await swarm.focusByNumber(num);
      return;
    }
    case 'toggle-fullscreen':
      await swarm.fullscreenPreferredWorm();
      return;
    case 'kill-all':
      await swarm.kill();
      return;
    case 'deploy-default':
      await swarm.deploy(DEFAULT_FORMATION);
      return;
    default:
      return;
  }
}

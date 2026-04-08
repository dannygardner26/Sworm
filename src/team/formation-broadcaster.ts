/**
 * Bridges the local SwormEventBus to the relay.
 *
 * Listens for formation:deployed and formation:killed events, then broadcasts
 * a FormationStatusMessage to all online teammates so they can see what you're
 * working on in real time.
 */
import type { SwormEventBus } from '../core/events.js';
import type { RelayClient } from './relay-client.js';

export class FormationBroadcaster {
  private relayClient: RelayClient;
  private currentFormation: string | null = null;
  private currentWormCount = 0;

  private onDeployed: (formation: string, wormCount: number) => void;
  private onKilled: () => void;

  constructor(relayClient: RelayClient) {
    this.relayClient = relayClient;

    this.onDeployed = (formation: string, wormCount: number) => {
      this.currentFormation = formation;
      this.currentWormCount = wormCount;
      this.broadcast();
    };

    this.onKilled = () => {
      this.currentFormation = null;
      this.currentWormCount = 0;
      this.broadcast();
    };
  }

  attach(eventBus: SwormEventBus): this {
    eventBus.on('formation:deployed', this.onDeployed);
    eventBus.on('formation:killed', this.onKilled);
    return this;
  }

  detach(eventBus: SwormEventBus): void {
    eventBus.off('formation:deployed', this.onDeployed);
    eventBus.off('formation:killed', this.onKilled);
  }

  /** Broadcast current state — call right after connecting so teammates see your status. */
  broadcastCurrent(): void {
    this.broadcast();
  }

  private broadcast(): void {
    if (!this.relayClient.connected) return;
    this.relayClient.sendBroadcast({
      type: 'formation_status',
      formation: this.currentFormation,
      wormCount: this.currentWormCount,
    });
  }
}

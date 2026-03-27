import { type VoiceCommand, parseVoiceCommand } from './commands.js';
import { DictationBridge } from './dictation-bridge.js';

export interface VoiceListenerOptions {
  wakeWord?: string;
  engine?: 'vosk' | 'windows' | 'bridge';
  modelPath?: string;
  sampleRate?: number;
  bridgePort?: number;
}

export interface VoiceListener {
  start(): Promise<void>;
  stop(): Promise<void>;
  onCommand(handler: (command: VoiceCommand) => void): void;
  isListening(): boolean;
}

/**
 * Stub listener for testing. Allows manual injection of text commands.
 */
export class StubListener implements VoiceListener {
  private handlers: Array<(command: VoiceCommand) => void> = [];
  private listening = false;

  async start(): Promise<void> {
    this.listening = true;
  }

  async stop(): Promise<void> {
    this.listening = false;
  }

  onCommand(handler: (command: VoiceCommand) => void): void {
    this.handlers.push(handler);
  }

  isListening(): boolean {
    return this.listening;
  }

  /** Manually inject a text string to be parsed as a voice command. */
  inject(text: string): void {
    const command = parseVoiceCommand(text);
    if (command) {
      for (const handler of this.handlers) {
        handler(command);
      }
    }
  }
}

/**
 * Bridge listener that delegates to the DictationBridge HTTP server.
 */
export class BridgeListener implements VoiceListener {
  private bridge: DictationBridge;
  private port: number;

  constructor(port = 7483) {
    this.port = port;
    this.bridge = new DictationBridge();
  }

  async start(): Promise<void> {
    await this.bridge.start(this.port);
  }

  async stop(): Promise<void> {
    await this.bridge.stop();
  }

  onCommand(handler: (command: VoiceCommand) => void): void {
    this.bridge.onCommand(handler);
  }

  isListening(): boolean {
    return this.bridge.isListening();
  }
}

/**
 * Factory function to create a VoiceListener based on the given options.
 */
export function createVoiceListener(options: VoiceListenerOptions = {}): VoiceListener {
  const engine = options.engine ?? 'bridge';

  switch (engine) {
    case 'bridge':
      return new BridgeListener(options.bridgePort);
    case 'vosk':
      console.warn('Vosk engine is not yet implemented. Using StubListener.');
      return new StubListener();
    case 'windows':
      console.warn('Windows engine is not yet implemented. Using StubListener.');
      return new StubListener();
    default:
      return new BridgeListener(options.bridgePort);
  }
}

/// <reference types="node" />
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { type VoiceCommand, parseVoiceCommand } from './commands.js';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const GRAMMAR_DESCRIPTIONS: string[] = [
  'deploy <name> [formation] — deploy a formation by name',
  'switch to <name> — switch to (deploy) a formation by name',
  'kill all / kill everything — kill all running formations',
  'kill <name> — kill a specific formation or process',
  'status / show status — show current status',
  'focus [on] <name> — focus a specific window or formation',
  'list formations / what formations — list available formations',
];

/**
 * HTTP bridge that accepts dictation text via POST and parses it into voice commands.
 */
export class DictationBridge {
  private server: Server | null = null;
  private handlers: Array<(command: VoiceCommand) => void> = [];
  private listening = false;
  private activePort = 0;

  /**
   * Start the HTTP bridge server on the given port.
   */
  async start(port = 7483): Promise<void> {
    if (this.server) {
      throw new Error('DictationBridge is already running');
    }

    return new Promise<void>((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', reject);

      this.server.listen(port, () => {
        this.listening = true;
        this.activePort = port;
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP bridge server.
   */
  async stop(): Promise<void> {
    if (!this.server) return;

    return new Promise<void>((resolve, reject) => {
      this.server!.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.server = null;
          this.listening = false;
          this.activePort = 0;
          resolve();
        }
      });
    });
  }

  /**
   * Register a handler to be called when a valid command is received.
   */
  onCommand(handler: (command: VoiceCommand) => void): void {
    this.handlers.push(handler);
  }

  /**
   * Returns whether the bridge is currently listening for requests.
   */
  isListening(): boolean {
    return this.listening;
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      this.sendJson(res, 204, null);
      return;
    }

    const url = req.url ?? '/';

    if (req.method === 'GET' && url === '/health') {
      this.sendJson(res, 200, {
        status: 'ok',
        listening: this.listening,
        port: this.activePort,
      });
      return;
    }

    if (req.method === 'GET' && url === '/grammar') {
      this.sendJson(res, 200, { patterns: GRAMMAR_DESCRIPTIONS });
      return;
    }

    if (req.method === 'POST' && url === '/command') {
      this.handleCommand(req, res);
      return;
    }

    this.sendJson(res, 404, { error: 'not found' });
  }

  private handleCommand(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { text?: string };
        const text = body.text;

        if (typeof text !== 'string' || text.trim().length === 0) {
          this.sendJson(res, 400, { ok: false, error: 'missing or empty "text" field' });
          return;
        }

        const command = parseVoiceCommand(text);

        if (!command) {
          this.sendJson(res, 200, { ok: false, error: 'unrecognized command' });
          return;
        }

        for (const handler of this.handlers) {
          handler(command);
        }

        this.sendJson(res, 200, { ok: true, command });
      } catch {
        this.sendJson(res, 400, { ok: false, error: 'invalid JSON body' });
      }
    });
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      res.setHeader(key, value);
    }

    if (data === null) {
      res.writeHead(status);
      res.end();
      return;
    }

    res.setHeader('Content-Type', 'application/json');
    res.writeHead(status);
    res.end(JSON.stringify(data));
  }
}

import { spawn, type ChildProcess } from 'node:child_process';

export interface AudioCaptureOptions {
  sampleRate?: number;      // default: 16000
  channels?: number;        // default: 1 (mono)
  bitDepth?: number;        // default: 16
  device?: string;          // OS audio device name
  recorder?: 'sox' | 'ffmpeg';  // default: try sox first, fallback to ffmpeg
}

export class AudioCapture {
  private process: ChildProcess | null = null;
  private options: Required<AudioCaptureOptions>;

  constructor(options?: AudioCaptureOptions) {
    this.options = {
      sampleRate: options?.sampleRate ?? 16000,
      channels: options?.channels ?? 1,
      bitDepth: options?.bitDepth ?? 16,
      device: options?.device ?? 'default',
      recorder: options?.recorder ?? 'sox',
    };
  }

  start(): NodeJS.ReadableStream {
    // For SoX:
    // sox -d -t raw -r 16000 -c 1 -b 16 -e signed-integer -
    // For ffmpeg:
    // ffmpeg -f dshow -i audio="Microphone" -ar 16000 -ac 1 -f s16le -

    if (this.options.recorder === 'sox') {
      this.process = spawn('sox', [
        '-d',           // default audio device
        '-t', 'raw',    // raw PCM output
        '-r', String(this.options.sampleRate),
        '-c', String(this.options.channels),
        '-b', String(this.options.bitDepth),
        '-e', 'signed-integer',
        '-',            // stdout
      ], { stdio: ['pipe', 'pipe', 'pipe'] });
    } else {
      this.process = spawn('ffmpeg', [
        '-f', 'dshow',
        '-i', `audio=${this.options.device}`,
        '-ar', String(this.options.sampleRate),
        '-ac', String(this.options.channels),
        '-f', 's16le',
        '-',
      ], { stdio: ['pipe', 'pipe', 'pipe'] });
    }

    if (!this.process.stdout) throw new Error('Failed to capture audio stream');
    return this.process.stdout;
  }

  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  isRecording(): boolean {
    return this.process !== null && !this.process.killed;
  }
}

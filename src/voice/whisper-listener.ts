import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AudioCapture } from './audio-capture.js';
import { parseVoiceCommand, type VoiceCommand } from './commands.js';
import type { VoiceListener } from './listener.js';

export interface WhisperOptions {
  modelPath: string;           // Path to whisper.cpp model file (e.g., ggml-base.en.bin)
  whisperPath?: string;        // Path to whisper.cpp binary (default: 'whisper-cpp' in PATH)
  wakeWord?: string;           // Wake word (default: 'sworm')
  sampleRate?: number;         // Audio sample rate (default: 16000)
  chunkDurationMs?: number;    // Audio chunk duration in ms (default: 3000)
  language?: string;           // Language code (default: 'en')
}

export class WhisperListener implements VoiceListener {
  private options: Required<WhisperOptions>;
  private capture: AudioCapture;
  private handlers: Array<(cmd: VoiceCommand) => void> = [];
  private listening = false;
  private tempDir: string;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: WhisperOptions) {
    this.options = {
      modelPath: options.modelPath,
      whisperPath: options.whisperPath ?? 'whisper-cpp',
      wakeWord: options.wakeWord ?? 'sworm',
      sampleRate: options.sampleRate ?? 16000,
      chunkDurationMs: options.chunkDurationMs ?? 3000,
      language: options.language ?? 'en',
    };
    this.capture = new AudioCapture({ sampleRate: this.options.sampleRate });
    this.tempDir = mkdtempSync(join(tmpdir(), 'sworm-whisper-'));
  }

  async start(): Promise<void> {
    this.listening = true;
    const stream = this.capture.start();

    // Collect audio chunks and transcribe them
    let audioBuffer = Buffer.alloc(0);
    const bytesPerChunk = (this.options.sampleRate * 2 * this.options.chunkDurationMs) / 1000; // 16-bit mono

    stream.on('data', (chunk: Buffer) => {
      if (!this.listening) return;
      audioBuffer = Buffer.concat([audioBuffer, chunk]);

      if (audioBuffer.length >= bytesPerChunk) {
        const chunkToProcess = audioBuffer.subarray(0, bytesPerChunk);
        audioBuffer = audioBuffer.subarray(bytesPerChunk);
        void this.processChunk(chunkToProcess);
      }
    });
  }

  async stop(): Promise<void> {
    this.listening = false;
    this.capture.stop();
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
  }

  onCommand(handler: (command: VoiceCommand) => void): void {
    this.handlers.push(handler);
  }

  isListening(): boolean {
    return this.listening;
  }

  private async processChunk(pcmData: Buffer): Promise<void> {
    try {
      // Write PCM to temp WAV file (whisper.cpp needs WAV input)
      const wavPath = join(this.tempDir, `chunk-${Date.now()}.wav`);
      const wavBuffer = this.pcmToWav(pcmData);
      writeFileSync(wavPath, wavBuffer);

      // Run whisper.cpp
      const text = await this.transcribe(wavPath);

      // Clean up temp file
      try { unlinkSync(wavPath); } catch { /* ignore cleanup errors */ }

      if (!text.trim()) return;

      // Check for wake word
      const lower = text.toLowerCase().trim();
      const wakeIdx = lower.indexOf(this.options.wakeWord);
      if (wakeIdx === -1) return;

      // Extract command after wake word
      const commandText = lower.substring(wakeIdx + this.options.wakeWord.length).trim();
      if (!commandText) return;

      const command = parseVoiceCommand(commandText);
      if (command) {
        for (const handler of this.handlers) {
          handler(command);
        }
      }
    } catch {
      // Transcription failed, skip this chunk
    }
  }

  private transcribe(wavPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.options.whisperPath, [
        '-m', this.options.modelPath,
        '-f', wavPath,
        '-l', this.options.language,
        '--no-timestamps',
        '-nt',  // no timestamps in output
      ]);

      let output = '';
      proc.stdout.on('data', (data: Buffer) => { output += data.toString(); });
      proc.on('close', (code) => {
        if (code === 0) resolve(output.trim());
        else reject(new Error(`whisper-cpp exited with code ${code}`));
      });
      proc.on('error', reject);
    });
  }

  private pcmToWav(pcmData: Buffer): Buffer {
    // Create WAV header for 16-bit mono PCM
    const header = Buffer.alloc(44);
    const dataLen = pcmData.length;
    const fileLen = dataLen + 36;

    header.write('RIFF', 0);
    header.writeUInt32LE(fileLen, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);       // fmt chunk size
    header.writeUInt16LE(1, 20);        // PCM format
    header.writeUInt16LE(1, 22);        // mono
    header.writeUInt32LE(this.options.sampleRate, 24);
    header.writeUInt32LE(this.options.sampleRate * 2, 28);  // byte rate
    header.writeUInt16LE(2, 32);        // block align
    header.writeUInt16LE(16, 34);       // bits per sample
    header.write('data', 36);
    header.writeUInt32LE(dataLen, 40);

    return Buffer.concat([header, pcmData]);
  }
}

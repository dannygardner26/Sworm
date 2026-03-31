/**
 * Voice Activation — push-to-talk + wake word unified listener.
 *
 * Push-to-talk: triggered externally (hotkey), records until silence/timeout, transcribes, executes.
 * Wake word: continuous monitoring, detects "hey sworm" or "sworm", then records command.
 */
import { AudioCapture } from './audio-capture.js';
import { parseVoiceCommand, type VoiceCommand } from './commands.js';
import {
  playListeningChime,
  playAcknowledgeChime,
  playErrorTone,
  playReadyTick,
} from './audio-feedback.js';
import { showListeningOverlay, hideListeningOverlay } from './overlay.js';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

export interface VoiceActivationConfig {
  /** Path to whisper.cpp binary */
  whisperPath: string;
  /** Path to whisper model file (e.g., ggml-tiny.en.bin) */
  modelPath: string;
  /** Push-to-talk recording timeout in ms (default: 5000) */
  pttTimeout?: number;
  /** Silence threshold — number of consecutive quiet chunks before stopping (default: 3) */
  silenceChunks?: number;
  /** Audio sample rate (default: 16000) */
  sampleRate?: number;
  /** Enable wake word detection (default: true) */
  wakeWordEnabled?: boolean;
  /** Wake word phrase (default: "sworm") */
  wakeWord?: string;
  /** Wake word chunk duration in ms (default: 2000) */
  wakeWordChunkMs?: number;
  /** Audio recorder: sox or ffmpeg (default: sox) */
  recorder?: 'sox' | 'ffmpeg';
}

type ActivationState = 'idle' | 'ptt-recording' | 'hold-recording' | 'toggle-recording' | 'wake-listening' | 'wake-recording';

export class VoiceActivation {
  private config: Required<VoiceActivationConfig>;
  private state: ActivationState = 'idle';
  private handlers: Array<(cmd: VoiceCommand, raw: string) => void> = [];
  private capture: AudioCapture | null = null;
  private tempDir: string;
  private pttBuffer: Buffer = Buffer.alloc(0);
  private pttTimer: ReturnType<typeof setTimeout> | null = null;
  private holdBuffer: Buffer = Buffer.alloc(0);
  private holdCapture: AudioCapture | null = null;
  private toggleBuffer: Buffer = Buffer.alloc(0);
  private toggleCapture: AudioCapture | null = null;
  private toggleTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeCapture: AudioCapture | null = null;
  private wakeBuffer: Buffer = Buffer.alloc(0);
  private wakeActive = false;
  private wakeCommandBuffer: Buffer = Buffer.alloc(0);
  private wakeCommandTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: VoiceActivationConfig) {
    this.config = {
      whisperPath: config.whisperPath,
      modelPath: config.modelPath,
      pttTimeout: config.pttTimeout ?? 5000,
      silenceChunks: config.silenceChunks ?? 3,
      sampleRate: config.sampleRate ?? 16000,
      wakeWordEnabled: config.wakeWordEnabled ?? true,
      wakeWord: config.wakeWord ?? 'sworm',
      wakeWordChunkMs: config.wakeWordChunkMs ?? 2000,
      recorder: config.recorder ?? 'sox',
    };
    this.tempDir = mkdtempSync(join(tmpdir(), 'sworm-voice-'));
  }

  onCommand(handler: (cmd: VoiceCommand, raw: string) => void): void {
    this.handlers.push(handler);
  }

  getState(): ActivationState {
    return this.state;
  }

  // ─── Push-to-Talk ──────────────────────────────────────

  /** Start push-to-talk recording. Called when hotkey is pressed. */
  startPTT(): void {
    if (this.state === 'ptt-recording') {
      // Already recording — stop (toggle behavior)
      this.stopPTT();
      return;
    }

    this.state = 'ptt-recording';
    this.pttBuffer = Buffer.alloc(0);
    showListeningOverlay();
    playListeningChime();

    this.capture = new AudioCapture({
      sampleRate: this.config.sampleRate,
      recorder: this.config.recorder,
    });
    const stream = this.capture.start();

    let quietChunks = 0;
    const chunkSize = this.config.sampleRate * 2; // 1 second of 16-bit mono

    stream.on('data', (chunk: Buffer) => {
      if (this.state !== 'ptt-recording') return;
      this.pttBuffer = Buffer.concat([this.pttBuffer, chunk]);

      // Simple silence detection: check RMS energy of chunk
      if (chunk.length >= 320) {
        const rms = computeRMS(chunk);
        if (rms < 200) {
          quietChunks++;
        } else {
          quietChunks = 0;
        }

        if (quietChunks >= this.config.silenceChunks && this.pttBuffer.length > chunkSize) {
          this.stopPTT();
        }
      }
    });

    // Hard timeout
    this.pttTimer = setTimeout(() => {
      if (this.state === 'ptt-recording') {
        this.stopPTT();
      }
    }, this.config.pttTimeout);
  }

  /** Stop push-to-talk recording and transcribe. */
  private async stopPTT(): Promise<void> {
    if (this.state !== 'ptt-recording') return;

    if (this.pttTimer) {
      clearTimeout(this.pttTimer);
      this.pttTimer = null;
    }

    this.capture?.stop();
    this.capture = null;
    hideListeningOverlay();

    const audioData = this.pttBuffer;
    this.pttBuffer = Buffer.alloc(0);
    this.state = 'idle';

    if (audioData.length < 3200) {
      // Too short to transcribe (< 0.1s)
      playErrorTone();
      return;
    }

    playAcknowledgeChime();

    try {
      const text = await this.transcribe(audioData);
      if (text.trim()) {
        this.processText(text.trim());
      }
    } catch {
      playErrorTone();
    }

    // Restart wake word listener if enabled
    if (this.config.wakeWordEnabled && this.wakeActive) {
      this.startWakeWordListener();
    }
  }

  // ─── Hold-to-Talk ──────────────────────────────────────

  /** Start hold-to-talk recording. Records until stopHoldRecording() is called (key release). */
  startHoldRecording(): void {
    if (this.state !== 'idle' && this.state !== 'wake-listening') return;

    // Pause wake listener if active
    if (this.wakeActive) this.stopWakeWordListener();

    this.state = 'hold-recording';
    this.holdBuffer = Buffer.alloc(0);
    showListeningOverlay('hold');
    playListeningChime();

    this.holdCapture = new AudioCapture({
      sampleRate: this.config.sampleRate,
      recorder: this.config.recorder,
    });
    const stream = this.holdCapture.start();

    // No silence detection, no timeout — purely controlled by key hold duration
    stream.on('data', (chunk: Buffer) => {
      if (this.state !== 'hold-recording') return;
      this.holdBuffer = Buffer.concat([this.holdBuffer, chunk]);
    });
  }

  /** Stop hold-to-talk recording and transcribe. Called on key release. */
  async stopHoldRecording(): Promise<void> {
    if (this.state !== 'hold-recording') return;

    this.holdCapture?.stop();
    this.holdCapture = null;
    hideListeningOverlay();

    const audioData = this.holdBuffer;
    this.holdBuffer = Buffer.alloc(0);
    this.state = 'idle';

    // Minimum ~500ms of audio (16000 Hz * 2 bytes * 0.5s = 16000 bytes)
    if (audioData.length < 16000) {
      playErrorTone();
      if (this.config.wakeWordEnabled) this.startWakeWordListener();
      return;
    }

    playAcknowledgeChime();

    try {
      const text = await this.transcribe(audioData);
      if (text.trim()) this.processText(text.trim());
    } catch {
      playErrorTone();
    }

    if (this.config.wakeWordEnabled) this.startWakeWordListener();
  }

  // ─── Toggle Recording ─────────────────────────────────

  /** Toggle recording on/off. First call starts, second call stops. */
  toggleRecording(): void {
    if (this.state === 'toggle-recording') {
      void this.stopToggleRecording();
      return;
    }

    if (this.state !== 'idle' && this.state !== 'wake-listening') return;

    if (this.wakeActive) this.stopWakeWordListener();

    this.state = 'toggle-recording';
    this.toggleBuffer = Buffer.alloc(0);
    showListeningOverlay('toggle');
    playListeningChime();

    this.toggleCapture = new AudioCapture({
      sampleRate: this.config.sampleRate,
      recorder: this.config.recorder,
    });
    const stream = this.toggleCapture.start();

    let quietChunks = 0;

    stream.on('data', (chunk: Buffer) => {
      if (this.state !== 'toggle-recording') return;
      this.toggleBuffer = Buffer.concat([this.toggleBuffer, chunk]);

      // Silence detection as safety net (more lenient than PTT)
      if (chunk.length >= 320) {
        const rms = computeRMS(chunk);
        if (rms < 200) {
          quietChunks++;
        } else {
          quietChunks = 0;
        }
        // Auto-stop after extended silence (8 quiet chunks, more lenient than PTT's 3)
        if (quietChunks >= 8 && this.toggleBuffer.length > this.config.sampleRate * 2) {
          void this.stopToggleRecording();
        }
      }
    });

    // Safety timeout at 30 seconds
    this.toggleTimer = setTimeout(() => {
      if (this.state === 'toggle-recording') {
        void this.stopToggleRecording();
      }
    }, 30000);
  }

  private async stopToggleRecording(): Promise<void> {
    if (this.state !== 'toggle-recording') return;

    if (this.toggleTimer) {
      clearTimeout(this.toggleTimer);
      this.toggleTimer = null;
    }

    this.toggleCapture?.stop();
    this.toggleCapture = null;
    hideListeningOverlay();

    const audioData = this.toggleBuffer;
    this.toggleBuffer = Buffer.alloc(0);
    this.state = 'idle';

    if (audioData.length < 3200) {
      playErrorTone();
      if (this.config.wakeWordEnabled) this.startWakeWordListener();
      return;
    }

    playAcknowledgeChime();

    try {
      const text = await this.transcribe(audioData);
      if (text.trim()) this.processText(text.trim());
    } catch {
      playErrorTone();
    }

    if (this.config.wakeWordEnabled) this.startWakeWordListener();
  }

  // ─── Wake Word ─────────────────────────────────────────

  /** Start continuous wake word monitoring. */
  startWakeWordListener(): void {
    if (this.state === 'ptt-recording') return; // Don't interfere with PTT

    this.wakeActive = true;
    this.state = 'wake-listening';
    this.wakeBuffer = Buffer.alloc(0);

    this.wakeCapture = new AudioCapture({
      sampleRate: this.config.sampleRate,
      recorder: this.config.recorder,
    });

    const stream = this.wakeCapture.start();
    const bytesPerChunk = (this.config.sampleRate * 2 * this.config.wakeWordChunkMs) / 1000;

    stream.on('data', (chunk: Buffer) => {
      if (this.state === 'wake-listening') {
        this.wakeBuffer = Buffer.concat([this.wakeBuffer, chunk]);

        if (this.wakeBuffer.length >= bytesPerChunk) {
          const toProcess = this.wakeBuffer.subarray(0, bytesPerChunk);
          this.wakeBuffer = this.wakeBuffer.subarray(bytesPerChunk);
          void this.checkWakeWord(toProcess);
        }
      } else if (this.state === 'wake-recording') {
        this.wakeCommandBuffer = Buffer.concat([this.wakeCommandBuffer, chunk]);
      }
    });
  }

  /** Stop wake word monitoring. */
  stopWakeWordListener(): void {
    this.wakeActive = false;
    if (this.state === 'wake-listening' || this.state === 'wake-recording') {
      this.state = 'idle';
    }
    this.wakeCapture?.stop();
    this.wakeCapture = null;
    if (this.wakeCommandTimer) {
      clearTimeout(this.wakeCommandTimer);
      this.wakeCommandTimer = null;
    }
  }

  private async checkWakeWord(audioData: Buffer): Promise<void> {
    if (this.state !== 'wake-listening') return;

    try {
      const text = await this.transcribe(audioData);
      const lower = text.toLowerCase().trim();

      // Check if wake word is present
      const wakeIdx = lower.indexOf(this.config.wakeWord);
      if (wakeIdx === -1) return;

      // Check if there's a command after the wake word in same chunk
      const afterWake = lower.substring(wakeIdx + this.config.wakeWord.length).trim();
      if (afterWake.length > 3) {
        // Command was in the same chunk as wake word
        playReadyTick();
        playAcknowledgeChime();
        this.processText(afterWake);
        return;
      }

      // Wake word detected but no command yet — start recording command
      playReadyTick();
      showListeningOverlay();
      this.state = 'wake-recording';
      this.wakeCommandBuffer = Buffer.alloc(0);

      // Record for up to 4 seconds for the command
      this.wakeCommandTimer = setTimeout(() => {
        void this.finishWakeCommand();
      }, 4000);
    } catch {
      // Transcription failed, keep listening
    }
  }

  private async finishWakeCommand(): Promise<void> {
    if (this.state !== 'wake-recording') return;

    this.wakeCommandTimer = null;
    hideListeningOverlay();
    const audioData = this.wakeCommandBuffer;
    this.wakeCommandBuffer = Buffer.alloc(0);
    this.state = 'wake-listening';

    if (audioData.length < 3200) {
      playErrorTone();
      return;
    }

    playAcknowledgeChime();

    try {
      const text = await this.transcribe(audioData);
      if (text.trim()) {
        this.processText(text.trim());
      }
    } catch {
      playErrorTone();
    }
  }

  // ─── Shared ────────────────────────────────────────────

  private processText(text: string): void {
    // Strip wake word if present at start
    let cleaned = text;
    const wakePattern = new RegExp(`^(?:hey\\s+)?${this.config.wakeWord}\\s*`, 'i');
    cleaned = cleaned.replace(wakePattern, '').trim();

    if (!cleaned) return;

    const command = parseVoiceCommand(cleaned);
    if (command) {
      for (const handler of this.handlers) {
        handler(command, cleaned);
      }
    }
  }

  private transcribe(pcmData: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const wavPath = join(this.tempDir, `va-${Date.now()}.wav`);
      const wavBuffer = pcmToWav(pcmData, this.config.sampleRate);
      writeFileSync(wavPath, wavBuffer);

      const proc = spawn(this.config.whisperPath, [
        '-m',
        this.config.modelPath,
        '-f',
        wavPath,
        '-l',
        'en',
        '--no-timestamps',
      ]);

      let output = '';
      proc.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });
      proc.on('close', (code) => {
        try {
          unlinkSync(wavPath);
        } catch {}
        if (code === 0) resolve(output.trim());
        else reject(new Error(`whisper exited with code ${code}`));
      });
      proc.on('error', reject);
    });
  }

  dispose(): void {
    this.stopWakeWordListener();
    if (this.capture) {
      this.capture.stop();
      this.capture = null;
    }
    if (this.holdCapture) {
      this.holdCapture.stop();
      this.holdCapture = null;
    }
    if (this.toggleCapture) {
      this.toggleCapture.stop();
      this.toggleCapture = null;
    }
    if (this.pttTimer) {
      clearTimeout(this.pttTimer);
      this.pttTimer = null;
    }
    if (this.toggleTimer) {
      clearTimeout(this.toggleTimer);
      this.toggleTimer = null;
    }
  }
}

/** Compute RMS energy of 16-bit PCM buffer */
function computeRMS(buf: Buffer): number {
  let sum = 0;
  const samples = buf.length / 2;
  for (let i = 0; i < buf.length - 1; i += 2) {
    const sample = buf.readInt16LE(i);
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples);
}

/** Convert raw PCM to WAV format */
function pcmToWav(pcmData: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const dataLen = pcmData.length;
  const fileLen = dataLen + 36;

  header.write('RIFF', 0);
  header.writeUInt32LE(fileLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);

  return Buffer.concat([header, pcmData]);
}

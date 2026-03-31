/**
 * Audio feedback via Win32 Beep API — pleasant tones for voice activation states.
 * Zero dependencies, works everywhere on Windows.
 */
import koffi from 'koffi';

const kernel32 = koffi.load('kernel32.dll');
const Beep = kernel32.func('bool Beep(uint dwFreq, uint dwDuration)');

/** Two-tone ascending chime — "I'm listening" */
export function playListeningChime(): void {
  try {
    Beep(880, 80); // A5
    Beep(1175, 100); // D6
  } catch {
    // Silently fail if Beep unavailable
  }
}

/** Two-tone descending chime — "Got it" */
export function playAcknowledgeChime(): void {
  try {
    Beep(1175, 80); // D6
    Beep(880, 100); // A5
  } catch {
    // Silently fail
  }
}

/** Short error buzz */
export function playErrorTone(): void {
  try {
    Beep(300, 150);
  } catch {
    // Silently fail
  }
}

/** Quick single tick — wake word detected, ready for command */
export function playReadyTick(): void {
  try {
    Beep(1047, 60); // C6
  } catch {
    // Silently fail
  }
}

/** Two short ascending beeps — toggle recording ON */
export function playToggleOnTone(): void {
  try {
    Beep(660, 80);
    Beep(880, 80);
  } catch {
    // Silently fail
  }
}

/** Two short descending beeps — toggle recording OFF */
export function playToggleOffTone(): void {
  try {
    Beep(880, 80);
    Beep(660, 80);
  } catch {
    // Silently fail
  }
}

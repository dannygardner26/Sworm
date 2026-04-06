import { describe, it, expect } from 'vitest';
import { parseVoiceCommand } from '../src/voice/commands.js';

describe('parseVoiceCommand', () => {
  // Deploy
  it('parses "deploy pilot"', () => {
    expect(parseVoiceCommand('deploy pilot')).toEqual({ action: 'deploy', target: 'pilot' });
  });

  it('parses "deploy pilot formation"', () => {
    expect(parseVoiceCommand('deploy pilot formation')).toEqual({ action: 'deploy', target: 'pilot' });
  });

  it('parses "switch to review"', () => {
    expect(parseVoiceCommand('switch to review')).toEqual({ action: 'deploy', target: 'review' });
  });

  // Kill
  it('parses "kill all"', () => {
    expect(parseVoiceCommand('kill all')).toEqual({ action: 'kill-all' });
  });

  it('parses "kill everything"', () => {
    expect(parseVoiceCommand('kill everything')).toEqual({ action: 'kill-all' });
  });

  it('parses "kill claude"', () => {
    expect(parseVoiceCommand('kill claude')).toEqual({ action: 'kill', target: 'claude' });
  });

  // Status
  it('parses "status"', () => {
    expect(parseVoiceCommand('status')).toEqual({ action: 'status' });
  });

  it('parses "show status"', () => {
    expect(parseVoiceCommand('show status')).toEqual({ action: 'status' });
  });

  // Focus
  it('parses "focus on editor"', () => {
    expect(parseVoiceCommand('focus on editor')).toEqual({ action: 'focus', target: 'editor' });
  });

  it('parses "focus editor"', () => {
    expect(parseVoiceCommand('focus editor')).toEqual({ action: 'focus', target: 'editor' });
  });

  // List
  it('parses "list formations"', () => {
    expect(parseVoiceCommand('list formations')).toEqual({ action: 'list' });
  });

  it('parses "what formations"', () => {
    expect(parseVoiceCommand('what formations')).toEqual({ action: 'list' });
  });

  // Numbered agent focus
  it('parses "3" as focus-number', () => {
    expect(parseVoiceCommand('3')).toEqual({ action: 'focus-number', target: '3' });
  });

  it('parses "agent 2" as focus-number', () => {
    expect(parseVoiceCommand('agent 2')).toEqual({ action: 'focus-number', target: '2' });
  });

  // Layout commands
  it('parses "expand 1"', () => {
    expect(parseVoiceCommand('expand 1')).toEqual({ action: 'expand', target: '1' });
  });

  it('parses "expand agent 2"', () => {
    expect(parseVoiceCommand('expand agent 2')).toEqual({ action: 'expand', target: '2' });
  });

  it('parses "shrink 3"', () => {
    expect(parseVoiceCommand('shrink 3')).toEqual({ action: 'shrink', target: '3' });
  });

  it('parses "fullscreen 1"', () => {
    expect(parseVoiceCommand('fullscreen 1')).toEqual({ action: 'fullscreen', target: '1' });
  });

  it('parses "maximize agent 2"', () => {
    expect(parseVoiceCommand('maximize agent 2')).toEqual({ action: 'fullscreen', target: '2' });
  });

  it('parses "minimize all"', () => {
    expect(parseVoiceCommand('minimize all')).toEqual({ action: 'minimize-all' });
  });

  // Toggle visibility
  it('parses "show worms"', () => {
    expect(parseVoiceCommand('show worms')).toEqual({ action: 'toggle-visibility' });
  });

  it('parses "hide agents"', () => {
    expect(parseVoiceCommand('hide agents')).toEqual({ action: 'toggle-visibility' });
  });

  it('parses "toggle all agents"', () => {
    expect(parseVoiceCommand('toggle all agents')).toEqual({ action: 'toggle-visibility' });
  });

  // Filler word stripping
  it('strips filler words', () => {
    expect(parseVoiceCommand('um please deploy pilot')).toEqual({ action: 'deploy', target: 'pilot' });
  });

  it('strips "can you" and "just"', () => {
    expect(parseVoiceCommand('can you just kill all')).toEqual({ action: 'kill-all' });
  });

  it('does not discard single-word command requests that are still meaningful speech', () => {
    expect(parseVoiceCommand('please status')).toEqual({ action: 'status' });
  });

  // Unknown
  it('returns null for unrecognized input', () => {
    expect(parseVoiceCommand('hello world')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseVoiceCommand('')).toBeNull();
  });
});

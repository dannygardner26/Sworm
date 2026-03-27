# Sworm

**Spatially-aware desktop orchestration** — deploy AI agents and applications across multi-monitor setups via named formations.

Sworm = **Swarm** (collective orchestrator) + **Worm** (autonomous window agents)

## What It Does

Instead of manually arranging windows every time you switch contexts, you define **formations** — named layouts that specify which apps to open and where to place them. Then deploy with a single command or voice trigger.

```bash
sworm deploy pilot
```

Instantly spawns Claude Code, your IDE, and a browser — each precisely positioned across your monitors.

## Quick Start

```bash
npm install -g sworm

# See your monitors
sworm monitors

# List available formations
sworm list

# Deploy a formation
sworm deploy pilot

# Kill all running worms
sworm kill
```

## Formations

Formations are YAML files in the `formations/` directory:

```yaml
name: pilot
description: "Primary dev formation"
worms:
  - id: claude-main
    type: claude
    monitor: primary
    position:
      zone: left-half
    params:
      repo: "."
      shell: wt

  - id: editor
    type: ide
    monitor: primary
    position:
      zone: right-half
    params:
      folder: "."

  - id: browser
    type: app
    monitor: right
    position:
      zone: full
    params:
      app: chrome
      url: http://localhost:3000
```

## Worm Types

| Type | Description |
|------|-------------|
| `claude` | Claude Code in a terminal (supports git worktrees) |
| `ide` | VS Code with folder/files/workspace |
| `generic` | Any executable |
| `app` | Browser with URL/profile support |

## Positioning

Three modes for placing windows:

**Zones** (simplest): `full`, `left-half`, `right-half`, `top-left`, `top-right`, `bottom-left`, `bottom-right`, `left-third`, `center-third`, `right-third`

**Grid**: Precise column/row placement within a configurable grid.

**Absolute**: Pixel coordinates or percentage-based positioning.

## Voice Commands

Start the voice listener:

```bash
sworm voice
```

Or send commands via the dictation bridge HTTP API:

```bash
curl -X POST http://localhost:7483/command -d '{"text": "deploy pilot formation"}'
```

Supported voice commands:
- "Deploy [formation]" / "Switch to [formation]"
- "Kill all" / "Kill [target]"
- "Status"
- "Focus [worm]"
- "List formations"

## Architecture

```
Swarm (orchestrator)
├── Formation Loader (YAML → validated config)
├── Monitor Detector (Win32 API → screen geometry)
├── Worm Registry (plugin system)
└── Event Bus (lifecycle events)
    ├── ClaudeWorm → Windows Terminal + Claude Code
    ├── IDEWorm → VS Code
    ├── AppWorm → Chrome / Edge / Firefox
    └── GenericWorm → Any executable
```

## Requirements

- Windows 11 (uses Win32 APIs via koffi)
- Node.js >= 20
- For voice: microphone access or external dictation tool

## License

MIT

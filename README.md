<div align="center">
  <img src="logos/sworm-icon.png" width="80" alt="sworm">
  <h1>sworm</h1>
  <p><em>spatial agent orchestration</em></p>
  <p>
    <a href="https://github.com/dannygardner26/Sworm/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/dannygardner26/Sworm/ci.yml?style=flat-square&label=CI" alt="CI"></a>
    <img src="https://img.shields.io/badge/license-MIT-white?style=flat-square" alt="MIT License">
    <img src="https://img.shields.io/badge/platform-Windows%2011-white?style=flat-square" alt="Windows 11">
    <img src="https://img.shields.io/badge/node-%3E%3D20-white?style=flat-square" alt="Node >= 20">
    <a href="https://github.com/dannygardner26/Sworm/stargazers"><img src="https://img.shields.io/github/stars/dannygardner26/Sworm?style=flat-square" alt="Stars"></a>
    <a href="https://github.com/dannygardner26/Sworm/issues"><img src="https://img.shields.io/github/issues/dannygardner26/Sworm?style=flat-square" alt="Issues"></a>
    <img src="https://img.shields.io/github/last-commit/dannygardner26/Sworm?style=flat-square" alt="Last Commit">
  </p>
</div>

---

Deploy AI agents and apps across multi-monitor setups via named formations.

## Get Started

```bash
git clone https://github.com/dannygardner26/Sworm.git
cd Sworm
npm install
npm run build
```

## Quick Start

```bash
sworm deploy pilot    # deploy a formation
sworm list            # see available formations
sworm kill            # tear down everything
```

## What is Sworm?

Every context switch costs you time. You close tabs, reopen terminals, drag windows across monitors, and manually reconstruct whatever layout you had before. Multiply that by the number of times per day you shift between coding, reviewing, debugging, or demoing, and the overhead adds up fast. The problem gets worse with multi-monitor setups where precise window placement matters.

Sworm solves this with declarative YAML formations. You describe which apps, terminals, and AI agents to launch and where they go across your screens, then deploy the entire layout with a single command or voice trigger. The name comes from **swarm** (collective orchestration) + **worm** (autonomous window agents) = **sworm**. Each window is a "worm" that knows how to spawn, position, and manage itself, while the swarm coordinates the whole formation.

## Features

- **Spatial formations** — define multi-monitor layouts in YAML, deploy with one command
- **AI agents** — multi-provider LLM runtime with tool use (Anthropic, OpenAI, Gemini, Bedrock, Ollama)
- **Voice control** — Whisper-powered speech commands for hands-free operation
- **Global hotkeys** — Win32 shortcuts while `sworm voice listen` is running (layout toggles, focus, deploy default, push-to-talk)
- **Electron app** — rich desktop UI with terminal panes and widget system
- **Wallpaper mode** — render agent windows as desktop wallpaper
- **Git worktrees** — auto-create isolated branches for parallel work

## Formation Example

Formations are YAML files that declare which worms to spawn and where to place them. Here is `formations/pilot.yaml`, a basic dev layout with Claude Code on the left and VS Code on the right:

```yaml
# Pilot Formation — Primary development layout
# Claude Code on the left, IDE on the right
# Works on single or multi-monitor setups

name: pilot
description: "Primary dev formation — Claude + IDE"

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
```

## Hooks and security

Formations may define `hooks.pre` and `hooks.post` arrays of shell commands. Those strings are executed on your machine when you deploy, using the system shell (same risk as running a script you downloaded). **Only deploy formations from sources you trust.** Strings can include `${formation}`; that value is interpolated and also exposed to the hook process as the environment variable `SWORM_FORMATION`. See [SECURITY.md](SECURITY.md) for reporting issues.

## Worm Types

| Type | Description | Key Params |
|------|-------------|------------|
| `claude` | Claude Code in Windows Terminal | `repo`, `shell`, `worktree` |
| `ide` | VS Code | `folder`, `workspace` |
| `app` | Browser (Chrome, Edge, Firefox) | `url`, `browser`, `profile` |
| `generic` | Any executable | `command`, `args` |
| `ai-agent` | LLM agent with tool use | `provider`, `model`, `task` |

## Development

```bash
git clone https://github.com/dannygardner26/Sworm.git
cd Sworm
npm install
npm run build
npm test
npm run lint
```

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)

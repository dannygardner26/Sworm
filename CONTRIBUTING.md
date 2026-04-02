# contributing to sworm

thanks for your interest in contributing. this guide will help you get started.

## Prerequisites

- **Node.js** 20 or later
- **Windows 11** (required for Win32 platform features)
- Git

## Setup

```bash
git clone https://github.com/dannygardner26/Sworm.git
cd Sworm
npm install
npm run build
npm test
```

## Branch Naming

Use the following prefixes for all branches:

| Prefix   | Purpose              |
| -------- | -------------------- |
| `feat/`  | New features         |
| `fix/`   | Bug fixes            |
| `chore/` | Maintenance tasks    |
| `ui/`    | UI/UX changes        |
| `docs/`  | Documentation only   |

Examples: `feat/add-team-invites`, `fix/upload-parsing-bug`

## Pull Request Process

1. Branch from `dev` (not `master`).
2. Make your changes in a feature branch.
3. Run tests and lint before submitting:
   ```bash
   npm test
   npm run lint
   ```
4. Include a `## Summary` section in your PR description with bullet points describing the changes.
5. Open a PR against `dev` and wait for review.

> **Note:** `master` is the release branch. All contributions go into `dev` first and are merged to `master` at release time.

## Code Style

- TypeScript strict mode is enforced.
- We use **ESLint** and **Prettier** for linting and formatting.
- Before committing, run:
  ```bash
  npm run lint
  npm run format
  ```

## Architecture Overview

| Directory        | Purpose                                    |
| ---------------- | ------------------------------------------ |
| `src/cli`        | CLI commands (deploy, list, run, etc.)     |
| `src/core`       | Orchestration engine (swarm, registry)     |
| `src/worms`      | Agent types (claude, ide, app, generic)    |
| `src/platform`   | Win32 abstraction layer via koffi          |
| `src/voice`      | Speech recognition and voice commands      |
| `src/agent`      | LLM runtime with multi-provider support    |

## Adding a Worm Type

1. Create a new file in `src/worms/` that extends the `Worm` base class.
2. Implement the required lifecycle methods.
3. Register your worm type in `src/core/registry.ts`.

## Adding a Formation

1. Create a new YAML file in `formations/`.
2. Define zones, grid layout, or absolute positions for your agents.
3. Test with `sworm deploy <your-formation>.yaml`.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). Please read it before participating.

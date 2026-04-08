# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| < 0.2   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in Sworm, please report it responsibly.

**Do not open a public issue.** Instead, email **dannygardner26@gmail.com** with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You should receive a response within 48 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Scope

Security concerns particularly relevant to Sworm:

- **Win32 API abuse** — FFI calls via koffi that could be exploited
- **Agent spawning** — unauthorized process execution
- **Cross-machine communication** — when team/sync features are implemented
- **Formation injection** — malicious YAML that executes unintended commands
- **Formation hooks** — `hooks.pre` / `hooks.post` in a formation file run as shell commands during deploy. Interpolation uses `${formation}`; hook processes also receive `SWORM_FORMATION` (and other `SWORM_*` keys derived from the hook context). Treat every formation like executable code: do not run `sworm deploy` on untrusted files.

## User-facing hardening tips

- Prefer formations you authored or reviewed; do not paste unknown YAML into `formations/`.
- Avoid committing secrets into formation YAML; use environment variables for sensitive values where supported.

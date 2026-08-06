This repo is the Server Dashboard project. Project context, decisions, and open work live in the vault — this file just loads them automatically.

## Docs in this repo

None yet — all documentation for this project lives in the vault, loaded below.

| Open this when... | File |
|---|---|
| "What is this, what's decided, what's open?" | vault `instructions.md` / `history.md` / `To-Do.md` — **not** the repo |
| "What's the server itself set up like?" | vault `linux-home-server/instructions.md` (loaded below) |

Add a row here if this repo ever gains a real doc.

@~/.claude/vaults/server-dashboard/instructions.md
@~/.claude/vaults/server-dashboard/history.md
@~/.claude/vaults/server-dashboard/To-Do.md

This dashboard manages the actual Linux home server (`mulderserver`), documented separately in the vault's "Linux Home Server" project. Its reference (hostname, IPs, docker layout, hard rules like warning before `sudo reboot` or `rm -rf`) is small and stable, so it's imported unconditionally:

@~/.claude/vaults/linux-home-server/instructions.md

That project's `history.md` and `To-Do.md` are large (~45KB combined) and mostly cover unrelated sysadmin work (Samba, Immich, the *arr stack, VPN) — not imported by default. If a task needs that deeper history, read them directly from `~/.claude/vaults/linux-home-server/`.

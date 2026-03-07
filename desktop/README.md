# Archestra Desktop

Native desktop app that lets users run Archestra with one click — no need to manually install Docker, Kubernetes, or run CLI commands. Built with [Tauri v2](https://tauri.app/) (Rust + WebView).

This folder is **fully self-contained** and has zero dependencies on the `platform/` codebase. The app is a thin management shell around the existing `archestra/platform` Docker image.

## What It Does

The app manages everything needed to run Archestra locally:

- **Runtime management** — Detects and starts a container runtime automatically (Colima on macOS, WSL2 on Windows, native Docker on Linux)
- **Container lifecycle** — Starts, stops, restarts the `archestra/platform` container with the right ports and volumes
- **Logs inspector** — View container logs with source/level filtering, search, and download
- **Pod manager** — List, restart, delete, and inspect MCP server pods running in the KinD cluster inside the container
- **Drizzle Studio** — Toggle the database browser UI on/off inside the running container
- **Auto-updates** — Checks Docker Hub for new image versions and prompts to pull

```
┌──────────────────────────────────────┐
│        Tauri App (native shell)      │
│  ┌────────────────────────────────┐  │
│  │  WebView UI (Next.js+shadcn) │  │
│  │  ui/src/ (static export)     │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │  Rust Backend                 │  │
│  │  ├── runtime.rs  (VM mgmt)   │  │
│  │  ├── container.rs (Docker)   │  │
│  │  ├── logs.rs     (streaming) │  │
│  │  ├── pods.rs     (kubectl)   │  │
│  │  └── updater.rs  (Hub API)   │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
                  │
    ┌─────────────▼─────────────┐
    │  archestra/platform:latest │
    │  (unchanged Docker image)  │
    └───────────────────────────┘
```

---

## Running Locally (Dev Mode)

### 1. Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 2. Install Node.js

Required for the React frontend. Install via [nvm](https://github.com/nvm-sh/nvm) or [nodejs.org](https://nodejs.org/).

```bash
node --version  # v18+ required
```

### 3. Install Tauri CLI

```bash
cargo install tauri-cli --version "^2"
```

### 4. Install platform-specific system dependencies

**macOS:**
```bash
xcode-select --install
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

**Windows:**
- Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-studio-build-tools/) with the "Desktop development with C++" workload
- Install [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (comes with Windows 11, manual install on Windows 10)

### 5. Install frontend dependencies

```bash
cd desktop/ui
npm install
```

### 6. Run in dev mode

```bash
cd desktop
cargo tauri dev
```

This automatically starts the Next.js dev server (`npm run dev` in `ui/`) and the Rust backend.

First run takes 2-4 minutes (compiling Rust deps). After that, the Rust backend recompiles incrementally (~15-30s) and React changes hot-reload instantly via Next.js Turbopack.

The app window will open automatically. It will try to detect your container runtime and connect to a running Archestra container.

---

## Building Installers

### Build for your current platform

```bash
cd desktop
cargo tauri build
```

First build takes 3-8 minutes. Subsequent builds take 30-90 seconds.

### Output locations

| Platform | Format | Path | Typical Size |
|----------|--------|------|-------------|
| macOS | `.dmg` | `src-tauri/target/release/bundle/dmg/Archestra_0.1.0_*.dmg` | 8-15 MB |
| Windows | `.msi` | `src-tauri/target/release/bundle/msi/Archestra_0.1.0_*.msi` | 5-10 MB |
| Linux | `.AppImage` | `src-tauri/target/release/bundle/appimage/Archestra_0.1.0_*.AppImage` | 10-18 MB |
| Linux | `.deb` | `src-tauri/target/release/bundle/deb/archestra-desktop_0.1.0_*.deb` | 4-8 MB |

### Cross-platform builds

You **cannot** cross-compile Tauri apps. To build for all platforms, you need CI with separate runners for each OS (e.g. GitHub Actions with `macos-latest`, `ubuntu-latest`, `windows-latest`).

### Note on code signing

Currently unsigned. Users will see OS warnings:
- **macOS**: Right-click → Open to bypass Gatekeeper
- **Windows**: Click "More info" → "Run anyway" on SmartScreen
- **Linux**: No signing needed

---

## Project Structure

```
desktop/
├── .gitignore                  # Ignores target/, gen/, .DS_Store
│
├── src-tauri/
│   ├── Cargo.toml              # Rust dependencies (tauri, tokio, reqwest, serde, etc.)
│   ├── build.rs                # Tauri build script (required by Tauri)
│   ├── tauri.conf.json         # App config: window size, ports, bundle settings, plugin permissions
│   ├── capabilities/
│   │   └── default.json        # WebView permission grants (shell, notifications)
│   ├── icons/                  # App icons (add .icns, .ico, .png before building)
│   └── src/
│       ├── main.rs             # Entry point, just calls lib::run()
│       ├── lib.rs              # Registers all Tauri commands and plugins, sets up app state
│       ├── state.rs            # AppState struct, config persistence to ~/.config/archestra-desktop/
│       ├── runtime.rs          # Detects and manages container runtimes (Colima/Lima/Docker/Podman/WSL2)
│       ├── container.rs        # Docker container start/stop/restart, Drizzle Studio toggle
│       ├── logs.rs             # Fetches container logs via `docker logs`, parses source/level
│       ├── pods.rs             # Runs kubectl inside the container to manage KinD pods
│       └── updater.rs          # Compares local image digest with Docker Hub to detect updates
│
└── ui/                         # Next.js + shadcn/ui frontend (static export)
    ├── package.json            # Frontend dependencies (next, react, shadcn, lucide, etc.)
    ├── next.config.ts          # Static export config (output: 'export')
    ├── components.json         # shadcn/ui config (new-york style, neutral base)
    ├── tsconfig.json           # TypeScript config with @/ path alias
    ├── postcss.config.mjs      # PostCSS with Tailwind CSS v4
    └── src/
        ├── app/
        │   ├── layout.tsx      # Root layout with dark mode class
        │   ├── page.tsx        # Main page: sidebar + tab routing + shared state
        │   └── globals.css     # Tailwind v4 + dark theme CSS vars (modern-minimal from platform)
        ├── lib/
        │   ├── utils.ts        # cn() utility for class merging
        │   └── types.ts        # TypeScript interfaces for all Tauri IPC types
        ├── hooks/
        │   └── use-tauri.ts    # Typed wrapper around all Tauri invoke() calls
        └── components/
            ├── ui/             # shadcn/ui primitives (button, card, badge, input, select, dialog, etc.)
            ├── sidebar.tsx     # Navigation sidebar with lucide icons + update indicator
            ├── status-card.tsx # Reusable status card built on shadcn Card
            ├── home-tab.tsx    # Dashboard: runtime/container/image/cluster cards + quick links
            ├── logs-tab.tsx    # Log viewer: shadcn Select filters, search, download
            ├── pods-tab.tsx    # Pod list: badges, actions, Radix Dialog for describe
            ├── database-tab.tsx # Drizzle Studio toggle + open in browser
            └── settings-tab.tsx # Container config with shadcn Input/Label, resource limits
```

---

## How the Rust Backend Works

### Runtime detection (`runtime.rs`)

On startup, the app checks which container runtime is available. Priority order:

1. **Linux**: Native Docker (no VM needed)
2. **macOS**: Colima → Lima → Docker Desktop → Podman
3. **Windows**: Docker Desktop → WSL2 → Podman

The `start_runtime` command launches the VM with configured CPU/memory limits (applies to Colima/Lima only — Docker Desktop manages its own VM).

### Container management (`container.rs`)

Runs the `archestra/platform` image with these defaults:
- Ports: `3000` (frontend), `9000` (backend), `4983` (Drizzle Studio)
- Volumes: `archestra-postgres-data`, `archestra-app-data`, Docker socket
- Env: `ARCHESTRA_QUICKSTART=true`
- Restart policy: `unless-stopped`

All configurable via the Settings tab. Config is persisted to `~/.config/archestra-desktop/config.json`.

### Pod management (`pods.rs`)

Runs `kubectl` commands **inside** the Archestra container (where KinD is running):
```
docker exec archestra -- kubectl get pods ...
```

This avoids needing kubectl installed on the host or merging kubeconfigs.

### Update checking (`updater.rs`)

Compares the local image's `RepoDigests` with the Docker Hub tag API. If digests differ, shows an update notification. Pulling is a single `docker pull` — user then restarts the container to use the new image.

### Log parsing (`logs.rs`)

Fetches logs via `docker logs --timestamps`, then classifies each line by:
- **Source**: backend, frontend, postgres, kind, supervisor, system (based on keywords in the line)
- **Level**: error, warn, info, debug (based on keywords)

Pod-specific logs are fetched via the Archestra backend REST API (`/api/mcp_server/:id/logs`).

---

## How the UI Works (`ui/`)

Built with **Next.js 15 + Tailwind CSS v4 + shadcn/ui + TypeScript**, statically exported for Tauri. Uses the same stack and design system (new-york style, modern-minimal dark theme) as the Archestra platform — but fully self-contained with no shared code. All components are client-only (`"use client"`). Communicates with Rust via Tauri's `invoke()` IPC through a typed `useTauri()` hook.

### Tabs

| Tab | What it shows |
|-----|--------------|
| **Home** | Dashboard with runtime/container/image/cluster status cards, quick links to open frontend/backend/Drizzle in browser |
| **Logs** | Container log viewer with source filter, level filter, text search, auto-scroll, and download button |
| **Pods** | List of MCP server pods with status, restarts, CPU/memory usage. Actions: view logs, describe, restart, delete |
| **Database** | Toggle Drizzle Studio on/off, open in browser |
| **Settings** | Configure image, container name, ports, CPU/memory limits, auto-update preference |

### Auto-refresh

Container status polls every 10 seconds. Update check runs 5 seconds after startup (if auto-update is enabled).

---

## Before You Build: Add Icons

Tauri requires app icons. Generate them from a 1024x1024 PNG:

```bash
cargo tauri icon path/to/your-icon.png
```

This creates all required sizes in `src-tauri/icons/`. Without icons, `cargo tauri build` will fail.

---

## Relationship to Platform

This app is **decoupled** from the `platform/` codebase:

- No shared code, no shared dependencies, no imports between them
- The Docker image (`archestra/platform:latest`) is the only interface
- Updating the platform means pushing a new Docker image — the desktop app detects it and prompts the user
- The desktop app only needs a new release when the shell UI or management features change

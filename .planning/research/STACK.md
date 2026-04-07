# Technology Stack

**Project:** AI Traffic Controller (AITC)
**Researched:** 2026-04-07
**Overall Confidence:** HIGH

## Recommended Stack

### Core Shell: Tauri v2

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Tauri | ^2.10 | Desktop shell, native APIs, system tray | Lighter than Electron (~5MB vs ~150MB), Rust backend for CPU-intensive file watching, IPC for frontend-backend communication. Already decided in PROJECT.md. | HIGH |
| tauri-specta | ^2.0 | Type-safe Rust-to-TypeScript bridge | Generates TS bindings from Rust commands at build time. Eliminates the #1 Tauri pain point: manually keeping invoke() calls in sync with Rust signatures. Compile-time safety across the IPC boundary. | HIGH |

### Frontend Framework

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| React | ^19.2 | UI framework | Current stable (19.2.4). React 19's concurrent features (useTransition, Suspense) are critical for keeping the radar responsive while processing high-frequency file events. Already decided in PROJECT.md. | HIGH |
| TypeScript | ^5.7 | Type safety | Non-negotiable for a project with complex data flowing between Rust and React. | HIGH |
| Vite | ^8.0 | Build tool / dev server | Vite 8 ships Rolldown (Rust-based bundler) for 10-30x faster builds. Default Tauri scaffolding uses Vite. HMR for rapid UI iteration on the design system. | HIGH |

### State Management

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Zustand | ^5.0 | Global application state | 3KB, no providers, selector-based subscriptions prevent re-render cascades from high-frequency file events. Perfect for the "many stores" pattern: one store per domain (agents, conflicts, comms, radar). Dominant React state library in 2025-2026 (150% YoY growth). | HIGH |

**Why not Jotai?** Jotai's atomic model excels for deeply nested derived state but adds cognitive overhead for this project's relatively flat domain model. Zustand's single-store-per-domain pattern maps directly to AITC's screens (Airspace, Tower, Comms, Conflicts).

**Why not Redux Toolkit?** 5x the bundle size (~15KB), excessive boilerplate for a desktop app with no server-side requirements. RTK's middleware system is overkill here.

### Styling

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Tailwind CSS | ^4.2 | Utility-first CSS | v4 is CSS-first (no JS config). Custom dark theme via CSS `@theme` block maps perfectly to Command Horizon's surface hierarchy tokens. Incremental builds in microseconds. | HIGH |
| CSS custom properties | native | Design token system | Command Horizon's color system (surface tiers, phosphor greens, status colors) maps to CSS variables. Tailwind v4's `@theme` directive consumes these natively. | HIGH |

**Why not CSS-in-JS (styled-components, Emotion)?** Runtime CSS generation adds latency to every render. In a real-time dashboard updating at 60fps, this is unacceptable. Tailwind generates all CSS at build time.

**Why not shadcn/ui?** Command Horizon's design system is heavily custom (zero-radius, no borders, phosphor glows, radar indicators). shadcn components would need to be gutted and restyled -- more work than building purpose-built components. Import individual Radix UI primitives when needed instead.

### Data Visualization

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Canvas 2D API (native) | n/a | Radar display, agent trajectory rendering | The ATC radar is a custom, continuously-animating visualization (sweeping arcs, pulsing dots, trajectory lines). No charting library models this. Raw Canvas 2D gives full control over the render loop at 60fps with minimal overhead. | HIGH |
| @visx/scale, @visx/shape | ^3.12 | Coordinate math, scale utilities | Use visx as a math library (scales, coordinate transforms, path generators) without its SVG rendering. Feed computed coordinates into the Canvas renderer. Tree-shakable -- only import what you use (~2-5KB). | MEDIUM |
| React-Konva | ^18.2 | Interactive canvas elements (agent cards, tooltips) | Konva provides a scene graph with hit detection, drag/drop, and event bubbling on Canvas. Use for interactive overlays on the radar (clicking agents, dragging boundaries). Not for the radar sweep itself. | MEDIUM |

**Why not ECharts/Recharts/ApexCharts?** These are chart libraries for bar/line/pie charts. The AITC radar is a custom spatial visualization (file-tree-as-geography with agent dots). No charting library supports this paradigm. Using one would mean fighting the abstraction constantly.

**Why not PixiJS?** WebGL is overkill for 2D dots and lines. PixiJS excels at sprite-heavy game rendering. Canvas 2D handles the radar's rendering needs with simpler code, smaller bundle, and no WebGL context management.

**Why not pure D3?** D3 fights React for DOM control. visx solves this by providing D3's math as React-friendly utilities. Use visx for scales/paths and React for rendering.

### Icons

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Lucide React | ^1.7 | UI icons | Stroke-based SVG icons with configurable `strokeWidth`. Set to 1px or 1.5px globally to match Command Horizon's "thin-stroke linear icons" requirement. Tree-shakable (import only used icons). | HIGH |

### Animation

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Motion (formerly Framer Motion) | ^12.0 | UI transitions, phosphor effects | Hardware-accelerated via Web Animations API (120fps). Perfect for Command Horizon's "Phosphor Transitions" (150ms opacity fade + scanline wipe) and ambient glow animations. Layout animations for panel resizing. | HIGH |

**Why not CSS animations only?** CSS handles simple transitions, but Command Horizon requires orchestrated multi-property animations (opacity + transform + glow simultaneously), presence animations (AnimatePresence for mount/unmount), and layout animations. Motion handles all three; CSS cannot orchestrate presence.

### Virtualization

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| @tanstack/react-virtual | ^3.13 | Large file lists, session history | The file tree and session history could have 10K+ items. TanStack Virtual renders only visible items at 60fps. Headless (no imposed styles), which is required for Command Horizon's custom table styling. | HIGH |

### Database (Rust Backend)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| SQLite (via sqlx) | sqlx ^0.8 | Session history, conflict logs, approval records | SQLite is the right choice for a single-user desktop app. No server process, single file, ACID transactions. sqlx provides compile-time checked queries (catches SQL errors at build time, not runtime). | HIGH |
| tauri-plugin-sql | ^2.3 | Frontend DB access for reads | Provides JS API for simple queries from the frontend. Use for read-only dashboard queries. All writes go through Rust commands for validation. | MEDIUM |

**Why sqlx over diesel?** sqlx checks raw SQL at compile time without a DSL. Diesel requires learning a custom query builder. For AITC's relatively simple schema (agents, sessions, conflicts, approvals), raw SQL with compile-time checking is simpler and more maintainable.

**Why not tauri-plugin-sql for everything?** The plugin is convenient for reads but provides no validation layer. Writes (creating sessions, resolving conflicts) should go through typed Rust commands that validate data before persisting.

### Filesystem Watching (Rust Backend)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| notify | ^8.2 (stable) | Cross-platform filesystem events | The de facto Rust filesystem watcher. Used by rust-analyzer, deno, cargo-watch. Supports Windows (ReadDirectoryChangesW), macOS (FSEvents), Linux (inotify). Debouncer included for batching rapid events. | HIGH |
| notify-debouncer-full | ^0.4 | Event debouncing and deduplication | Batches rapid file events (common during agent writes) into deduplicated events with configurable delay. Prevents flooding the frontend with hundreds of events per second during bulk writes. | HIGH |

**Why not chokidar (Node.js)?** Tauri's backend is Rust. Using chokidar would require a Node.js sidecar process -- unnecessary complexity and resource usage. notify-rs is native Rust, zero-overhead integration with Tauri commands. Chokidar v5 is also ESM-only which complicates bundling.

**Why not Tauri's built-in fs-watch plugin?** The plugin provides basic watching but lacks the debouncing, filtering, and event batching needed for monitoring 10K+ file codebases. Building on notify directly gives full control over event processing in the Rust backend.

### Rust Supporting Crates

| Crate | Version | Purpose | Why | Confidence |
|-------|---------|---------|-----|------------|
| serde + serde_json | ^1.0 | Serialization | Standard Rust serialization. Required for IPC between Rust and frontend. | HIGH |
| tokio | ^1.0 | Async runtime | Tauri v2 uses tokio internally. All async Rust code (file watching, DB queries) runs on tokio. | HIGH |
| tauri-specta | ^2.0 | Type-safe IPC | Generates TypeScript types from Rust command signatures. Eliminates manual type sync. | HIGH |
| specta | ^2.0 | Type export | Underlying type export engine for tauri-specta. | HIGH |
| chrono | ^0.4 | Timestamp handling | Session start/end times, conflict timestamps, event logs. | HIGH |
| tracing | ^0.1 | Structured logging | Production-grade logging for debugging filesystem events and agent interactions. | HIGH |

### Fonts

| Font | Source | Purpose | Why | Confidence |
|------|--------|---------|-----|------------|
| Space Grotesk | Google Fonts (self-hosted) | Headlines, navigation, labels | Specified by Command Horizon design system. Architectural, technical aesthetic with wide letter-spacing. | HIGH |
| JetBrains Mono | JetBrains (self-hosted) | Code, agent IDs, coordinates, monospace data | Superior readability for dense data tables and code strings. Ligatures for code display. Better than generic monospace. | HIGH |

**Self-host both fonts** in the Tauri bundle. No external CDN calls from a desktop app.

## Full Installation

### Frontend (npm)

```bash
# Core
npm install react react-dom
npm install zustand
npm install motion
npm install lucide-react
npm install @tanstack/react-virtual
npm install @visx/scale @visx/shape @visx/group
npm install react-konva konva

# Dev
npm install -D typescript @types/react @types/react-dom
npm install -D vite @vitejs/plugin-react
npm install -D tailwindcss @tailwindcss/vite
npm install -D @tauri-apps/cli
```

### Backend (Cargo.toml)

```toml
[dependencies]
tauri = { version = "2.10", features = ["tray-icon", "devtools"] }
tauri-plugin-sql = { version = "2.3", features = ["sqlite"] }
tauri-specta = { version = "2.0", features = ["derive", "typescript"] }
specta = { version = "2.0", features = ["derive"] }
notify = "8.2"
notify-debouncer-full = "0.4"
sqlx = { version = "0.8", features = ["runtime-tokio", "sqlite"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1.0", features = ["full"] }
chrono = { version = "0.4", features = ["serde"] }
tracing = "0.1"
tracing-subscriber = "0.3"
```

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Desktop shell | Tauri v2 | Electron | 30x larger binary, higher memory usage, no Rust backend for file watching perf |
| State management | Zustand | Redux Toolkit | 5x bundle size, boilerplate overhead, no advantage for desktop app |
| State management | Zustand | Jotai | Atomic model adds complexity for AITC's flat domain; Zustand's store-per-domain is simpler |
| Styling | Tailwind CSS v4 | styled-components | Runtime CSS generation hurts real-time dashboard performance |
| Styling | Custom components | shadcn/ui | Command Horizon is too custom; would gut and restyle every component |
| Radar viz | Canvas 2D + visx math | ECharts | No charting library supports ATC-style spatial radar |
| Radar viz | Canvas 2D | PixiJS (WebGL) | WebGL overkill for 2D dots/lines; adds GPU context complexity |
| Canvas interaction | React-Konva | Fabric.js | Konva has better React integration and scene graph model |
| Icons | Lucide | Heroicons | Lucide offers configurable stroke-width; Heroicons are fixed at 1.5/2px |
| Animation | Motion v12 | react-spring | Motion has better presence animations (AnimatePresence) and layout animations |
| DB ORM | sqlx (raw SQL) | Diesel | Diesel's DSL is overkill; sqlx's compile-time SQL checking is simpler |
| FS watching | notify (Rust) | chokidar (Node) | Native Rust integration with Tauri; no Node sidecar needed |
| Build tool | Vite 8 | Webpack | Vite 8's Rolldown is 10-30x faster; default Tauri tooling |
| Fonts | JetBrains Mono | Fira Code | JetBrains Mono has better readability at small sizes for dense data |

## Architecture Notes for Stack

**Data Flow: Filesystem Events to UI**
```
notify (Rust) --> debouncer --> Tauri command/event --> Zustand store --> React component --> Canvas render
```

All filesystem processing happens in Rust. The frontend receives pre-processed, debounced events via Tauri's event system. This keeps the UI thread free for rendering.

**Store Architecture (Zustand)**
```
agentStore     - Active agents, statuses, positions
radarStore     - Viewport state, zoom, pan, animation frame
conflictStore  - Detected conflicts, resolution state
commsStore     - Approval requests, message queue
sessionStore   - Historical data, filters
settingsStore  - User preferences, watched directories
```

Each store is independent. Components subscribe to specific slices. A file event updates agentStore; only Radar and Tower components re-render.

**Canvas Rendering Pattern**
```
useAnimationFrame() hook --> read from Zustand (no subscription, use getState()) --> draw to Canvas
```

The radar uses a manual render loop (requestAnimationFrame) reading from Zustand's getState() to avoid React re-renders entirely. React manages the Canvas element lifecycle; the render loop manages what's drawn on it.

## Sources

- [Tauri v2 Releases](https://v2.tauri.app/release/) - Tauri v2.10.3 confirmed
- [Tauri SQL Plugin](https://v2.tauri.app/plugin/sql/) - Official plugin docs
- [tauri-specta GitHub](https://github.com/specta-rs/tauri-specta) - Type-safe IPC bridge
- [notify-rs GitHub](https://github.com/notify-rs/notify) - notify 8.2.0 stable
- [React Versions](https://react.dev/versions) - React 19.2.4
- [Vite Releases](https://vite.dev/releases) - Vite 8.0 with Rolldown
- [Zustand npm](https://www.npmjs.com/package/zustand) - Zustand 5.0.12
- [visx GitHub](https://github.com/airbnb/visx) - visx 3.12.0
- [Motion (Framer Motion)](https://motion.dev) - Motion v12
- [TanStack Virtual](https://tanstack.com/virtual/latest) - Headless virtualization
- [Tailwind CSS v4](https://tailwindcss.com/blog/tailwindcss-v4) - v4.2.2
- [Lucide Icons](https://lucide.dev/) - v1.7.0, configurable stroke-width
- [Konva.js](https://konvajs.org/) - Declarative canvas scene graph
- [sqlx docs.rs](https://docs.rs/sqlx/latest/sqlx/) - v0.8.6

# Design System Strategy: The Command Horizon

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Command Horizon."** 

In an air traffic control environment, the room is dark so the data can shine. This system is not a "website"—it is a high-performance instrument cluster for managing autonomous intelligence. We are moving away from the "friendly SaaS" aesthetic toward a **Tactical Editorial** style. This is achieved through intentional asymmetry, zero-radius corners (0px) to imply precision engineering, and a focus on "Light as Information." Every pixel of color must represent a state, a pulse, or a priority. We do not use color for decoration; we use it for orientation.

## 2. Colors
Our palette is rooted in the "Dark Room" philosophy. The background is not merely black; it is a deep, obsidian void that allows neon status indicators to pop with "retina-searing" clarity.

### The "No-Line" Rule
Standard UI relies on 1px borders to separate ideas. In this system, **borders are prohibited for sectioning.** Boundaries must be defined through:
*   **Tonal Shifts:** Placing a `surface-container-low` (#131313) panel against the `surface` (#0e0e0e) background.
*   **Negative Space:** Using wide gutters to create "islands" of data.
*   **The Edge of Light:** A container’s edge is defined by the end of its background color, not a stroke.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. Use the surface tiers to create a sense of optical depth:
*   **Base Level:** `surface-container-lowest` (#000000) for the primary application backdrop.
*   **Primary Panels:** `surface-container` (#1a1919) for the main workspace.
*   **Elevated Widgets:** `surface-container-high` (#201f1f) or `highest` (#262626) for pop-overs or focused agent cards.

### The "Glass & Gradient" Rule
To prevent the UI from feeling "flat" or "cheap," use Glassmorphism for floating elements (like command palettes or tooltips). Apply `surface-variant` (#262626) at 60% opacity with a heavy `backdrop-filter: blur(20px)`. 

### Signature Textures
For primary actions, do not use flat fills. Use a subtle linear gradient from `primary` (#8eff71) to `primary-container` (#2ff801) at a 45-degree angle. This mimics the "glow" of a phosphorus monitor.

## 3. Typography
The typography is a dialogue between **Space Grotesk** (The Human Interface) and a high-density Monospace logic (The Machine Data).

*   **Display & Headlines (Space Grotesk):** Used for high-level orientation. These should feel architectural and authoritative. Use wide letter-spacing (0.05em) for `headline-sm` to evoke a technical manual aesthetic.
*   **Data & Code (Monospace/Inter Logic):** While `inter` is our body face, all agent IDs, coordinates, and code strings must be rendered in a monospace variant. 
*   **Hierarchy as Signal:** Use `label-sm` (#0.6875rem) in `on-surface-variant` (#adaaaa) for metadata. The small size suggests high information density, rewarding the "expert" user who knows where to look.

## 4. Elevation & Depth
In a dark room, shadows are cast by the UI itself. 

*   **The Layering Principle:** Depth is achieved by stacking. A `surface-container-low` section sitting on a `surface` background creates a soft, natural lift. 
*   **Ambient Glows:** Traditional "drop shadows" are replaced by "Ambient Glows." When an element is active (e.g., a selected Agent Card), apply a shadow with the color of the status (e.g., `primary` at 10% opacity) with a 40px blur. The element should look like it is illuminating the desk beneath it.
*   **The "Ghost Border" Fallback:** If a container absolutely requires a boundary for accessibility, use a **Ghost Border**: `outline-variant` (#494847) at 15% opacity. It should be felt, not seen.

## 5. Components

### Buttons (Tactical Switches)
*   **Primary:** Rectangular (0px radius). Background: `primary` (#8eff71). Text: `on-primary` (#0d6100). On hover, add a 10px outer glow of the same color.
*   **Secondary:** Ghost style. No fill, `outline` (#777575) at 20% opacity. Text: `secondary` (#00cffc).

### Status Indicators (The Pulse)
*   Do not use simple circles. Use **Radar Indicators**: A central dot of `primary` or `tertiary` surrounded by two concentric "ping" rings at 10% opacity that subtly pulse in scale.

### Data Tables (The Manifest)
*   **Rule:** Forbid all horizontal and vertical dividers.
*   **Separation:** Use a `surface-container-low` background on every second row (zebra striping) or use a `primary` vertical sliver (2px wide) on the far left of a row only upon `hover`.
*   **Density:** Use `body-sm` for table cells to maximize information per square inch.

### Input Fields (The Terminal)
*   Inputs should resemble terminal prompts. Use a `surface-container-lowest` fill and a `ghost border`. The cursor should be a solid block of `secondary` (#00cffc) that blinks.

### Radar Visualizations (Custom Component)
*   For agent management, use circular radar plots. Use `outline-variant` for the circular grid lines at 10% opacity. Agents are plotted as high-contrast `primary` or `error` dots with "lead lines" (thin 0.5px paths) showing their trajectory or parent process.

## 6. Do's and Don'ts

### Do
*   **Do** use 0px border radii for everything. Roundness suggests consumer-grade softness; sharp corners suggest professional-grade precision.
*   **Do** use "Phosphor Transitions": When an element appears, use a quick 150ms opacity fade combined with a subtle vertical "scanline" wipe.
*   **Do** prioritize "Glanceability." A user should know if the system is "Healthy" (Green) or "In Conflict" (Amber) from 10 feet away.

### Don't
*   **Don't** use pure white (#FFFFFF) for body text. Use `on-surface-variant` (#adaaaa) to reduce eye strain in the dark room aesthetic. Reserve pure white for critical headers.
*   **Don't** use standard shadows. If it's not a glow, it doesn't exist in this environment.
*   **Don't** use icons with fills. Use thin-stroke (1px or 1.5px) linear icons to match the high-density Monospace vibe.
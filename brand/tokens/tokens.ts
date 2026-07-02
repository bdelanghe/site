// AUTO-GENERATED from tokens/tokens.json by Style Dictionary (npm run build:sd).
// Do not edit by hand — drift-checked by `npm run tokens:ts:check`.

export const tokens = {
  primitive: {
    "green-700": "#0c5a42", // Brand green
    "green-900": "#073d2c", // Deep green
    "green-100": "#e2ebe6", // Green wash
    "green-200": "#d2e0d8", // Green soft
    "green-300": "#bbd1ca", // Muted mint — text on forest (AA, 5.1:1)
    "green-500": "#58b196", // Bright sage — hairline/border on forest (non-text AA, 3.19:1; CVD-safe)
    "green-600": "#5f8971", // Deep sage — functional border/divider on LIGHT surfaces (non-text AA ≥3:1 on white/paper/tint; CVD-safe)
    paper: "#edeae1", // Warm paper
    white: "#ffffff",
    cream: "#f4f1ea", // Warm off-white
    "ink-900": "#16221c", // Near-black ink
    "ink-600": "#5c6b63", // Muted ink
    "ink-500": "#5e6b62", // Mono-label ink (WCAG-AA on paper)
    line: "#888374", // Hairline / divider — warm grey, non-text AA ≥3:1 on white/paper/cream (CVD-safe)
    "clay-600": "#9f3e2b", // Clay — text AA + CVD-safe (≥4.5:1 under deuteranopia/protanopia/tritanopia on paper & clay wash)
    "clay-100": "#f2ded8", // Clay wash
    "amber-600": "#8c5818", // Amber — text AA + CVD-safe (≥4.5:1 under deuteranopia/protanopia/tritanopia on paper & amber wash)
    "amber-100": "#f3e8d6", // Amber wash
  },
  color: {
    forest: "#0c5a42", // Primary brand fill
    "forest-deep": "#073d2c", // Pressed / deep surfaces
    paper: "#edeae1", // App background, warm
    card: "#ffffff", // Card surface
    "card-alt": "#f4f1ea", // Light avatar fill
    ink: "#16221c", // Primary text
    "ink-soft": "#5c6b63", // Secondary text
    "ink-mono": "#5e6b62", // Mono label / slug text
    line: "#888374", // Hairline borders
    white: "#ffffff", // Mark on forest
    "forest-tint": "#e2ebe6", // Subtle tinted surface
    "forest-soft": "#5f8971", // Functional border/divider on light surfaces (non-text AA ≥3:1; was green-200 — split out so on-forest text can stay light while borders meet 1.4.11)
    "on-forest": "#d2e0d8", // Primary text on the forest panel (AA, 6.0:1)
    "on-forest-soft": "#bbd1ca", // Muted text / eyebrow on forest (AA, 5.1:1)
    "on-forest-line": "#58b196", // Hairline / border on forest — functional non-text contrast (AA ≥3:1, CVD-safe)
    clay: "#9f3e2b", // Accent / negative
    "clay-tint": "#f2ded8", // Negative surface
    amber: "#8c5818", // Caution / highlight
    "amber-tint": "#f3e8d6", // Caution surface
  },
  font: {
    display: ["Space Grotesk","sans-serif"], // Headings & UI
    mono: ["IBM Plex Mono","monospace"], // Labels, slugs, code
  },
  size: {
    "text-h1": "46px",
    "text-h2": "26px",
    "text-title": "18px",
    "text-body": "16px", // Body — 16px so primary body text clears the APCA size-aware comfort tier (Lc ≥90 at 16px) on paper/card, not just WCAG-2 AA. Was 15px (sub-16 → APCA floor Lc 100, unreachable).
    "text-label": "11px",
  },
  radius: {
    "radius-lg": "18px", // Cards, large surfaces
    "radius-md": "12px", // Inputs, small surfaces
  },
  control: {
    "min-tap-target": "24px", // WCAG 2.2 SC 2.5.8 (AA) minimum pointer-target side — the floor. Apply as min-width/min-height on any interactive control.
    sm: "36px", // Compact control (chips, dense toolbars) — clears 2.5.8 AA (24px) with margin.
    md: "44px", // Default control — meets 2.5.5 (AAA, 44px) and Apple HIG / Material touch-target guidance.
    lg: "52px", // Prominent / primary control.
  },
  grade: {
    enforced: "#3fb984", // Proven/enforced in running code
    partial: "#c8902f", // Partially enforced
    aspirational: "#7e8c83", // Aspirational / not yet enforced
  },
  text: {
    h1: {"fontFamily":["Space Grotesk","sans-serif"],"fontSize":"46px","fontWeight":600,"lineHeight":1.02,"letterSpacing":"-0.025em"},
    h2: {"fontFamily":["Space Grotesk","sans-serif"],"fontSize":"26px","fontWeight":600,"lineHeight":1.1,"letterSpacing":"-0.02em"},
    title: {"fontFamily":["Space Grotesk","sans-serif"],"fontSize":"18px","fontWeight":600,"lineHeight":1.3,"letterSpacing":"-0.01em"},
    body: {"fontFamily":["Space Grotesk","sans-serif"],"fontSize":"16px","fontWeight":400,"lineHeight":1.5,"letterSpacing":"0"},
    label: {"fontFamily":["IBM Plex Mono","monospace"],"fontSize":"11px","fontWeight":500,"lineHeight":1,"letterSpacing":"0.14em","textTransform":"uppercase"}, // Slug / eyebrow: mono uppercase tracked label.
  },
} as const;

/** The full, resolved token tree. */
export type Tokens = typeof tokens;

/** Top-level token categories: `primitive` | `color` | `font` | `size` | `radius` | `control` | `grade` | `text`. */
export type TokenCategory = keyof Tokens;

/** Every fully-qualified token name, e.g. `color.forest`. */
export type TokenName = {
  [C in TokenCategory]: `${C}.${Extract<keyof Tokens[C], string>}`;
}[TokenCategory];

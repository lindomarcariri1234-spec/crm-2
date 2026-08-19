---
name: Recharts React 19 type fix
description: How to fix Recharts 2.x class-component type incompatibility with React 19 TypeScript types in the visitecrm project.
---

# Recharts React 19 TypeScript Fix

## The Rule
Recharts 2.x components extend React.Component but their TypeScript declarations are incompatible with React 19 types (which dropped `context, setState, forceUpdate, props, state` from the required Component interface). This causes TS2607/TS2786 JSX errors on every Recharts component.

## Fix Applied
Created `artifacts/visitecrm/src/types/recharts.d.ts` that overrides the recharts module, declaring all components as `any`. This file is picked up automatically because visitecrm tsconfig includes `"src/**/*"`.

## Side Effect: Callback noImplicitAny
When recharts components become `any`, TypeScript cannot contextually type inline callback parameters. Add explicit types to affected callbacks:
- `tickFormatter={(v: number) => ...}` (YAxis, XAxis)
- `formatter={(v: number, name: string) => ...}` (Tooltip)
- `onMouseEnter={(_: unknown, idx: number) => ...}` (Pie)
- `content={({ payload, label }: { payload: Array<Record<string, any>>; label: string }) => ...}` (Tooltip)

## Other chart.tsx Fixes
- Replace `Pick<RechartsPrimitive.LegendProps, "payload" | "verticalAlign">` with inline `{ payload?: Array<Record<string, any>>; verticalAlign?: "top" | "middle" | "bottom" }` since LegendProps is no longer exported.
- Cast `payload` to `Array<Record<string, any>>` before `.filter()` / `.map()` calls.

**Why:** React 19 TypeScript types changed the Component class signature; Recharts 2.x was not updated; upgrading recharts would require significant testing; module override is the least-invasive fix.

**How to apply:** If recharts JSX errors reappear after updating recharts, check if they ship their own React 19–compatible types (recharts 3.x planned to fix this). Until then, keep the `src/types/recharts.d.ts` override.

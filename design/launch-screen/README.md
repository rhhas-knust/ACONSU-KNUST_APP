# Launch screen — Continuance

The Android launch artwork in `android/app/src/main/res/drawable*/splash.png` is
generated, not drawn. This directory holds what generated it so it can be
reproduced or changed rather than being an opaque binary nobody can edit.

- `CONTINUANCE.md` — the algorithmic philosophy behind the piece.
- `continuance.html` — the generator. Open it in any browser; no build, no
  server. It pulls p5.js from a CDN.

## Reproducing the shipped artwork

The splash assets are **seed 860** with these parameters:

| Parameter     | Value  |
|---------------|--------|
| Generations   | 5      |
| Cohort Size   | 500    |
| Lifespan      | 140    |
| Field Detail  | 0.0012 |
| Inheritance ° | 5      |
| Drift Speed   | 1.1    |
| Successors    | 2      |
| Trail Weight  | 1.0    |
| Handover Glow | 0.45   |

Colours are ACONSU's own: `#241530` ground, `#F6EEFB` lineage, `#E8971E`
handover. The same seed always reproduces the same image, so those values are
enough to get the exact artwork back.

## Changing it

Open the generator, walk the seeds, and tune. It is calmer than the defaults on
purpose: a launch screen needs negative space behind the app name. The eleven
density files are each rendered natively at their own aspect ratio rather than
being scaled from one master, so the composition fits every frame instead of
being stretched or cropped.

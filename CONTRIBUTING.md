# Contributing

Thank you for helping. Issues and pull requests are welcome: new examples, better drawings, fixes to the kit, clearer references.

## Working on it

```sh
npm test                                              # the kit, the simulator against queueing theory, every example's audit
node skills/dissect/examples/<name>/build.mjs --audit  # rebuild one example
node tools/gallery.mjs [<name>]                        # rebuild the pages and the README images
```

The browser scripts (`skills/dissect/scripts/capture.mjs`, `drive.mjs`) need Chrome or Chromium; set `CHROME_PATH` if it is not found.

## Rules the project keeps

- **No dependencies.** The kit and the scripts use Node's built-in modules and the browser only.
- **The inliner's style.** Runtime modules (`rng`, `dist`, `geom`, `model`, `sim`, `replay`, `live`) use single-line `import { a, b } from "./x.mjs"` and `export function`, `export const` or `export class` only, so `page.mjs` can inline them into one script.
- **The simulator is the truth.** The page draws what the log says and nothing else. A change to the simulator comes with a test, ideally one against theory.
- **Every number in an example is generated.** Captions come from `figure.caption`; statements about the numbers go in `claims`; examples pass their audit with no warnings, on a seed close to the median.
- **Look at it.** A change to the drawing comes with captures at 1280 and 390 px, light and dark, and you have read them.
- **Plain words.** Interface text and documentation say what things do, in sentence case, without slogans; no long dashes.

## A new example

Copy the closest one. Write the lesson first (one sentence and the click that proves it), then the model with real or stated numbers, calibrate it on several seeds, generate the caption, pass the audit, drive the what-if the caption promises, and add the example to `SKILL.md`, the README gallery and `tools/gallery.mjs`.

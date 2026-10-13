# The live page

What a built figure does in the browser, and the knobs you have. Everything moves from the simulator's log: the page draws, it never invents.

## Playback

- **The clock.** Model time advances at `pace` (model time per second) times the speed (0.25× to 16×, the speed button or `+` and `-`). The simulator runs a few seconds ahead of the clock; the replay applies the log up to the clock each frame.
- **Pace.** By default a typical item crosses the top level in about 12 seconds at 1×. Set `figure.pace` when the lesson needs a scale of its own.
- **Levels have their own time.** Opening a step slows the clock to that step's scale (its typical time inside, over eight), and going back up restores it. The readout says so ("time ×1/40") and so does the screen reader. Pass `levelPace: { "<path>": pace }` to fix a level's pace by hand.
- **Glides.** A hop with no latency happens in no model time; the page glides the dot along the route for a moment (about a third of a second) so the eye can follow it, then shows it where it truly is. A route with latency is traveled at the clock's pace: there the motion is the model.
- **The end of a run.** When everything has drained after the horizon, a fresh run starts (the next seed): the reader sees that the next day is a little different. Restart goes back to the figure's own seed.
- **Off screen, it stops.** Hidden tabs and figures scrolled away do not run.

## The instrument around the drawing

Every figure has the same controls, built into its card, so a reader who has used one has used them all:

- **The level bar**, at the top of the drawing while a step is open: the path back up (each level a button) and **Close** (one level up; Escape does the same). Opening a step zooms toward it; closing zooms back out to it.
- **The strip of keys**, at the bottom of the drawing: play and pause, step to the next event, the speed, the three layers (Flow, Time, Failures) and restart, with the readout on the right (model time, done, in flight, the median, and the time scale when a level runs slower; with `figure.watch`, the share of the watched kind served lately instead of what is done).
- **Switches**, on the plates of the parts the model lets the reader turn off, and **settings panels**, which open on the figure next to a part that has dials or servers that scale (below).
- **The inspector**, beside the drawing on a wide card and under it on a narrow one.

None of them covers the drawing, and none scrolls away when the drawing scrolls sideways on a phone. Do not add controls of your own around a figure; use its handle and its events (below).

## What the reader sees

- Items are dots in the color of their kind (`classes`); red after they fail, until they are routed; orange when followed. In work they sit in a bay of their station (one bay per server, in two rows from four servers), with the bay filling as the work is done; at a step with no limit they sit in a row. Waiting, they line up on the queue rail, one tick per place and "+n" past six. At a timer they ride its rim, as far round as their wait has gone. Inside an open step they are drawn small in its window.
- Stations: a lamp (grey idle, green busy, orange work waiting, red down), a gauge (busy share so far), counters (✓ done, ✗ failed or timed out or turned away), set smaller when they outgrow their room and on two lines when they still do. A station that scales has a bay for every server it can have: solid while it runs, dashed and pulsing orange while it starts, faint while it is not there.
- A part that is switched off has a dashed outline, its switch to the left and grey, and "switched off" for its spec; items glide straight through it.
- Choices: the needle points at the way the last item took. Ends count what reached them.
- A hop lights its rail for a moment (at most once a second per rail).
- Words are fitted to the reader's font when the page loads: a name, a spec or a lane label that would not fit its room in a wider font is set a little smaller, and only then cut, with the whole words in its tooltip. Tags grow to hold their words.

## The inspector

Beside the drawing on a wide card, under it on a narrow one. With nothing selected: the process, its numbers so far (done, in flight, median and p95 time), how each kind of item fared lately when there are several ("pages: 97% served, 2% served at the edge, 1% blocked", over the last twentieth of the horizon, or the watch's window) and where the waiting is ("Most of the waiting is for Code review: 72% of it, 15 min per item on average, busy 81% of the time"). It describes and counts; a part's settings are on the figure, with the part. Click or focus a part: what it is (`about`), its rule in words, its live numbers, and its what-ifs. Inside an open level: that level's own numbers.

## Switches and settings

A switch turns a part off from the moment it is clicked (or focused and given Enter or Space), and back on the same way.

A part with dials, or with servers that scale, has a settings badge, and a click on it (on the badge, for a step that opens into a level; or Enter on the focused part) opens its settings panel on the figure, next to the part: under it, else over it, and at the bottom of the drawing on a narrow card. The panel says what the part is doing now (a scaling station's servers as a row of cells, running, starting or not there, and its policy in words; a start's rate), then its dials as rows of options, then its switch if it has one. The close key, Escape (which gives the focus back to the part), a click on the empty sheet, another part, or another level closes it. Both apply from that moment like what-ifs: the run before stays as it was, the consequence plays out from there, and the polite live region says what changed ("Challenge is off: everything passes straight through it."). They hold for the rest of the run, and a new run (the next seed, or Restart) starts with them where the reader left them. "Undo what-ifs" puts them back as the model has them. The handle sets them too: `toggle(path)`, `setDial(path, i, option)` and `settings(path)` (open a part's panel; `settings(null)` closes it), and `state().settings` and `state().panel` read them.

## What-ifs

A what-if re-runs the model with a change from the current moment on. Everything before stays exactly as it was (each part has its own random stream), so the reader sees the consequence and only the consequence. They accumulate; "Undo what-ifs" removes them all (the picture then jumps to the run as modelled, at the same moment).

| Part | What-ifs |
|---|---|
| Station with limited capacity | One more at a time, one fewer, an outage (`figure.outage` long; an eighth of the horizon by default). A station that scales has only the outage: its dials set the rest |
| Station with a work time | Twice as slow, twice as fast; never fails (when it can fail) |
| Start | 50% more work, half the work, a burst (three times the work for `burst`, a tenth of the horizon by default), and half of each kind when there are several (`Half the noise`) |
| Choice by chance | The rarer way twice as often, half as often (not where the odds differ by kind) |
| Timer | Wait twice as long, half as long |

The step the caption points at must have the what-if the caption promises.

## Following

Click a dot to follow it: it turns orange with a halo, its trail is drawn, and the inspector lists its journey in plain words with times ("2 h 36 min: healthy?: on to Roll out"). When it goes inside a step, the view goes in with it (and comes back out); "Stay on this level" turns that off. Escape stops following. When nobody has touched the figure for a few seconds, it follows an item by itself, quietly (no view changes), and stops at the first touch.

## Layers

- **Flow**: the default.
- **Time**: each station's bar shows where an item's time goes there, waiting (orange) then working (grey), on a common scale, and its line says how long items wait.
- **Failures**: the rails that carry failed work turn red and the others fade; each station says how much of its work came out failed (in its `failLabel` words).

## Keyboard and screen readers

- Tab moves through the parts; each has a full description as its label (what it is, its capacity and times, its `about`). Focus selects it.
- Enter opens a step with a window; Escape goes back up (or stops following, or clears the selection). Arrow keys move to the nearest part in that direction.
- Space plays and pauses, `.` steps to the next event, `+` and `-` change the speed, `f` follows an item at the focused step. On a switch, Enter and Space turn it off or on (and do not pause).
- Opening, following, finishing and what-ifs are announced in a polite live region; the inspector itself is not live, so tabbing through parts is quiet.

## Reduced motion

With `prefers-reduced-motion: reduce` the figure opens paused on a moment about a third into the run, with no glides and no transitions. Step and Play still work: the reader decides when anything moves.

## Events

The figure tells the page what the reader does, as DOM events that bubble from its `<figure>`:

| Event | `detail` | When |
|---|---|---|
| `dissect:select` | `{ path, part }` | a part is selected (clicked, focused, or `select(path)`); `path` is `null` when nothing is |
| `dissect:open` | `{ path, part }` | a level is opened, or the top one shown again (`path` `""`) |
| `dissect:follow` | `{ id }` | the reader starts or stops following an item |

`part` is the part as written in the model, with any field of your own (a `section` naming the paragraph that explains it, say). With the handle (`figure.dissect`, or what `mount` returns), a page can drive the figure back: `open(path)`, `select(path)`, `follow(id)`, `inject(changes)`.

## Options

`figure` (or `buildFigure` options): `pace`, `speed` (initial), `autoplay` (default on), `idle` (the self-following tour, default on), `outage`, `burst`, `levelPace`, `watch` (`{ class, label, window }`: the readout's one number), `hint` (the line at the bottom left), `theme` (`auto`, `light` or `dark`), `fig`, `title`, `caption`.

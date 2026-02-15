# Bad Apple!! on ARMLite

Renders [Bad Apple!!](https://www.youtube.com/watch?v=FtutLA63Cp8) on the
[ARMLite simulator](https://peterhigginson.co.uk/ARMlite/) at 128×96 hi-res,
using Playwright to drive frame-delta playback directly into the simulator's
pixel display.

## Quick start

```bash
npm install              # installs Playwright + Chromium
node play_bad_apple.js   # opens ARMLite and starts playback
```

With audio:

```bash
node play_bad_apple.js --audio bad_apple.mp3
```

## Options

| Flag | Default | Description |
|---|---|---|
| `--masks-dir <path>` | `./masks` | Directory of frame JSON masks |
| `--fps <n>` | `30` | Target framerate |
| `--audio <file>` | none | Audio file to sync (mp3/wav/ogg) |
| `--start-frame <n>` | `1` | First frame to play |
| `--end-frame <n>` | all | Last frame to play |
| `--url <url>` | ARMLite online | Custom ARMLite URL |
| `--browser <path>` | bundled | Custom Chromium executable |
| `--headless` | off | Run headless (no visible browser) |
| `--local` | off | Use `http://localhost:3000/` |

## npm scripts

```bash
npm run play          # default (30fps, no audio)
npm run play:audio    # with bad_apple.mp3
npm run play:10fps    # 10fps mode
npm run play:local    # localhost ARMLite
```

## Controls

| Control | Action |
|---|---|
| **⏸ / ▶** button | Pause / resume |
| **⏮** button | Rewind to start |
| **Seek bar** | Drag to any frame |
| **Space** | Toggle pause |
| **← / →** | Seek ±5 seconds |
| **Home / End** | Jump to start / end |
| **S** | Toggle stats for nerds |

## How it works

1. **Mask files** (`masks/frame_NNNNN.json`) — 6,572 RLE-encoded 128×96
   black/white frames extracted from the original video.
2. **Delta encoding** — the player computes pixel-level diffs between
   consecutive frames (avg ~199 pixel changes per frame).
3. **Playwright bootstrap** — opens ARMLite in Chromium, submits a tiny
   ASM program (`MOV R0, #2; STR R0, .Resolution; HALT`) to switch to
   128×96 hi-res mode.
4. **In-page engine** — all delta data is uploaded into the browser as a
   JS array. A `requestAnimationFrame` loop applies deltas directly to
   ARMLite's `v1address[]` shadow array and the pixel `<div>` elements.
   Zero per-frame IPC.
5. **Audio sync** — when `--audio` is provided, the video clock is slaved
   to `audio.currentTime`. Pausing/seeking the audio automatically
   pauses/seeks the video.
6. **Keyframe cache** — periodic pixel-state snapshots are saved so seeking
   doesn't have to replay from frame 0 every time.

## Project structure

```
play_bad_apple.js     Main Playwright player
package.json          Dependencies & npm scripts
masks/                6,572 RLE frame JSONs
dev/                  Old/experimental approaches, source frames, tools
armlite_manual.txt    ARMLite instruction set reference
```

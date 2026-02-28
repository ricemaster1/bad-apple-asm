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
npm run play          # default (30fps)
npm run play:10fps    # 10fps mode
npm run play:local    # localhost ARMLite
```

## Controls

| Control | Action |
|---|---|
| **Space** | Toggle pause |
| **← / →** | Seek ±5 seconds |
| **s** | Toggle stats for nerds |

## Note

It takes about 15s to initialize.

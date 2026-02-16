#!/usr/bin/env node
/**
 * play_bad_apple.js — Playwright-driven Bad Apple!! renderer for ARMLite
 *
 * Loads pre-computed frame deltas into the browser, then runs a
 * requestAnimationFrame-based playback loop inside the page itself.
 * Zero per-frame IPC overhead → smooth 30fps playback at 128×96.
 *
 * Usage:
 *   node play_bad_apple.js [options]
 *
 * Options:
 *   --masks-dir <path>   Mask JSON directory        (default: ./masks)
 *   --fps <number>       Target FPS                 (default: 30)
 *   --url <url>          ARMLite URL                (default: online)
 *   --audio <path>       Audio file to play (mp3/wav/ogg)
 *   --start-frame <n>    First frame number         (default: 1)
 *   --end-frame <n>      Last frame number           (default: all)
 *   --browser <path>     Custom Chromium executable
 *   --headless           Run headless
 *   --local              Use http://localhost:3000/
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs() {
  const base = yargs(hideBin(process.argv))
    .option('masks-dir', { type: 'string', default: './masks' })
    .option('fps', { type: 'number', default: 30 })
    .option('url', { type: 'string', default: 'https://peterhigginson.co.uk/ARMlite/' })
    .option('audio', { type: 'string', default: null })
    .option('start-frame', { type: 'number', default: 1 })
    .option('end-frame', { type: 'number' })
    .option('browser', { type: 'string', default: null })
    .option('headless', { type: 'boolean', default: false })
    .option('local', { type: 'boolean', default: false })
    .help(false)
    .version(false)
    .strict()
    .check(argv => {
      if (typeof argv.fps !== 'number' || argv.fps <= 0) throw new Error('`--fps` must be a positive number');
      if (!Number.isInteger(argv['start-frame']) || argv['start-frame'] < 1) throw new Error('`--start-frame` must be an integer ≥ 1');
      if (argv['end-frame'] !== undefined) {
        if (!Number.isInteger(argv['end-frame']) || argv['end-frame'] < 1) throw new Error('`--end-frame` must be an integer ≥ 1');
        if (argv['end-frame'] < argv['start-frame']) throw new Error('`--end-frame` must be ≥ `--start-frame`');
      }
      if (!fs.existsSync(argv['masks-dir']) || !fs.statSync(argv['masks-dir']).isDirectory()) {
        throw new Error(`Masks directory not found: ${argv['masks-dir']}`);
      }
      return true;
    });

  const argv = base.parse();

  const opts = {
    masksDir: argv['masks-dir'],
    fps: argv.fps,
    url: argv.url,
    audio: argv.audio,
    startFrame: argv['start-frame'],
    endFrame: argv['end-frame'] !== undefined ? argv['end-frame'] : Infinity,
    browser: argv.browser,
    headless: argv.headless,
    local: argv.local,
  };

  if (opts.local) opts.url = 'http://localhost:3000/';
  return opts;
}

// ── Mask loading ─────────────────────────────────────────────────────────────
function loadMaskPixels(fp) {
  const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const w = d.w;
  const s = new Set();
  for (let y = 0; y < d.rows.length; y++)
    for (const [start, len] of d.rows[y])
      for (let x = start; x < start + len; x++)
        s.add(y * w + x);
  return s;
}

function listMasks(dir) {
  return fs.readdirSync(dir)
    .filter(f => /^frame_\d+\.json$/.test(f))
    .sort()
    .map(f => path.join(dir, f));
}

// ── Delta computation ────────────────────────────────────────────────────────
function buildDeltas(frames) {
  const out = [];
  out.push([[...frames[0]], []]); // first: all black from empty
  for (let i = 1; i < frames.length; i++) {
    const b = [], w = [];
    for (const p of frames[i])     if (!frames[i-1].has(p)) b.push(p);
    for (const p of frames[i-1])   if (!frames[i].has(p))   w.push(p);
    out.push([b, w]);
  }
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();
  console.log('Bad Apple!! ARMLite Player');
  console.log('─────────────────────────');

  const masks = listMasks(opts.masksDir);
  if (!masks.length) { console.error('No masks in ' + opts.masksDir); process.exit(1); }

  const si = opts.startFrame - 1;
  const ei = Math.min(opts.endFrame, masks.length);
  const n  = ei - si;
  console.log(`${n} frames (${si+1}–${ei}), ${opts.fps} fps → ${(n/opts.fps).toFixed(1)}s`);

  // Load
  process.stdout.write('Loading masks... ');
  const frames = [];
  for (let i = si; i < ei; i++) {
    frames.push(loadMaskPixels(masks[i]));
    if (frames.length % 1000 === 0) process.stdout.write(`${frames.length}... `);
  }
  console.log(`${frames.length} loaded.`);

  // Deltas
  process.stdout.write('Computing deltas... ');
  const deltas = buildDeltas(frames);
  frames.length = 0; // free
  let ops = 0;
  for (const [b, w] of deltas) ops += b.length + w.length;
  console.log(`done (avg ${(ops/deltas.length)|0} ops/frame)`);

  // Browser
  const launchOpts = { headless: opts.headless };
  if (opts.browser) launchOpts.executablePath = opts.browser;
  console.log('Launching browser...');
  const browser = await chromium.launch(launchOpts);
  const page = await (await browser.newContext()).newPage();

  await page.route('**/*', r => {
    try {
      const h = new URL(r.request().url()).hostname;
      if (['matomo.peterhigginson.co.uk','connect.facebook.net'].includes(h)) return r.abort();
    } catch {}
    return r.continue();
  });

  await page.goto(opts.url, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  // ── Bootstrap: submit & run a small program to set hi-res ──
  console.log('Bootstrapping hi-res mode...');
  await page.evaluate(() => {
    const prog = '    MOV R0, #2\n    STR R0, .Resolution\n    HALT';
    // Enter edit mode
    const edit = document.getElementById('edit');
    if (edit) edit.click();
    return new Promise(r => setTimeout(() => {
      const ta = document.querySelector('#source textarea') || document.querySelector('textarea');
      if (ta) { ta.value = prog; ta.dispatchEvent(new Event('input', {bubbles:true})); }
      const sub = document.getElementById('submit');
      if (sub) sub.click();
      r();
    }, 400));
  });
  await page.waitForTimeout(600);

  // Run the bootstrap
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /^run$/i.test(b.textContent.trim()));
    if (btn) btn.click(); else if (typeof run === 'function') run();
  });
  await page.waitForTimeout(600);

  // Clear
  await page.evaluate(() => { if (typeof clearPixelArea === 'function') clearPixelArea(); });
  await page.waitForTimeout(200);

  // ── Upload deltas in chunks ──
  process.stdout.write('Uploading frame data... ');
  const CHUNK = 100;
  await page.evaluate(() => { window._bd = []; });
  for (let c = 0; c < deltas.length; c += CHUNK) {
    await page.evaluate(ch => { window._bd.push(...ch); }, deltas.slice(c, c + CHUNK));
    if ((c + CHUNK) % 500 < CHUNK)
      process.stdout.write(`${Math.min(c+CHUNK, deltas.length)}/${deltas.length}... `);
  }
  console.log('done.');

  // ── Audio injection ──
  if (opts.audio) {
    const ap = path.resolve(opts.audio);
    if (fs.existsSync(ap)) {
      console.log('Injecting audio...');
      const b64 = fs.readFileSync(ap).toString('base64');
      const ext = path.extname(ap).slice(1);
      const mime = ext === 'mp3' ? 'audio/mpeg' : `audio/${ext}`;
      await page.evaluate(({b64,mime}) => {
        const a = document.createElement('audio');
        a.id = 'ba-audio'; a.src = `data:${mime};base64,${b64}`;
        a.style.display = 'none';
        document.body.appendChild(a);
      }, {b64,mime});
    } else console.warn('Audio not found:', ap);
  }

  // ── Start in-page playback engine ──
  console.log('\n>>> Playback starting! <<<\n');
  await page.evaluate((fps) => {
    const D = window._bd;
    const ms = 1000 / fps;
    const totalSec = D.length / fps;
    let fi = 0;           // next frame index to apply (frames 0..fi-1 are applied)
    let skip = 0;
    let paused = false;
    let t0 = null;        // fallback clock start (used when no audio)
    let pauseOffset = 0;  // accumulated paused time for fallback clock

    const audio = document.getElementById('ba-audio');
    const hasAudio = !!audio;
    let _seekGuard = false;  // prevents seekTo ↔ seeked event feedback loop

    // ── Stats for nerds tracking ──
    const stats = {
      tickCount: 0,
      lastTickTs: 0,
      frameTimes: [],        // last N tick intervals (ms)
      deltaOps: [],          // last N delta sizes (pixel writes per frame)
      seekCount: 0,
      lastSeekMs: 0,
      totalPixelWrites: 0,
      maxDeltaSize: 0,
      maxDeltaFrame: 0,
      playbackStart: 0,
    };

    // ── Build keyframe snapshots for fast seeking ──
    // Every KEYFRAME_INTERVAL frames, store a full pixel state snapshot
    const KF_INT = Math.max(1, fps * 2); // every ~2 seconds
    const keyframes = new Map(); // frameIndex → Uint32Array(pixelAreaSize)

    // ── Transport controls bar ──
    const bar = document.createElement('div');
    bar.id = 'ba-controls';
    Object.assign(bar.style, {
      position:'fixed', bottom:'0', left:'0', right:'0', zIndex:'10001',
      background:'rgba(0,0,0,.85)', padding:'8px 12px',
      display:'flex', alignItems:'center', gap:'8px',
      fontFamily:'monospace', fontSize:'13px', color:'#fff',
    });
    document.body.appendChild(bar);

    // Play/Pause button
    const playBtn = document.createElement('button');
    playBtn.textContent = '⏸';
    Object.assign(playBtn.style, {
      fontSize:'18px', background:'none', border:'1px solid #666',
      color:'#fff', borderRadius:'4px', padding:'2px 10px', cursor:'pointer',
    });
    bar.appendChild(playBtn);

    // Rewind button
    const rewBtn = document.createElement('button');
    rewBtn.textContent = '⏮';
    Object.assign(rewBtn.style, {
      fontSize:'18px', background:'none', border:'1px solid #666',
      color:'#fff', borderRadius:'4px', padding:'2px 10px', cursor:'pointer',
    });
    bar.appendChild(rewBtn);

    // Time label (left)
    const timeLabel = document.createElement('span');
    timeLabel.style.minWidth = '55px';
    timeLabel.textContent = '0:00';
    bar.appendChild(timeLabel);

    // Seek bar
    const seekBar = document.createElement('input');
    seekBar.type = 'range'; seekBar.min = '0'; seekBar.max = String(D.length - 1);
    seekBar.value = '0'; seekBar.step = '1';
    Object.assign(seekBar.style, { flex:'1', cursor:'pointer', accentColor:'#0f0' });
    bar.appendChild(seekBar);

    // Duration label (right)
    const durLabel = document.createElement('span');
    durLabel.style.minWidth = '55px';
    durLabel.textContent = fmtTime(totalSec);
    bar.appendChild(durLabel);

    // Frame counter
    const frameLbl = document.createElement('span');
    frameLbl.style.minWidth = '100px'; frameLbl.style.textAlign = 'right';
    bar.appendChild(frameLbl);

    // Stats for nerds button
    const statsBtn = document.createElement('button');
    statsBtn.textContent = '⚙';
    statsBtn.title = 'Stats for nerds (S)';
    Object.assign(statsBtn.style, {
      fontSize:'16px', background:'none', border:'1px solid #666',
      color:'#fff', borderRadius:'4px', padding:'2px 8px', cursor:'pointer',
      marginLeft:'4px',
    });
    bar.appendChild(statsBtn);

    // HUD overlay (top-right)
    const hud = document.createElement('div');
    Object.assign(hud.style, {
      position:'fixed', top:'5px', right:'5px', zIndex:'10000',
      background:'rgba(0,0,0,.75)', color:'#0f0', padding:'4px 10px',
      fontFamily:'monospace', fontSize:'13px', borderRadius:'4px',
    });
    hud.id = 'ba-hud';
    document.body.appendChild(hud);

    // ── Stats for nerds panel ──
    const statsPanel = document.createElement('div');
    statsPanel.id = 'ba-stats';
    Object.assign(statsPanel.style, {
      position:'fixed', top:'40px', left:'10px', zIndex:'10002',
      background:'rgba(0,0,0,.88)', color:'#0f0', padding:'12px 16px',
      fontFamily:'monospace', fontSize:'12px', borderRadius:'6px',
      border:'1px solid #333', lineHeight:'1.6',
      display:'none', minWidth:'320px', whiteSpace:'pre',
      pointerEvents:'none', userSelect:'text',
    });
    document.body.appendChild(statsPanel);
    let statsVisible = false;

    function toggleStats() {
      statsVisible = !statsVisible;
      statsPanel.style.display = statsVisible ? 'block' : 'none';
      statsBtn.style.color = statsVisible ? '#0f0' : '#fff';
    }
    statsBtn.addEventListener('click', toggleStats);

    function updateStatsPanel() {
      if (!statsVisible) return;
      const ft = stats.frameTimes;
      const avgTickMs = ft.length > 0 ? (ft.reduce((a,b) => a+b, 0) / ft.length).toFixed(2) : '—';
      const minTickMs = ft.length > 0 ? Math.min(...ft).toFixed(2) : '—';
      const maxTickMs = ft.length > 0 ? Math.max(...ft).toFixed(2) : '—';
      const realFps = ft.length > 0 ? (1000 / parseFloat(avgTickMs)).toFixed(1) : '—';

      const dOps = stats.deltaOps;
      const avgDelta = dOps.length > 0 ? (dOps.reduce((a,b) => a+b, 0) / dOps.length).toFixed(0) : '—';
      const lastDelta = dOps.length > 0 ? dOps[dOps.length - 1] : '—';

      const elSec = getCurrentTimeSec();
      const expectedFrame = Math.floor(elSec * fps);
      const drift = fi - expectedFrame;

      let audioDriftMs = '—';
      if (hasAudio && !audio.paused) {
        const videoTimeSec = (fi - 1) / fps;
        audioDriftMs = ((videoTimeSec - audio.currentTime) * 1000).toFixed(1);
      }

      const kfCount = keyframes.size;
      const kfMemKB = (kfCount * pixelAreaSize * 4 / 1024).toFixed(0);

      const uptimeSec = stats.playbackStart > 0 ? ((performance.now() - stats.playbackStart) / 1000).toFixed(1) : '0';
      const pct = ((fi / D.length) * 100).toFixed(1);

      // Count black pixels for current frame
      let blackPx = 0;
      for (let i = 0; i < pixelAreaSize; i++) { if (v1address[i] === 0) blackPx++; }

      statsPanel.textContent =
        '╔══ Stats for Nerds ══════════════════╗\n' +
        '║ Frame:    ' + fi + ' / ' + D.length + ' (' + pct + '%)\n' +
        '║ Target:   ' + fps + ' fps\n' +
        '║ Real FPS: ' + realFps + ' (avg tick ' + avgTickMs + 'ms)\n' +
        '║ Tick:     min ' + minTickMs + 'ms / max ' + maxTickMs + 'ms\n' +
        '║ Dropped:  ' + skip + ' frames\n' +
        '║ Drift:    ' + drift + ' frames\n' +
        '║ A/V Sync: ' + audioDriftMs + ' ms\n' +
        '╠══ Delta ════════════════════════════╣\n' +
        '║ Last Δ:   ' + lastDelta + ' px writes\n' +
        '║ Avg Δ:    ' + avgDelta + ' px/frame\n' +
        '║ Max Δ:    ' + stats.maxDeltaSize + ' px (f' + stats.maxDeltaFrame + ')\n' +
        '║ Total:    ' + stats.totalPixelWrites.toLocaleString() + ' writes\n' +
        '║ Black px: ' + blackPx + ' / ' + pixelAreaSize + '\n' +
        '╠══ Seek / Cache ═════════════════════╣\n' +
        '║ Seeks:    ' + stats.seekCount + (stats.lastSeekMs > 0 ? ' (last ' + stats.lastSeekMs + 'ms)' : '') + '\n' +
        '║ KF cache: ' + kfCount + ' snapshots (~' + kfMemKB + ' KB)\n' +
        '║ KF int:   every ' + KF_INT + ' frames\n' +
        '╠══ Session ══════════════════════════╣\n' +
        '║ Uptime:   ' + uptimeSec + 's\n' +
        '║ Ticks:    ' + stats.tickCount + '\n' +
        '║ Res:      ' + (typeof pixelWidth !== 'undefined' ? pixelWidth : '?') + '×' +
                        (typeof pixelHeight !== 'undefined' ? pixelHeight : '?') + '\n' +
        '║ Pixels:   ' + pixelAreaSize + '\n' +
        '║ Audio:    ' + (hasAudio ? 'yes' : 'no') + (hasAudio ? ' (' + audio.duration.toFixed(1) + 's)' : '') + '\n' +
        '╚════════════════════════════════════╝';
    }

    // ── Helpers ──
    function fmtTime(s) {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return m + ':' + String(sec).padStart(2, '0');
    }

    function drawDelta(idx) {
      const [bl, wh] = D[idx];
      let writes = 0;
      for (let i = 0; i < bl.length; i++) {
        const p = bl[i];
        if (p >= 0 && p < pixelAreaSize && v1address[p] !== 0) {
          v1address[p] = 0;
          document.getElementById('p' + p).style.background = '#000';
          writes++;
        }
      }
      for (let i = 0; i < wh.length; i++) {
        const p = wh[i];
        if (p >= 0 && p < pixelAreaSize && v1address[p] !== 0xFFFFFF) {
          v1address[p] = 0xFFFFFF;
          document.getElementById('p' + p).style.background = '#FFF';
          writes++;
        }
      }
      // Track stats
      stats.totalPixelWrites += writes;
      if (stats.deltaOps.length >= 120) stats.deltaOps.shift();
      stats.deltaOps.push(writes);
      if (writes > stats.maxDeltaSize) { stats.maxDeltaSize = writes; stats.maxDeltaFrame = idx; }
    }

    function clearScreen() {
      for (let i = 0; i < pixelAreaSize; i++) {
        if (v1address[i] !== 0xFFFFFF) {
          v1address[i] = 0xFFFFFF;
          document.getElementById('p' + i).style.background = '#FFF';
        }
      }
    }

    function saveKeyframe(frameIdx) {
      const snap = new Uint32Array(pixelAreaSize);
      for (let i = 0; i < pixelAreaSize; i++) snap[i] = v1address[i];
      keyframes.set(frameIdx, snap);
    }

    function restoreKeyframe(snap) {
      for (let i = 0; i < pixelAreaSize; i++) {
        const c = snap[i];
        if (v1address[i] !== c) {
          v1address[i] = c;
          document.getElementById('p' + i).style.background =
            c === 0 ? '#000' : c === 0xFFFFFF ? '#FFF' : '#' + c.toString(16).padStart(6, '0');
        }
      }
    }

    // Seek to a specific frame index
    function seekTo(targetFrame) {
      const seekStart = performance.now();
      targetFrame = Math.max(0, Math.min(targetFrame, D.length - 1));

      // Find the nearest keyframe at or before targetFrame
      let bestKf = 0;
      for (const kfIdx of keyframes.keys()) {
        if (kfIdx <= targetFrame && kfIdx >= bestKf) bestKf = kfIdx;
      }

      if (keyframes.has(bestKf) && bestKf > 0) {
        restoreKeyframe(keyframes.get(bestKf));
        fi = bestKf;
      } else {
        // Rebuild from scratch
        clearScreen();
        fi = 0;
      }

      // Apply deltas from bestKf (or 0) up to targetFrame
      while (fi <= targetFrame) {
        drawDelta(fi);
        fi++;
      }

      // Sync audio position
      if (hasAudio) {
        _seekGuard = true;
        audio.currentTime = targetFrame / fps;
      } else {
        t0 = performance.now() - (targetFrame / fps) * 1000;
        pauseOffset = 0;
      }

      // Track seek stats
      stats.seekCount++;
      stats.lastSeekMs = (performance.now() - seekStart).toFixed(1);
    }

    function getCurrentTimeSec() {
      if (hasAudio) return audio.currentTime;
      if (t0 === null) return 0;
      return (performance.now() - t0 - pauseOffset) / 1000;
    }

    // ── Controls wiring ──
    function togglePause() {
      paused = !paused;
      playBtn.textContent = paused ? '▶' : '⏸';
      if (hasAudio) {
        if (paused) audio.pause();
        else audio.play().catch(() => {});
      } else {
        if (paused) {
          window._baPauseStart = performance.now();
        } else if (window._baPauseStart) {
          pauseOffset += performance.now() - window._baPauseStart;
          window._baPauseStart = null;
        }
      }
      if (!paused) requestAnimationFrame(tick); // restart RAF loop
    }

    playBtn.addEventListener('click', togglePause);

    rewBtn.addEventListener('click', () => {
      seekTo(0);
      if (paused) togglePause(); // auto-play on rewind
    });

    // Seek bar interaction
    let seeking = false;
    seekBar.addEventListener('mousedown', () => { seeking = true; });
    seekBar.addEventListener('input', () => {
      if (seeking) {
        const target = parseInt(seekBar.value, 10);
        seekTo(target);
      }
    });
    seekBar.addEventListener('mouseup', () => { seeking = false; });
    seekBar.addEventListener('change', () => {
      seeking = false;
      const target = parseInt(seekBar.value, 10);
      seekTo(target);
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); togglePause(); }
      else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        seekTo(Math.max(0, fi - fps * 5)); // -5 seconds
      }
      else if (e.code === 'ArrowRight') {
        e.preventDefault();
        seekTo(Math.min(D.length - 1, fi + fps * 5)); // +5 seconds
      }
      else if (e.code === 'Home') { e.preventDefault(); seekTo(0); }
      else if (e.code === 'End') { e.preventDefault(); seekTo(D.length - 1); }      else if (e.code === 'KeyS') { e.preventDefault(); toggleStats(); }    });

    // ── Audio sync: pause video when audio pauses, and vice versa ──
    if (hasAudio) {
      audio.addEventListener('pause', () => {
        if (!paused && !audio.ended) { paused = true; playBtn.textContent = '▶'; }
      });
      audio.addEventListener('play', () => {
        // Handle external play (e.g. native audio controls); our togglePause handles our button
        if (paused) { paused = false; playBtn.textContent = '⏸'; requestAnimationFrame(tick); }
      });
      audio.addEventListener('seeked', () => {
        // Guard: ignore seeked events triggered by our own seekTo()
        if (_seekGuard) { _seekGuard = false; return; }
        const target = Math.round(audio.currentTime * fps);
        seekTo(target);
      });
    }

    // ── Main tick loop ──
    function tick(ts) {
      if (paused) return; // stop RAF loop; resumed by play handler

      // Track tick timing
      stats.tickCount++;
      if (stats.playbackStart === 0) stats.playbackStart = ts;
      if (stats.lastTickTs > 0) {
        const interval = ts - stats.lastTickTs;
        if (stats.frameTimes.length >= 120) stats.frameTimes.shift();
        stats.frameTimes.push(interval);
      }
      stats.lastTickTs = ts;

      if (t0 === null && !hasAudio) { t0 = ts; }

      // Start audio on first tick
      if (hasAudio && audio.paused && !audio.ended && fi === 0) {
        audio.play().catch(() => {});
      }

      const elSec = getCurrentTimeSec();
      const target = Math.floor(elSec * fps);

      if (target >= D.length) {
        hud.textContent = 'Done! ' + D.length + 'f, ' + skip + ' dropped';
        playBtn.textContent = '▶';
        paused = true;
        return;
      }

      // Catch up: apply skipped deltas to keep pixel state consistent
      while (fi < target && fi < D.length - 1) { drawDelta(fi); fi++; skip++; }
      if (fi <= target && fi < D.length) {
        drawDelta(fi);
        // Save keyframe periodically
        if (fi % KF_INT === 0 && !keyframes.has(fi)) saveKeyframe(fi);
        fi++;
      }

      // Update UI
      if (fi % 10 === 0 || fi >= D.length) {
        const secNow = elSec.toFixed(1);
        const curFps = (fi / (elSec || 0.001)).toFixed(1);
        hud.textContent = fi + '/' + D.length + ' | ' + secNow + 's | ' + curFps + 'fps | ' + skip + ' drop';
        timeLabel.textContent = fmtTime(elSec);
        if (!seeking) seekBar.value = String(fi);
        frameLbl.textContent = fi + '/' + D.length;
        updateStatsPanel();
      }

      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, opts.fps);

  // ── Monitor from Node side ──
  let last = '';
  while (true) {
    await new Promise(r => setTimeout(r, 3000));
    const st = await page.evaluate(() => {
      const h = document.getElementById('ba-hud');
      return h ? h.textContent : '';
    }).catch(() => '');
    if (st && st !== last) { console.log('  [browser]', st); last = st; }
    if (/^Done!/.test(st)) { console.log('\nPlayback complete!'); break; }
  }

  console.log('Close the browser when ready or press Ctrl+C.');
  await new Promise(() => {});
}

main().catch(e => { console.error(e); process.exit(1); });

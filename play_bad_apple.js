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

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs() {
  const a = process.argv.slice(2);
  const o = {
    masksDir: './masks', fps: 30,
    url: 'https://peterhigginson.co.uk/ARMlite/',
    audio: null, startFrame: 1, endFrame: Infinity,
    browser: null, headless: false, local: false,
  };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--masks-dir')    o.masksDir    = a[++i];
    else if (k === '--fps')     o.fps         = Number(a[++i]);
    else if (k === '--url')     o.url         = a[++i];
    else if (k === '--audio')   o.audio       = a[++i];
    else if (k === '--start-frame') o.startFrame = Number(a[++i]);
    else if (k === '--end-frame')   o.endFrame   = Number(a[++i]);
    else if (k === '--browser') o.browser     = a[++i];
    else if (k === '--headless') o.headless   = true;
    else if (k === '--local')   o.local       = true;
  }
  if (o.local) o.url = 'http://localhost:3000/';
  return o;
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
        a.controls = true;
        Object.assign(a.style, {position:'fixed',bottom:'10px',right:'10px',zIndex:'9999'});
        document.body.appendChild(a);
      }, {b64,mime});
    } else console.warn('Audio not found:', ap);
  }

  // ── Start in-page playback engine ──
  console.log('\n>>> Playback starting! <<<\n');
  await page.evaluate((fps) => {
    const D = window._bd;
    const ms = 1000 / fps;
    let fi = 0, t0 = null, skip = 0;

    // HUD overlay
    const hud = document.createElement('div');
    Object.assign(hud.style, {
      position:'fixed', top:'5px', right:'5px', zIndex:'10000',
      background:'rgba(0,0,0,.75)', color:'#0f0', padding:'4px 10px',
      fontFamily:'monospace', fontSize:'13px', borderRadius:'4px',
    });
    hud.id = 'ba-hud';
    document.body.appendChild(hud);

    function draw(idx) {
      const [bl, wh] = D[idx];
      for (let i = 0; i < bl.length; i++) {
        const p = bl[i];
        if (p >= 0 && p < pixelAreaSize && v1address[p] !== 0) {
          v1address[p] = 0;
          document.getElementById('p'+p).style.background = '#000';
        }
      }
      for (let i = 0; i < wh.length; i++) {
        const p = wh[i];
        if (p >= 0 && p < pixelAreaSize && v1address[p] !== 0xFFFFFF) {
          v1address[p] = 0xFFFFFF;
          document.getElementById('p'+p).style.background = '#FFF';
        }
      }
    }

    function tick(ts) {
      if (t0 === null) {
        t0 = ts;
        const au = document.getElementById('ba-audio');
        if (au) au.play().catch(()=>{});
      }
      const el = ts - t0;
      const target = Math.floor(el / ms);

      if (target >= D.length) {
        hud.textContent = 'Done! ' + D.length + 'f, ' + skip + ' dropped';
        return;
      }

      // catch up: apply all skipped deltas (keeps pixel state consistent)
      while (fi < target && fi < D.length - 1) { draw(fi); fi++; skip++; }
      if (fi <= target && fi < D.length) { draw(fi); fi++; }

      if (fi % 30 === 0 || fi >= D.length) {
        const s = (el/1000).toFixed(1);
        const f = (fi/(el/1000||1)).toFixed(1);
        hud.textContent = fi+'/'+D.length+' | '+s+'s | '+f+'fps | '+skip+' drop';
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
    if (st.startsWith('Done!')) { console.log('\nPlayback complete!'); break; }
  }

  console.log('Close the browser when ready or press Ctrl+C.');
  await new Promise(() => {});
}

main().catch(e => { console.error(e); process.exit(1); });

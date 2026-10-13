// Shared helpers: serve build/yandex-build, drive the game in Chrome, report results.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'build', 'yandex-build');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');
// Same local-date format the game uses for the daily bonus and tasks
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

function suite(title) {
  const results = [];
  console.log(`\n== ${title}`);
  return {
    ok(name, pass, info = '') {
      results.push({ name, pass });
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
    },
    finish() {
      const failed = results.filter(r => !r.pass).length;
      console.log(`${results.length - failed}/${results.length} passed`);
      if (failed) process.exitCode = 1;
    }
  };
}

async function withBrowser(port, fn) {
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js'), BUILD, String(port)], { stdio: 'ignore' });
  await sleep(400);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  browser.base = `http://127.0.0.1:${port}/index-test.html`;
  try {
    await fn(browser);
  } finally {
    await browser.close();
    server.kill();
  }
}

// Opens the game. preset is written to localStorage once, before the game boots.
async function openGame(browser, { query = '', viewport = { width: 390, height: 780 }, preset = null } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'ru-RU' });
  if (preset) {
    await ctx.addInitScript(p => {
      if (sessionStorage.getItem('preset')) return;
      localStorage.setItem('kolbochki-v2', JSON.stringify(p));
      sessionStorage.setItem('preset', '1');
    }, preset);
  }
  const page = await ctx.newPage();
  // The Play button "breathes" forever, so Playwright's stability wait never ends: click without it.
  const click = page.click.bind(page);
  page.click = (sel, opts = {}) => click(sel, { force: true, timeout: 10000, ...opts });
  page.errors = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) page.errors.push('console: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/sdk.js')) page.errors.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(browser.base + query);
  page.booted = await page.waitForFunction(() => window.__kolb && window.__kolb.G, null, { timeout: 8000 }).then(() => true, () => false);
  return page;
}

const state = page => page.evaluate(() => {
  const G = __kolb.G, S = __kolb.S, $ = s => document.querySelector(s);
  return {
    level: S.level, max: S.max, coins: S.coins, won: G.won, busy: G.busy, moves: G.moves, sel: G.sel, frozen: G.frozen, undos: G.undos,
    tubes: __kolb.allColors(), title: !$('#title').hidden, modal: !$('#modal').hidden, adov: !$('#adov').hidden,
    modalText: $('#modal').innerText.replace(/\s+/g, ' ').slice(0, 90), sdk: (window.__sdkLog || []).slice()
  };
});
const lastGameplay = s => [...s.sdk].reverse().find(x => x.startsWith('GameplayAPI')) || 'none';

async function clickTube(page, k) {
  const box = await page.locator('#board .tube').nth(k).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function startFromTitle(page) {
  await page.click('#playBtn');
  await sleep(300);
  if (await page.isVisible('#dGet')) await page.click('#dGet');
  await sleep(200);
  if (await page.isVisible('#iOk')) await page.click('#iOk');
}

// Plays the current level with real clicks; the in-game solver only plans the moves.
async function playLevel(page) {
  let plan = [];
  for (let step = 0; step < 500; step++) {
    await page.waitForFunction(() => !__kolb.G.busy);
    const s = await state(page);
    if (s.won) return s;
    if (s.modal) {
      if (await page.isVisible('#iOk')) { await page.click('#iOk'); continue; }
      throw new Error('unexpected modal: ' + s.modalText);
    }
    if (s.sel >= 0) { await clickTube(page, s.sel); await sleep(250); continue; }
    // Plan the whole level once and follow it; re-planning each step can loop back and forth.
    if (!plan.length) {
      plan = await page.evaluate(() => {
        const G = __kolb.G, t = __kolb.allColors();
        return __kolb.astar(t, 300000, G.frozen, 1.5) || __kolb.solve(t, 400000, G.frozen) || [];
      });
    }
    const mv = plan.shift();
    if (!mv) throw new Error('solver found no way forward at level ' + s.level);
    await clickTube(page, mv[0]);
    await clickTube(page, mv[1]);
    await page.waitForFunction(m => __kolb.G.moves !== m || __kolb.G.won, s.moves, { timeout: 6000 });
  }
  throw new Error('level did not finish');
}

// Presses "Next" on the win panel and waits until the next level is playable.
async function nextFromWin(page) {
  await page.waitForSelector('#wNext', { state: 'visible', timeout: 15000 });
  const s = await state(page);
  await page.click('#wNext');
  // After the very first win the daily bonus is offered before the next level starts
  await page.waitForFunction(() => document.querySelector('#dGet') || (!__kolb.G.won && document.querySelector('#adov').hidden), null, { timeout: 15000 });
  if (await page.isVisible('#dGet')) await page.click('#dGet');
  await page.waitForFunction(l => __kolb.S.level === l + 1 && !__kolb.G.won && document.querySelector('#adov').hidden, s.level, { timeout: 15000 });
  await sleep(250);
  if (await page.isVisible('#iOk')) await page.click('#iOk');
  return s;
}

// Every color appears exactly CAP times and no tube is over capacity.
function boardIsConsistent(tubes, colors) {
  const counts = {};
  tubes.flat().forEach(c => { counts[c] = (counts[c] || 0) + 1; });
  return !tubes.some(t => t.length > 4) && Object.keys(counts).length === colors && Object.values(counts).every(n => n === 4);
}

module.exports = { ROOT, BUILD, sleep, today, suite, withBrowser, openGame, state, lastGameplay, clickTube, startFromTitle, playLevel, nextFromWin, boardIsConsistent };

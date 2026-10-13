// Regression tests: one per bug fixed after the October 2026 review.
// Each test reproduces the original defect and must stay green.
const fs = require('fs');
const path = require('path');
const { BUILD, sleep, today, suite, withBrowser, openGame, state, lastGameplay, clickTube, startFromTitle, playLevel, boardIsConsistent } = require('./harness');

const t = suite('regress: fixed bugs');
const returning = extra => ({ v: 2, daily: { last: today(), streak: 1 }, seen: { hidden: true, frozen: true }, ...extra });

async function check(name, fn) {
  try {
    const [pass, info] = await fn();
    t.ok(name, pass, info);
  } catch (e) {
    t.ok(name, false, 'threw: ' + e.message.split('\n')[0]);
  }
}

// Bug 1: on a landscape phone the Play button was below the screen and could not be pressed.
async function playButtonReachable(browser, width, height) {
  const page = await openGame(browser, { query: '?nosdk=1', viewport: { width, height }, preset: returning({ level: 20, max: 20 }) });
  try {
    const box = await page.locator('#playBtn').boundingBox();
    const inside = box && box.y >= 0 && box.y + box.height <= height && box.x >= 0 && box.x + box.width <= width;
    if (inside) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(300);
    const started = !(await state(page)).title;
    return [inside && started, `button y ${Math.round(box.y)}..${Math.round(box.y + box.height)} of ${height}, game started: ${started}`];
  } finally {
    await page.context().close();
  }
}

// Bug 7: at 320px the HUD ran past the right edge and hid the restart button.
async function hudFits(browser, width) {
  const page = await openGame(browser, { query: '?nosdk=1', viewport: { width, height: 568 }, preset: returning({ level: 20, max: 20, coins: 12345 }) });
  try {
    await startFromTitle(page);
    const m = await page.evaluate(() => {
      const right = Math.max(...[...document.querySelectorAll('.hud > *')].map(e => e.getBoundingClientRect().right));
      const r = document.querySelector('#restartBtn').getBoundingClientRect();
      return { right: Math.round(right), restartVisible: r.right <= innerWidth && r.width > 0, hscroll: document.documentElement.scrollWidth > innerWidth };
    });
    return [m.right <= width && m.restartVisible && !m.hscroll, `HUD right edge ${m.right}px of ${width}px`];
  } finally {
    await page.context().close();
  }
}

// Bug 5: one broken field in a save stopped the game from starting.
const BROKEN_SAVES = [
  ['skin id with a space', { skin: 'bad skin', owned: ['faces', 'night', 'bad skin'] }],
  ['unknown background', { bg: 'nope', owned: ['faces', 'night', 'nope'] }],
  ['owned is not a list', { owned: 'faces' }],
  ['tasks without list', { tasks: { date: today() } }],
  ['coins as a string', { coins: '50' }],
  ['stars, daily, seen are null', { stars: null, daily: null, seen: null, adProg: null }],
  ['level is garbage', { level: 'abc', max: -5 }]
];

withBrowser(8771, async browser => {
  await check('bug 1: Play button reachable on a landscape phone 640x360', () => playButtonReachable(browser, 640, 360));
  await check('bug 1: Play button reachable on a landscape phone 844x390', () => playButtonReachable(browser, 844, 390));
  await check('bug 1: Play button reachable on a small landscape phone 568x320', () => playButtonReachable(browser, 568, 320));

  await check('bug 2: after login with cloud progress the board is rebuilt for the cloud level', async () => {
    const page = await openGame(browser, { query: '?login=1' });
    try {
      await startFromTitle(page);
      await page.click('#menuBtn'); await page.click('#mLogin'); await sleep(800);
      const s = await page.evaluate(() => ({ level: __kolb.S.level, colors: __kolb.G.tubes.flat().length / 4, hud: document.querySelector('#lvl').textContent }));
      return [s.level === 30 && s.colors === 10 && s.hud === 'Уровень 30', `S.level=${s.level}, board colors=${s.colors} (level 30 has 10)`];
    } finally {
      await page.context().close();
    }
  });

  await check('bug 3: leaderboard player name is shown as text, not HTML', async () => {
    const page = await openGame(browser, { query: '?auth=1&xss=1', preset: returning({ level: 2, max: 2 }) });
    try {
      await startFromTitle(page);
      await page.click('#menuBtn'); await page.click('#mRate'); await sleep(600);
      const r = await page.evaluate(() => ({ ran: window.__xss || 0, img: !!document.querySelector('#lbList img'), text: document.querySelector('#lbList').innerText.includes('<img') }));
      return [!r.ran && !r.img && r.text, `script ran=${r.ran}, <img> injected=${r.img}, name shown as text=${r.text}`];
    } finally {
      await page.context().close();
    }
  });

  await check('bug 4: fullscreen ad error (onError + onClose) starts the next level once', async () => {
    const page = await openGame(browser, { query: '?fs=err', preset: returning({ level: 4, max: 4 }) });
    try {
      await startFromTitle(page);
      await playLevel(page);
      await page.waitForSelector('#wNext', { state: 'visible', timeout: 15000 });
      await page.evaluate(() => { window.__gs = new Set(); setInterval(() => window.__gs.add(__kolb.G), 2); });
      await page.click('#wNext'); await sleep(800);
      const games = await page.evaluate(() => window.__gs.size);
      return [games === 2, `level objects seen: ${games} (old + one new expected)`];
    } finally {
      await page.context().close();
    }
  });

  await check('bug 4: rewarded ad error (onError + onClose) reopens the win panel once, no reward', async () => {
    const page = await openGame(browser, { query: '?rw=err', preset: returning({ level: 2, max: 2 }) });
    try {
      await startFromTitle(page);
      await playLevel(page);
      await page.waitForSelector('#wAd', { state: 'visible', timeout: 15000 });
      await page.evaluate(() => {
        window.__panels = 0;
        new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('card')) window.__panels++; })))
          .observe(document.querySelector('#modal'), { childList: true });
      });
      await page.click('#wAd'); await sleep(800);
      const s = await state(page), panels = await page.evaluate(() => window.__panels);
      return [panels === 1 && s.coins === 0 && s.level === 2, `win panels opened=${panels}, coins=${s.coins}`];
    } finally {
      await page.context().close();
    }
  });

  for (const [label, bad] of BROKEN_SAVES) {
    await check(`bug 5: save with ${label} still boots`, async () => {
      const page = await openGame(browser, { query: '?nosdk=1', preset: returning({ level: 3, max: 3, ...bad }) });
      try {
        const s = page.booted ? await page.evaluate(() => ({ skin: __kolb.S.skin, bg: __kolb.S.bg, coins: __kolb.S.coins, level: __kolb.S.level })) : null;
        const sane = s && ['faces', 'berry', 'candy', 'planet', 'monster', 'pumpkin'].includes(s.skin) && ['night', 'sunset', 'mint', 'halloween'].includes(s.bg)
          && typeof s.coins === 'number' && s.level >= 1;
        return [page.booted && sane && page.errors.length === 0, page.booted ? JSON.stringify(s) + ' ' + page.errors.join(' | ') : 'GAME DID NOT START: ' + page.errors.join(' | ')];
      } finally {
        await page.context().close();
      }
    });
  }

  await check('bug 6: restart right after buying the extra tube has no JS error', async () => {
    const page = await openGame(browser, { query: '?nosdk=1', preset: returning({ level: 5, max: 5, coins: 999 }) });
    try {
      await startFromTitle(page);
      await page.click('#tubeBtn'); await page.click('#oCoin'); await page.click('#restartBtn'); await sleep(600);
      return [page.errors.length === 0, page.errors.join(' | ')];
    } finally {
      await page.context().close();
    }
  });

  // Found by the fuzz test: while undo waited for a lifted ball to drop back, taps still started moves,
  // and the two moves ran at the same time.
  await check('bug 8: taps during an undo are ignored, undo restores the board', async () => {
    const page = await openGame(browser, { query: '?nosdk=1', preset: returning({ level: 18, max: 18 }) });
    try {
      await startFromTitle(page);
      const start = (await state(page)).tubes;
      const first = await page.evaluate(() => __kolb.solve(__kolb.allColors(), 400000, __kolb.G.frozen)[0]);
      await clickTube(page, first[0]); await clickTube(page, first[1]);
      await page.waitForFunction(() => __kolb.G.moves === 1 && !__kolb.G.busy);
      // a legal move and a tube to lift, picked from the current board
      const plan = await page.evaluate(() => {
        const t = __kolb.allColors(), G = __kolb.G, ok = k => t[k].length && !G.done.has(k) && k !== G.frozen;
        const lift = t.findIndex((_, k) => ok(k));
        for (let i = 0; i < t.length; i++) for (let j = 0; j < t.length; j++) {
          if (i !== j && ok(i) && t[j].length < 4 && j !== G.frozen) return { lift, move: [i, j] };
        }
        return null;
      });
      await clickTube(page, plan.lift);
      await page.click('#undoBtn');
      await clickTube(page, plan.move[0]); await clickTube(page, plan.move[1]);
      await sleep(1500);
      await page.waitForFunction(() => !__kolb.G.busy);
      const s = await state(page);
      const restored = JSON.stringify(s.tubes) === JSON.stringify(start);
      return [restored && s.moves === 0 && boardIsConsistent(s.tubes, 10), `board restored=${restored}, moves=${s.moves}`];
    } finally {
      await page.context().close();
    }
  });

  await check('bug 7: HUD fits at 320px with a 5-digit coin count', () => hudFits(browser, 320));
  await check('bug 7: HUD fits at 360px with a 5-digit coin count', () => hudFits(browser, 360));

  await check('daily bonus waits for the first win, then is offered once', async () => {
    const page = await openGame(browser, { query: '?nosdk=1' });
    try {
      await page.click('#playBtn'); await sleep(400);
      const atStart = await page.isVisible('#dGet');
      const tutorial = await page.isVisible('#tip');
      await playLevel(page);
      await page.waitForSelector('#wNext', { state: 'visible', timeout: 15000 });
      await page.click('#wNext'); await sleep(500);
      const offered = await page.isVisible('#dGet');
      if (offered) await page.click('#dGet');
      await sleep(400);
      const s = await state(page);
      const ok = !atStart && tutorial && offered && s.level === 2 && !s.modal && s.coins === 30;
      return [ok, `bonus at first Play=${atStart}, tutorial=${tutorial}, bonus after first win=${offered}, level=${s.level}, coins=${s.coins}`];
    } finally {
      await page.context().close();
    }
  });

  await check('daily bonus still shows on Play for a returning player', async () => {
    const page = await openGame(browser, { query: '?nosdk=1', preset: { v: 2, level: 3, max: 3, daily: { last: '2026-01-01', streak: 3 } } });
    try {
      await page.click('#playBtn'); await sleep(400);
      return [await page.isVisible('#dGet'), ''];
    } finally {
      await page.context().close();
    }
  });

  await check('leaderboard score is sent right after login', async () => {
    const page = await openGame(browser, { query: '?login=1' });
    try {
      await startFromTitle(page);
      await page.click('#menuBtn'); await page.click('#mLogin'); await sleep(800);
      const sent = (await state(page)).sdk.filter(x => x.startsWith('setScore'));
      return [sent.includes('setScore levels 29'), sent.join(', ') || 'no setScore calls'];
    } finally {
      await page.context().close();
    }
  });

  await check('game_api_pause mutes the game, game_api_resume brings sound back', async () => {
    const page = await openGame(browser, { query: '?auth=1', preset: returning({ level: 3, max: 3 }) });
    try {
      await startFromTitle(page);
      const subscribed = (await state(page)).sdk.filter(x => x.startsWith('on game_api_'));
      const audio = () => page.evaluate(() => __kolb.Sound && __kolb.Sound.ctx ? __kolb.Sound.ctx.state : 'no sound handle');
      const before = await audio();
      await page.evaluate(() => window.__fireSdk('game_api_pause')); await sleep(200);
      const paused = await audio();
      const gpPaused = lastGameplay(await state(page));
      await page.evaluate(() => window.__fireSdk('game_api_resume')); await sleep(200);
      const resumed = await audio();
      const ok = subscribed.length === 2 && before === 'running' && paused === 'suspended' && resumed === 'running' && gpPaused === 'GameplayAPI.stop';
      return [ok, `subscribed=[${subscribed}] audio ${before} → ${paused} → ${resumed}, gameplay on pause: ${gpPaused}`];
    } finally {
      await page.context().close();
    }
  });

  // Found in code review: a platform resume arriving while an SDK ad is still on screen restarted gameplay under the ad.
  await check('game_api_resume during an ad keeps gameplay stopped until the ad closes', async () => {
    const page = await openGame(browser, { query: '?auth=1&rw=slow', preset: returning({ level: 5, max: 5 }) });
    try {
      await startFromTitle(page);
      await page.click('#hintBtn'); await page.click('#oAd'); await sleep(200);
      await page.evaluate(() => { window.__fireSdk('game_api_pause'); window.__fireSdk('game_api_resume'); });
      await sleep(100);
      const duringAd = lastGameplay(await state(page));
      const audioDuringAd = await page.evaluate(() => __kolb.Sound.ctx.state);
      await sleep(1700);
      const afterAd = lastGameplay(await state(page));
      return [duringAd === 'GameplayAPI.stop' && audioDuringAd === 'suspended' && afterAd === 'GameplayAPI.start',
        `during ad: ${duringAd}, audio ${audioDuringAd}; after ad: ${afterAd}`];
    } finally {
      await page.context().close();
    }
  });

  await check('build output uses LF line endings', async () => {
    const page = fs.readFileSync(path.join(BUILD, 'index.html'), 'utf8');
    return [!page.includes('\r'), page.includes('\r') ? 'index.html contains CRLF' : ''];
  });
}).catch(e => t.ok('test runner', false, e.stack)).finally(() => t.finish());

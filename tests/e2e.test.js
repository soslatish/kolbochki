// End-to-end play in Chrome: real clicks through levels, SDK integration, tools, menus, rapid input, layouts.
const { today, sleep, suite, withBrowser, openGame, state, lastGameplay, clickTube, startFromTitle, playLevel, nextFromWin, boardIsConsistent } = require('./harness');

const t = suite('e2e: playing the built game');
const returning = extra => ({ v: 2, daily: { last: today(), streak: 1 }, seen: { hidden: true, frozen: true }, ...extra });

async function localPlay(browser) {
  const page = await openGame(browser, { query: '?nosdk=1' });
  t.ok('no SDK: title screen with demo footer', (await state(page)).title && await page.isVisible('#titleFoot'));
  await startFromTitle(page);
  t.ok('no SDK: tutorial on level 1', await page.isVisible('#tip'));
  for (let i = 0; i < 3; i++) { await playLevel(page); await nextFromWin(page); }
  const s = await state(page);
  t.ok('no SDK: levels 1-3 completed by clicks', s.level === 4, `level=${s.level} coins=${s.coins}`);
  await page.reload();
  await page.waitForFunction(() => window.__kolb && window.__kolb.G);
  const label = await page.textContent('#playLabel');
  t.ok('no SDK: progress survives reload', (await state(page)).level === 4 && label.includes('4'), label);
  t.ok('no SDK: no JS errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
}

async function sdkPlay(browser) {
  const page = await openGame(browser, { query: '?auth=1' });
  const s0 = await state(page);
  t.ok('SDK: init → getPlayer → LoadingAPI.ready', s0.sdk[0] === 'init' && s0.sdk.indexOf('getPlayer') < s0.sdk.indexOf('LoadingAPI.ready'), s0.sdk.join(','));
  t.ok('SDK: demo footer hidden, no gameplay on title', !(await page.isVisible('#titleFoot')) && !s0.sdk.includes('GameplayAPI.start'));
  await startFromTitle(page);
  const problems = [], kinds = new Set();
  for (let l = 1; l <= 13; l++) {
    const before = await state(page);
    kinds.add(await page.evaluate(() => document.querySelector('.ice') ? 'ice' : document.querySelector('.ball.hid') ? 'sleeping' : 'normal'));
    if (lastGameplay(before) !== 'GameplayAPI.start') problems.push(`L${l} playing but last=${lastGameplay(before)}`);
    if (!boardIsConsistent(before.tubes, before.tubes.flat().length / 4)) problems.push(`L${l} board inconsistent`);
    await playLevel(page);
    await page.waitForSelector('#wNext', { state: 'visible', timeout: 15000 });
    const atWin = await state(page);
    if (lastGameplay(atWin) !== 'GameplayAPI.stop') problems.push(`L${l} win panel but last=${lastGameplay(atWin)}`);
    const adsBefore = atWin.sdk.filter(x => x === 'fullscreen').length;
    await nextFromWin(page);
    const ads = (await state(page)).sdk.filter(x => x === 'fullscreen').length;
    // Fullscreen ads run between levels starting with the way into level 4
    if (l + 1 >= 4 && ads === adsBefore) problems.push(`L${l}: no fullscreen ad before level ${l + 1}`);
    if (l + 1 < 4 && ads > 0) problems.push(`L${l}: fullscreen ad before level ${l + 1}`);
  }
  const s = await state(page);
  t.ok('SDK: levels 1-13 completed (normal, sleeping, ice)', s.level === 14 && kinds.size === 3, `level=${s.level}, kinds=${[...kinds]}`);
  t.ok('SDK: GameplayAPI and fullscreen ads in the right places', problems.length === 0, problems.join('; '));
  t.ok('SDK: leaderboard score and cloud save sent', s.sdk.includes('setScore levels 13') && s.sdk.includes('setData flush=true'));
  await tools(page);
  await menus(page);
  t.ok('SDK: no JS errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
}

async function tools(page) {
  await page.waitForFunction(() => !__kolb.G.busy);
  const mv = await page.evaluate(() => __kolb.solve(__kolb.allColors(), 400000, __kolb.G.frozen)[0]);
  await clickTube(page, mv[0]); await clickTube(page, mv[1]);
  await page.waitForFunction(() => __kolb.G.moves === 1 && !__kolb.G.busy);
  await page.click('#undoBtn');
  await page.waitForFunction(() => __kolb.G.moves === 0 && !__kolb.G.busy);
  const u = await state(page);
  t.ok('tools: undo returns the move and spends one undo', u.undos === 2);
  await page.click('#hintBtn'); await page.click('#oAd');
  t.ok('tools: hint via rewarded ad highlights the source tube', await page.waitForSelector('.tube.hsrc', { timeout: 8000 }).then(() => true, () => false));
  const n = u.tubes.length;
  await page.click('#tubeBtn'); await page.click('#oAd');
  await page.waitForFunction(k => __kolb.G.tubes.length === k + 1, n, { timeout: 5000 }).catch(() => {});
  t.ok('tools: extra tube after rewarded ad', (await state(page)).tubes.length === n + 1);
  await page.click('#tubeBtn');
  t.ok('tools: second extra tube refused', !(await state(page)).modal);
  await page.click('#restartBtn'); await sleep(300);
  const r = await state(page);
  t.ok('tools: restart rebuilds the level', r.tubes.length === n && r.moves === 0);
}

async function menus(page) {
  await page.click('#menuBtn');
  t.ok('menu: opening it stops gameplay', lastGameplay(await state(page)) === 'GameplayAPI.stop');
  await page.click('#mTasks');
  t.ok('menu: daily tasks', (await state(page)).modalText.includes('Задания дня'));
  await page.click('#tOk');
  await page.click('#coinBtn');
  await page.click('[data-ad="candy"]'); await sleep(400);
  t.ok('shop: ad-unlock progress counts', await page.evaluate(() => __kolb.S.adProg.candy === 1));
  await page.click('[data-tab="bgs"]');
  const seasonal = await page.isVisible('[data-free="halloween"]');
  if (seasonal) await page.click('[data-free="halloween"]');
  t.ok('shop: seasonal background can be taken in season', !seasonal || await page.evaluate(() => __kolb.S.bg === 'halloween'), seasonal ? '' : 'out of season, skipped');
  await page.click('#sOk');
  await page.click('#lvlBtn'); await page.click('[data-lv="5"]'); await sleep(300);
  const s = await state(page);
  t.ok('levels: replay level 5 from the list', s.level === 5 && s.max === 14 && !s.modal);
  await page.click('#menuBtn'); await page.click('#mRate');
  await page.waitForFunction(() => !document.querySelector('#lbList').innerText.includes('Загружаем'));
  t.ok('rating: leaderboard rendered', (await page.innerText('#lbList')).includes('Аня'));
  await page.click('#rOk');
}

async function shopPurchase(browser) {
  const page = await openGame(browser, { query: '?nosdk=1', preset: returning({ level: 5, max: 5, coins: 300 }) });
  await startFromTitle(page);
  await page.click('#coinBtn');
  await page.click('[data-buy="berry"]');
  const s = await page.evaluate(() => ({ coins: __kolb.S.coins, skin: __kolb.S.skin, board: document.querySelector('#board').classList.contains('skin-berry') }));
  t.ok('shop: buying a skin spends coins and applies it', s.coins === 50 && s.skin === 'berry' && s.board, JSON.stringify(s));
  await page.context().close();
}

async function fuzz(browser) {
  const page = await openGame(browser, { query: '?nosdk=1', preset: returning({ level: 18, max: 18, coins: 999 }) });
  await startFromTitle(page);
  const n = (await state(page)).tubes.length;
  for (let i = 0; i < 250; i++) {
    if (Math.random() < 0.1) await page.click('#undoBtn').catch(() => {});
    else await clickTube(page, Math.floor(Math.random() * n));
    if ((await state(page)).modal) await page.click('#oNo').catch(() => {});
  }
  await page.waitForFunction(() => !__kolb.G.busy); await sleep(700);
  const s = await state(page);
  const dom = await page.evaluate(() => {
    const seen = new Set(); let overlap = 0;
    document.querySelectorAll('#board .ball').forEach(el => { if (seen.has(el.style.transform)) overlap++; seen.add(el.style.transform); });
    return { balls: document.querySelectorAll('#board .ball').length, overlap };
  });
  t.ok('fuzz: 250 rapid taps and undos keep the board consistent', boardIsConsistent(s.tubes, 10) && dom.balls === 40 && dom.overlap === 0 && page.errors.length === 0,
    `balls=${dom.balls} overlapping=${dom.overlap} tubes=${JSON.stringify(s.tubes)} won=${s.won} errors=${page.errors.join(' | ')}`);
  await page.context().close();
}

async function layouts(browser) {
  for (const [w, h] of [[320, 568], [360, 640], [375, 667], [390, 844], [768, 1024], [1280, 720], [640, 360], [844, 390]]) {
    const page = await openGame(browser, { query: '?nosdk=1', viewport: { width: w, height: h }, preset: returning({ level: 20, max: 20, coins: 999 }) });
    await startFromTitle(page);
    await page.click('#tubeBtn'); await page.click('#oCoin'); await sleep(600);
    const m = await page.evaluate(() => {
      const b = document.querySelector('#board').getBoundingClientRect();
      const tubes = [...document.querySelectorAll('#board .tube')].map(r => r.getBoundingClientRect());
      const tools = document.querySelector('.tools').getBoundingClientRect();
      return {
        n: tubes.length, tubeW: Math.round(tubes[0].width),
        out: tubes.filter(r => r.left < b.left - 1 || r.right > b.right + 1 || r.bottom > b.bottom + 1 || r.top < b.top - 30).length,
        hscroll: document.documentElement.scrollWidth > innerWidth, toolsOnScreen: tools.bottom <= innerHeight + 1
      };
    });
    t.ok(`layout ${w}x${h}: 12 tubes fit`, m.n === 12 && m.out === 0 && !m.hscroll && m.toolsOnScreen && m.tubeW >= 28, `tube width ${m.tubeW}px, outside=${m.out}, hscroll=${m.hscroll}`);
    await page.context().close();
  }
}

withBrowser(8772, async browser => {
  for (const step of [localPlay, sdkPlay, shopPurchase, fuzz, layouts]) {
    try { await step(browser); } catch (e) { t.ok(`${step.name} finished`, false, e.message.split('\n')[0]); }
  }
}).catch(e => t.ok('test runner', false, e.stack)).finally(() => t.finish());

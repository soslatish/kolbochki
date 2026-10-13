// Fake Yandex Games SDK for local tests. Behaviour is driven by the page's query string:
//   fs=ok|err        fullscreen ad: normal close, or onError followed by onClose (as the real SDK does)
//   rw=ok|err|skip|slow  rewarded ad: rewarded+close, error+close, close without reward, or a 1.5s ad
//   auth=1           authorized player (leaderboard writes allowed)
//   login=1          the auth dialog succeeds and the account already has progress up to level 30
//   xss=1            the leaderboard returns a player name containing HTML
// window.__sdkLog lists every SDK call; window.__fireSdk(event) fires ysdk.on() handlers.
(function () {
  const q = new URLSearchParams(location.search);
  const log = [];
  const handlers = {};
  window.__sdkLog = log;
  window.__fireSdk = ev => (handlers[ev] || []).forEach(cb => cb());
  const L = s => log.push(s);
  const later = (fn, ms) => setTimeout(fn, ms);
  let cloud = JSON.parse(localStorage.getItem('mockcloud') || 'null') || {};

  const player = {
    isAuthorized: () => q.get('auth') === '1',
    getMode: () => (q.get('auth') === '1' ? '' : 'lite'),
    getData: async () => { L('getData'); return cloud; },
    setData: async (d, flush) => { L('setData flush=' + flush); cloud = d; localStorage.setItem('mockcloud', JSON.stringify(d)); }
  };

  const ysdk = {
    features: {
      LoadingAPI: { ready() { L('LoadingAPI.ready'); } },
      GameplayAPI: { start() { L('GameplayAPI.start'); }, stop() { L('GameplayAPI.stop'); } }
    },
    adv: {
      showFullscreenAdv({ callbacks: c = {} }) {
        L('fullscreen');
        if (q.get('fs') === 'err') { later(() => c.onError && c.onError(new Error('mock')), 30); later(() => c.onClose && c.onClose(false), 60); }
        else { later(() => c.onOpen && c.onOpen(), 10); later(() => c.onClose && c.onClose(true), 60); }
      },
      showRewardedVideo({ callbacks: c = {} }) {
        L('rewarded');
        const mode = q.get('rw') || 'ok';
        if (mode === 'err') { later(() => c.onError && c.onError(new Error('mock')), 30); later(() => c.onClose && c.onClose(), 60); }
        else if (mode === 'skip') later(() => c.onClose && c.onClose(), 60);
        else if (mode === 'slow') { later(() => c.onOpen && c.onOpen(), 10); later(() => { c.onRewarded && c.onRewarded(); c.onClose && c.onClose(); }, 1500); }
        else { later(() => c.onOpen && c.onOpen(), 10); later(() => { c.onRewarded && c.onRewarded(); c.onClose && c.onClose(); }, 60); }
      }
    },
    getPlayer: async () => { L('getPlayer'); return player; },
    auth: {
      openAuthDialog: async () => {
        L('openAuthDialog');
        if (q.get('login') !== '1') throw new Error('cancelled');
        q.set('auth', '1');
        cloud = { v: 2, level: 30, max: 30, coins: 500, stars: {}, daily: { last: '', streak: 0 }, ts: Date.now() + 1e6 };
      }
    },
    leaderboards: {
      setScore: async (name, v) => L(`setScore ${name} ${v}`),
      getEntries: async () => ({
        userRank: 2,
        entries: [
          { rank: 1, score: 99, player: { publicName: q.get('xss') ? '<img src=x onerror="window.__xss=(window.__xss||0)+1">Хакер' : 'Аня' } },
          { rank: 2, score: 5, player: { publicName: 'Я' } }
        ]
      })
    },
    on(ev, cb) { L('on ' + ev); (handlers[ev] = handlers[ev] || []).push(cb); },
    off(ev, cb) { handlers[ev] = (handlers[ev] || []).filter(x => x !== cb); },
    environment: { i18n: { lang: 'ru' } }
  };
  window.YaGames = { init: async () => { L('init'); return ysdk; } };
})();

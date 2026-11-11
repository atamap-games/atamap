// 配信で遊ぶときの、大きく見せる画面。2つの使い方がある。
//   ・配信用の画面（mode: 'cast'）：配信ソフトに映す。ボタンはない。配信者が置いているあいだは「考え中…」だけを出す
//   ・配信者の操作の画面（mode: 'op'）：同じ見た目に、進めるボタンが付く（配信者がワードを置く画面は screen-place.js）
// 答え合わせでは、見ている人のピンを色の濃さ（たくさん集まったところほど濃い）で見せ、
// スポットライトのあとに配信者の答え（ココらへん！）が落ちてくる。
import { showScreen, el } from './ui.js';
import { createMap, createPin, placePinsApart, watchResize, ANSWER_LABEL } from './mapview.js';
import { createQrSvg } from './qr.js';
import { createTimer } from './timer.js';
import { NEAR, CLOSE } from './score.js';
import { streamWordResult, VIEWER_COLOR } from './stream.js';
import { popIn, dropIn, slideIn, burstAt, shake, bump, confetti, reduced, moveSpotlight } from './fx.js';
import { sfx, drumroll, duckBgm } from './sound.js';

const screen = document.querySelector('[data-screen="cast"]');
const part = (name) => screen.querySelector(`[data-cast="${name}"]`);

// 見ている人のピンを出しきるまでの時間（ミリ秒）
const HEAT_MS = 1800;
// ドキドキの演出の時間（ミリ秒。ふつうの答え合わせと同じ）
const SUSPENSE_MS = 5000;
// この距離より遠い予想には「そこ置く!?」と出す
const SHOUT_DISTANCE = 35;
// 答えのあとで名前を出す、近かった人の数
const NAMED = 3;

let view = null;
let timers = [];
let stopSpot = () => {};
let stopWatching = () => {};
let timer = null;
let timerDeadline = null;
let qrFor = '';
let joinQrFor = '';
let handlers = {};

function later(ms, callback) {
  timers.push(window.setTimeout(callback, ms));
}

function clearTimers() {
  timers.forEach((t) => window.clearTimeout(t));
  timers = [];
  stopSpot();
  stopSpot = () => {};
}

/**
 * 画面を出す（部屋のデータが変わるたびに呼んでよい）。
 * @param {object} o
 * @param {'cast'|'op'} o.mode 配信用の画面／配信者の操作の画面
 * @param {string} o.phase 'lobby'|'make'|'guess'|'reveal'|'summary'|'end'
 * @param {string} o.key 今のお題を見分ける文字（ゲームの番号とお題の番号）
 * @param {string} o.streamer 配信者の名前
 * @param {string} o.code 部屋の番号
 * @param {string} o.url 参加するためのアドレス
 * @param {{ uid: string, name: string }[]} o.viewers 今つながっている、見ている人
 * @param {object} [o.topic] 今のお題
 * @param {number} [o.roundNo] 何問目か
 * @param {number|null} [o.remaining] 残り時間（秒）
 * @param {number|null} [o.deadline] 締め切り
 * @param {number} [o.total] 制限時間の全体（秒）
 * @param {object[]} [o.answer] 配信者の答え（[{ w, x, y }]）
 * @param {object[]} [o.guesses] 見ている人の予想（[{ uid, name, placements }]）
 * @param {number} [o.wordIndex] 何番目のワードか
 * @param {boolean} [o.answerShown] 答えを出したか
 * @param {object[]} [o.ranking] 合計のランキング（[{ name, total, round, rank }]）
 * @param {object[]} [o.roundRanking] このお題のランキング
 * @param {object} [o.handlers] 操作の画面のボタン { answer, next, close, finish, again, openCast }
 */
export function showCast(o) {
  handlers = o.handlers ?? {};
  const wordKey = `${o.phase}:${o.key}:${o.phase === 'reveal' ? o.wordIndex : ''}`;
  const same = view && view.wordKey === wordKey;
  const wasShown = view?.answerShown;
  view = same ? Object.assign(view, o) : { ...o, wordKey, stage: '' };
  screen.classList.toggle('is-broadcast', o.mode === 'cast');
  screen.dataset.phase = o.phase;

  renderHead();
  if (!same) {
    clearTimers();
    stopWatching();
    stopWatching = () => {};
    if (o.phase === 'closed') renderClosed();
    else if (o.phase === 'lobby') renderLobby();
    else if (o.phase === 'make' || o.phase === 'guess') renderWaiting();
    else if (o.phase === 'reveal') renderWord();
    else renderRanking();
  } else if (o.phase === 'lobby') {
    renderLobbyMembers();
  } else if (o.phase === 'make' || o.phase === 'guess') {
    renderWaitingInfo();
  } else if (o.phase === 'reveal' && o.answerShown && !wasShown && (view.stage === 'heat' || view.stage === 'ready')) {
    revealAnswer(true);
  }
  renderJoin();
  applyButtons();
  showScreen('cast');
}

/** 画面を離れるときの後片づけ */
export function stopCast() {
  clearTimers();
  stopWatching();
  stopWatching = () => {};
  timer?.stop();
  timer = null;
  timerDeadline = null;
  view = null;
}

// ---------- 上の段（お題・残り時間） ----------

function renderHead() {
  const { phase, topic, roundNo } = view;
  const inGame = topic && !['lobby', 'end', 'closed'].includes(phase);
  part('genre').textContent = inGame ? `${roundNo}問目・${topic.genre}` : phase === 'end' ? '結果発表' : '配信で遊ぶ';
  part('title').textContent = inGame ? topic.title : 'アタマップ';
  part('count').textContent = phase === 'reveal' && topic ? `${view.wordIndex + 1}/${topic.words.length}` : '';

  const deadline = phase === 'make' || phase === 'guess' ? view.deadline ?? null : null;
  if (deadline !== timerDeadline) {
    timerDeadline = deadline;
    timer?.stop();
    timer = null;
    const box = part('timer');
    const remaining = deadline ? view.remaining : null;
    box.hidden = remaining === null || remaining === undefined;
    if (!box.hidden) {
      timer = createTimer({
        seconds: Math.max(0, remaining),
        pausable: false,
        onTick: (left) => {
          part('seconds').textContent = left;
          box.style.setProperty('--left', String(Math.min(1, left / (view?.total || 90))));
          box.classList.toggle('is-hurry', left <= 10);
          if (left <= 10) bump(part('seconds'));
          if (left > 0 && left <= 5 && view?.mode === 'cast') sfx('tick');
        },
        onEnd: () => {},
      });
    }
  }
}

// ---------- つないでいる・部屋が閉じた（配信用の画面だけ） ----------

function renderClosed() {
  part('stage').replaceChildren();
  part('info').replaceChildren(el('p', 'cast__lead', view.message ?? ''));
}

// ---------- 待合室（配信用の画面だけ） ----------

function renderLobby() {
  view.seen = new Set();
  const qr = el('div', 'qr cast__qr');
  part('stage').replaceChildren(qr);
  qrFor = '';
  showQr(qr, view.url, (url) => qrFor === url, (url) => (qrFor = url));
  const info = el('div', 'cast__lobby');
  info.append(
    el('p', 'cast__lead', `${view.streamer}さんの頭の中を当てよう！`),
    el('p', 'cast__how', 'スマホでQRコードを読んで、名前を入れるだけ'),
    codeLine(view.code),
    el('p', 'cast__url', view.url),
    el('p', 'cast__people'),
    el('ul', 'members cast__members'),
  );
  part('info').replaceChildren(info);
  renderLobbyMembers();
}

function codeLine(code) {
  const line = el('p', 'cast__code');
  line.append(el('small', '', '部屋の番号'), el('b', '', code));
  return line;
}

// 新しく入った人を、ぽんっと出す（多いときは、新しい人から入るだけ）
function renderLobbyMembers() {
  const box = part('info');
  const people = box.querySelector('.cast__people');
  if (!people) return;
  people.replaceChildren(el('b', '', String(view.viewers.length)), '人が参加中');
  const list = box.querySelector('.cast__members');
  const recent = [...view.viewers].reverse();
  const chips = recent.map((v) => {
    const chip = el('li', 'member');
    chip.style.setProperty('--player-color', VIEWER_COLOR);
    chip.append(el('span', 'member__dot'), el('span', 'member__name', v.name));
    return [chip, v];
  });
  list.replaceChildren(...chips.map(([chip]) => chip));
  chips.forEach(([chip, v]) => {
    if (view.seen.has(v.uid)) return;
    view.seen.add(v.uid);
    popIn(chip, { from: 'scale(0.2) rotate(-12deg)' });
    if (view.mode === 'cast') sfx('pin', view.seen.size % 8);
  });
  fitRows(list, '.member');
}

function showQr(box, url, isCurrent, setCurrent) {
  setCurrent(url);
  box.replaceChildren(el('p', 'qr__loading', 'QRコードを作っています…'));
  createQrSvg(url)
    .then((svg) => isCurrent(url) && box.replaceChildren(svg))
    .catch(() => isCurrent(url) && box.replaceChildren(el('p', 'qr__loading', 'QRコードを出せませんでした')));
}

// 配信用の画面のすみに、あとから参加する人のための小さなQRコードと番号を出す
function renderJoin() {
  const box = part('join');
  const show = view.mode === 'cast' && !['lobby', 'closed'].includes(view.phase);
  box.hidden = !show;
  if (!show) return;
  if (joinQrFor !== view.url) {
    const qr = el('span', 'cast__join-qr');
    const text = el('span', 'cast__join-text');
    text.append(el('small', '', 'スマホで参加'), el('b', '', view.code));
    box.replaceChildren(qr, text);
    showQr(qr, view.url, (url) => joinQrFor === url, (url) => (joinQrFor = url));
  }
}

// ---------- 配信者が置いている・みんなが予想している ----------

function renderWaiting() {
  const { topic, phase } = view;
  const map = createMap(topic, 'map--static map--preview');
  if (phase === 'make') {
    const thinking = el('span', 'cast__thinking');
    thinking.append(el('b', '', '考え中'), el('span', 'cast__dots', '…'));
    map.append(thinking);
  }
  part('stage').replaceChildren(map);
  const info = el('div', 'cast__waiting');
  const lead = el('p', 'cast__lead', phase === 'make' ? `${view.streamer}さんが置いています` : 'スマホでピンを置いてね！');
  const sub = el('p', 'cast__how', phase === 'make' ? 'ロックしたら、みんなで予想スタート！' : `「${view.streamer}さんならココらへん」と思うところに5つ置こう`);
  const words = el('div', 'wordlist cast__words');
  const chips = topic.words.map((word) => el('span', 'chip chip--static', word));
  words.append(...chips);
  const people = el('p', 'cast__people');
  info.append(lead, sub, words, people);
  part('info').replaceChildren(info);
  popIn(lead, { from: 'scale(0.5) rotate(-4deg)' });
  chips.forEach((chip, i) => popIn(chip, { delay: 300 + i * 80 }));
  if (view.mode === 'cast') sfx(phase === 'make' ? 'topic' : 'select');
  view.lastDone = -1;
  renderWaitingInfo();
}

function renderWaitingInfo() {
  const people = part('info').querySelector('.cast__people');
  if (!people) return;
  const all = view.viewers.length;
  if (view.phase === 'make') {
    people.replaceChildren(el('b', '', String(all)), '人が参加中');
    return;
  }
  const done = view.guesses?.length ?? 0;
  people.replaceChildren(el('b', '', String(done)), `人が予想した（${all}人中）`);
  if (done > view.lastDone && view.lastDone >= 0) {
    bump(people.firstElementChild);
    if (view.mode === 'cast') sfx('place');
  }
  view.lastDone = done;
}

// ---------- 答え合わせ（1ワードずつ） ----------

function renderWord() {
  const { topic, wordIndex, answer, guesses } = view;
  const word = topic.words[wordIndex];
  const result = streamWordResult(answer ?? [], guesses ?? [], word);
  const map = createMap(topic, 'map--static map--reveal map--heat');

  // 3点・1点の輪（答えを出すまで見せない）
  const rings = el('span', 'map__rings');
  if (result.answer) {
    for (const [radius, name] of [[CLOSE, 'ring--close'], [NEAR, 'ring--near']]) {
      const ring = el('span', `ring ${name}`);
      ring.style.left = `${result.answer.x}%`;
      ring.style.top = `${result.answer.y}%`;
      ring.style.width = ring.style.height = `${radius * 2}%`;
      rings.append(ring);
    }
  }
  rings.hidden = true;

  // みんなの予想：ぼかした丸を重ねて、たくさん集まったところほど濃く見せる。点も小さく出す
  const heat = el('span', 'map__heat');
  const placed = result.results.filter((r) => r.pos);
  const blobs = placed.map((r) => {
    const blob = el('span', 'heat');
    blob.style.left = `${r.pos.x}%`;
    blob.style.top = `${r.pos.y}%`;
    blob.hidden = true;
    heat.append(blob);
    return blob;
  });
  map.append(heat, rings);

  // 答えのあとで名前を出す人：いちばん近かった人たちと、いちばん遠かった人（「そこ置く!?」）
  const nearest = [...placed].sort((a, b) => a.distance - b.distance).filter((r) => r.points > 0).slice(0, NAMED);
  const farthest = [...placed].sort((a, b) => b.distance - a.distance).find((r) => r.distance > SHOUT_DISTANCE && !nearest.includes(r));
  const named = [...nearest, ...(farthest ? [farthest] : [])].map((r) => {
    const pin = createPin(r.name, { className: 'pin--guess', color: VIEWER_COLOR });
    if (r === farthest) pin.append(el('span', 'pin__shout', 'そこ置く!?'));
    pin.hidden = true;
    map.append(pin);
    return [pin, r];
  });
  let answerPin = null;
  if (result.answer) {
    answerPin = createPin(ANSWER_LABEL, { className: 'pin--answer' });
    answerPin.hidden = true;
    map.append(answerPin);
  }
  const layoutOrder = [...(answerPin ? [[answerPin, result.answer]] : []), ...named.map(([pin, r]) => [pin, r.pos])];
  const layout = () => placePinsApart(map, layoutOrder.filter(([pin]) => !pin.hidden).map(([pin, pos]) => ({ pin, pos })));
  part('stage').replaceChildren(map);
  stopWatching = watchResize(map, layout);

  // 右（スマホでは上）：ワードと、何人がどこに置いたか
  const info = el('div', 'cast__result');
  const wordText = el('p', 'reveal__word cast__word', `「${word}」`);
  const stats = el('div', 'cast__stats');
  info.append(wordText, stats);
  part('info').replaceChildren(info);
  popIn(wordText, { from: 'scale(0.4) rotate(-6deg)' });

  Object.assign(view, { result, map, rings, blobs, named, answerPin, layout, stats, placed });
  renderStats(false);

  if (view.answerShown) {
    blobs.forEach((b) => (b.hidden = false));
    revealAnswer(false);
    return;
  }
  // みんなのピンを、ばらばらの順に少しずつ出す
  view.stage = 'heat';
  const order = blobs.map((b, i) => [b, Math.random(), i]).sort((a, b) => a[1] - b[1]);
  const gap = order.length ? Math.min(120, HEAT_MS / order.length) : 0;
  order.forEach(([blob], i) => {
    later(300 + i * gap, () => {
      blob.hidden = false;
      // たくさんのときは、音は少しだけ鳴らす
      if (view.mode === 'cast' && (order.length <= 12 || i % Math.ceil(order.length / 12) === 0)) sfx('pin', i % 8);
    });
  });
  later(300 + order.length * gap + 200, () => {
    view.stage = 'ready';
    renderStats(false);
    applyButtons();
  });
}

// 何人がどこに置いたか（答えを出す前は、予想した人の数だけ）
function renderStats(answered) {
  const { stats, result, placed } = view;
  if (!answered) {
    const line = el('p', 'cast__people');
    line.append(el('b', '', String(placed.length)), '人の予想');
    const hint = el('p', 'cast__how', placed.length ? '濃いところほど、たくさん集まっています' : 'だれも予想しませんでした');
    stats.replaceChildren(line, hint);
    return;
  }
  const rows = [
    ['ど真ん中', '+3', result.near, 'p3'],
    ['近い', '+1', result.close, 'p1'],
    ['はずれ', '+0', result.miss, 'p0'],
  ].map(([name, pts, n, cls]) => {
    const row = el('p', `cast__stat cast__stat--${cls}`);
    row.append(el('span', 'cast__stat-name', name), el('small', '', pts), el('b', '', `${n}人`));
    return row;
  });
  const best = [...placed].sort((a, b) => a.distance - b.distance)[0];
  const nearest = el('p', 'cast__best', best && best.points > 0 ? `ニアピン：${best.name}さん` : 'ニアピンはいませんでした');
  stats.replaceChildren(...rows, nearest);
  rows.forEach((row, i) => slideIn(row, { delay: 500 + i * 120 }));
  popIn(nearest, { delay: 900, from: 'scale(0.5) rotate(4deg)' });
}

// 答えを出す（ドキドキの演出つき／なし）
function revealAnswer(suspense) {
  if (view.stage === 'heat') {
    // このパソコンの発表がおくれていた：残りのピンをすぐに出す
    clearTimers();
    view.blobs.forEach((b) => (b.hidden = false));
  }
  view.stage = 'suspense';
  applyButtons();
  if (!suspense || reduced() || !view.result.answer) {
    finishAnswer(Boolean(suspense));
    return;
  }
  const { map, placed } = view;
  map.classList.add('is-suspense');
  const layer = el('span', 'map__spot-layer');
  const spot = el('span', 'reveal-spot');
  layer.append(spot);
  const text = el('span', 'suspense-text', 'ドキドキ…');
  map.append(layer, text);
  // スポットライトは、答えの場所とは関係なく動く（止まる場所で答えがばれないように）
  stopSpot = moveSpotlight(spot, placed.slice(0, 24).map((r) => r.pos), SUSPENSE_MS);
  if (view.mode === 'cast') {
    duckBgm(SUSPENSE_MS + 2500, 0.1);
    drumroll(SUSPENSE_MS);
  }
  later(SUSPENSE_MS, () => layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' }));
  later(SUSPENSE_MS + 250, () => {
    layer.remove();
    text.remove();
    map.classList.remove('is-suspense');
    finishAnswer(true);
  });
}

function finishAnswer(animate) {
  const { map, rings, answerPin, named } = view;
  view.stage = 'answer';
  rings.hidden = false;
  if (answerPin) answerPin.hidden = false;
  named.forEach(([pin]) => (pin.hidden = false));
  view.layout();
  renderStats(true);
  applyButtons();
  if (!animate) return;
  dropIn(answerPin);
  map.querySelectorAll('.ring').forEach((ring, i) => popIn(ring, { delay: 450 + i * 120, from: 'scale(0)', base: 'translate(-50%, -50%)' }));
  named.forEach(([pin], i) => popIn(pin, { delay: 700 + i * 120, from: 'scale(0)' }));
  later(450, () => {
    burstAt(answerPin?.querySelector('.pin__dot'), { count: 16, spread: 70, stars: true });
    if (view.mode === 'cast') sfx('reveal');
  });
  later(900, () => {
    if (view.result.near && view.mode === 'cast') sfx('sparkle');
    const shout = map.querySelector('.pin__shout');
    if (shout) {
      shake(shout.parentElement);
      if (view.mode === 'cast') later(250, () => sfx('shout'));
    }
  });
}

// ---------- このお題の結果・最後のランキング ----------

function renderRanking() {
  const end = view.phase === 'end';
  const list = end ? view.ranking ?? [] : view.ranking ?? [];
  const board = el('div', 'cast__board');
  const title = el('p', 'cast__board-title', end ? '最終ランキング' : '合計ランキング');
  const rows = el('ol', 'cast__rank');
  const items = list.map((r) => {
    const row = el('li', `cast__row${r.rank === 1 ? ' is-top' : ''}`);
    row.append(
      el('span', 'cast__row-rank', r.rank === 1 ? '★1位' : `${r.rank}位`),
      el('span', 'cast__row-name', r.name),
      el('span', 'cast__row-points', `${r.total}点`),
    );
    if (!end) row.append(el('small', 'cast__row-plus', `+${r.round}`));
    return row;
  });
  if (!items.length) items.push(el('li', 'cast__row cast__row--empty', 'まだ点を取った人はいません'));
  rows.append(...items);
  board.append(title, rows);
  part('stage').replaceChildren(board);

  const info = el('div', 'cast__summary');
  if (end) {
    const lead = el('p', 'cast__lead cast__lead--big', `${view.streamer}さんのことを一番わかっている人は…`);
    const top = list.filter((r) => r.rank === 1);
    const winner = el('p', 'cast__winner', top.length ? `${top.map((r) => r.name).join('さん・')}さん！` : '…いませんでした');
    const note = el('p', 'cast__how', top.length ? `${top[0].total}点・${list.length}人中1位` : '');
    info.append(lead, winner, note);
    popIn(winner, { delay: 600, from: 'scale(2)' });
    later(800, () => burstAt(winner, { count: 18, spread: 90, stars: true }));
    if (view.mode === 'cast') {
      later(600, () => sfx('fanfare'));
      later(600, () => confetti());
    }
  } else {
    const round = view.roundRanking ?? [];
    const lead = el('p', 'cast__lead', 'このお題の結果');
    const top = round.filter((r) => r.rank === 1 && r.round > 0);
    const best = el('p', 'cast__winner cast__winner--small', top.length ? `トップ：${top.slice(0, 3).map((r) => r.name).join('さん・')}さん（+${top[0].round}点）` : 'このお題で点を取った人はいませんでした');
    const avg = round.length ? round.reduce((a, r) => a + r.round, 0) / round.length : 0;
    const note = el('p', 'cast__how', `${round.length}人が参加・平均 ${avg.toFixed(1)}点`);
    info.append(lead, best, note);
    popIn(best, { delay: 300 });
    if (view.mode === 'cast') sfx('sparkle');
  }
  part('info').replaceChildren(info);
  items.forEach((row, i) => slideIn(row, { delay: 200 + i * 90 }));
  // 入りきらない行は出さない（画面をスクロールさせないため）
  requestAnimationFrame(() => fitRows(rows, '.cast__row'));
  stopWatching = watchResize(rows, () => fitRows(rows, '.cast__row'));
}

// 入れ物からはみ出す行を隠す
function fitRows(box, selector) {
  const items = [...box.querySelectorAll(selector)];
  items.forEach((item) => (item.hidden = false));
  const limit = box.getBoundingClientRect().bottom + 1;
  if (!box.clientHeight) return;
  for (const item of items) {
    if (item.getBoundingClientRect().bottom > limit) item.hidden = true;
  }
}

// ---------- ボタン（操作の画面だけ） ----------

function applyButtons() {
  const foot = part('foot');
  if (!view || view.mode === 'cast') {
    foot.hidden = true;
    return;
  }
  foot.hidden = false;
  const main = part('main');
  const sub = part('sub');
  const last = view.topic ? view.wordIndex >= view.topic.words.length - 1 : true;
  let mainText = '';
  let mainOn = false;
  let subText = '配信用の画面';
  if (view.phase === 'guess') {
    mainText = '締め切って答え合わせ';
    mainOn = true;
  } else if (view.phase === 'reveal') {
    const texts = { heat: 'みんなの予想を発表中…', ready: '答えを見る！', suspense: 'ドキドキ…', answer: last ? 'このお題の結果' : '次のワード' };
    mainText = texts[view.stage] ?? '';
    mainOn = view.stage === 'ready' || view.stage === 'answer';
  } else if (view.phase === 'summary') {
    subText = 'ここで終わる';
    mainText = '次のお題へ';
    mainOn = true;
  } else if (view.phase === 'end') {
    subText = '部屋を閉じる';
    mainText = 'もう一度';
    mainOn = true;
  }
  main.textContent = mainText;
  main.disabled = !mainOn;
  main.classList.toggle('is-answer', view.phase === 'reveal' && view.stage === 'ready');
  sub.textContent = subText;
}

export const castActions = {
  'cast-main': () => {
    if (!view || view.mode === 'cast') return;
    if (view.phase === 'guess') handlers.close?.();
    else if (view.phase === 'reveal' && view.stage === 'ready') handlers.answer?.();
    else if (view.phase === 'reveal' && view.stage === 'answer') handlers.next?.();
    else if (view.phase === 'summary') handlers.next?.();
    else if (view.phase === 'end') handlers.again?.();
  },
  'cast-sub': () => {
    if (!view || view.mode === 'cast') return;
    if (view.phase === 'summary') handlers.finish?.();
    else if (view.phase === 'end') handlers.quit?.();
    else handlers.openCast?.();
  },
};

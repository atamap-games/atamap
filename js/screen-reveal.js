// 答え合わせ。1ワードずつ、次の順に進める。
//   1. ワードが出る。主役が「みんなの予想を見る！」を押す（いきなりピンが出ないように、ひと呼吸おく）
//   2. みんなの予想のピンを、0.5秒ごとに1本ずつ出す（主役はここでコメントできる）
//   3. 出そろったら、主役が「答えを見る！」を押す
//   4. ドキドキの演出（スポットライトがマップの上を動き、だんだんゆっくりになって答えの場所で止まる）
//   5. 答えのピンが落ちてきて、3点・1点の輪が広がり、点数が出る。かなり遠い人には全員「そこ置く!?」
// 5つ終わったら、主役が「結果を見る」を押す。ラウンドの結果を、下の順位から1人ずつ出し、
// 最後に「1位は…？」（ドキドキ）のあと、1位を発表する（紙ふぶき・ファンファーレ）。
import { showScreen, el } from './ui.js';
import { createMap, createPin, placePinsApart, watchResize, ANSWER_LABEL } from './mapview.js';
import { playerById } from './game.js';
import { wordResult, roundPoints, biggestMiss, gradeName, NEAR, CLOSE } from './score.js';
import { popIn, dropIn, slideIn, burstAt, shake, haptic, reduced, moveSpotlight, confetti } from './fx.js';
import { sfx, drumroll, stopDrumroll, duckBgm } from './sound.js';

const screen = document.querySelector('[data-screen="reveal"]');
const part = (name) => screen.querySelector(`[data-reveal="${name}"]`);
const nextButton = () => screen.querySelector('[data-action="reveal-next"]');

// 予想のピンを出す間かく（ミリ秒）
const PIN_INTERVAL = 500;
// この距離より遠い予想には「そこ置く!?」と出す
const SHOUT_DISTANCE = 35;
// ドキドキの演出：スポットライトがめぐる時間（ミリ秒）
const SUSPENSE_MS = 5000;

// ラウンドの結果の、最後の段（今は1段だけ。押さずに、下から順に出る）
export const SUMMARY_LAST_STEP = 0;
// ラウンドの結果：1人ずつ出す間かく・1位の前のドキドキの長さ（ミリ秒）
const RANK_INTERVAL = 700;
const RANK_DRUM_MS = 2000;

// 今出している答え合わせ
// stage：'intro'（予想を見る前）→ 'pins'（予想を発表中）→ 'ready'（答えを見る前）→ 'suspense'（ドキドキ）→ 'answer'（答えを出した）／ 'summary'（ラウンドの結果）
let view = null;
let stopWatching = () => {};
let timers = [];
// スポットライトの動きを止める関数
let stopSpot = () => {};

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
 * 1台で遊ぶとき：答え合わせを最後（まとめ）まで、このスマホで進める。
 * @param {object} options
 * @param {object} options.game ゲーム
 * @param {{ id: string, name: string }} options.main 主役
 * @param {object} options.topic 主役のお題
 * @param {boolean} options.isLast 最後のラウンドか
 * @returns {Promise<void>} まとめで「次の主役へ」（最終結果へ）を押したら終わる
 */
export function showReveal({ game, main, topic, isLast }) {
  return new Promise((resolve) => {
    const count = topic.words.length;
    let index = 0;
    let answerShown = false;
    let pinsShown = false;
    let step = 0;
    const show = () => showRevealAt({
      key: `solo:${main.id}`,
      game,
      main,
      topic,
      isLast,
      index,
      answerShown,
      pinsShown,
      step,
      canAdvance: true,
      onPins: () => {
        pinsShown = true;
        show();
      },
      onAnswer: () => {
        answerShown = true;
        show();
      },
      onNext: () => {
        if (index < count) {
          index += 1;
          answerShown = false;
          pinsShown = false;
          step = 0;
          show();
        } else if (step < SUMMARY_LAST_STEP) {
          step += 1;
          show();
        } else {
          stopReveal();
          resolve();
        }
      },
    });
    show();
  });
}

/**
 * 答え合わせの、決まった場所を出す（同じものを何度呼んでもよい）。
 * 部屋で遊ぶときは、部屋のデータが変わるたびに呼ばれる。
 * @param {object} options
 * @param {string} options.key ラウンドを見分ける文字（ラウンドが変わったら作り直す）
 * @param {object} options.game ゲーム
 * @param {{ id: string, name: string }} options.main 主役
 * @param {object} options.topic 主役のお題
 * @param {boolean} options.isLast 最後のラウンドか
 * @param {number} options.index 何番目のワードか（0から。ワードの数と同じならまとめ）
 * @param {boolean} options.answerShown 答えを出したか
 * @param {boolean} [options.pinsShown] みんなの予想を出したか
 * @param {number} [options.step] ラウンドの結果の、何段目か（0〜SUMMARY_LAST_STEP）
 * @param {boolean} options.canAdvance このスマホでボタンを押せるか（部屋で遊ぶときは主役だけ）
 * @param {() => void} [options.onPins] 「みんなの予想を見る！」を押したとき
 * @param {() => void} options.onAnswer 「答えを見る！」を押したとき
 * @param {() => void} options.onNext 「次のワード」「次の主役へ」などを押したとき
 */
export function showRevealAt(options) {
  const { key, index, answerShown } = options;
  const sameWord = view && view.key === key && view.index === index;
  const wasShown = view?.answerShown;
  view = sameWord ? Object.assign(view, options) : { ...options, stage: 'intro' };
  view.step = view.step ?? 0;

  part('word').classList.remove('reveal__word--long');
  part('who').textContent = `主役：${view.main.name}さん`;
  part('title').textContent = view.topic.title;

  if (index >= words().length) {
    if (!sameWord) renderSummary();
  } else if (!sameWord) {
    renderWord();
  } else {
    if (view.pinsShown && view.stage === 'intro' && !answerShown) startPins();
    if (answerShown && !wasShown && ['intro', 'pins', 'ready'].includes(view.stage)) revealAnswer({ suspense: true });
  }
  applyButton();
  showScreen('reveal');
}

/** 画面を離れるときの後片づけ */
export function stopReveal() {
  stopDrumroll();
  stopWatching();
  stopWatching = () => {};
  clearTimers();
  view = null;
}

function words() {
  return view.game.maps[view.main.id].placements.map((p) => p.word);
}

// ---------- 1つのワード ----------

function renderWord() {
  clearTimers();
  const list = words();
  const word = list[view.index];
  const { game, main, topic } = view;
  const result = wordResult(game, main.id, word);

  part('count').textContent = `${view.index + 1}/${list.length}`;
  part('word').textContent = `「${word}」`;
  part('summary').hidden = true;
  part('map').hidden = false;
  part('scores').hidden = false;

  const map = createMap(topic, 'map--static map--reveal');

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
  map.append(rings);

  // みんなの予想（はじめは見せず、0.5秒ごとに1本ずつ出す）
  const guessPins = [];
  for (const r of result.results) {
    if (!r.pos) continue;
    const player = playerById(game, r.playerId);
    const pin = createPin(player.name, { className: 'pin--guess', color: player.color });
    // かなり遠くに置いた人には、全員「そこ置く!?」（答えを出したら見せる）
    if (r.distance !== null && r.distance > SHOUT_DISTANCE) {
      const shout = el('span', 'pin__shout', 'そこ置く!?');
      shout.hidden = true;
      pin.append(shout);
    }
    pin.hidden = true;
    map.append(pin);
    guessPins.push([pin, r]);
  }

  // 主役の答え（答えを出すまで見せない）
  let answerPin = null;
  if (result.answer) {
    answerPin = createPin(ANSWER_LABEL, { className: 'pin--answer' });
    answerPin.hidden = true;
    map.append(answerPin);
  }

  // 点数の札とピンを出す順（点の高い順）
  const ordered = [...result.results].sort((a, b) => b.points - a.points || (a.distance ?? 999) - (b.distance ?? 999));

  // 名札が重ならないように並べる。答えの名札がいちばん先に、点のすぐそばの場所を取る。予想は出した順
  const layoutOrder = [
    ...(answerPin ? [[answerPin, result.answer]] : []),
    ...ordered.map((r) => guessPins.find(([, x]) => x === r)).filter(Boolean).map(([pin, r]) => [pin, r.pos]),
  ];
  const layout = () => placePinsApart(map, layoutOrder.filter(([pin]) => !pin.hidden).map(([pin, pos]) => ({ pin, pos })));
  part('map').replaceChildren(map);
  stopWatching();
  stopWatching = watchResize(map, layout);

  // 点数の札：はじめは名前だけ。答えを出したら点数を入れる
  const chips = ordered.map((r) => {
    const player = playerById(game, r.playerId);
    const chip = el('span', 'score-chip score-chip--pending');
    chip.style.setProperty('--player-color', player.color);
    chip.append(el('b', '', player.name), el('span', '', '？'));
    chip.hidden = true;
    return [chip, r];
  });
  part('scores').classList.toggle('scores--compact', result.results.length > 4);
  part('scores').replaceChildren(...chips.map(([chip]) => chip));

  Object.assign(view, { result, map, rings, guessPins, answerPin, chips, layout });
  popIn(part('word'), { from: 'scale(0.4) rotate(-6deg)' });

  if (view.answerShown) {
    // もう答えを出したあと（途中から開いたときなど）：全部すぐに出す
    guessPins.forEach(([pin]) => showGuess(pin, false));
    chips.forEach(([chip]) => (chip.hidden = false));
    revealAnswer({ suspense: false });
    return;
  }

  view.steps = ordered.map((r) => [chips.find(([, x]) => x === r)[0], guessPins.find(([, x]) => x === r)?.[0]]);
  if (view.pinsShown) {
    startPins({ cue: false });
    return;
  }
  // 主役が「みんなの予想を見る！」を押すまで、マップに問いかけだけを出しておく
  view.stage = 'intro';
  const ask = el('span', 'suspense-text suspense-text--ask', 'みんなの予想は…？');
  map.append(ask);
  view.ask = ask;
  popIn(ask, { delay: 250, from: 'scale(0.4)', base: 'translate(-50%, -50%)' });
}

// 予想のピンを、0.5秒ごとに1本ずつ出す。置かなかった人の札も、同じ順に出す
function startPins({ cue = true } = {}) {
  view.stage = 'pins';
  applyButton();
  view.ask?.remove();
  view.ask = null;
  // 「デデン！」と鳴らしてから出しはじめる
  const wait = cue ? 700 : 300;
  if (cue) {
    sfx('pinsCue');
    haptic(10);
  }
  view.steps.forEach(([chip, pin], i) => {
    later(wait + i * PIN_INTERVAL, () => {
      if (pin) showGuess(pin, true);
      chip.hidden = false;
      popIn(chip);
    });
  });
  later(wait + view.steps.length * PIN_INTERVAL, () => {
    view.stage = 'ready';
    applyButton();
  });
}

// 予想のピンを出す
function showGuess(pin, animate) {
  pin.hidden = false;
  view.layout();
  if (animate) {
    popIn(pin, { from: 'scale(0)' });
    haptic(6);
    sfx('pin', view.guessPins.filter(([p]) => !p.hidden).length - 1);
  }
}

// 答えを出す（ドキドキの演出つき／なし）
function revealAnswer({ suspense }) {
  if (view.stage === 'pins' || view.stage === 'intro') {
    // 予想の発表のとちゅうで答えが出た（このスマホの発表がおくれていた）：残りの予想をすぐに出す
    clearTimers();
    view.ask?.remove();
    view.ask = null;
    view.guessPins.forEach(([pin]) => pin.hidden && showGuess(pin, false));
    view.chips.forEach(([chip]) => (chip.hidden = false));
  }
  view.stage = 'suspense';
  applyButton();
  if (!suspense || reduced() || !view.result.answer) {
    finishAnswer(Boolean(suspense));
    return;
  }
  const { map, guessPins } = view;
  map.classList.add('is-suspense');
  // スポットライトは、マップの中だけを暗くする（外にはみ出さない入れ物に入れる）
  const layer = el('span', 'map__spot-layer');
  const spot = el('span', 'reveal-spot');
  layer.append(spot);
  const text = el('span', 'suspense-text', 'ドキドキ…');
  map.append(layer, text);
  // スポットライトが、みんなの予想とランダムな場所を5秒、なめらかにめぐる（答えの場所とは関係ない。止まる場所で答えがばれないように）
  stopSpot = moveSpotlight(spot, guessPins.map(([, r]) => r.pos), SUSPENSE_MS);
  haptic(8);
  // BGM を小さくして、小太鼓のロール
  duckBgm(SUSPENSE_MS + 2500, 0.1);
  drumroll(SUSPENSE_MS);
  // 最後はスポットライトがぱっと消えて、答えが落ちてくる
  later(SUSPENSE_MS, () => layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' }));
  later(SUSPENSE_MS + 250, () => {
    haptic(30);
    layer.remove();
    text.remove();
    map.classList.remove('is-suspense');
    finishAnswer(true);
  });
}

// 答えのピン・輪・点数を出す
function finishAnswer(animate) {
  const { map, rings, answerPin, chips, guessPins, result } = view;
  view.stage = 'answer';
  rings.hidden = false;
  // 「そこ置く!?」（名札を並べる前に出して、その大きさも入れて並べる）
  const shouts = [...map.querySelectorAll('.pin__shout')];
  shouts.forEach((shout) => (shout.hidden = false));
  if (answerPin) answerPin.hidden = false;
  view.layout();
  // 点数を入れる
  for (const [chip, r] of chips) {
    chip.hidden = false;
    chip.classList.remove('score-chip--pending');
    chip.classList.add(`score-chip--p${r.points}`);
    const compact = result.results.length > 4;
    chip.lastElementChild.textContent = r.pos ? `${compact ? '' : `${gradeName(r.points)} `}+${r.points}` : `${compact ? '' : '置かず '}+0`;
  }
  applyButton();
  if (!animate) return;

  dropIn(answerPin);
  map.querySelectorAll('.ring').forEach((ring, i) => popIn(ring, { delay: 450 + i * 120, from: 'scale(0)', base: 'translate(-50%, -50%)' }));
  later(450, () => {
    burstAt(answerPin?.querySelector('.pin__dot'), { count: 16, spread: 70, stars: true });
    haptic([30, 30, 60]);
    sfx('reveal');
  });
  chips.forEach(([chip], i) => popIn(chip, { delay: 700 + i * 70 }));
  later(900, () => {
    const bullseye = guessPins.filter(([, r]) => r.points === 3);
    bullseye.forEach(([pin]) => burstAt(pin.querySelector('.pin__dot'), { count: 10, spread: 40, stars: true }));
    if (bullseye.length) sfx('sparkle');
    if (shouts.length) {
      shouts.forEach((shout, i) => later(i * 120, () => shake(shout.parentElement)));
      later(bullseye.length ? 250 : 0, () => sfx('shout'));
    }
  });
}

// ---------- まとめ ----------

function renderSummary() {
  clearTimers();
  stopWatching();
  view.stage = 'summary-playing';
  const { game, main } = view;
  const points = roundPoints(game, main.id);
  const sorted = Object.entries(points).sort((a, b) => b[1] - a[1]);
  const best = sorted.length ? sorted[0][1] : 0;
  // 同じ点なら同じ順位
  let rank = 0;
  let last = null;
  const rows = sorted.map(([id, total], i) => {
    if (total !== last) {
      rank = i + 1;
      last = total;
    }
    const player = playerById(game, id);
    const top = rank === 1;
    const row = el('li', `summary__row${top ? ' summary__row--top' : ''} is-waiting`);
    row.style.setProperty('--player-color', player.color);
    row.append(el('span', 'summary__rank', `${rank}位`), el('span', 'summary__name', player.name), el('span', 'summary__points', `+${total}点`));
    return { row, top, name: player.name };
  });
  const miss = biggestMiss(game, main.id);
  part('count').textContent = '結果';
  part('word').textContent = '結果発表！';
  part('word').classList.remove('reveal__word--long');
  part('map').hidden = true;
  part('scores').hidden = true;
  part('summary').hidden = false;
  const list = el('ol', `summary__list${rows.length > 4 ? ' summary__list--two' : ''}`);
  list.append(...rows.map((r) => r.row));
  const missText = el('p', 'summary__miss', miss ? `いちばんズレたのは「${miss.word}」。${main.name}さん、ひとこと説明を！` : '');
  missText.hidden = true;
  part('summary').replaceChildren(list, missText);
  popIn(part('word'), { from: 'scale(0.4) rotate(-6deg)' });
  applyButton();

  // 下の順位から1人ずつ出す（場所はとっておき、順番に見せる）
  const tops = rows.filter((r) => r.top);
  const others = rows.filter((r) => !r.top).reverse();
  const nobody = best === 0;
  const start = 500;
  others.forEach((r, i) => later(start + i * RANK_INTERVAL, () => {
    r.row.classList.remove('is-waiting');
    slideIn(r.row);
    sfx('rankRow', i);
  }));
  // 1位の前：「1位は…？」とドキドキ
  const drumAt = start + others.length * RANK_INTERVAL;
  later(drumAt, () => {
    part('word').textContent = nobody ? 'そして…' : '1位は…？';
    popIn(part('word'), { from: 'scale(0.6)' });
    duckBgm(RANK_DRUM_MS + 2500, 0.15);
    drumroll(RANK_DRUM_MS, 'rankDrum');
  });
  // 1位の発表
  later(drumAt + RANK_DRUM_MS, () => {
    tops.forEach((r) => r.row.classList.remove('is-waiting'));
    // 同点のときは人数だけ（名前は下の札に出る）
    part('word').textContent = nobody ? '全員0点…！' : tops.length > 1 ? `1位は${tops.length}人！` : `1位は${tops[0].name}さん！`;
    // 名前が長いときは、1行に入るように文字を小さくする
    part('word').classList.toggle('reveal__word--long', part('word').textContent.length > 9);
    popIn(part('word'), { from: 'scale(2)' });
    tops.forEach((r, i) => popIn(r.row, { delay: i * 120, from: 'scale(1.6) rotate(-4deg)' }));
    haptic([30, 30, 80]);
    if (nobody) {
      sfx('rankZero');
      tops.forEach((r) => shake(r.row));
    } else {
      sfx('rankTop');
      later(150, () => tops.forEach((r) => burstAt(r.row.querySelector('.summary__points'), { count: 18, spread: 80, stars: true })));
      later(200, () => confetti({ duration: 2200, count: 90 }));
    }
    view.stage = 'summary';
    applyButton();
  });
  if (miss) {
    later(drumAt + RANK_DRUM_MS + 1300, () => {
      missText.hidden = false;
      popIn(missText, { from: 'scale(0.6) rotate(3deg)' });
    });
  }
}

// ---------- ボタン ----------

// 今の段階に合わせて、ボタンの文字と押せるかを決める
function applyButton() {
  if (!view) return;
  const button = nextButton();
  const can = view.canAdvance;
  const last = view.index >= words().length - 1;
  const texts = {
    intro: ['みんなの予想を見る！', '主役が予想を出します'],
    pins: ['みんなの予想を発表中…', 'みんなの予想を発表中…'],
    ready: ['答えを見る！', '主役が答えを出します'],
    suspense: ['ドキドキ…', 'ドキドキ…'],
    answer: [last ? '結果を見る' : '次のワード', '主役が進めます'],
    'summary-playing': ['結果発表中…', '結果発表中…'],
    summary: [view.isLast ? '最終結果へ' : '次の主役へ', '主役が進めます'],
  };
  const enabled = can && ['intro', 'ready', 'answer', 'summary'].includes(view.stage);
  button.disabled = !enabled;
  button.textContent = texts[view.stage][can ? 0 : 1];
  button.classList.toggle('is-answer', view.stage === 'ready' && can);
}

export const revealActions = {
  'reveal-next': () => {
    if (!view || !view.canAdvance) return;
    if (view.stage === 'intro') view.onPins?.();
    else if (view.stage === 'ready') view.onAnswer?.();
    else if (view.stage === 'answer' || view.stage === 'summary') view.onNext?.();
  },
};

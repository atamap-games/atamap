// トップ画面の見本：答え合わせのデモを、お題を変えながらくり返し見せる。
//   みんなの予想のピンが1本ずつ出る → スポットライトがめぐる → 答えが落ちてくる → 次のお題
// トップ画面を出しているあいだだけ動かす。スマホが「動きを減らす」設定のときは、答えまで出した1枚の絵にする。
import { el } from './ui.js';
import { loadTopics } from './topics.js';
import { createMap, createPin, placePinsApart, watchResize, ANSWER_LABEL } from './mapview.js';
import { PLAYER_COLORS } from './game.js';
import { NEAR, CLOSE } from './score.js';
import { popIn, dropIn, burstAt, shake, reduced, moveSpotlight } from './fx.js';

const stage = document.querySelector('[data-screen="top"] .sample__stage');
const caption = document.querySelector('[data-screen="top"] .sample__caption');

// デモの予想をする人
const PLAYERS = [
  { name: 'あおい', color: PLAYER_COLORS[0] },
  { name: 'みなと', color: PLAYER_COLORS[1] },
  { name: 'ゆい', color: PLAYER_COLORS[2] },
];
// 1つのお題の流れ（ミリ秒）
const FIRST_PIN = 700;
const PIN_INTERVAL = 500;
const SPOT_MS = 5000;
const HOLD = 2600;
const FADE = 350;

let running = false;
let timers = [];
let stopSpot = () => {};
let stopWatching = () => {};
let topics = null;
let order = [];

/** デモを始める（トップ画面を出すときに呼ぶ。動いていれば何もしない） */
export async function startDemo() {
  if (running || !stage) return;
  running = true;
  try {
    topics ??= await loadTopics();
  } catch {
    running = false;
    return; // 読みこめないときは、HTML にある見本のまま
  }
  if (!running) return;
  next();
}

/** デモを止める（トップ画面を離れるときに呼ぶ） */
export function stopDemo() {
  running = false;
  timers.forEach((t) => window.clearTimeout(t));
  timers = [];
  stopSpot();
  // とちゅうで止めたときは、スポットライトを片づける
  stage?.querySelectorAll('.map__spot-layer, .suspense-text').forEach((part) => part.remove());
}

// 画面が見えていないあいだ（ほかのアプリを開いたときなど）は止めておき、もどったら続ける
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (running) {
      stopDemo();
      running = 'paused';
    }
  } else if (running === 'paused') {
    running = false;
    startDemo();
  }
});

function later(ms, callback) {
  timers.push(window.setTimeout(() => running === true && callback(), ms));
}

// 次のお題を出す（50個を順番を混ぜて、ひととおり出す）
function next() {
  if (!order.length) order = shuffle(topics.map((t) => t.id));
  const id = order.pop();
  const topic = topics.find((t) => t.id === id);
  play(topic, topic.words[Math.floor(Math.random() * topic.words.length)]);
}

function play(topic, word) {
  const still = reduced();
  const answer = { x: rand(18, 82), y: rand(18, 82) };
  const guesses = makeGuesses(answer);

  const map = createMap(topic, 'map--static map--demo');
  const rings = el('span', 'map__rings');
  for (const [radius, name] of [[CLOSE, 'ring--close'], [NEAR, 'ring--near']]) {
    const ring = el('span', `ring ${name}`);
    ring.style.left = `${answer.x}%`;
    ring.style.top = `${answer.y}%`;
    ring.style.width = ring.style.height = `${radius * 2}%`;
    rings.append(ring);
  }
  rings.hidden = true;
  map.append(rings);
  const guessPins = guesses.map((g) => {
    const pin = createPin(g.name, { className: 'pin--guess', color: g.color });
    pin.hidden = true;
    map.append(pin);
    return [pin, g.pos];
  });
  // 遠くに置いた人には、答えが出たら「そこ置く!?」（本番の答え合わせと同じ）
  const farIndex = guesses.findIndex((g) => g.far);
  const shout = el('span', 'pin__shout', 'そこ置く!?');
  shout.hidden = true;
  if (farIndex >= 0) guessPins[farIndex][0].append(shout);
  const answerPin = createPin(ANSWER_LABEL, { className: 'pin--answer' });
  answerPin.hidden = true;
  map.append(answerPin);

  const layout = () => placePinsApart(map, [[answerPin, answer], ...guessPins]
    .filter(([pin]) => !pin.hidden)
    .map(([pin, pos]) => ({ pin, pos })));
  stage.querySelector('.map')?.remove();
  stage.append(map);
  stopWatching();
  stopWatching = watchResize(map, layout);
  caption.textContent = `お題「${topic.title}」の「${word}」はどこ？`;

  if (still) {
    // 動きを減らす設定：答えまで出した1枚の絵
    guessPins.forEach(([pin]) => (pin.hidden = false));
    answerPin.hidden = false;
    shout.hidden = false;
    rings.hidden = false;
    layout();
    return;
  }

  popIn(map, { from: 'scale(0.85)' });
  popIn(caption, { from: 'scale(0.8)' });
  // 予想のピンを1本ずつ
  guessPins.forEach(([pin], i) => {
    later(FIRST_PIN + i * PIN_INTERVAL, () => {
      pin.hidden = false;
      layout();
      popIn(pin, { from: 'scale(0)' });
    });
  });
  // スポットライトが予想とランダムな場所を5秒めぐる（本番と同じく、答えの場所とは関係ない）
  let time = FIRST_PIN + guessPins.length * PIN_INTERVAL + 300;
  const layer = el('span', 'map__spot-layer');
  const spot = el('span', 'reveal-spot');
  layer.append(spot);
  const text = el('span', 'suspense-text', 'ドキドキ…');
  later(time, () => {
    map.append(layer, text);
    stopSpot = moveSpotlight(spot, guesses.map((g) => g.pos), SPOT_MS);
  });
  time += SPOT_MS;
  later(time, () => layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' }));
  // 答えが落ちてくる
  later(time + 250, () => {
    layer.remove();
    text.remove();
    rings.hidden = false;
    answerPin.hidden = false;
    shout.hidden = false;
    layout();
    dropIn(answerPin);
    popIn(shout, { delay: 650, from: 'scale(0) rotate(-20deg)', base: 'translateX(-50%) rotate(-5deg)' });
    later(900, () => shake(shout.parentElement));
    rings.querySelectorAll('.ring').forEach((ring, i) => popIn(ring, { delay: 400 + i * 120, from: 'scale(0)', base: 'translate(-50%, -50%)' }));
    later(420, () => burstAt(answerPin.querySelector('.pin__dot'), { count: 12, spread: 50, stars: true }));
  });
  time += 250 + HOLD;
  // うすく消えて、次のお題へ
  later(time, () => map.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.92)' }], { duration: FADE, fill: 'forwards' }));
  later(time + FADE, next);
}

// 予想の場所：1人は近く（3点）、1人は少しずれて（1点）、1人は遠く
function makeGuesses(answer) {
  const at = (min, max) => {
    const angle = Math.random() * Math.PI * 2;
    const dist = rand(min, max);
    return { x: clamp(answer.x + Math.cos(angle) * dist), y: clamp(answer.y + Math.sin(angle) * dist) };
  };
  // 遠い人は、本番で「そこ置く!?」が出る距離（35）より遠くに置く
  const spots = shuffle([{ pos: at(2, CLOSE - 2) }, { pos: at(CLOSE + 2, NEAR - 2) }, { pos: farFrom(answer), far: true }]);
  return PLAYERS.map((p, i) => ({ ...p, ...spots[i] }));
}

// 答えから40以上はなれた場所（マップの中で、いちばん遠い側から選ぶ）
function farFrom(answer) {
  for (let i = 0; i < 30; i++) {
    const pos = { x: rand(8, 92), y: rand(8, 92) };
    if (Math.hypot(pos.x - answer.x, pos.y - answer.y) >= 40) return pos;
  }
  return { x: answer.x < 50 ? 88 : 12, y: answer.y < 50 ? 88 : 12 };
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(v) {
  return Math.min(92, Math.max(8, v));
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

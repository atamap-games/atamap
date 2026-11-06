// 答え合わせ。1ワードずつ、主役の答えとみんなの予想を重ねて見せ、点数をつける。
// 5つ終わったら、そのラウンドのまとめを出す。
import { showScreen, el } from './ui.js';
import { createMap, createPin, placePin, watchResize } from './mapview.js';
import { playerById } from './game.js';
import { wordResult, roundPoints, biggestMiss, gradeName, NEAR, CLOSE } from './score.js';

const screen = document.querySelector('[data-screen="reveal"]');
const part = (name) => screen.querySelector(`[data-reveal="${name}"]`);
const nextButton = () => screen.querySelector('[data-action="reveal-next"]');

// この距離より遠い予想には「そこ置く!?」と出す
const SHOUT_DISTANCE = 35;

let state = null;
let stopWatching = () => {};

/**
 * @param {object} options
 * @param {object} options.game ゲーム
 * @param {{ id: string, name: string }} options.main 主役
 * @param {object} options.topic 主役のお題
 * @param {boolean} options.isLast 最後のラウンドか
 */
export function showReveal({ game, main, topic, isLast }) {
  stopReveal();
  state = { game, main, topic, isLast, index: 0, resolve: null };
  part('who').textContent = `主役：${main.name}さん`;
  part('title').textContent = topic.title;
  renderWord();
  showScreen('reveal');
  return new Promise((resolve) => {
    state.resolve = resolve;
  });
}

/**
 * 部屋で遊ぶとき：決まった場所（何番目のワードか、まとめか）を出す。進めるのはホストだけ。
 * @param {object} options showReveal と同じものに加えて
 * @param {number} options.index 何番目のワードか（0から。ワードの数と同じならまとめ）
 * @param {boolean} options.canAdvance このスマホで「次へ」を押せるか（ホストだけ）
 * @param {() => void} options.onNext 「次へ」を押したとき
 */
export function showRevealAt({ game, main, topic, isLast, index, canAdvance, onNext }) {
  stopReveal();
  state = { game, main, topic, isLast, index, controlled: true, canAdvance, onNext };
  part('who').textContent = `主役：${main.name}さん`;
  part('title').textContent = topic.title;
  if (index < words().length) renderWord();
  else renderSummary();
  showScreen('reveal');
}

/** 画面を離れるときの後片づけ */
export function stopReveal() {
  stopWatching();
  stopWatching = () => {};
}

function words() {
  return state.game.maps[state.main.id].placements.map((p) => p.word);
}

function renderWord() {
  const list = words();
  const word = list[state.index];
  const { game, main, topic } = state;
  const result = wordResult(game, main.id, word);

  part('count').textContent = `${state.index + 1}/${list.length}`;
  part('word').textContent = `「${word}」`;
  part('word').hidden = false;
  part('summary').hidden = true;
  part('map').hidden = false;
  part('scores').hidden = false;

  // マップ：主役の答えのまわりに、3点・1点の範囲を輪で出す
  const map = createMap(topic, 'map--static map--reveal');
  const pins = [];
  if (result.answer) {
    const rings = el('span', 'map__rings');
    for (const [radius, name] of [[CLOSE, 'ring--close'], [NEAR, 'ring--near']]) {
      const ring = el('span', `ring ${name}`);
      ring.style.left = `${result.answer.x}%`;
      ring.style.top = `${result.answer.y}%`;
      ring.style.width = ring.style.height = `${radius * 2}%`;
      rings.append(ring);
    }
    map.append(rings);
  }
  const farthest = result.results
    .filter((r) => r.distance !== null && r.distance > SHOUT_DISTANCE)
    .sort((a, b) => b.distance - a.distance)[0];
  for (const r of result.results) {
    if (!r.pos) continue;
    const player = playerById(game, r.playerId);
    const pin = createPin(player.name, { className: 'pin--guess', color: player.color });
    if (r === farthest) pin.append(el('span', 'pin__shout', 'そこ置く!?'));
    map.append(pin);
    pins.push([pin, r.pos]);
  }
  if (result.answer) {
    const answer = createPin('答え', { className: 'pin--answer' });
    map.append(answer);
    pins.push([answer, result.answer]);
  }
  part('map').replaceChildren(map);
  const layout = () => pins.forEach(([pin, pos]) => placePin(pin, map, pos));
  stopWatching();
  stopWatching = watchResize(map, layout);
  layout();

  // 点数：近い人から順に
  const chips = [...result.results]
    .sort((a, b) => b.points - a.points || (a.distance ?? 999) - (b.distance ?? 999))
    .map((r) => {
      const player = playerById(game, r.playerId);
      const chip = el('span', `score-chip score-chip--p${r.points}`);
      chip.style.setProperty('--player-color', player.color);
      const compact = result.results.length > 4;
      const detail = r.pos ? `${compact ? '' : `${gradeName(r.points)} `}+${r.points}` : `${compact ? '' : '置かず '}+0`;
      chip.append(el('b', '', player.name), el('span', '', detail));
      return chip;
    });
  part('scores').classList.toggle('scores--compact', result.results.length > 4);
  part('scores').replaceChildren(...chips);

  nextButton().textContent = state.index < list.length - 1 ? '次のワード' : 'このラウンドの結果';
  applyControl();
}

// 部屋で遊ぶとき、ホスト以外は「次へ」を押せない
function applyControl() {
  const button = nextButton();
  const waiting = state.controlled && !state.canAdvance;
  button.disabled = waiting;
  if (waiting) button.textContent = 'ホストが進めます';
}

function renderSummary() {
  const { game, main, isLast } = state;
  const points = roundPoints(game, main.id);
  const rows = Object.entries(points)
    .sort((a, b) => b[1] - a[1])
    .map(([id, total]) => {
      const player = playerById(game, id);
      const row = el('li', 'summary__row');
      row.style.setProperty('--player-color', player.color);
      row.append(el('span', 'summary__name', player.name), el('span', 'summary__points', `+${total}点`));
      return row;
    });
  const miss = biggestMiss(game, main.id);
  part('count').textContent = 'まとめ';
  part('word').textContent = 'このラウンドの点数';
  part('map').hidden = true;
  part('scores').hidden = true;
  part('summary').hidden = false;
  const list = el('ol', `summary__list${rows.length > 4 ? ' summary__list--two' : ''}`);
  list.append(...rows);
  part('summary').replaceChildren(
    list,
    el('p', 'summary__miss', miss ? `いちばんズレたのは「${miss.word}」。${main.name}さん、ひとこと説明を！` : ''),
  );
  stopWatching();
  nextButton().textContent = isLast ? '最終結果へ' : '次の主役へ';
  applyControl();
}

export const revealActions = {
  'reveal-next': () => {
    if (!state) return;
    if (state.controlled) {
      if (state.canAdvance) state.onNext?.();
      return;
    }
    const count = words().length;
    if (state.index < count - 1) {
      state.index += 1;
      renderWord();
    } else if (state.index === count - 1) {
      state.index += 1;
      renderSummary();
    } else {
      const resolve = state.resolve;
      state.resolve = null;
      stopReveal();
      resolve?.();
    }
  },
};

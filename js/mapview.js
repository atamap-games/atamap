// マップの見た目を作る部品（軸・軸の言葉・ピン）。動かす操作は board.js、答え合わせの表示は screen-reveal.js で使う。
// 座標は x：左 0 → 右 100、y：上 0 → 下 100（マップの見たままの向き）。
import { el } from './ui.js';
import { arrangeLabels } from './labels.js';

// ピンの名札と点のすきま（px）
const LABEL_GAP = 12;

/**
 * 軸と軸の言葉が入ったマップを作る。
 * @param {object} topic お題（axes に top/bottom/left/right の言葉）
 * @param {string} [extraClass] マップに足すクラス
 */
export function createMap(topic, extraClass = '') {
  const map = el('div', `map ${extraClass}`.trim());
  map.append(el('span', 'map__axis map__axis--v'), el('span', 'map__axis map__axis--h'));
  for (const side of ['top', 'bottom', 'left', 'right']) {
    const label = el('span', `map__label map__label--${side}`, topic.axes[side]);
    map.append(label);
  }
  return map;
}

/**
 * ピン（点と名札）を作る。
 * @param {string} text 名札の文字
 * @param {object} [options]
 * @param {string} [options.className] 足すクラス
 * @param {string} [options.color] 点と名札のふちの色
 */
export function createPin(text, { className = '', color = '' } = {}) {
  const pin = el('div', `pin ${className}`.trim());
  pin.append(el('span', 'pin__label', text), el('span', 'pin__dot'));
  if (color) pin.style.setProperty('--pin-color', color);
  return pin;
}

/** マップの上のピンを、座標の場所に置き、名札がはみ出さないように整える */
export function placePin(pin, map, pos) {
  pin.style.left = `${pos.x}%`;
  pin.style.top = `${pos.y}%`;
  fitLabel(pin, (pos.x / 100) * map.clientWidth, (pos.y / 100) * map.clientHeight, map.clientWidth);
}

/**
 * 名札を左右にずらして枠の中に収め、上が狭いときは点の下に出す。
 * @param {HTMLElement} pin ピン
 * @param {number} x 点の位置（枠の左からの px）
 * @param {number} y 点の位置（枠の上からの px）
 * @param {number} areaWidth 枠の幅（px）
 */
export function fitLabel(pin, x, y, areaWidth) {
  const label = pin.querySelector('.pin__label');
  if (!label) return;
  const labelWidth = label.offsetWidth;
  const margin = 4;
  const left = x - labelWidth / 2;
  const fitted = Math.min(Math.max(left, margin), areaWidth - labelWidth - margin);
  pin.style.setProperty('--shift', `${Math.round(fitted - left)}px`);
  pin.classList.toggle('pin--below', y < label.offsetHeight + LABEL_GAP + 2);
}

/**
 * 何本ものピンを置き、名札がたがいに重ならないように並べる（答え合わせのマップで使う）。
 * 名札を点から離したときは、点と名札を細い線でつなぐ。
 * @param {HTMLElement} map マップ
 * @param {Array<{ pin: HTMLElement, pos: { x: number, y: number } }>} entries 見えているピン。先のものほど点のそばに名札を置く
 */
export function placePinsApart(map, entries) {
  const width = map.clientWidth;
  const height = map.clientHeight;
  if (!width || !height) return;
  const mapBox = map.getBoundingClientRect();
  // 軸の言葉には、なるべく重ねない
  // （画面が切りかわる動きで、マップが拡大・縮小されているときも測れるように、大きさの比で割る）
  const scale = mapBox.width / map.offsetWidth || 1;
  const soft = [...map.querySelectorAll('.map__label')].map((label) => {
    const r = label.getBoundingClientRect();
    return {
      x: (r.left - mapBox.left) / scale - map.clientLeft,
      y: (r.top - mapBox.top) / scale - map.clientTop,
      w: r.width / scale,
      h: r.height / scale,
    };
  });
  const items = entries.map(({ pin, pos }) => {
    pin.style.left = `${pos.x}%`;
    pin.style.top = `${pos.y}%`;
    pin.classList.add('pin--free');
    const label = pin.querySelector('.pin__label');
    const shout = pin.querySelector('.pin__shout:not([hidden])');
    const answer = pin.classList.contains('pin--answer');
    return {
      x: (pos.x / 100) * width,
      y: (pos.y / 100) * height,
      w: label.offsetWidth,
      h: label.offsetHeight + 3, // 下の影の分
      gap: answer ? 15 : 10,
      dot: answer ? 13 : 9,
      top: shout ? shout.offsetHeight - 2 : 0,
      topW: shout ? shout.offsetWidth + 6 : 0, // 少しかたむけている分
    };
  });
  const spots = arrangeLabels(items, { width, height, margin: 3 }, soft);
  // 点と名札をつなぐ線は、すべての名札の下になるように、マップに1枚の層を作って描く
  let lines = map.querySelector('.map__lines');
  if (!lines) {
    lines = el('span', 'map__lines');
    map.append(lines);
  }
  lines.replaceChildren();
  entries.forEach(({ pin }, i) => {
    const it = items[i];
    const spot = spots[i];
    const lx = Math.round(spot.x - it.x);
    const ly = Math.round(spot.y - it.y);
    const label = pin.querySelector('.pin__label');
    label.style.left = `${lx}px`;
    label.style.top = `${ly}px`;
    const shout = pin.querySelector('.pin__shout');
    if (shout) {
      shout.style.left = `${lx + it.w / 2}px`;
      shout.style.top = `${ly - it.top - 2}px`;
    }
    if (!spot.far) return;
    // 名札が点から離れたら、点から名札のいちばん近いところまで線を引く
    const nx = Math.min(Math.max(0, lx), lx + it.w);
    const ny = Math.min(Math.max(0, ly), ly + it.h - 3);
    const line = el('span', 'map__line');
    line.style.left = `${it.x}px`;
    line.style.top = `${it.y}px`;
    line.style.width = `${Math.hypot(nx, ny)}px`;
    line.style.transform = `rotate(${Math.atan2(ny, nx)}rad)`;
    lines.append(line);
  });
}

/**
 * マップの大きさが変わったら呼ばれるようにする（名札の位置を整え直すため）。
 * @returns {() => void} 見張りをやめる関数
 */
export function watchResize(map, callback) {
  const observer = new ResizeObserver(() => callback());
  observer.observe(map);
  // 文字（Google Fonts）があとから読み込まれたときも、名札を整え直す
  const onFonts = () => callback();
  document.fonts?.addEventListener?.('loadingdone', onFonts);
  return () => {
    observer.disconnect();
    document.fonts?.removeEventListener?.('loadingdone', onFonts);
  };
}

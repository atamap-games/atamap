// マップの見た目を作る部品（軸・軸の言葉・ピン）。動かす操作は board.js、答え合わせの表示は screen-reveal.js で使う。
// 座標は x：左 0 → 右 100、y：上 0 → 下 100（マップの見たままの向き）。
import { el } from './ui.js';

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

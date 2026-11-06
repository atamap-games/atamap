// マップにワードを置く部品。
// 「自分のマップを作る画面」と、あとで作る「予想の画面」の両方で使う。
//
// 置き方は2とおり：
//   1. ワードを指でドラッグして、マップの上で離す
//   2. ワードをタップして選び、マップの置きたいところをタップする
// 置いたワードも同じように動かせる。マップの外へドラッグすると、下の列に戻る。
//
// 座標は x：左 0 → 右 100、y：上 0 → 下 100（マップの見たままの向き）。
import { el } from './ui.js';
import { createMap, createPin, fitLabel } from './mapview.js';

// 指で隠れないよう、ドラッグ中のピンは指より少し上に出す（px）
const TOUCH_LIFT = 56;
// これより動かなければ「タップ」とみなす（px）
const TAP_SLOP = 8;
// マップの外に少しはみ出して離しても、端に置いたことにする幅（px）
const EDGE_SNAP = 16;

/**
 * マップと、置くワードの列を作る。
 * @param {HTMLElement} root 部品を入れる場所（中身は作り直す）
 * @param {object} topic お題（topics.js の形）
 * @param {object} [options]
 * @param {(state: object) => void} [options.onChange] 置き場所や選択が変わったときに呼ばれる
 */
export function createBoard(root, topic, { onChange } = {}) {
  root.replaceChildren();

  const map = createMap(topic, 'map--board');

  const tray = el('div', 'tray');
  const trayDone = el('p', 'tray__done', '5つ全部置けました！');
  tray.append(trayDone);

  const words = topic.words.map((text, index) => ({ index, text, pos: null, chip: null, pin: null }));
  let selected = null;
  let locked = false;

  for (const word of words) {
    const chip = el('button', 'chip', word.text);
    chip.type = 'button';
    chip.addEventListener('pointerdown', (event) => startPointer(event, word));
    word.chip = chip;
    tray.insertBefore(chip, trayDone);
  }

  // マップは、空いている高さに合わせて大きさが変わる（css の .board__stage）
  const stage = el('div', 'board__stage');
  stage.append(map);
  root.append(stage, tray);

  // マップの何もないところをタップしたとき：選んでいるワードをそこに置く
  map.addEventListener('pointerdown', (event) => {
    if (locked || !selected || event.target.closest('.pin')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const start = { x: event.clientX, y: event.clientY };
    const id = event.pointerId;
    const finish = (ev, cancelled) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      if (cancelled || locked || !selected || distance(start, ev) > TAP_SLOP) return;
      const pos = toMapPos({ x: ev.clientX, y: ev.clientY }, 0);
      if (pos) place(selected, pos);
    };
    const up = (ev) => finish(ev, false);
    const cancel = (ev) => finish(ev, true);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  });

  // 画面の大きさが変わったら、名札の位置を整え直す
  const resizeObserver = new ResizeObserver(() => words.forEach(layoutPin));
  resizeObserver.observe(map);

  // ---------- 指やマウスの操作 ----------

  function startPointer(event, word) {
    if (locked) return;
    if (event.pointerType === 'mouse') {
      if (event.button !== 0) return;
      // マウスでドラッグしたときに、文字が選ばれてしまうのを防ぐ
      event.preventDefault();
    }

    const id = event.pointerId;
    const start = { x: event.clientX, y: event.clientY };
    const lift = event.pointerType === 'mouse' ? 0 : TOUCH_LIFT;
    let ghost = null;

    const pointOf = (ev) => ({ x: ev.clientX, y: ev.clientY - lift });

    const move = (ev) => {
      if (ev.pointerId !== id) return;
      if (!ghost) {
        if (distance(start, ev) < TAP_SLOP) return;
        ghost = makeGhost(word);
        word.pin?.classList.add('is-dragging');
        word.chip.classList.add('is-dragging');
        select(null);
      }
      const point = pointOf(ev);
      moveGhost(ghost, point);
      map.classList.toggle('is-over', Boolean(toMapPos(point)));
    };

    const finish = (ev, cancelled) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      map.classList.remove('is-over');
      word.pin?.classList.remove('is-dragging');
      word.chip.classList.remove('is-dragging');

      if (!ghost) {
        // ほとんど動いていない＝タップ。選ぶ・選ぶのをやめる
        if (!cancelled) select(selected === word ? null : word);
        return;
      }
      ghost.remove();
      if (cancelled) return;

      const pos = toMapPos(pointOf(ev));
      if (pos) {
        place(word, pos);
      } else {
        unplace(word);
      }
    };
    const up = (ev) => finish(ev, false);
    const cancel = (ev) => finish(ev, true);

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  // ---------- 置く・戻す・選ぶ ----------

  function place(word, pos) {
    word.pos = pos;
    if (!word.pin) {
      word.pin = makePin(word);
    }
    // あとから動かしたものを一番上に重ねる
    map.append(word.pin);
    word.pin.style.left = `${pos.x}%`;
    word.pin.style.top = `${pos.y}%`;
    setChipPlaced(word, true);
    layoutPin(word);
    navigator.vibrate?.(8);
    // 選んで置いたときは、選んでいる印を消す
    if (selected === word) {
      select(null);
    } else {
      update();
    }
  }

  function unplace(word) {
    if (!word.pos) return;
    word.pin.remove();
    word.pin = null;
    word.pos = null;
    setChipPlaced(word, false);
    update();
  }

  // 置いたワードは、列の中に点線の枠だけ残す（列の長さが変わって画面がずれないように）
  function setChipPlaced(word, placed) {
    word.chip.classList.toggle('is-placed', placed);
    word.chip.disabled = placed;
  }

  function select(word) {
    selected = word;
    for (const w of words) {
      w.chip.classList.toggle('is-selected', w === word);
      w.pin?.classList.toggle('is-selected', w === word);
    }
    map.classList.toggle('is-waiting', Boolean(word));
    update();
  }

  function update() {
    const placed = words.filter((w) => w.pos).length;
    tray.classList.toggle('is-empty', placed === words.length);
    onChange?.({ placed, total: words.length, selected: selected?.text ?? null, locked });
  }

  // ---------- 見た目 ----------

  function makePin(word) {
    const pin = createPin(word.text);
    pin.addEventListener('pointerdown', (event) => startPointer(event, word));
    return pin;
  }

  function makeGhost(word) {
    const ghost = createPin(word.text, { className: 'pin--ghost' });
    ghost.setAttribute('aria-hidden', 'true');
    document.body.append(ghost);
    return ghost;
  }

  function moveGhost(ghost, point) {
    ghost.style.left = `${point.x}px`;
    ghost.style.top = `${point.y}px`;
    fitLabel(ghost, point.x, point.y, window.innerWidth);
  }

  // 置いたピンの名札が、マップの外にはみ出さないようにする
  function layoutPin(word) {
    if (!word.pin || !word.pos) return;
    const width = map.clientWidth;
    const height = map.clientHeight;
    fitLabel(word.pin, (word.pos.x / 100) * width, (word.pos.y / 100) * height, width);
  }

  // 画面上の点を、マップの座標（0〜100）にする。マップから離れすぎていれば null
  function toMapPos(point, snap = EDGE_SNAP) {
    const rect = map.getBoundingClientRect();
    if (
      point.x < rect.left - snap || point.x > rect.right + snap ||
      point.y < rect.top - snap || point.y > rect.bottom + snap
    ) {
      return null;
    }
    const x = clamp(((point.x - rect.left) / rect.width) * 100, 0, 100);
    const y = clamp(((point.y - rect.top) / rect.height) * 100, 0, 100);
    return { x: round1(x), y: round1(y) };
  }

  update();

  return {
    /** 置き場所の一覧。まだ置いていないワードは pos が null */
    getPlacements() {
      return words.map((w) => ({ word: w.text, pos: w.pos && { ...w.pos } }));
    },
    /** 案内などを、今の状態で出し直す */
    refresh() {
      update();
    },
    /** まだ置いていないワードを、すべて同じ場所に置く（時間切れのとき） */
    placeRemaining(pos) {
      for (const word of words) {
        if (!word.pos) place(word, { ...pos });
      }
    },
    /** 5つとも置けたか */
    isComplete() {
      return words.every((w) => w.pos);
    },
    /**
     * 動かせないようにする（ロック）。ワードの列のところに、知らせる文を出す。
     * @param {object} [text]
     * @param {string} [text.message] 大きく出す文
     * @param {string} [text.note] 小さく添える文
     */
    lock({ message = 'ロックしました！', note = '' } = {}) {
      locked = true;
      select(null);
      map.classList.add('is-locked');
      tray.classList.add('is-locked');
      trayDone.replaceChildren(message);
      if (note) trayDone.append(el('span', 'tray__sub', note));
      update();
    },
    /** 後片づけ（画面を離れるとき） */
    destroy() {
      resizeObserver.disconnect();
      document.querySelectorAll('.pin--ghost').forEach((ghost) => ghost.remove());
    },
  };
}

function distance(a, b) {
  return Math.hypot(b.clientX - a.x, b.clientY - a.y);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

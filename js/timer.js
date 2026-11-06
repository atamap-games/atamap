// 残り時間を数える部品（マップ作りと予想の制限時間）。
// 別窓（「ゲームを終わりますか？」など）が開いているあいだは、時間を止めておく。

/**
 * @param {object} options
 * @param {number} options.seconds 制限時間（秒）
 * @param {(left: number) => void} options.onTick 残り秒が変わったときに呼ばれる
 * @param {() => void} options.onEnd 時間切れのときに1回だけ呼ばれる
 */
export function createTimer({ seconds, onTick, onEnd }) {
  let left = seconds * 1000;
  let last = Date.now();
  let shown = seconds;
  let interval = 0;
  let ended = false;

  function tick() {
    const now = Date.now();
    const paused = Boolean(document.querySelector('dialog[open]'));
    if (!paused) left -= now - last;
    last = now;
    const secondsLeft = Math.max(0, Math.ceil(left / 1000));
    if (secondsLeft !== shown) {
      shown = secondsLeft;
      onTick(secondsLeft);
    }
    if (left <= 0 && !ended) {
      ended = true;
      stop();
      onEnd();
    }
  }

  function stop() {
    window.clearInterval(interval);
    interval = 0;
  }

  onTick(seconds);
  interval = window.setInterval(tick, 200);
  return { stop };
}

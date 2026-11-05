// 画面の切り替えや、お知らせの表示など、どの画面でも使う部品

/**
 * 指定した画面だけを表示する。
 * 画面は index.html の <section data-screen="名前"> で用意する。
 * @param {string} name 表示する画面の名前（例：'top'）
 */
export function showScreen(name) {
  const screens = document.querySelectorAll('[data-screen]');
  screens.forEach((screen) => {
    screen.hidden = screen.dataset.screen !== name;
  });
  window.scrollTo(0, 0);
}

let toastTimer = 0;

/**
 * 画面の下に短いお知らせを出す。少したつと自動で消える。
 * @param {string} message 表示する文
 * @param {number} [duration=2600] 表示しておく時間（ミリ秒）
 */
export function showToast(message, duration = 2600) {
  const toast = document.querySelector('.toast');
  if (!toast) return;

  toast.textContent = message;
  // 続けて押されたときも、毎回出し直して時間を数え直す
  toast.hidden = true;
  void toast.offsetWidth;
  toast.hidden = false;

  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, duration);
}

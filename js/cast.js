// 配信用の画面（配信ソフトに映す窓）。アドレスに ?cast=部屋の番号 を付けて開く。
// 見るだけの画面で、ボタンはない。配信者の操作の画面の「配信用の画面」ボタンで開く。
// 配信者がワードを置いているあいだは「考え中…」だけを出すので、答えは映らない。
import { connect } from './net.js';
import { showCast } from './screen-cast.js';
import { castModel } from './online-stream.js';
import { soundReady, soundOn } from './sound.js';

let started = false;

/**
 * 配信用の画面を始める。
 * @param {string} code 部屋の番号
 */
export async function startCast(code) {
  if (started) return;
  started = true;
  document.title = `配信用の画面（${code}）｜アタマップ`;
  showCast({ mode: 'cast', phase: 'closed', key: '', message: 'つないでいます…' });
  watchSound();
  try {
    const net = await connect();
    net.watch(`rooms/${code}`, (room) => {
      if (!room?.meta) {
        showCast({ mode: 'cast', phase: 'closed', key: 'missing', message: `部屋「${code}」が見つかりませんでした` });
        return;
      }
      if (room.meta.status === 'closed') {
        showCast({ mode: 'cast', phase: 'closed', key: 'closed', message: '配信の部屋は閉じました。おつかれさま！' });
        return;
      }
      room.code = code;
      showCast(castModel(room, { mode: 'cast', now: net.now }));
    });
  } catch (err) {
    console.error(err);
    showCast({ mode: 'cast', phase: 'closed', key: 'error', message: 'つながりませんでした。窓を開き直してね' });
  }
}

// ブラウザは、画面を一度クリックするまで音を出せない。音が出せるようになるまで、知らせを出しておく
function watchSound() {
  const hint = document.querySelector('[data-cast="sound"]');
  const check = () => {
    hint.hidden = soundReady() || !soundOn();
    if (!hint.hidden) window.setTimeout(check, 800);
  };
  check();
}

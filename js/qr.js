// QRコード。模様の計算は qrcode-generator（MIT ライセンス）を CDN から読み込んで使い、絵はここで SVG に描く。
const LIBRARY = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
const SVG = 'http://www.w3.org/2000/svg';

let loading = null;

function loadLibrary() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = LIBRARY;
    script.async = true;
    script.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error('QRコードの部品を読み込めませんでした')));
    script.onerror = () => {
      loading = null;
      reject(new Error('QRコードの部品を読み込めませんでした'));
    };
    document.head.append(script);
  });
  return loading;
}

/**
 * 文字（URL など）の QRコードを SVG で作る。
 * @param {string} text QRコードにする文字
 * @returns {Promise<SVGSVGElement>}
 */
export async function createQrSvg(text) {
  const qrcode = await loadLibrary();
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const margin = 2;
  const size = count + margin * 2;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'この部屋に入るための QRコード');
  svg.setAttribute('shape-rendering', 'crispEdges');
  const background = document.createElementNS(SVG, 'rect');
  background.setAttribute('width', String(size));
  background.setAttribute('height', String(size));
  background.setAttribute('fill', '#FFFFFF');
  // 黒いマスを1本の線（path）にまとめて描く
  let d = '';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) d += `M${col + margin} ${row + margin}h1v1h-1z`;
    }
  }
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#2B2A3A');
  svg.append(background, path);
  return svg;
}

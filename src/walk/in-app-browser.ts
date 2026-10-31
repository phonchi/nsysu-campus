/** LINE and Instagram open links in a webview with less memory, where a 3D page is more likely to reload. */
export function inAppBrowserName(userAgent: string) {
  if (/\bLine\//i.test(userAgent)) return 'LINE';
  if (/\bInstagram\b/i.test(userAgent)) return 'Instagram';
  return undefined;
}

const DISMISS_KEY = 'nsysu-walk-webview-dismissed';

/** A dismissable banner; it never redirects and is not shown in ordinary browsers. */
export function showInAppBrowserNotice(host: HTMLElement, userAgent = navigator.userAgent) {
  const name = inAppBrowserName(userAgent);
  if (!name) return;
  try { if (sessionStorage.getItem(DISMISS_KEY)) return; } catch { /* show it */ }
  const el = document.createElement('div');
  el.className = 'walk-webview'; el.setAttribute('role', 'status');
  el.innerHTML = `<p>${name} 內建瀏覽器的記憶體較少，遊戲可能重新載入。建議改用 Safari 或 Chrome 開啟。</p><div><button type="button" data-webview="copy">複製連結</button><button type="button" data-webview="close">知道了</button></div>`;
  el.addEventListener('click', e => {
    const action = (e.target as HTMLElement).closest<HTMLElement>('[data-webview]')?.dataset.webview;
    if (action === 'copy') {
      const button = el.querySelector<HTMLElement>('[data-webview=copy]')!;
      void navigator.clipboard?.writeText(location.href).then(() => { button.textContent = '已複製'; }, () => { button.textContent = '無法複製，請用右上選單開啟'; });
    } else if (action === 'close') {
      try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* per view */ }
      el.remove();
    }
  });
  host.append(el);
}

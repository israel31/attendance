/* ui.js — small shared helpers used across every page */

function injectQrField() {
  const div = document.createElement('div');
  div.className = 'qr-field';
  document.body.prepend(div);
}

function toast(message, kind = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = kind;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

function wireModeToggle() {
  const wrap = document.querySelector('.mode-toggle');
  if (!wrap) return;
  const mode = Store.getMode();
  wrap.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
    btn.addEventListener('click', () => {
      Store.setMode(btn.dataset.mode);
      renderEnvBanner();
      wrap.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.mode === 'production') {
        toast('Production Mode needs a connected Google account — see Setup.', '');
      } else {
        toast('Demo Mode — sample org, no Google account needed.', 'good');
      }
    });
  });
}

function renderEnvBanner() {
  const target = document.getElementById('env-banner');
  if (!target) return;
  const mode = Store.getMode();
  if (mode === 'demo') {
    target.className = 'env-banner demo';
    target.innerHTML = '<span class="dot"></span> Demo Mode — sample organization, fake calendar, no real Google account. Nothing here touches live data.';
  } else {
    target.className = 'env-banner';
    target.innerHTML = '<span class="dot"></span> Production Mode — connect a Google account under Setup to sync real Calendar and Sheets data.';
  }
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

document.addEventListener('DOMContentLoaded', () => {
  injectQrField();
  Store.seedIfEmpty();
  wireModeToggle();
  renderEnvBanner();
});

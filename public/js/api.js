async function api(path, opts = {}) {
  const init = { credentials: 'same-origin', headers: {}, ...opts };
  if (opts.body && !(opts.body instanceof FormData)) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  } else if (opts.body instanceof FormData) {
    init.body = opts.body;
  }
  const res = await fetch(path, init);
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function showError(el, msg) {
  if (!el) { alert(msg); return; }
  el.className = 'alert alert-error';
  el.textContent = msg;
  el.style.display = 'block';
}
function hideAlert(el) { if (el) el.style.display = 'none'; }

function showSmsToast(phone, code) {
  const existing = document.querySelector('.sms-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'sms-toast';
  t.innerHTML = `
        <div class="from"><span>SMS · CarShare</span><span>сейчас</span></div>
    <div class="body">Ваш код подтверждения для ${phone}:</div>
    <div class="code">${code}</div>
    <div class="from" style="margin-top:8px">Демо-режим: код показан здесь вместо реальной SMS</div>
  `;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 30000);
}

async function requireAuth() {
  try {
    const { user } = await api('/api/me');
    return user;
  } catch (e) {
    window.location.href = '/';
    throw e;
  }
}
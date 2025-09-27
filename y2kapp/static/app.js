document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('composer-form');
  const recipientInput = document.getElementById('recipient-input');
  const screen = document.getElementById('screen');
  const byteCounter = document.getElementById('byte-counter');
  const statusLabel = document.getElementById('status-label');
  const toolbar = document.querySelector('.screen__toolbar');
  const composer = document.getElementById('composer-form');
  const menuBtn = document.getElementById('btn-menu');
  const modeMenu = document.getElementById('mode-menu');

  let mode = 'compose';
  let currentBox = 'inbox';

  const SMS_LIMIT = 80; // bytes (legacy KR phones: ASCII 1B, non-ASCII 2B)

  function smsByteLength(text) {
    let bytes = 0;
    for (const ch of text) {
      const code = ch.codePointAt(0) || 0;
      bytes += code <= 0x7f ? 1 : 2;
    }
    return bytes;
  }

  function ensureComposeView() {
    const recipient = recipientInput.value || '-';
    const existing = document.getElementById('compose-body');
    if (existing) {
      const meta = screen.querySelector('.message-detail__meta span');
      if (meta) meta.textContent = `To: ${recipient}`;
      return existing;
    }
    screen.innerHTML = `
      <div class="message-detail">
        <div class="message-detail__meta"><span>To: ${recipient}</span><span></span></div>
        <div class="message-detail__body" id="compose-body" contenteditable="true" data-placeholder="내용을 입력하세요"></div>
      </div>
    `;
    return document.getElementById('compose-body');
  }

  function updateComposeCounter() {
    const bodyEl = ensureComposeView();
    const text = (bodyEl && bodyEl.innerText) ? bodyEl.innerText : '';
    const bytes = smsByteLength(text);
    byteCounter.textContent = `${bytes}/${SMS_LIMIT}B`;
    if (bytes > SMS_LIMIT) byteCounter.classList.add('over-limit');
    else byteCounter.classList.remove('over-limit');
  }

  recipientInput.addEventListener('input', () => { ensureComposeView(); });
  screen.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'compose-body') updateComposeCounter();
  });
  ensureComposeView();
  updateComposeCounter();

  async function fetchBox(box) {
    const res = await fetch(`/api/boxes/${box}`);
    if (!res.ok) throw new Error('목록을 불러올 수 없습니다.');
    return res.json();
  }

  function renderList(box, items) {
    if (!Array.isArray(items) || items.length === 0) {
      screen.innerHTML = '<p class="empty-state">메시지가 없습니다.</p>';
      return;
    }
    const list = document.createElement('div');
    list.className = 'message-list';
    items.forEach((m) => {
      const el = document.createElement('article');
      el.className = 'message-item';
      el.dataset.id = m.id;
      el.innerHTML = `
        <div class="message-item__meta">
          <span class="message-item__title">${box === 'sent' ? (m.recipient || '-') : (m.author || '-')}</span>
          <time>${new Intl.DateTimeFormat('ko-KR', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}).format(new Date(m.created_at))}</time>
        </div>
        <div class="message-item__preview"></div>
      `;
      el.querySelector('.message-item__preview').textContent = m.body;
      el.addEventListener('click', () => openDetail(m.id));
      list.appendChild(el);
    });
    screen.innerHTML = '';
    screen.appendChild(list);
  }

  async function loadBox(box) {
    currentBox = box;
    try {
      const items = await fetchBox(box);
      renderList(box, items);
    } catch (e) {
      screen.innerHTML = '<p class="empty-state">목록을 불러오는 중 오류</p>';
    }
  }

  async function openDetail(id) {
    const res = await fetch(`/api/messages/${id}`);
    if (!res.ok) return;
    const m = await res.json();
    if (m.box === 'inbox' && !m.read) {
      fetch(`/api/messages/${id}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({read:true})});
    }
    screen.innerHTML = `
      <div class="message-detail">
        <div class="message-detail__meta">
          <span>${m.box === 'sent' ? `To: ${m.recipient || '-'}` : `From: ${m.author || '-'}`}</span>
          <time>${new Intl.DateTimeFormat('ko-KR', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}).format(new Date(m.created_at))}</time>
        </div>
        <div class="message-detail__body"></div>
        <div style="margin-top:10px; display:flex; gap:8px;">
          <button type="button" id="btn-back">뒤로</button>
          <button type="button" id="btn-delete">삭제</button>
        </div>
      </div>
    `;
    screen.querySelector('.message-detail__body').textContent = m.body;
    screen.querySelector('#btn-back').addEventListener('click', () => setActiveTab(currentBox));
    screen.querySelector('#btn-delete').addEventListener('click', async () => {
      const ok = confirm('삭제할까요?');
      if (!ok) return;
      const resp = await fetch(`/api/messages/${m.id}`, {method:'DELETE'});
      if (resp.ok) setActiveTab(currentBox);
    });
  }

  function setActiveTab(nextMode) {
    mode = nextMode;
    document.querySelectorAll('.toolbar__tab').forEach((t) => t.setAttribute('aria-current', t.dataset.mode === mode ? 'page' : 'false'));
    if (mode === 'compose') {
      statusLabel.textContent = '메시지 작성';
      const bodyEl = ensureComposeView();
      setTimeout(() => bodyEl && bodyEl.focus(), 0);
      updateComposeCounter();
      if (composer) composer.removeAttribute('hidden');
      if (byteCounter) byteCounter.removeAttribute('hidden');
    } else if (mode === 'menu') {
      statusLabel.textContent = '메뉴';
      if (composer) composer.setAttribute('hidden', '');
      if (byteCounter) byteCounter.setAttribute('hidden', '');
      renderMenu();
    } else {
      statusLabel.textContent = mode === 'inbox' ? '받은 메시지' : mode === 'sent' ? '보낸 메시지' : '임시보관함';
      loadBox(mode);
      if (composer) composer.setAttribute('hidden', '');
      if (byteCounter) byteCounter.setAttribute('hidden', '');
    }
  }

  function renderMenu() {
    const menu = document.createElement('div');
    menu.className = 'menu-list';
    const items = [
      { key: 'inbox', label: '받은함' },
      { key: 'sent', label: '보낸함' },
      { key: 'drafts', label: '임시' },
      { key: 'compose', label: '작성' },
    ];
    items.forEach(({ key, label }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item';
      b.textContent = label;
      b.addEventListener('click', () => setActiveTab(key));
      menu.appendChild(b);
    });
    screen.innerHTML = '';
    screen.appendChild(menu);
  }

  if (toolbar) {
    toolbar.addEventListener('click', (e) => {
      const composeBtn = e.target.closest('.toolbar__tab');
      if (composeBtn) {
        e.preventDefault();
        setActiveTab('compose');
        return;
      }
      if (e.target.closest('#btn-menu')) {
        e.preventDefault();
        setActiveTab('menu');
      }
    });
  }
  setActiveTab('compose');

  async function submitMessage(event) {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    const bodyEl = document.getElementById('compose-body');
    const bodyText = (bodyEl && bodyEl.innerText) ? bodyEl.innerText.trim() : '';
    payload.body = bodyText;
    if (!payload.recipient || !payload.body) {
      alert('받는이와 메시지를 입력하세요.');
      return;
    }

    try {
      const response = await fetch('/api/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message = data?.detail ?? '메세지를 전송할 수 없습니다.';
        throw new Error(message);
      }

      form.reset();
      ensureComposeView();
      updateComposeCounter();
      alert('메시지가 전송되었습니다.');
    } catch (error) {
      alert(error.message);
    }
  }

  form.addEventListener('submit', submitMessage);

  // Reference overlay for pixel-perfect alignment (dev only)
  (function setupReferenceOverlay() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('ref')) return;
    const overlay = document.createElement('div');
    overlay.id = 'ref-overlay';
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      backgroundImage: 'url(/assets/reference.png)',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center top',
      backgroundSize: 'contain',
      opacity: '0.5',
      pointerEvents: 'none',
      zIndex: '9999',
    });
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed', top: '8px', right: '8px', display: 'flex', gap: '6px', alignItems: 'center', padding: '6px 8px', background: 'rgba(0,0,0,0.55)', color: '#fff', borderRadius: '8px', zIndex: '10000',
    });
    const label = document.createElement('span'); label.textContent = 'ref'; label.style.fontSize = '12px';
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.value = '50'; slider.style.width = '120px'; slider.addEventListener('input', () => { overlay.style.opacity = String(Number(slider.value) / 100); });
    const hideBtn = document.createElement('button'); hideBtn.textContent = 'hide'; Object.assign(hideBtn.style, { background: '#333', color: '#fff', border: '1px solid #666', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' });
    let hidden = false; hideBtn.addEventListener('click', () => { hidden = !hidden; overlay.style.display = hidden ? 'none' : 'block'; hideBtn.textContent = hidden ? 'show' : 'hide'; });
    panel.appendChild(label); panel.appendChild(slider); panel.appendChild(hideBtn);
    document.body.appendChild(overlay); document.body.appendChild(panel);
  })();
});

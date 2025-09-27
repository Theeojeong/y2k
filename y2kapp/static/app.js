document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("composer-form");
  const screen = document.getElementById("screen");
  const byteCounter = document.getElementById("byte-counter");
  const statusLabel = document.getElementById("status-label");
  const toolbar = document.querySelector(".screen__toolbar");
  const composer = document.getElementById("composer-form");

  let mode = "compose";
  let currentBox = "inbox";
  let legacyApi = false;
  let lastList = [];

  const SMS_LIMIT = 80; // ASCII 1B, non-ASCII 2B

  function smsByteLength(text) {
    let bytes = 0;
    for (const ch of text) {
      const code = ch.codePointAt(0) || 0;
      bytes += code <= 0x7f ? 1 : 2;
    }
    return bytes;
  }

  function getSentIds() {
    try {
      const raw = localStorage.getItem("y2k.sentIds");
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  }
  function saveSentId(id) {
    const set = getSentIds();
    set.add(id);
    localStorage.setItem("y2k.sentIds", JSON.stringify([...set]));
  }
  function getSentNameMap() {
    try {
      const raw = localStorage.getItem("y2k.sentRecipients");
      const obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === "object" ? obj : {};
    } catch {
      return {};
    }
  }
  function saveSentRecipient(id, name) {
    const map = getSentNameMap();
    map[id] = name;
    localStorage.setItem("y2k.sentRecipients", JSON.stringify(map));
  }

  function ensureComposeView() {
    const existing = document.getElementById("compose-body");
    if (existing) return existing;
    screen.innerHTML = `
      <div class="message-detail">
        <div class="message-detail__meta">
          <span>To:</span>
          <span id="compose-to" contenteditable="true" data-placeholder="연락처 또는 이름"></span>
        </div>
        <div class="message-detail__body" id="compose-body" contenteditable="true" data-placeholder="내용을 입력하세요"></div>
      </div>`;
    return document.getElementById("compose-body");
  }

  function updateComposeCounter() {
    const bodyEl = ensureComposeView();
    const text = bodyEl && bodyEl.innerText ? bodyEl.innerText : "";
    const bytes = smsByteLength(text);
    byteCounter.textContent = `${bytes}/${SMS_LIMIT}B`;
    if (bytes > SMS_LIMIT) byteCounter.classList.add("over-limit");
    else byteCounter.classList.remove("over-limit");
  }

  screen.addEventListener("input", (e) => {
    if (e.target && e.target.id === "compose-body") updateComposeCounter();
  });
  ensureComposeView();
  updateComposeCounter();

  // Auto-login like SNS: cache nickname locally and re-login silently on load
  let meCache = null;
  let loginInFlight = null;
  async function ensureLogin(promptUser = false) {
    if (meCache) return meCache;
    if (loginInFlight) return loginInFlight;
    const me = await fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (me) {
      meCache = me;
      return me;
    }
    const stored = (localStorage.getItem("y2k.handle") || "").trim();
    if (stored) {
      loginInFlight = fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: stored }),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((u) => {
          meCache = u;
          loginInFlight = null;
          return u;
        })
        .catch(() => {
          loginInFlight = null;
          return null;
        });
      const ok = await loginInFlight;
      if (ok) return ok;
    }
    if (!promptUser) return null;
    let handle = null;
    while (!handle) {
      handle = window.prompt("닉네임을 입력하세요 (인앱 전용)");
      if (handle === null) break;
      handle = handle.trim();
      if (handle) break;
    }
    if (!handle) throw new Error("로그인이 필요합니다.");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle }),
    });
    if (!res.ok) throw new Error("로그인 실패");
    const user = await res.json();
    meCache = user;
    localStorage.setItem("y2k.handle", handle);
    return user;
  }

  async function fetchBox(box) {
    await ensureLogin(false);
    let res = await fetch(`/api/boxes/${box}`);
    if (res.status === 404) {
      legacyApi = true;
      res = await fetch("/api/messages");
    }
    if (!res.ok) throw new Error("목록을 불러올 수 없습니다.");
    const data = await res.json();
    lastList = Array.isArray(data) ? data : [];
    lastList.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (!legacyApi) return lastList;
    const sentIds = getSentIds();
    if (box === "sent") return lastList.filter((m) => sentIds.has(m.id));
    if (box === "inbox") return lastList.filter((m) => !sentIds.has(m.id));
    if (box === "drafts") return [];
    return lastList;
  }

  function renderList(box, items) {
    // ensure any compose-only overlays are cleared
    const oldSuggest = document.querySelector(".to-suggest");
    if (oldSuggest) oldSuggest.remove();
    if (!Array.isArray(items) || items.length === 0) {
      screen.innerHTML = '<p class="empty-state">메시지가 없습니다.</p>';
      return;
    }
    const list = document.createElement("div");
    list.className = "message-list";
    const sentNameMap = legacyApi ? getSentNameMap() : {};
    items.forEach((m) => {
      const el = document.createElement("article");
      el.className = "message-item";
      el.dataset.id = m.id;
      const titleText = legacyApi
        ? box === "sent"
          ? sentNameMap[m.id] || m.author || "-"
          : m.author || "-"
        : box === "sent"
        ? m.recipient || "-"
        : m.author || "-";
      el.innerHTML = `<div class="message-item__meta"><span class="message-item__title">${titleText}</span><time>${new Intl.DateTimeFormat(
        "ko-KR",
        { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
      ).format(
        new Date(m.created_at)
      )}</time></div><div class="message-item__preview"></div>`;
      el.querySelector(".message-item__preview").textContent = m.body;
      el.addEventListener("click", () => openDetail(m.id));
      list.appendChild(el);
    });
    screen.innerHTML = "";
    screen.appendChild(list);
  }

  // Robust click handling for message items (delegation)
  screen.addEventListener("click", (e) => {
    const item = e.target.closest(".message-item");
    if (!item || !screen.contains(item)) return;
    const id = item.dataset.id;
    if (!id) return;
    e.preventDefault();
    openDetail(String(id));
  });

  async function loadBox(box) {
    currentBox = box;
    try {
      const items = await fetchBox(box);
      renderList(box, items);
    } catch (e) {
      screen.innerHTML = '<p class="empty-state">목록을 불러오는 중 오류</p>';
    }
  }

  let currentDetailMsg = null;
  async function openDetail(id) {
    let m;
    let res = await fetch(`/api/messages/${id}`);
    if (!res.ok) {
      // fallback to client cache when GET detail is unavailable (e.g., 404/405)
      m = (lastList || []).find((x) => String(x.id) === String(id));
      if (!m) return;
    } else {
      m = await res.json();
    }
    if (!legacyApi && m.box === "inbox" && !m.read) {
      fetch(`/api/messages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      });
    }
    const sentIds = getSentIds();
    const sentNameMap = getSentNameMap();
    const isSent = legacyApi ? sentIds.has(m.id) : m.box === "sent";
    const otherName = isSent
      ? legacyApi
        ? sentNameMap[m.id] || m.author || "-"
        : m.recipient || "-"
      : m.author || "-";
    currentDetailMsg = m;
    // Toolbar: for sent -> Back + Delete; for inbox -> Back + Reply
    if (toolbar) {
      toolbar.innerHTML = isSent
        ? '<button class="toolbar__back" id="btn-back-toolbar" type="button">뒤로</button><button class="toolbar__delete" id="btn-delete-toolbar" type="button">삭제</button>'
        : '<button class="toolbar__back" id="btn-back-toolbar" type="button">뒤로</button><button class="toolbar__reply" id="btn-reply-toolbar" type="button">답장</button>';
    }
    screen.innerHTML = `<div class="message-detail"><div class="message-detail__meta"><span>${
      isSent ? `To: ${otherName}` : `From: ${otherName}`
    }</span><time>${new Intl.DateTimeFormat("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(
      new Date(m.created_at)
    )}</time></div><div class="message-detail__body"></div>
    ${isSent ? '' : '<div style="margin-top:10px; display:flex; gap:8px;"><button type="button" id="btn-delete">삭제</button></div>'}
    </div>`;
    screen.querySelector(".message-detail__body").textContent = m.body;
    const delBtn = screen.querySelector("#btn-delete");
    if (delBtn) delBtn.addEventListener("click", async () => {
      const ok = confirm("삭제할까요?");
      if (!ok) return;
      const resp = await fetch(`/api/messages/${m.id}`, { method: "DELETE" });
      if (resp.ok) setActiveTab(currentBox);
    });
  }

  function setActiveTab(nextMode) {
    mode = nextMode;
    if (screen) screen.setAttribute("data-mode", mode);
    document
      .querySelectorAll(".toolbar__tab")
      .forEach((t) =>
        t.setAttribute(
          "aria-current",
          t.dataset.mode === mode ? "page" : "false"
        )
      );
    // always restore default toolbar for non-detail views
    const defaultToolbarHtml = '<button class="toolbar__menu" id="btn-menu" type="button">메뉴</button>' +
      '<button class="toolbar__tab" data-mode="compose" type="button">보내기</button>';
    if (toolbar) toolbar.innerHTML = defaultToolbarHtml;

    if (mode === "compose") {
      statusLabel.textContent = "메시지 작성";
      ensureComposeView();
      requestAnimationFrame(() => {
        if (screen) screen.scrollTop = 0;
        const bodyEl = document.getElementById("compose-body");
        if (bodyEl && bodyEl.scrollIntoView)
          bodyEl.scrollIntoView({ block: "start", inline: "nearest" });
      });
      updateComposeCounter();
      if (composer) composer.setAttribute("hidden", "");
      if (byteCounter) byteCounter.removeAttribute("hidden");
    } else if (mode === "menu") {
      // In menu home, show only the 메뉴 버튼 (hide 보내기)
      if (toolbar) toolbar.innerHTML = '<button class="toolbar__menu" id="btn-menu" type="button">메뉴</button>';
      statusLabel.textContent = "메뉴";
      if (composer) composer.setAttribute("hidden", "");
      if (byteCounter) byteCounter.setAttribute("hidden", "");
      renderMenu();
    } else {
      // remove any lingering compose suggestion overlay before showing lists
      const oldSuggest = document.querySelector(".to-suggest");
      if (oldSuggest) oldSuggest.remove();
      statusLabel.textContent =
        mode === "inbox"
          ? "받은 메시지"
          : mode === "sent"
          ? "보낸 메시지"
          : "임시보관함";
      loadBox(mode);
      if (composer) composer.setAttribute("hidden", "");
      if (byteCounter) byteCounter.setAttribute("hidden", "");
    }
  }

  function renderMenu() {
    const menu = document.createElement("div");
    menu.className = "menu-list";
    [
      { key: "inbox", label: "받은 메세지함" },
      { key: "sent", label: "보낸 메세지함" },
      { key: "drafts", label: "임시 메세지함" },
      { key: "compose", label: "메세지 작성" },
    ].forEach(({ key, label }) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "menu-item";
      b.textContent = label;
      b.addEventListener("click", () => setActiveTab(key));
      menu.appendChild(b);
    });
    screen.innerHTML = "";
    screen.appendChild(menu);
  }

  if (toolbar) {
    toolbar.addEventListener("click", async (e) => {
      const composeBtn = e.target.closest(".toolbar__tab");
      const backToolbar = e.target.closest('#btn-back-toolbar');
      const replyToolbar = e.target.closest('#btn-reply-toolbar');
      const deleteToolbar = e.target.closest('#btn-delete-toolbar');
      if (backToolbar) { e.preventDefault(); setActiveTab(currentBox); return; }
      if (replyToolbar) {
        e.preventDefault();
        // Derive reply target reliably from current detail context
        let toName = '';
        if (typeof currentDetailMsg === 'object' && currentDetailMsg !== null) {
          const box = (currentDetailMsg.box || '').toLowerCase();
          toName = box === 'sent' ? (currentDetailMsg.recipient || '') : (currentDetailMsg.author || '');
        } else {
          // Fallback to parsing header if state missing
          const header = screen.querySelector('.message-detail__meta span');
          if (header) {
            const txt = header.textContent || '';
            const idx = txt.indexOf(':');
            if (idx >= 0) toName = txt.slice(idx + 1).trim();
          }
        }
        setActiveTab('compose');
        ensureComposeView();
        const toEl = document.getElementById('compose-to');
        if (toEl) toEl.textContent = toName;
        const bodyEl = document.getElementById('compose-body');
        if (bodyEl && bodyEl.focus) bodyEl.focus();
        return;
      }
      if (deleteToolbar) {
        e.preventDefault();
        if (currentDetailMsg) {
          const ok = confirm('삭제할까요?');
          if (ok) {
            const resp = await fetch(`/api/messages/${currentDetailMsg.id}`, { method: 'DELETE' });
            if (resp.ok) setActiveTab(currentBox);
          }
        }
        return;
      }
      if (composeBtn) {
        e.preventDefault();
        if (mode === "compose") {
          try {
            await ensureLogin(false);
            await doSend();
          } catch (err) {
            alert(err.message || String(err));
          }
        } else {
          setActiveTab("compose");
        }
        return;
      }
      if (e.target.closest("#btn-menu")) {
        e.preventDefault();
        setActiveTab("menu");
        refreshCounters();
      }
    });
  }
  // Establish session early (silent auto-login if stored, else 1st-time prompt)
  ensureLogin(true).catch(() => {});
  setActiveTab("compose");

  async function doSend() {
    await ensureLogin(false);
    const toEl = document.getElementById("compose-to");
    const bodyEl = document.getElementById("compose-body");
    const payload = {
      recipient: (toEl?.innerText || "").trim(),
      body: (bodyEl?.innerText || "").trim(),
    };
    if (!payload.recipient || !payload.body) {
      alert("받는이와 메시지를 입력하세요.");
      return;
    }
    let response = await fetch("/api/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.status === 404) {
      legacyApi = true;
      response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: payload.recipient, body: payload.body }),
      });
      if (response.ok) {
        const created = await response.json().catch(() => null);
        if (created && created.id != null) {
          saveSentId(created.id);
          saveSentRecipient(created.id, payload.recipient);
        }
      }
    } else if (response.ok) {
      const created = await response.json().catch(() => null);
      if (created && created.id != null && payload.recipient)
        saveSentRecipient(created.id, payload.recipient);
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const message = data?.detail ?? "메세지를 전송할 수 없습니다.";
      throw new Error(message);
    }
    if (form) form.reset();
    setActiveTab("sent");
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    doSend().catch((err) => alert(err.message || String(err)));
  });

  // To autocomplete suggestions
  screen.addEventListener("input", async (e) => {
    if (e.target && e.target.id === "compose-to") {
      const q = (e.target.innerText || "").trim();
      const old = document.querySelector(".to-suggest");
      if (old) old.remove();
      if (!q) {
        return;
      }
      try {
        const res = await fetch(`/api/users?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const items = await res.json();
        if (!Array.isArray(items) || items.length === 0) return;
        const list = document.createElement("div");
        list.className = "to-suggest";
        items.forEach((u) => {
          const it = document.createElement("div");
          it.className = "to-suggest__item";
          it.textContent = u.handle;
          it.addEventListener("click", () => {
            const toEl = document.getElementById("compose-to");
            if (toEl) {
              toEl.innerText = u.handle;
              list.remove();
            }
          });
          list.appendChild(it);
        });
        screen.appendChild(list);
      } catch {}
    }
  });
  document.addEventListener("click", (e) => {
    const s = document.querySelector(".to-suggest");
    if (!s) return;
    if (!e.target.closest(".to-suggest") && !e.target.closest("#compose-to"))
      s.remove();
  });

  async function refreshCounters() {
    try {
      const res = await fetch("/api/counters");
      if (!res.ok) return;
      const c = await res.json();
      const menu = screen.querySelector(".menu-list");
      if (menu) {
        const map = {
          inbox: "받은 메세지함",
          sent: "보낸 메세지함",
          drafts: "임시 메세지함",
          compose: "메세지 작성",
        };
        menu.innerHTML = "";
        ["inbox", "sent", "drafts", "compose"].forEach((k) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "menu-item";
          const label =
            map[k] + (k !== "compose" && c[k] != null ? ` (${c[k]})` : "");
          b.textContent = label;
          b.addEventListener("click", () => setActiveTab(k));
          menu.appendChild(b);
        });
      }
    } catch {}
  }

  // Reference overlay
  (function setupReferenceOverlay() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("ref")) return;
    const overlay = document.createElement("div");
    overlay.id = "ref-overlay";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      backgroundImage: "url(/assets/reference.png)",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center top",
      backgroundSize: "contain",
      opacity: "0.5",
      pointerEvents: "none",
      zIndex: "9999",
    });
    const panel = document.createElement("div");
    Object.assign(panel.style, {
      position: "fixed",
      top: "8px",
      right: "8px",
      display: "flex",
      gap: "6px",
      alignItems: "center",
      padding: "6px 8px",
      background: "rgba(0,0,0,0.55)",
      color: "#fff",
      borderRadius: "8px",
      zIndex: "10000",
    });
    const label = document.createElement("span");
    label.textContent = "ref";
    label.style.fontSize = "12px";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = "50";
    slider.style.width = "120px";
    slider.addEventListener("input", () => {
      overlay.style.opacity = String(Number(slider.value) / 100);
    });
    const hideBtn = document.createElement("button");
    hideBtn.textContent = "hide";
    Object.assign(hideBtn.style, {
      background: "#333",
      color: "#fff",
      border: "1px solid #666",
      borderRadius: "6px",
      padding: "4px 8px",
      cursor: "pointer",
      fontSize: "12px",
    });
    let hidden = false;
    hideBtn.addEventListener("click", () => {
      hidden = !hidden;
      overlay.style.display = hidden ? "none" : "block";
      hideBtn.textContent = hidden ? "show" : "hide";
    });
    panel.appendChild(label);
    panel.appendChild(slider);
    panel.appendChild(hideBtn);
    document.body.appendChild(overlay);
    document.body.appendChild(panel);
  })();
});

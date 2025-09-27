document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('composer-form');
  const screen = document.getElementById('screen');
  const byteCounter = document.getElementById('byte-counter');
  const statusLabel = document.getElementById('status-label');
  const toolbar = document.querySelector('.screen__toolbar');
  const composer = document.getElementById('composer-form');

  let mode = 'compose';
  let currentBox = 'inbox';
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

  function getSentIds() { try { const raw=localStorage.getItem('y2k.sentIds'); const arr=raw?JSON.parse(raw):[]; return new Set(Array.isArray(arr)?arr:[]);} catch { return new Set(); } }
  function saveSentId(id){ const set=getSentIds(); set.add(id); localStorage.setItem('y2k.sentIds', JSON.stringify([...set])); }
  function getSentNameMap(){ try{ const raw=localStorage.getItem('y2k.sentRecipients'); const obj=raw?JSON.parse(raw):{}; return (obj&&typeof obj==='object')?obj:{};}catch{return{};} }
  function saveSentRecipient(id,name){ const map=getSentNameMap(); map[id]=name; localStorage.setItem('y2k.sentRecipients', JSON.stringify(map)); }

  function ensureComposeView(){
    const existing=document.getElementById('compose-body');
    if(existing) return existing;
    screen.innerHTML=`
      <div class="message-detail">
        <div class="message-detail__meta">
          <span>To:</span>
          <span id="compose-to" contenteditable="true" data-placeholder="연락처 또는 이름"></span>
        </div>
        <div class="message-detail__body" id="compose-body" contenteditable="true" data-placeholder="내용을 입력하세요"></div>
      </div>`;
    return document.getElementById('compose-body');
  }

  function updateComposeCounter(){
    const bodyEl=ensureComposeView();
    const text=(bodyEl && bodyEl.innerText) ? bodyEl.innerText : '';
    const bytes=smsByteLength(text);
    byteCounter.textContent=`${bytes}/${SMS_LIMIT}B`;
    if(bytes>SMS_LIMIT) byteCounter.classList.add('over-limit'); else byteCounter.classList.remove('over-limit');
  }

  screen.addEventListener('input',(e)=>{ if(e.target && e.target.id==='compose-body') updateComposeCounter(); });
  ensureComposeView(); updateComposeCounter();

  async function fetchBox(box){
    let res=await fetch(`/api/boxes/${box}`);
    if(res.status===404){ legacyApi=true; res=await fetch('/api/messages'); }
    if(!res.ok) throw new Error('목록을 불러올 수 없습니다.');
    const data=await res.json();
    lastList=Array.isArray(data)?data:[];
    lastList.sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));
    if(!legacyApi) return lastList;
    const sentIds=getSentIds();
    if(box==='sent') return lastList.filter(m=> sentIds.has(m.id));
    if(box==='inbox') return lastList.filter(m=> !sentIds.has(m.id));
    if(box==='drafts') return [];
    return lastList;
  }

  function renderList(box, items){
    if(!Array.isArray(items)||items.length===0){ screen.innerHTML='<p class="empty-state">메시지가 없습니다.</p>'; return; }
    const list=document.createElement('div'); list.className='message-list';
    const sentNameMap=legacyApi?getSentNameMap():{};
    items.forEach((m)=>{
      const el=document.createElement('article'); el.className='message-item'; el.dataset.id=m.id;
      const titleText = legacyApi ? (box==='sent' ? (sentNameMap[m.id]||m.author||'-') : (m.author||'-')) : (box==='sent' ? (m.recipient||'-') : (m.author||'-'));
      el.innerHTML=`<div class="message-item__meta"><span class="message-item__title">${titleText}</span><time>${new Intl.DateTimeFormat('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(m.created_at))}</time></div><div class="message-item__preview"></div>`;
      el.querySelector('.message-item__preview').textContent=m.body;
      el.addEventListener('click',()=>openDetail(m.id));
      list.appendChild(el);
    });
    screen.innerHTML=''; screen.appendChild(list);
  }

  async function loadBox(box){ currentBox=box; try{ const items=await fetchBox(box); renderList(box,items);} catch(e){ screen.innerHTML='<p class="empty-state">목록을 불러오는 중 오류</p>'; } }

  async function openDetail(id){
    let m; let res=await fetch(`/api/messages/${id}`);
    if(res.status===404 && legacyApi){ m=(lastList||[]).find(x=> String(x.id)===String(id)); if(!m) return; }
    else { if(!res.ok) return; m=await res.json(); }
    if(!legacyApi && m.box==='inbox' && !m.read){ fetch(`/api/messages/${id}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({read:true})}); }
    const sentIds=getSentIds(); const sentNameMap=getSentNameMap();
    const isSent = legacyApi ? sentIds.has(m.id) : m.box==='sent';
    const otherName = isSent ? (legacyApi ? (sentNameMap[m.id]||m.author||'-') : (m.recipient||'-')) : (m.author||'-');
    screen.innerHTML=`<div class="message-detail"><div class="message-detail__meta"><span>${isSent?`To: ${otherName}`:`From: ${otherName}`}</span><time>${new Intl.DateTimeFormat('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(m.created_at))}</time></div><div class="message-detail__body"></div><div style="margin-top:10px; display:flex; gap:8px;"><button type="button" id="btn-back">뒤로</button><button type="button" id="btn-delete">삭제</button></div></div>`;
    screen.querySelector('.message-detail__body').textContent=m.body;
    screen.querySelector('#btn-back').addEventListener('click',()=>setActiveTab(currentBox));
    screen.querySelector('#btn-delete').addEventListener('click', async()=>{ const ok=confirm('삭제할까요?'); if(!ok) return; const resp=await fetch(`/api/messages/${m.id}`,{method:'DELETE'}); if(resp.ok) setActiveTab(currentBox); });
  }

  function setActiveTab(nextMode){
    mode=nextMode;
    if(screen) screen.setAttribute('data-mode', mode);
    document.querySelectorAll('.toolbar__tab').forEach((t)=> t.setAttribute('aria-current', t.dataset.mode===mode?'page':'false'));
    if(mode==='compose'){
      statusLabel.textContent='메시지 작성';
      ensureComposeView();
      requestAnimationFrame(()=>{ if(screen) screen.scrollTop=0; const bodyEl=document.getElementById('compose-body'); if(bodyEl&&bodyEl.scrollIntoView) bodyEl.scrollIntoView({block:'start', inline:'nearest'}); });
      updateComposeCounter();
      if(composer) composer.setAttribute('hidden','');
      if(byteCounter) byteCounter.removeAttribute('hidden');
    } else if(mode==='menu'){
      statusLabel.textContent='메뉴';
      if(composer) composer.setAttribute('hidden','');
      if(byteCounter) byteCounter.setAttribute('hidden','');
      renderMenu();
    } else {
      statusLabel.textContent = mode==='inbox' ? '받은 메시지' : (mode==='sent' ? '보낸 메시지' : '임시보관함');
      loadBox(mode);
      if(composer) composer.setAttribute('hidden','');
      if(byteCounter) byteCounter.setAttribute('hidden','');
    }
  }

  function renderMenu(){ const menu=document.createElement('div'); menu.className='menu-list'; [{key:'inbox',label:'받은함'},{key:'sent',label:'보낸함'},{key:'drafts',label:'임시'},{key:'compose',label:'작성'}].forEach(({key,label})=>{ const b=document.createElement('button'); b.type='button'; b.className='menu-item'; b.textContent=label; b.addEventListener('click',()=>setActiveTab(key)); menu.appendChild(b); }); screen.innerHTML=''; screen.appendChild(menu); }

  if(toolbar){ toolbar.addEventListener('click', async (e)=>{ const composeBtn=e.target.closest('.toolbar__tab'); if(composeBtn){ e.preventDefault(); if(mode==='compose'){ try{ await doSend(); }catch(err){ alert(err.message||String(err)); } } else { setActiveTab('compose'); } return; } if(e.target.closest('#btn-menu')){ e.preventDefault(); setActiveTab('menu'); } }); }
  setActiveTab('compose');

  async function doSend(){
    const toEl=document.getElementById('compose-to');
    const bodyEl=document.getElementById('compose-body');
    const payload={ recipient:(toEl?.innerText||'').trim(), body:(bodyEl?.innerText||'').trim() };
    if(!payload.recipient||!payload.body){ alert('받는이와 메시지를 입력하세요.'); return; }
    let response=await fetch('/api/compose',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
    if(response.status===404){ legacyApi=true; response=await fetch('/api/messages',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ author: payload.recipient, body: payload.body }) }); if(response.ok){ const created=await response.json().catch(()=>null); if(created&&created.id!=null){ saveSentId(created.id); saveSentRecipient(created.id, payload.recipient); } } }
    else if(response.ok){ const created=await response.json().catch(()=>null); if(created&&created.id!=null&&payload.recipient) saveSentRecipient(created.id, payload.recipient); }
    if(!response.ok){ const data=await response.json().catch(()=>({})); const message=data?.detail??'메세지를 전송할 수 없습니다.'; throw new Error(message); }
    if(form) form.reset(); setActiveTab('sent');
  }

  form.addEventListener('submit',(event)=>{ event.preventDefault(); doSend().catch(err=>alert(err.message||String(err))); });

  // Reference overlay
  (function setupReferenceOverlay(){ const params=new URLSearchParams(window.location.search); if(!params.has('ref')) return; const overlay=document.createElement('div'); overlay.id='ref-overlay'; Object.assign(overlay.style,{position:'fixed',inset:'0',backgroundImage:'url(/assets/reference.png)',backgroundRepeat:'no-repeat',backgroundPosition:'center top',backgroundSize:'contain',opacity:'0.5',pointerEvents:'none',zIndex:'9999'}); const panel=document.createElement('div'); Object.assign(panel.style,{position:'fixed',top:'8px',right:'8px',display:'flex',gap:'6px',alignItems:'center',padding:'6px 8px',background:'rgba(0,0,0,0.55)',color:'#fff',borderRadius:'8px',zIndex:'10000'}); const label=document.createElement('span'); label.textContent='ref'; label.style.fontSize='12px'; const slider=document.createElement('input'); slider.type='range'; slider.min='0'; slider.max='100'; slider.value='50'; slider.style.width='120px'; slider.addEventListener('input',()=>{overlay.style.opacity=String(Number(slider.value)/100)}); const hideBtn=document.createElement('button'); hideBtn.textContent='hide'; Object.assign(hideBtn.style,{background:'#333',color:'#fff',border:'1px solid #666',borderRadius:'6px',padding:'4px 8px',cursor:'pointer',fontSize:'12px'}); let hidden=false; hideBtn.addEventListener('click',()=>{hidden=!hidden; overlay.style.display=hidden?'none':'block'; hideBtn.textContent=hidden?'show':'hide';}); panel.appendChild(label); panel.appendChild(slider); panel.appendChild(hideBtn); document.body.appendChild(overlay); document.body.appendChild(panel); })();
});


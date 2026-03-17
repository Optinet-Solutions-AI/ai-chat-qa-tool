// ── ROLE ──────────────────────────────────────────────────────────

function setRole(r) {
  currentRole = r;
  save();
  const adm = document.getElementById('role-adm');
  const cli = document.getElementById('role-cli');
  if (adm) adm.className = 'role-btn' + (r === 'admin' ? ' a-adm' : '');
  if (cli) cli.className = 'role-btn' + (r === 'client' ? ' a-cli' : '');
  document.getElementById('ov-role').textContent = r === 'admin' ? 'Admin' : 'Client';
  syncWhoUI();
}

function syncWhoUI() {
  const adm = document.getElementById('tm-who-adm');
  const cli = document.getElementById('tm-who-cli');
  if (adm && cli) {
    adm.className = 'who-btn' + (currentRole === 'admin' ? ' a-adm' : '');
    cli.className = 'who-btn' + (currentRole === 'client' ? ' a-cli' : '');
  }
  // Also sync any open accordion who buttons
  document.querySelectorAll('.q-panel.open .who-btn').forEach(btn => {
    btn.className = 'who-btn';
    if (btn.textContent.includes('Admin') && currentRole === 'admin') btn.classList.add('a-adm');
    if (btn.textContent.includes('Client') && currentRole === 'client') btn.classList.add('a-cli');
  });
}

function switchWho(r) {
  currentRole = r;
  save();
  syncWhoUI();
}

// ── SEND REPLY ────────────────────────────────────────────────────

function sendReply() {
  if (!openQid) return;
  const ta = document.getElementById('tm-ta');
  const text = ta.value.trim();
  if (!text) return;
  const q = questions.find(x => x.id === openQid);
  if (!q || q.resolved) return;

  q.thread.push({ role: currentRole, text, ts: new Date().toISOString() });
  save();
  dbInsertMessage(openQid, currentRole, text); // Supabase (async, optimistic)
  ta.value = '';

  renderThreadMessages(q);
  renderFooter(q);
  scrollThreadBottom();

  const badge = document.getElementById('tm-badge');
  badge.className = 'q-badge in-disc';
  badge.textContent = 'In Discussion';

  const card = document.getElementById('card-' + openQid);
  if (card) {
    document.getElementById('qc-' + q.stage).replaceChild(buildCard(q), card);
  }
  updateStageProg(q.stage);
  updateGlobal();
  updatePills();
  renderOverview();
  toast('Reply sent', 'ok');
}

// ── RESOLVE / REOPEN ──────────────────────────────────────────────

function resolveQ() {
  if (!openQid) return;
  const q = questions.find(x => x.id === openQid);
  if (!q) return;
  const hasAdm = q.thread.some(m => m.role === 'admin');
  const hasCli = q.thread.some(m => m.role === 'client');
  if (!hasAdm || !hasCli) { toast('Need replies from both Admin and Client first', 'i'); return; }
  q.resolved = true;
  save();
  dbSetResolved(openQid, true); // Supabase

  renderThreadMessages(q);
  renderFooter(q);

  const badge = document.getElementById('tm-badge');
  badge.className = 'q-badge resolved';
  badge.textContent = 'Resolved';

  const card = document.getElementById('card-' + openQid);
  if (card) { document.getElementById('qc-' + q.stage).replaceChild(buildCard(q), card); }
  updateStageProg(q.stage);
  updateGlobal();
  updatePills();
  renderOverview();
  toast('Question resolved ✅', 'ok');
}

function reopenQ() {
  if (!openQid) return;
  const q = questions.find(x => x.id === openQid);
  if (!q) return;
  q.resolved = false;
  save();
  dbSetResolved(openQid, false); // Supabase

  renderThreadMessages(q);
  renderFooter(q);

  const badge = document.getElementById('tm-badge');
  badge.className = 'q-badge in-disc';
  badge.textContent = 'In Discussion';

  const card = document.getElementById('card-' + openQid);
  if (card) { document.getElementById('qc-' + q.stage).replaceChild(buildCard(q), card); }
  updateStageProg(q.stage);
  updateGlobal();
  updatePills();
  renderOverview();
  toast('Question reopened', 'i');
}

// ── ACCORDION ACTIONS (mobile) ────────────────────────────────────

function accSend(qid) {
  const ta = document.getElementById('acc-ta-' + qid);
  if (!ta) return;
  const text = ta.value.trim();
  if (!text) return;
  const q = questions.find(x => x.id === qid);
  if (!q || q.resolved) return;

  q.thread.push({ role: currentRole, text, ts: new Date().toISOString() });
  save();
  dbInsertMessage(qid, currentRole, text);

  const wrap = document.getElementById('card-' + qid);
  if (wrap) wrap.parentElement.replaceChild(buildCard(q), wrap);
  openAccordionPanel(qid);

  updateStageProg(q.stage);
  updateGlobal();
  updatePills();
  renderOverview();
  toast('Reply sent', 'ok');
}

function accResolve(qid) {
  const q = questions.find(x => x.id === qid);
  if (!q) return;
  const hasAdm = q.thread.some(m => m.role === 'admin');
  const hasCli = q.thread.some(m => m.role === 'client');
  if (!hasAdm || !hasCli) { toast('Need replies from both Admin and Client first', 'i'); return; }
  q.resolved = true;
  save();
  dbSetResolved(qid, true);

  const wrap = document.getElementById('card-' + qid);
  if (wrap) wrap.parentElement.replaceChild(buildCard(q), wrap);
  openAccordionPanel(qid);

  updateStageProg(q.stage);
  updateGlobal();
  updatePills();
  renderOverview();
  toast('Question resolved ✅', 'ok');
}

function accReopen(qid) {
  const q = questions.find(x => x.id === qid);
  if (!q) return;
  q.resolved = false;
  save();
  dbSetResolved(qid, false);

  const wrap = document.getElementById('card-' + qid);
  if (wrap) wrap.parentElement.replaceChild(buildCard(q), wrap);
  openAccordionPanel(qid);

  updateStageProg(q.stage);
  updateGlobal();
  updatePills();
  renderOverview();
  toast('Question reopened', 'i');
}

function accDelete(qid) {
  const q = questions.find(x => x.id === qid);
  if (!q) return;
  if (!confirm(`Delete "${q.num} — ${q.text.slice(0, 60)}${q.text.length > 60 ? '…' : ''}"?\n\nThis cannot be undone.`)) return;
  const stage = q.stage;
  questions = questions.filter(x => x.id !== qid);
  if (openQid === qid) openQid = null;
  save();
  dbDeleteQuestion(qid);
  renderStage(stage);
  updateGlobal();
  updatePills();
  renderOverview();
  toast('Question deleted', 'i');
}

function accSwitchWho(role, qid) {
  currentRole = role;
  save();
  const panel = document.getElementById('panel-' + qid);
  if (!panel) return;
  panel.querySelectorAll('.who-btn').forEach(btn => {
    btn.className = 'who-btn';
    if (btn.textContent.includes('Admin') && role === 'admin') btn.classList.add('a-adm');
    if (btn.textContent.includes('Client') && role === 'client') btn.classList.add('a-cli');
  });
}

function accHandleKey(e, qid) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    accSend(qid);
  }
}

// ── DELETE ────────────────────────────────────────────────────────

function deleteQ() {
  if (!openQid) return;
  const q = questions.find(x => x.id === openQid);
  if (!q) return;
  if (!confirm(`Delete "${q.num} — ${q.text.slice(0, 60)}${q.text.length > 60 ? '…' : ''}"?\n\nThis cannot be undone.`)) return;
  const stage = q.stage;
  const deletedId = openQid; // capture before closeThread() clears it
  questions = questions.filter(x => x.id !== openQid);
  save();
  dbDeleteQuestion(deletedId); // Supabase (cascade removes messages)
  closeThread();
  renderStage(stage);
  updateGlobal();
  updatePills();
  renderOverview();
  toast('Question deleted', 'i');
}

// ── STATE ─────────────────────────────────────────────────────────

let questions = [], stages = [], conversations = [], currentRole = 'admin', openQid = null;
const SK = 'qa-dash-v5';

async function loadState() {
  currentRole = localStorage.getItem('qa-role') || 'admin';

  // ── Supabase ────────────────────────────────────────────────────
  if (window.db) {
    try {
      const [sRes, qRes, mRes] = await Promise.all([
        window.db.from('stages').select('*').order('sort_order'),
        window.db.from('questions').select('*'),
        window.db.from('messages').select('*').order('created_at'),
      ]);
      if (sRes.error) throw sRes.error;
      if (qRes.error) throw qRes.error;
      if (mRes.error) throw mRes.error;

      stages = sRes.data.map(s => ({ id: s.id, label: s.label, emoji: s.emoji }));
      questions = qRes.data.map(q => ({
        id:       q.id,
        stage:    q.stage_id,
        num:      q.num,
        text:     q.text,
        resolved: q.resolved,
        thread:   mRes.data
          .filter(m => m.question_id === q.id)
          .map(m => ({ role: m.role, text: m.text, ts: m.created_at })),
      }));
      console.info('[Supabase] Loaded', stages.length, 'stages,', questions.length, 'questions');
      // Conversations are localStorage-only (no Supabase table)
      try {
        const lc = localStorage.getItem('qa-conv-v1');
        if (lc) conversations = JSON.parse(lc);
      } catch(_) {}
      return;
    } catch (e) {
      console.error('[Supabase] loadState failed, falling back to localStorage:', e.message);
    }
  }

  // ── localStorage fallback ───────────────────────────────────────
  try {
    const s = localStorage.getItem(SK);
    if (s) {
      const d = JSON.parse(s);
      questions = d.questions;
      stages    = d.stages || JSON.parse(JSON.stringify(DEFAULT_STAGES));
      // Prefer the dedicated conversations key; fall back to the bundled one
      try {
        const lc = localStorage.getItem('qa-conv-v1');
        conversations = lc ? JSON.parse(lc) : (d.conversations || []);
      } catch(_) {
        conversations = d.conversations || [];
      }
    } else {
      initDefault();
    }
  } catch (e) {
    initDefault();
  }
}

function initDefault() {
  stages    = JSON.parse(JSON.stringify(DEFAULT_STAGES));
  questions = SEED.map(s => ({
    ...s,
    thread:   SEED_THREADS[s.id] ? [...SEED_THREADS[s.id]] : [],
    resolved: PRE_RESOLVED.includes(s.id),
  }));
}

// Persists role locally; also full-saves to localStorage when Supabase is not active.
// Conversations are always saved locally — they have no Supabase table.
function save() {
  localStorage.setItem('qa-role', currentRole);
  localStorage.setItem('qa-conv-v1', JSON.stringify(conversations));
  if (!window.db) {
    localStorage.setItem(SK, JSON.stringify({ questions, stages, conversations, role: currentRole }));
  }
}

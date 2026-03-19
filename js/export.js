// ── EXPORT ────────────────────────────────────────────────────────

function exportMD() {
  document.getElementById('export-overlay').classList.add('open');
}

function closeExportModal() {
  document.getElementById('export-overlay').classList.remove('open');
}

function runExport() {
  const includeQA   = document.getElementById('exp-qa').checked;
  const includeConv = document.getElementById('exp-conv').checked;

  if (!includeQA && !includeConv) {
    toast('Select at least one option', 'i');
    return;
  }

  let md = `# QA Dashboard — Chat Monitoring & Analysis\n**Exported:** ${new Date().toLocaleDateString('en-GB')}\n\n---\n\n`;

  // ── Q&A Sections ──────────────────────────────────────────────
  if (includeQA) {
    md += `# 📋 Q&A Sections\n\n`;
    stages.forEach((st, i) => {
      const sq   = questions.filter(q => q.stage === st.id);
      const done = sq.filter(q => q.resolved).length;
      md += `## ${st.emoji} Section ${i + 1} — ${st.label}\n*${done}/${sq.length} resolved*\n\n---\n\n`;
      sq.forEach(q => {
        md += `### ${q.num} — ${q.text}\n**Status:** ${q.resolved ? '✅ Resolved' : '🟡 Pending'}\n\n`;
        if (q.thread.length > 0) {
          md += `**Thread:**\n\n`;
          q.thread.forEach(m => {
            const who = m.role === 'admin' ? '👤 Admin' : '🏢 Client';
            md += `> **${who}** _(${fmtTime(m.ts)})_\n>\n`;
            m.text.split('\n').forEach(l => { md += `> ${l}\n`; });
            md += `\n`;
          });
        }
        md += `---\n\n`;
      });
    });
  }

  // ── Conversation Analysis ──────────────────────────────────────
  if (includeConv) {
    md += `# 🧠 Conversation Analysis\n*${conversations.length} conversation${conversations.length !== 1 ? 's' : ''} analyzed*\n\n---\n\n`;

    if (conversations.length === 0) {
      md += `_No conversations analyzed yet._\n\n`;
    } else {
      const sorted = conversations.slice().sort((a, b) => new Date(b.analyzed_at) - new Date(a.analyzed_at));
      sorted.forEach((c, i) => {
        md += `## ${i + 1}. ${c.title}\n`;
        md += `**Sentiment:** ${c.sentiment}  |  **Intent:** ${c.intent}\n`;
        if (c.intercom_id) md += `**Intercom ID:** ${c.intercom_id}\n`;
        md += `**Analyzed:** ${fmtTime(c.analyzed_at)}\n\n`;
        md += `**Summary:**\n> ${(c.summary || '').split('\n').join('\n> ')}\n\n`;

        if (c.notes && c.notes.length > 0) {
          const teamNotes = c.notes.filter(n => !n.system);
          const sysNotes  = c.notes.filter(n => n.system);
          if (teamNotes.length > 0) {
            md += `**Team Notes:**\n`;
            teamNotes.forEach(n => {
              md += `> 💬 **${n.author}** _(${fmtTime(n.ts)})_: ${n.text}\n`;
            });
            md += `\n`;
          }
          if (sysNotes.length > 0) {
            md += `**Re-analysis Log:**\n`;
            sysNotes.forEach(n => {
              md += `> 🔄 _(${fmtTime(n.ts)})_: ${n.text}\n`;
            });
            md += `\n`;
          }
        }
        md += `---\n\n`;
      });
    }
  }

  const filename = includeQA && includeConv ? 'QA-Full-Export.md'
                 : includeQA               ? 'QA-Sections-Export.md'
                 :                           'QA-Conversations-Export.md';

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
  a.download = filename;
  a.click();

  closeExportModal();
  toast('Exported', 'ok');
}

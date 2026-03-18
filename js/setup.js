/**
 * setup.js
 * Handles User Onboarding (Welcome Modal) and AI Import Logic.
 */

let setupRole = null;
let uploadedFileContent = null;

// ── INITIALIZATION ────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  checkUserSession();
});

function checkUserSession() {
  const user = localStorage.getItem('qa_user');
  const role = localStorage.getItem('qa_role_pref');

  if (user && role) {
    // User exists, show dashboard
    updateUserDisplay(user, role);
    
    // Sync with app state if functions exist
    if (typeof setRole === 'function') {
      setRole(role);
    }
  } else {
    // First visit, show modal
    document.getElementById('welcome-overlay').classList.add('open');
  }
}

function updateUserDisplay(name, role) {
  const disp = document.getElementById('user-display');
  const label = role === 'admin' ? 'Admin' : 'User';
  const icon = role === 'admin' ? '👤' : '🏢';
  
  disp.innerHTML = `${icon} ${esc(name)} <span style="opacity:0.5;margin:0 4px">|</span> ${label}`;
  disp.classList.remove('hidden');

  // Optionally hide the manual switcher if you want strict enforcement
  // document.querySelector('.role-sw').style.display = 'none';
}

// ── WELCOME MODAL LOGIC ───────────────────────────────────────────

function selectSetupRole(role, el) {
  setupRole = role;
  
  // UI Toggle
  document.querySelectorAll('.role-opt').forEach(opt => opt.classList.remove('selected'));
  el.classList.add('selected');
  
  // Clear error
  document.getElementById('err-role').classList.remove('vis');
}

function saveUserSetup() {
  const nameInput = document.getElementById('setup-name');
  const name = nameInput.value.trim();
  
  let isValid = true;

  // Validation
  if (!name) {
    document.getElementById('err-name').classList.add('vis');
    isValid = false;
  } else {
    document.getElementById('err-name').classList.remove('vis');
  }

  if (!setupRole) {
    document.getElementById('err-role').classList.add('vis');
    isValid = false;
  }

  if (!isValid) return;

  // Save to LocalStorage
  localStorage.setItem('qa_user', name);
  localStorage.setItem('qa_role_pref', setupRole);

  // Apply settings
  updateUserDisplay(name, setupRole);
  if (typeof setRole === 'function') {
    setRole(setupRole);
  }

  // Close Modal
  document.getElementById('welcome-overlay').classList.remove('open');
  if (typeof toast === 'function') toast(`Welcome, ${name}!`, 'ok');
}

// ── IMPORT / AI MODAL LOGIC ───────────────────────────────────────

function openImportModal() {
  document.getElementById('import-overlay').classList.add('open');
}

function closeImportModal() {
  document.getElementById('import-overlay').classList.remove('open');
  // Reset fields
  document.getElementById('file-input').value = '';
  document.getElementById('file-name').textContent = 'No file selected';
  document.getElementById('import-text').value = '';
  uploadedFileContent = null;
}

function switchImportTab(mode) {
  // Update Buttons
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');

  // Update Content
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('tab-' + mode).classList.add('active');
}

function handleFileSelect(input) {
  const file = input.files[0];
  if (!file) return;

  document.getElementById('file-name').textContent = file.name;

  const reader = new FileReader();
  reader.onload = (e) => {
    uploadedFileContent = e.target.result;
    // For preview, we could dump visible text into the textarea if it's JSON
    if (file.name.endsWith('.json')) {
        document.getElementById('import-text').value = uploadedFileContent;
    }
  };
  reader.readAsText(file);
}

// ── AI ANALYSIS PLACEHOLDER ───────────────────────────────────────

async function analyzeConversation(conversationText) {
  // ---------------------------------------------------------
  // PLACEHOLDER FOR OPENAI API
  // ---------------------------------------------------------
  console.log("Analyze requested for:", conversationText.substring(0, 50) + "...");

  // Simulate API delay
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({ status: 'success', summary: 'Analysis complete.' });
    }, 1500);
  });
}

async function runAnalysis() {
  // Determine source
  let textToAnalyze = document.getElementById('import-text').value.trim();
  
  // If text is empty but we have a file loaded, use that
  if (!textToAnalyze && uploadedFileContent) {
    textToAnalyze = uploadedFileContent;
  }

  if (!textToAnalyze) {
    if (typeof toast === 'function') toast('Please upload a file or paste text', 'i');
    else alert('Please upload a file or paste text');
    return;
  }

  const btn = document.querySelector('#import-overlay .btn-p');
  const originalText = btn.textContent;
  btn.textContent = 'Analyzing...';
  btn.disabled = true;

  try {
    await analyzeConversation(textToAnalyze);
    if (typeof toast === 'function') toast('Conversation analyzed successfully', 'ok');
    closeImportModal();
  } catch (err) {
    console.error(err);
    if (typeof toast === 'function') toast('Analysis failed', 'i');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}
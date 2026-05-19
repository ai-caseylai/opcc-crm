export const SPA_HTML = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TechForLiving AI Gateway</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config={theme:{extend:{colors:{
  brand:{50:'#eef2ff',100:'#e0e7ff',400:'#818cf8',500:'#6366f1',600:'#4f46e5',700:'#4338ca',900:'#312e81'}
}}}}
</script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
body{font-family:'Inter',system-ui,sans-serif}
.gradient-text{background:linear-gradient(135deg,#818cf8,#6366f1,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px}
.card:hover{border-color:rgba(99,102,241,0.3)}
.glow{box-shadow:0 0 40px rgba(99,102,241,0.15)}
.btn-primary{background:linear-gradient(135deg,#6366f1,#4f46e5);transition:all .2s}
.btn-primary:hover{transform:translateY(-1px);box-shadow:0 4px 20px rgba(99,102,241,0.4)}
.modal-bg{background:rgba(0,0,0,0.7);backdrop-filter:blur(8px)}
.fade-in{animation:fadeIn .3s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.key-mask{font-family:monospace;letter-spacing:1px}
.copy-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#10b981;color:#fff;padding:8px 20px;border-radius:8px;font-size:14px;z-index:9999;animation:fadeIn .2s ease}
::-webkit-scrollbar{width:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px}
</style>
</head>
<body class="bg-[#0a0a0f] text-gray-100 min-h-screen">

<!-- ===== NAVBAR ===== -->
<nav class="fixed top-0 w-full z-50 bg-[#0a0a0f]/80 backdrop-blur-xl border-b border-white/5">
  <div class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
    <a href="/" onclick="navigate('landing')" class="flex items-center gap-2">
      <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">AI</div>
      <span class="font-semibold text-white">TechForLiving <span class="text-brand-400">Gateway</span></span>
    </a>
    <div id="nav-links" class="flex items-center gap-4 text-sm"></div>
  </div>
</nav>

<!-- ===== LANDING ===== -->
<div id="page-landing" class="pt-16">
  <!-- Hero -->
  <section class="max-w-4xl mx-auto px-6 pt-24 pb-16 text-center">
    <div class="inline-block px-4 py-1.5 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-400 text-sm mb-6">OpenAI-Compatible API</div>
    <h1 class="text-5xl md:text-6xl font-bold mb-6 leading-tight">
      Your Own <span class="gradient-text">AI Gateway</span>
    </h1>
    <p class="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">Access multiple LLM providers through a single OpenAI-compatible endpoint. Pay as you go.</p>
    <div class="flex justify-center gap-4">
      <button onclick="showAuth('register')" class="btn-primary px-8 py-3 rounded-xl text-white font-medium">Get Started Free</button>
      <button onclick="navigate('landing');document.getElementById('models-section').scrollIntoView({behavior:'smooth'})" class="px-8 py-3 rounded-xl border border-white/10 text-gray-300 hover:bg-white/5 font-medium">View Models</button>
    </div>
  </section>

  <!-- Models & Pricing -->
  <section id="models-section" class="max-w-6xl mx-auto px-6 pb-20">
    <h2 class="text-2xl font-bold text-center mb-10">Available Models</h2>
    <div class="grid md:grid-cols-2 lg:grid-cols-4 gap-4" id="model-cards"></div>
  </section>

  <!-- Quick Start -->
  <section class="max-w-3xl mx-auto px-6 pb-20">
    <h2 class="text-2xl font-bold text-center mb-8">Quick Start</h2>

    <!-- Tab selector -->
    <div class="flex justify-center gap-2 mb-6">
      <button onclick="showTab('openai')" id="tab-openai" class="px-4 py-2 rounded-lg text-sm font-medium bg-brand-500/20 text-brand-400 border border-brand-500/30">OpenAI SDK</button>
      <button onclick="showTab('anthropic')" id="tab-anthropic" class="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 border border-white/10 hover:bg-white/5">Anthropic SDK</button>
      <button onclick="showTab('curl')" id="tab-curl" class="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 border border-white/10 hover:bg-white/5">cURL</button>
    </div>

    <!-- OpenAI tab -->
    <div id="code-openai" class="card p-6">
      <div class="flex items-center gap-2 mb-4">
        <span class="text-xs text-gray-500 bg-white/5 px-2 py-1 rounded">python</span>
        <span class="text-xs text-gray-500">OpenAI SDK compatible</span>
      </div>
      <pre class="text-sm text-gray-300 overflow-x-auto"><code>from openai import OpenAI

client = OpenAI(
    base_url="https://llm.techforliving.net/v1",
    api_key="YOUR_API_KEY"
)

response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)</code></pre>
    </div>

    <!-- Anthropic tab -->
    <div id="code-anthropic" class="card p-6 hidden">
      <div class="flex items-center gap-2 mb-4">
        <span class="text-xs text-gray-500 bg-white/5 px-2 py-1 rounded">python</span>
        <span class="text-xs text-gray-500">Anthropic SDK compatible</span>
      </div>
      <pre class="text-sm text-gray-300 overflow-x-auto"><code>import anthropic

client = anthropic.Anthropic(
    base_url="https://llm.techforliving.net",
    api_key="YOUR_API_KEY"
)

message = client.messages.create(
    model="deepseek-chat",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}]
)
print(message.content[0].text)</code></pre>
    </div>

    <!-- cURL tab -->
    <div id="code-curl" class="card p-6 hidden">
      <div class="flex items-center gap-2 mb-4">
        <span class="text-xs text-gray-500 bg-white/5 px-2 py-1 rounded">bash</span>
        <span class="text-xs text-gray-500">OpenAI-compatible</span>
      </div>
      <pre class="text-sm text-gray-300 overflow-x-auto"><code>curl https://llm.techforliving.net/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'</code></pre>
    </div>

    <p class="text-center text-gray-500 text-sm mt-6">Works with OpenAI SDK, Anthropic SDK, LangChain, CrewAI, and any compatible client.</p>
  </section>

  <!-- Footer -->
  <footer class="border-t border-white/5 py-8 text-center text-gray-500 text-sm">
    <p>&copy; 2026 TechForLiving AI Gateway. Powered by Cloudflare.</p>
  </footer>
</div>

<!-- ===== DASHBOARD ===== -->
<div id="page-dashboard" class="pt-16 hidden">
  <div class="max-w-5xl mx-auto px-6 py-8">
    <!-- Header -->
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-2xl font-bold">Dashboard</h1>
        <p class="text-gray-400 text-sm mt-1" id="dash-email"></p>
      </div>
      <button onclick="createKey()" class="btn-primary px-5 py-2.5 rounded-xl text-sm text-white font-medium">+ New API Key</button>
    </div>

    <!-- Stats -->
    <div class="grid md:grid-cols-3 gap-4 mb-8" id="dash-stats"></div>

    <!-- API Keys -->
    <div class="card p-6">
      <h2 class="text-lg font-semibold mb-4">API Keys</h2>
      <div id="keys-list"></div>
    </div>
  </div>
</div>

<!-- ===== AUTH MODAL ===== -->
<div id="auth-modal" class="hidden fixed inset-0 z-50 modal-bg flex items-center justify-center p-4">
  <div class="card glow w-full max-w-md p-8 fade-in relative">
    <button onclick="hideAuth()" class="absolute top-4 right-4 text-gray-500 hover:text-white text-xl">&times;</button>

    <!-- Login Form -->
    <div id="form-login">
      <h2 class="text-xl font-bold mb-6">Sign In</h2>
      <div class="space-y-4">
        <div>
          <label class="text-sm text-gray-400 mb-1 block">Email</label>
          <input type="email" id="login-email" class="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none" placeholder="you@example.com">
        </div>
        <div>
          <label class="text-sm text-gray-400 mb-1 block">Password</label>
          <input type="password" id="login-password" class="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none" placeholder="Min 6 characters">
        </div>
        <div id="login-error" class="text-red-400 text-sm hidden"></div>
        <button onclick="doLogin()" class="btn-primary w-full py-2.5 rounded-lg text-white font-medium">Sign In</button>
      </div>
      <p class="text-center text-gray-500 text-sm mt-6">Don't have an account? <a href="#" onclick="showAuth('register')" class="text-brand-400 hover:underline">Sign up</a></p>
    </div>

    <!-- Register Form -->
    <div id="form-register" class="hidden">
      <h2 class="text-xl font-bold mb-6">Create Account</h2>
      <div class="space-y-4">
        <div>
          <label class="text-sm text-gray-400 mb-1 block">Email</label>
          <input type="email" id="reg-email" class="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none" placeholder="you@example.com">
        </div>
        <div>
          <label class="text-sm text-gray-400 mb-1 block">Password</label>
          <input type="password" id="reg-password" class="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none" placeholder="Min 6 characters">
        </div>
        <div>
          <label class="text-sm text-gray-400 mb-1 block">Confirm Password</label>
          <input type="password" id="reg-password2" class="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none" placeholder="Confirm password">
        </div>
        <div id="reg-error" class="text-red-400 text-sm hidden"></div>
        <button onclick="doRegister()" class="btn-primary w-full py-2.5 rounded-lg text-white font-medium">Create Account</button>
      </div>
      <p class="text-center text-gray-500 text-sm mt-6">Already have an account? <a href="#" onclick="showAuth('login')" class="text-brand-400 hover:underline">Sign in</a></p>
    </div>
  </div>
</div>

<script>
// ===== STATE =====
const API = window.location.origin;
let token = localStorage.getItem('tfl_token');
let userEmail = localStorage.getItem('tfl_email');

const MODELS = [
  { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'DeepSeek', inputPrice: 0.30, outputPrice: 0.60, badge: 'Popular', badgeColor: 'bg-green-500/20 text-green-400' },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'DeepSeek', inputPrice: 0.20, outputPrice: 0.40, badge: 'Fast', badgeColor: 'bg-blue-500/20 text-blue-400' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'DeepSeek', inputPrice: 1.00, outputPrice: 2.00, badge: 'Pro', badgeColor: 'bg-purple-500/20 text-purple-400' },
  { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'DeepSeek', inputPrice: 0.80, outputPrice: 1.60, badge: 'Thinking', badgeColor: 'bg-amber-500/20 text-amber-400' },
  { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', provider: 'Kimi K2.6', inputPrice: 1.50, outputPrice: 3.00, badge: 'Alias', badgeColor: 'bg-indigo-500/20 text-indigo-400' },
  { id: 'claude-opus-4-7', name: 'Opus 4.7', provider: 'GLM-5.1', inputPrice: 2.00, outputPrice: 5.00, badge: 'Alias', badgeColor: 'bg-indigo-500/20 text-indigo-400' },
  { id: 'kimi', name: 'Kimi', provider: 'Moonshot', inputPrice: 1.00, outputPrice: 2.00 },
  { id: 'glm-4-plus', name: 'GLM-4 Plus', provider: 'Zhipu', inputPrice: 1.00, outputPrice: 2.00 },
];

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  renderModels();
  updateNav();
  if (token) navigate('dashboard');
  else navigate('landing');
});

// ===== NAVIGATION =====
function navigate(page) {
  document.getElementById('page-landing').classList.toggle('hidden', page !== 'landing');
  document.getElementById('page-dashboard').classList.toggle('hidden', page !== 'dashboard');
  updateNav();
  if (page === 'dashboard') loadDashboard();
}

function updateNav() {
  const nav = document.getElementById('nav-links');
  if (token) {
    nav.innerHTML = \`
      <span class="text-gray-400">\${userEmail}</span>
      <button onclick="navigate('dashboard')" class="text-gray-300 hover:text-white">Dashboard</button>
      <button onclick="doLogout()" class="text-gray-400 hover:text-white">Logout</button>
    \`;
  } else {
    nav.innerHTML = \`
      <button onclick="showAuth('login')" class="text-gray-300 hover:text-white">Sign In</button>
      <button onclick="showAuth('register')" class="btn-primary px-4 py-2 rounded-lg text-sm text-white">Get Started</button>
    \`;
  }
}

// ===== AUTH =====
function showAuth(type) {
  document.getElementById('auth-modal').classList.remove('hidden');
  document.getElementById('form-login').classList.toggle('hidden', type !== 'login');
  document.getElementById('form-register').classList.toggle('hidden', type !== 'register');
  document.getElementById('login-error').classList.add('hidden');
  document.getElementById('reg-error').classList.add('hidden');
}

function hideAuth() {
  document.getElementById('auth-modal').classList.add('hidden');
}

async function doRegister() {
  const email = document.getElementById('reg-email').value.trim();
  const pw = document.getElementById('reg-password').value;
  const pw2 = document.getElementById('reg-password2').value;
  const err = document.getElementById('reg-error');

  if (pw !== pw2) { err.textContent = 'Passwords do not match'; err.classList.remove('hidden'); return; }
  if (pw.length < 6) { err.textContent = 'Password must be at least 6 characters'; err.classList.remove('hidden'); return; }
  if (!email) { err.textContent = 'Email is required'; err.classList.remove('hidden'); return; }

  try {
    const resp = await fetch(API + '/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pw }),
    });
    const data = await resp.json();
    if (!resp.ok) { err.textContent = data.error || 'Registration failed'; err.classList.remove('hidden'); return; }

    token = data.token;
    userEmail = email;
    localStorage.setItem('tfl_token', token);
    localStorage.setItem('tfl_email', email);
    if (data.litellm_key) localStorage.setItem('tfl_first_key', data.litellm_key);

    hideAuth();
    navigate('dashboard');
  } catch (e) {
    err.textContent = 'Network error'; err.classList.remove('hidden');
  }
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pw = document.getElementById('login-password').value;
  const err = document.getElementById('login-error');

  if (!email || !pw) { err.textContent = 'Email and password required'; err.classList.remove('hidden'); return; }

  try {
    const resp = await fetch(API + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pw }),
    });
    const data = await resp.json();
    if (!resp.ok) { err.textContent = data.error || 'Login failed'; err.classList.remove('hidden'); return; }

    token = data.token;
    userEmail = email;
    localStorage.setItem('tfl_token', token);
    localStorage.setItem('tfl_email', email);

    hideAuth();
    navigate('dashboard');
  } catch (e) {
    err.textContent = 'Network error'; err.classList.remove('hidden');
  }
}

function doLogout() {
  token = null;
  userEmail = null;
  localStorage.removeItem('tfl_token');
  localStorage.removeItem('tfl_email');
  localStorage.removeItem('tfl_first_key');
  navigate('landing');
}

// ===== DASHBOARD =====
async function loadDashboard() {
  document.getElementById('dash-email').textContent = userEmail;
  document.getElementById('dash-stats').innerHTML = '<div class="card p-5 text-center text-gray-500">Loading...</div>';
  document.getElementById('keys-list').innerHTML = '';

  try {
    const [keysResp, userResp] = await Promise.all([
      fetch(API + '/api/keys', { headers: { Authorization: 'Bearer ' + token } }),
      fetch(API + '/api/user', { headers: { Authorization: 'Bearer ' + token } }),
    ]);
    const keysData = await keysResp.json();
    const userData = await userResp.json();

    renderStats(keysData, userData);
    renderKeys(keysData);
  } catch (e) {
    document.getElementById('dash-stats').innerHTML = '<div class="card p-5 text-center text-red-400">Failed to load data</div>';
  }
}

function renderStats(keysData, userData) {
  const keys = keysData?.keys || [];
  const totalSpend = keys.reduce((s, k) => s + (k.spend || 0), 0);
  const maxBudget = keys.reduce((s, k) => s + (k.max_budget || 0), 0);
  const activeKeys = keys.filter(k => !k.blocked).length;

  document.getElementById('dash-stats').innerHTML = \`
    <div class="card p-5">
      <div class="text-sm text-gray-400">API Keys</div>
      <div class="text-2xl font-bold mt-1">\${activeKeys}</div>
    </div>
    <div class="card p-5">
      <div class="text-sm text-gray-400">Total Spend</div>
      <div class="text-2xl font-bold mt-1">$\${totalSpend.toFixed(4)}</div>
    </div>
    <div class="card p-5">
      <div class="text-sm text-gray-400">Budget</div>
      <div class="text-2xl font-bold mt-1">\${maxBudget ? '$' + maxBudget.toFixed(2) : 'Unlimited'}</div>
    </div>
  \`;
}

function renderKeys(keysData) {
  const keys = keysData?.keys || [];
  const list = document.getElementById('keys-list');

  if (keys.length === 0) {
    list.innerHTML = '<p class="text-gray-500 text-sm">No API keys yet. Create one to get started.</p>';
    return;
  }

  list.innerHTML = keys.map(k => \`
    <div class="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium">\${k.key_alias || 'Key'}</span>
          \${k.blocked ? '<span class="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">Blocked</span>' : ''}
        </div>
        <div class="flex items-center gap-3 mt-1">
          <code class="text-xs text-gray-500 key-mask">\${maskKey(k.key)}</code>
          <button onclick="copyKey('\${k.token || k.key}')" class="text-xs text-brand-400 hover:underline">Copy</button>
        </div>
        <div class="text-xs text-gray-500 mt-1">Spend: $\${(k.spend || 0).toFixed(4)} \${k.max_budget ? '/ $' + k.max_budget.toFixed(2) : ''}</div>
      </div>
      <button onclick="deleteKey('\${k.token || k.key}')" class="text-xs text-red-400 hover:text-red-300 ml-4">Delete</button>
    </div>
  \`).join('');
}

function maskKey(key) {
  if (!key) return '****';
  return key.substring(0, 7) + '...' + key.substring(key.length - 4);
}

function copyKey(key) {
  navigator.clipboard.writeText(key).then(() => showToast('API key copied!'));
}

function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'copy-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

async function createKey() {
  const alias = prompt('Key name (optional):', 'my-key-' + Date.now().toString(36));
  if (alias === null) return;

  try {
    const resp = await fetch(API + '/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ key_alias: alias }),
    });
    const data = await resp.json();
    if (resp.ok && data.key) {
      showToast('Key created! Copy it now — it won\\'t be shown again.');
      // Show the full key in a prompt for the user to copy
      prompt('Your new API key (copy it now):', data.key);
      loadDashboard();
    } else {
      alert('Failed to create key: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Network error');
  }
}

async function deleteKey(key) {
  if (!confirm('Delete this API key? This cannot be undone.')) return;
  try {
    await fetch(API + '/api/keys/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ keys: [key] }),
    });
    loadDashboard();
  } catch (e) {
    alert('Failed to delete key');
  }
}

// ===== MODELS =====
function renderModels() {
  const container = document.getElementById('model-cards');
  container.innerHTML = MODELS.map(m => \`
    <div class="card p-5">
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm font-semibold">\${m.name}</span>
        \${m.badge ? '<span class="text-xs px-2 py-0.5 rounded ' + m.badgeColor + '">' + m.badge + '</span>' : ''}
      </div>
      <div class="text-xs text-gray-500 mb-3">\${m.provider} &middot; \${m.id}</div>
      <div class="flex justify-between text-xs">
        <div><span class="text-gray-400">Input:</span> <span class="text-white">$\${m.inputPrice.toFixed(2)}</span><span class="text-gray-500">/M</span></div>
        <div><span class="text-gray-400">Output:</span> <span class="text-white">$\${m.outputPrice.toFixed(2)}</span><span class="text-gray-500">/M</span></div>
      </div>
    </div>
  \`).join('');
}

// ===== KEYBOARD =====
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideAuth();
});

// ===== TABS =====
function showTab(name) {
  ['openai', 'anthropic', 'curl'].forEach(t => {
    document.getElementById('code-' + t)?.classList.toggle('hidden', t !== name);
    const btn = document.getElementById('tab-' + t);
    if (btn) {
      if (t === name) {
        btn.className = 'px-4 py-2 rounded-lg text-sm font-medium bg-brand-500/20 text-brand-400 border border-brand-500/30';
      } else {
        btn.className = 'px-4 py-2 rounded-lg text-sm font-medium text-gray-400 border border-white/10 hover:bg-white/5';
      }
    }
  });
}
</script>
</body>
</html>`;

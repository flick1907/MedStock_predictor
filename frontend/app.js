/* ══════════════════════════════════════════
   MedStock AI — app.js
  Connects to the same-origin FastAPI backend
   ══════════════════════════════════════════ */

// The frontend should be served from the same origin as the API in production.
const API_BASE = window.location.origin;

// ── Elements ─────────────────────────────
const form          = document.getElementById('predict-form');
const submitBtn     = document.getElementById('submit-btn');
const btnText       = submitBtn.querySelector('.btn-text');
const btnLoader     = submitBtn.querySelector('.btn-loader');
const formError     = document.getElementById('form-error');

const emptyState    = document.getElementById('empty-state');
const resultCards   = document.getElementById('result-cards');

const resMedicineName = document.getElementById('res-medicine-name');
const resTimestamp    = document.getElementById('res-timestamp');
const resDemand       = document.getElementById('res-demand');
const resDaysReorder  = document.getElementById('res-days-reorder');
const resReorderQty   = document.getElementById('res-reorder-qty');
const resExpiryBadge  = document.getElementById('res-expiry-badge');
const expiryBarFill   = document.getElementById('expiry-bar-fill');
const liveChips       = document.getElementById('live-chips');
const rawJson         = document.getElementById('raw-json');
const copyBtn         = document.getElementById('copy-btn');

const statusBadge = document.getElementById('api-status-badge');
const statusLabel = statusBadge.querySelector('.status-label');

const liveToggleBtn   = document.getElementById('live-toggle-btn');
const liveCollapsible = document.getElementById('live-collapsible');

// ── Canvas background particles ──────────
(function initCanvas() {
  const canvas = document.getElementById('bg-canvas');
  const ctx    = canvas.getContext('2d');
  let W, H, particles;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function makeParticle() {
    return {
      x:  Math.random() * W,
      y:  Math.random() * H,
      r:  Math.random() * 1.5 + 0.3,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      a:  Math.random() * 0.5 + 0.1,
    };
  }

  function init() {
    resize();
    particles = Array.from({ length: 120 }, makeParticle);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = W;
      if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H;
      if (p.y > H) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(99,179,237,${p.a})`;
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  init();
  draw();
})();

// ── API health check ─────────────────────
async function checkApiHealth() {
  setStatus('checking', 'Checking API…');
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      setStatus('online', 'API Online');
    } else {
      setStatus('offline', 'API Error');
    }
  } catch {
    setStatus('offline', 'API Offline');
  }
}

function setStatus(state, label) {
  statusBadge.className = `status-badge ${state}`;
  statusLabel.textContent = label;
}

// Check health on load and every 30s
checkApiHealth();
setInterval(checkApiHealth, 30_000);

// ── Collapsible live data section ────────
liveToggleBtn.addEventListener('click', () => {
  const isOpen = liveToggleBtn.getAttribute('aria-expanded') === 'true';
  liveToggleBtn.setAttribute('aria-expanded', String(!isOpen));
  liveCollapsible.classList.toggle('open', !isOpen);
});

// ── Form submission ──────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const valid = validateForm();
  if (!valid) return;

  setLoading(true);

  const payload = buildPayload();

  try {
    const res = await fetch(`${API_BASE}/predict`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      const msg = data?.detail || `Server error ${res.status}`;
      showError(`API Error: ${msg}`);
      return;
    }

    renderResults(data);

  } catch (err) {
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      showError('Cannot reach the API. Make sure the FastAPI server is running.');
    } else {
      showError(`Unexpected error: ${err.message}`);
    }
    setStatus('offline', 'API Offline');
  } finally {
    setLoading(false);
  }
});

// ── Validation ───────────────────────────
const REQUIRED_FIELDS = [
  'medicine_name', 'atc_code',
  'past_7_day_sales', 'past_30_day_avg_sales',
  'current_stock', 'days_to_expiry', 'price_per_unit'
];

function validateForm() {
  let ok = true;
  REQUIRED_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    const val = el.value.trim();
    if (!val) {
      el.classList.add('invalid');
      ok = false;
    } else {
      el.classList.remove('invalid');
    }
  });
  if (!ok) showError('Please fill in all required fields (highlighted in red).');
  return ok;
}

// Remove invalid on input
REQUIRED_FIELDS.forEach(id => {
  document.getElementById(id)?.addEventListener('input', (e) => {
    e.target.classList.remove('invalid');
  });
});

// ── Build payload ────────────────────────
function buildPayload() {
  const g = (id) => document.getElementById(id).value.trim();
  const num = (id) => {
    const v = g(id);
    return v === '' ? null : Number(v);
  };

  return {
    medicine_name:        g('medicine_name'),
    atc_code:             g('atc_code'),
    past_7_day_sales:     num('past_7_day_sales'),
    past_30_day_avg_sales:num('past_30_day_avg_sales'),
    current_stock:        num('current_stock'),
    days_to_expiry:       num('days_to_expiry'),
    price_per_unit:       num('price_per_unit'),
    // optional
    live_temp:     num('live_temp'),
    live_humidity: num('live_humidity'),
    is_rainy:      num('is_rainy'),
    fever_trend:   num('fever_trend'),
    allergy_trend: num('allergy_trend'),
  };
}

// ── Render results ───────────────────────
function renderResults(data) {
  // Medicine name & time
  resMedicineName.textContent = data.medicine_name;
  resTimestamp.textContent = `Predicted at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  // Key metrics
  resDemand.textContent      = data.next_7_day_demand.toLocaleString();
  resDaysReorder.textContent = data.days_to_reorder.toLocaleString();
  resReorderQty.textContent  = data.reorder_quantity.toLocaleString();

  // Expiry risk
  const risk = (data.expiry_risk || 'Low').toLowerCase();
  resExpiryBadge.textContent  = data.expiry_risk;
  resExpiryBadge.className    = `expiry-badge ${risk}`;

  const barPct  = risk === 'low' ? '20%' : risk === 'medium' ? '55%' : '92%';
  const barColor = risk === 'low'
    ? 'linear-gradient(90deg,#10b981,#34d399)'
    : risk === 'medium'
    ? 'linear-gradient(90deg,#f59e0b,#fbbf24)'
    : 'linear-gradient(90deg,#ef4444,#f87171)';

  expiryBarFill.style.width      = barPct;
  expiryBarFill.style.background = barColor;

  // Live data chips
  const liveData  = data.live_data_used || {};
  const chipLabels = {
    live_temp:    '🌡️ Temp',
    live_humidity:'💧 Humidity',
    is_rainy:     '🌧️ Rainy',
    fever_trend:  '🤒 Fever',
    allergy_trend:'🌸 Allergy',
    month:        '📅 Month',
  };

  liveChips.innerHTML = Object.entries(liveData).map(([k, v]) => {
    const label = chipLabels[k] || k;
    const display = k === 'live_temp'     ? `${v}°C`
                  : k === 'live_humidity' ? `${v}%`
                  : k === 'is_rainy'      ? (v ? 'Yes' : 'No')
                  : v;
    return `<span class="live-chip">
      <span class="live-chip-key">${label}:</span>
      <span class="live-chip-val">${display}</span>
    </span>`;
  }).join('');

  // Raw JSON
  rawJson.textContent = JSON.stringify(data, null, 2);

  // Show results, hide empty state
  emptyState.hidden    = true;
  resultCards.hidden   = false;

  // Reset animation
  resultCards.style.animation = 'none';
  void resultCards.offsetWidth; // reflow
  resultCards.style.animation = '';

  // Scroll to results on mobile
  if (window.innerWidth < 1024) {
    resultCards.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ── Copy JSON ────────────────────────────
copyBtn.addEventListener('click', () => {
  const text = rawJson.textContent;
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.textContent = '✓ Copied!';
    copyBtn.style.color = 'var(--risk-low)';
    setTimeout(() => {
      copyBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="none" style="width:14px;height:14px"><rect x="7" y="7" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Copy JSON`;
      copyBtn.style.color = '';
    }, 1800);
  });
});

// ── Helpers ──────────────────────────────
function setLoading(on) {
  submitBtn.disabled = on;
  btnText.hidden     = on;
  btnLoader.hidden   = !on;
}

function showError(msg) {
  formError.textContent = msg;
  formError.hidden = false;
}

function clearError() {
  formError.hidden = true;
  formError.textContent = '';
}




/* ══════════════════════════════════════════════════════════
   MedStock AI — app.js
   Role-Based UI & Navigation (Owner Sales Analytics vs Staff Out-of-Stock Alerts)
   ══════════════════════════════════════════════════════════ */

const API_BASE = window.location.origin;

// ── State Management ────────────────────────────────────────
let authToken = localStorage.getItem('medstock_token') || null;
let currentUser = null;
try {
  const savedUser = localStorage.getItem('medstock_user');
  if (savedUser) currentUser = JSON.parse(savedUser);
} catch (e) {
  currentUser = null;
}

let salesTrendChartInstance = null;
let demandVsStockChartInstance = null;
let expiryRiskChartInstance = null;

let cachedInventoryData = [];

// ── DOM Elements ────────────────────────────────────────────
const navTabs = document.querySelectorAll('.nav-tab');
const tabContents = document.querySelectorAll('.tab-content');

const navLoginBtn = document.getElementById('nav-login-btn');
const navLogoutBtn = document.getElementById('nav-logout-btn');
const userProfileBadge = document.getElementById('user-profile-badge');
const userAvatarInitials = document.getElementById('user-avatar-initials');
const userDisplayName = document.getElementById('user-display-name');
const userDisplayRole = document.getElementById('user-display-role');

const loginModal = document.getElementById('login-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const loginForm = document.getElementById('login-form');
const loginUsernameInput = document.getElementById('login_username');
const loginPasswordInput = document.getElementById('login_password');
const loginError = document.getElementById('login-error');
const demoFillOwnerBtn = document.getElementById('demo-fill-owner');
const demoFillStaffBtn = document.getElementById('demo-fill-staff');

// Form & Results elements
const form = document.getElementById('predict-form');
const submitBtn = document.getElementById('submit-btn');
const btnText = submitBtn.querySelector('.btn-text');
const btnLoader = submitBtn.querySelector('.btn-loader');
const formError = document.getElementById('form-error');

const emptyState = document.getElementById('empty-state');
const resultCards = document.getElementById('result-cards');
const resMedicineName = document.getElementById('res-medicine-name');
const resTimestamp = document.getElementById('res-timestamp');
const resDemand = document.getElementById('res-demand');
const resDaysReorder = document.getElementById('res-days-reorder');
const resReorderQty = document.getElementById('res-reorder-qty');
const resExpiryBadge = document.getElementById('res-expiry-badge');
const expiryBarFill = document.getElementById('expiry-bar-fill');
const liveChips = document.getElementById('live-chips');
const rawJson = document.getElementById('raw-json');
const copyBtn = document.getElementById('copy-btn');

const statusBadge = document.getElementById('api-status-badge');
const statusLabel = statusBadge.querySelector('.status-label');

const liveToggleBtn = document.getElementById('live-toggle-btn');
const liveCollapsible = document.getElementById('live-collapsible');

// Analytics elements
const refreshAnalyticsBtn = document.getElementById('refresh-analytics-btn');
const kpiPastWeekSales = document.getElementById('kpi-past-week-sales');
const kpiPastMonthSales = document.getElementById('kpi-past-month-sales');
const kpiForecastDemand = document.getElementById('kpi-forecast-demand');
const kpiPendingRequests = document.getElementById('kpi-pending-requests');
const ownerRequestsTbody = document.getElementById('owner-requests-tbody');
const requestsBadgeCount = document.getElementById('requests-badge-count');
const ownerInventoryTbody = document.getElementById('owner-inventory-tbody');

// Staff elements
const staffInventoryTbody = document.getElementById('staff-inventory-tbody');
const staffAlertsGrid = document.getElementById('staff-alerts-grid');
const staffInventorySearchInput = document.getElementById('staff-inventory-search');
const ownerInventorySearchInput = document.getElementById('owner-inventory-search');

const stockRequestForm = document.getElementById('stock-request-form');
const reqMedicineInput = document.getElementById('req_medicine_name');
const reqQuantityInput = document.getElementById('req_quantity');
const reqUrgencyInput = document.getElementById('req_urgency');
const reqNotesInput = document.getElementById('req_notes');
const requestFormMsg = document.getElementById('request-form-msg');
const sentRequestsList = document.getElementById('sent-requests-list');

// ── Particle Canvas Background ──────────────────────────────
(function initCanvas() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, particles;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function makeParticle() {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.5 + 0.3,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      a: Math.random() * 0.5 + 0.1,
    };
  }

  function init() {
    resize();
    particles = Array.from({ length: 100 }, makeParticle);
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

// ── API Health Check ────────────────────────────────────────
async function checkApiHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) setStatus('online', 'API Online');
    else setStatus('offline', 'API Error');
  } catch {
    setStatus('offline', 'API Offline');
  }
}

function setStatus(state, label) {
  statusBadge.className = `status-badge ${state}`;
  statusLabel.textContent = label;
}
checkApiHealth();
setInterval(checkApiHealth, 30_000);

// ── Tab Switching & Navigation ──────────────────────────────
navTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const targetId = tab.getAttribute('data-tab');

    navTabs.forEach(t => t.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));

    tab.classList.add('active');
    const targetContent = document.getElementById(targetId);
    if (targetContent) targetContent.classList.add('active');

    // Trigger tab specific data loading
    if (targetId === 'owner-analytics-tab') {
      loadOwnerAnalytics();
    } else if (targetId === 'owner-inventory-tab') {
      loadInventoryData();
    } else if (targetId === 'owner-requests-tab') {
      renderOwnerRequestsTable();
    } else if (targetId === 'staff-stock-tab') {
      loadInventoryData();
    } else if (targetId === 'staff-request-tab') {
      loadStaffRequests();
    }
  });
});

// ── Authentication & Role UI Management ──────────────────────
const togglePwdBtn = document.getElementById('toggle-pwd-btn');
togglePwdBtn?.addEventListener('click', () => {
  const isPwd = loginPasswordInput.type === 'password';
  loginPasswordInput.type = isPwd ? 'text' : 'password';
  togglePwdBtn.classList.toggle('showing', isPwd);
});

navLoginBtn.addEventListener('click', () => {
  loginModal.hidden = false;
  loginModal.style.display = 'flex';
  loginError.hidden = true;
});

closeModalBtn.addEventListener('click', () => {
  loginModal.hidden = true;
  loginModal.style.display = 'none';
});

demoFillOwnerBtn.addEventListener('click', () => {
  loginUsernameInput.focus();
});

demoFillStaffBtn.addEventListener('click', () => {
  loginUsernameInput.focus();
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.hidden = true;

  const username = loginUsernameInput.value.trim();
  const password = loginPasswordInput.value.trim();

  const loginSubmitBtn = document.getElementById('login-submit-btn');
  const originalBtnContent = loginSubmitBtn.innerHTML;
  loginSubmitBtn.disabled = true;
  loginSubmitBtn.innerHTML = '<span>Logging in…</span>';

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (!res.ok) {
      loginError.textContent = data.detail || 'Login failed';
      loginError.hidden = false;
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.innerHTML = originalBtnContent;
      return;
    }

    authToken = data.access_token;
    currentUser = data.user;
    localStorage.setItem('medstock_token', authToken);
    localStorage.setItem('medstock_user', JSON.stringify(currentUser));

    updateUserUI();

    loginModal.hidden = true;
    loginModal.style.display = 'none';
    loginSubmitBtn.disabled = false;
    loginSubmitBtn.innerHTML = originalBtnContent;

    // Automatically switch to user's primary view
    if (currentUser.role === 'owner') {
      const ownerTab = document.querySelector('[data-tab="owner-analytics-tab"]');
      if (ownerTab) ownerTab.click();
    } else {
      const staffTab = document.querySelector('[data-tab="staff-stock-tab"]');
      if (staffTab) staffTab.click();
    }
  } catch (err) {
    loginError.textContent = 'Server communication error';
    loginError.hidden = false;
    loginSubmitBtn.disabled = false;
    loginSubmitBtn.innerHTML = originalBtnContent;
  }
});

navLogoutBtn.addEventListener('click', () => {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('medstock_token');
  localStorage.removeItem('medstock_user');
  updateUserUI();
  document.querySelector('[data-tab="predict-tab"]').click();
});

async function checkSavedAuth() {
  updateUserUI(); // Update UI synchronously with cached user from localStorage
  if (!authToken) return;

  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.ok) {
      currentUser = await res.json();
      localStorage.setItem('medstock_user', JSON.stringify(currentUser));
    } else {
      authToken = null;
      currentUser = null;
      localStorage.removeItem('medstock_token');
      localStorage.removeItem('medstock_user');
    }
  } catch {
    // Retain offline state if server check fails
  }
  updateUserUI();
}
checkSavedAuth();

function updateUserUI() {
  navTabs.forEach(t => {
    const role = t.getAttribute('data-role');
    if (role === 'all') {
      t.hidden = false;
    } else if (currentUser && role === currentUser.role) {
      t.hidden = false;
    } else {
      t.hidden = true;
    }
  });

  if (currentUser) {
    navLoginBtn.hidden = true;
    userProfileBadge.hidden = false;

    userDisplayName.textContent = currentUser.full_name || currentUser.username;
    userDisplayRole.textContent = currentUser.role.toUpperCase();
    userAvatarInitials.textContent = currentUser.username.charAt(0).toUpperCase();

    if (currentUser.role === 'owner') {
      userDisplayRole.className = 'user-role-tag owner';
    } else {
      userDisplayRole.className = 'user-role-tag staff';
    }
  } else {
    navLoginBtn.hidden = false;
    userProfileBadge.hidden = true;
  }
}

// ── Collapsible Live Data Toggle ────────────────────────────
liveToggleBtn.addEventListener('click', () => {
  const isOpen = liveToggleBtn.getAttribute('aria-expanded') === 'true';
  liveToggleBtn.setAttribute('aria-expanded', String(!isOpen));
  liveCollapsible.classList.toggle('open', !isOpen);
});

// ── Predict Form Handler ────────────────────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  if (!currentUser) {
    showError('Please Sign In (as Owner or Staff) to run AI demand predictions.');
    loginModal.hidden = false;
    loginModal.style.display = 'flex';
    return;
  }

  if (!validateForm()) return;
  setLoading(true);

  const payload = buildPayload();

  try {
    const res = await fetch(`${API_BASE}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(`API Error: ${data?.detail || res.status}`);
      return;
    }

    renderResults(data);
  } catch (err) {
    showError(`Error connecting to server: ${err.message}`);
  } finally {
    setLoading(false);
  }
});

const REQUIRED_FIELDS = [
  'medicine_name', 'atc_code',
  'past_7_day_sales', 'past_30_day_avg_sales',
  'current_stock', 'days_to_expiry', 'price_per_unit'
];

function validateForm() {
  let ok = true;
  REQUIRED_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el.value.trim()) {
      el.classList.add('invalid');
      ok = false;
    } else {
      el.classList.remove('invalid');
    }
  });
  if (!ok) showError('Please fill in all required fields.');
  return ok;
}

REQUIRED_FIELDS.forEach(id => {
  document.getElementById(id)?.addEventListener('input', (e) => {
    e.target.classList.remove('invalid');
  });
});

function buildPayload() {
  const g = (id) => document.getElementById(id).value.trim();
  const num = (id) => (g(id) === '' ? null : Number(g(id)));

  return {
    medicine_name: g('medicine_name'),
    atc_code: g('atc_code'),
    past_7_day_sales: num('past_7_day_sales'),
    past_30_day_avg_sales: num('past_30_day_avg_sales'),
    current_stock: num('current_stock'),
    days_to_expiry: num('days_to_expiry'),
    price_per_unit: num('price_per_unit'),
    live_temp: num('live_temp'),
    live_humidity: num('live_humidity'),
    is_rainy: num('is_rainy'),
    fever_trend: num('fever_trend'),
    allergy_trend: num('allergy_trend'),
  };
}

function renderResults(data) {
  resMedicineName.textContent = data.medicine_name;
  resTimestamp.textContent = `Predicted at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  resDemand.textContent = data.next_7_day_demand.toLocaleString();
  resDaysReorder.textContent = data.days_to_reorder.toLocaleString();
  resReorderQty.textContent = data.reorder_quantity.toLocaleString();

  const risk = (data.expiry_risk || 'Low').toLowerCase();
  resExpiryBadge.textContent = data.expiry_risk;
  resExpiryBadge.className = `expiry-badge ${risk}`;

  const barPct = risk === 'low' ? '20%' : risk === 'medium' ? '55%' : '92%';
  const barColor = risk === 'low'
    ? 'linear-gradient(90deg,#10b981,#34d399)'
    : risk === 'medium'
    ? 'linear-gradient(90deg,#f59e0b,#fbbf24)'
    : 'linear-gradient(90deg,#ef4444,#f87171)';

  expiryBarFill.style.width = barPct;
  expiryBarFill.style.background = barColor;

  const liveData = data.live_data_used || {};
  const chipLabels = {
    live_temp: '🌡️ Temp',
    live_humidity: '💧 Humidity',
    is_rainy: '🌧️ Rainy',
    fever_trend: '🤒 Fever',
    allergy_trend: '🌸 Allergy',
    month: '📅 Month',
  };

  liveChips.innerHTML = Object.entries(liveData).map(([k, v]) => {
    const label = chipLabels[k] || k;
    const display = k === 'live_temp' ? `${v}°C` : k === 'live_humidity' ? `${v}%` : k === 'is_rainy' ? (v ? 'Yes' : 'No') : v;
    return `<span class="live-chip"><span class="live-chip-key">${label}:</span><span class="live-chip-val">${display}</span></span>`;
  }).join('');

  rawJson.textContent = JSON.stringify(data, null, 2);

  emptyState.hidden = true;
  resultCards.hidden = false;
}

copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(rawJson.textContent).then(() => {
    copyBtn.textContent = '✓ Copied!';
    setTimeout(() => {
      copyBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="none" style="width:14px;height:14px"><rect x="7" y="7" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Copy JSON`;
    }, 1800);
  });
});

function setLoading(on) {
  submitBtn.disabled = on;
  btnText.hidden = on;
  btnLoader.hidden = !on;
}

function showError(msg) {
  formError.textContent = msg;
  formError.hidden = false;
}

function clearError() {
  formError.hidden = true;
  formError.textContent = '';
}


// ── OWNER ANALYTICS DASHBOARD ───────────────────────────────
refreshAnalyticsBtn?.addEventListener('click', () => loadOwnerAnalytics());

async function loadOwnerAnalytics() {
  try {
    const res = await fetch(`${API_BASE}/analytics/owner`);
    if (!res.ok) return;

    const data = await res.json();
    const summary = data.summary || {};

    kpiPastWeekSales.textContent = `${(summary.past_7_day_sales || 0).toLocaleString()} units`;
    kpiPastMonthSales.textContent = `${(summary.past_30_day_sales || 0).toLocaleString()} units`;
    kpiForecastDemand.textContent = `${(summary.total_forecast_demand || 0).toLocaleString()} units`;
    kpiPendingRequests.textContent = summary.pending_stock_requests || 0;

    renderOwnerCharts(data);
  } catch (err) {
    console.error("Failed to load owner analytics:", err);
  }
}

function renderOwnerCharts(data) {
  if (typeof Chart === 'undefined') return;

  const topMeds = data.top_demanded_medicines || [];
  const riskCounts = data.expiry_risk_counts || { Low: 0, Medium: 0, High: 0 };
  const timeline = data.timeline || [];

  // Line Chart
  const lineCtx = document.getElementById('salesTrendChart')?.getContext('2d');
  if (lineCtx) {
    if (salesTrendChartInstance) salesTrendChartInstance.destroy();

    const labels = timeline.length > 0 ? timeline.map(t => t.label) : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const salesData = timeline.length > 0 ? timeline.map(t => t.past_7_sales) : [120, 140, 135, 160, 180, 210, 195];
    const forecastData = timeline.length > 0 ? timeline.map(t => t.forecast_demand) : [130, 145, 150, 175, 190, 220, 205];

    salesTrendChartInstance = new Chart(lineCtx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Past 7-Day Sales',
            data: salesData,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            fill: true,
            tension: 0.35,
          },
          {
            label: 'AI Forecast Demand',
            data: forecastData,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            fill: true,
            tension: 0.35,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
          x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        }
      }
    });
  }

  // Bar Chart
  const barCtx = document.getElementById('demandVsStockChart')?.getContext('2d');
  if (barCtx) {
    if (demandVsStockChartInstance) demandVsStockChartInstance.destroy();

    const barLabels = topMeds.length > 0 ? topMeds.map(m => m.medicine_name) : ['Diclofenac', 'Paracetamol', 'Amoxicillin', 'Aspirin', 'Ibuprofen'];
    const stockData = topMeds.length > 0 ? topMeds.map(m => m.current_stock) : [146, 90, 45, 200, 110];
    const demandData = topMeds.length > 0 ? topMeds.map(m => m.predicted_7_day_demand) : [160, 120, 85, 180, 130];

    demandVsStockChartInstance = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: barLabels,
        datasets: [
          {
            label: 'Current Stock',
            data: stockData,
            backgroundColor: '#6366f1',
            borderRadius: 6,
          },
          {
            label: 'Predicted 7-Day Demand',
            data: demandData,
            backgroundColor: '#06b6d4',
            borderRadius: 6,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
          x: { ticks: { color: '#64748b' }, grid: { display: false } },
          y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        }
      }
    });
  }

  // Doughnut Chart
  const doughnutCtx = document.getElementById('expiryRiskChart')?.getContext('2d');
  if (doughnutCtx) {
    if (expiryRiskChartInstance) expiryRiskChartInstance.destroy();

    expiryRiskChartInstance = new Chart(doughnutCtx, {
      type: 'doughnut',
      data: {
        labels: ['Low Risk', 'Medium Risk', 'High Risk'],
        datasets: [{
          data: [riskCounts.Low || 1, riskCounts.Medium || 0, riskCounts.High || 0],
          backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
          borderWidth: 0,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8' } } }
      }
    });
  }
}

function renderStatusTimelineHTML(status) {
  if (status === 'PENDING') {
    return `
      <div class="status-timeline">
        <div class="timeline-step completed">
          <span class="timeline-step-icon">✓</span> <span>Requested</span>
        </div>
        <div class="timeline-connector"></div>
        <div class="timeline-step active-pending">
          <span class="timeline-step-icon">⏳</span> <span>Pending Review</span>
        </div>
        <div class="timeline-connector"></div>
        <div class="timeline-step">
          <span class="timeline-step-icon">📦</span> <span>Fulfilled</span>
        </div>
      </div>`;
  } else if (status === 'APPROVED') {
    return `
      <div class="status-timeline">
        <div class="timeline-step completed">
          <span class="timeline-step-icon">✓</span> <span>Requested</span>
        </div>
        <div class="timeline-connector completed"></div>
        <div class="timeline-step active-approved">
          <span class="timeline-step-icon">✓</span> <span>Approved</span>
        </div>
        <div class="timeline-connector"></div>
        <div class="timeline-step active-pending">
          <span class="timeline-step-icon">🚚</span> <span>Awaiting Delivery</span>
        </div>
      </div>`;
  } else if (status === 'FULFILLED') {
    return `
      <div class="status-timeline">
        <div class="timeline-step completed">
          <span class="timeline-step-icon">✓</span> <span>Requested</span>
        </div>
        <div class="timeline-connector completed"></div>
        <div class="timeline-step completed">
          <span class="timeline-step-icon">✓</span> <span>Approved</span>
        </div>
        <div class="timeline-connector completed"></div>
        <div class="timeline-step completed">
          <span class="timeline-step-icon">🎉</span> <span>Fulfilled</span>
        </div>
      </div>`;
  } else if (status === 'REJECTED') {
    return `
      <div class="status-timeline">
        <div class="timeline-step completed">
          <span class="timeline-step-icon">✓</span> <span>Requested</span>
        </div>
        <div class="timeline-connector"></div>
        <div class="timeline-step rejected">
          <span class="timeline-step-icon">❌</span> <span>Rejected</span>
        </div>
      </div>`;
  }
  return '';
}

async function renderOwnerRequestsTable() {
  try {
    const res = await fetch(`${API_BASE}/stock-requests`);
    if (!res.ok) return;

    const requests = await res.json();
    requestsBadgeCount.textContent = `${requests.length} Requests`;

    const pendingCount = requests.filter(r => r.status === 'PENDING').length;
    const navDot = document.getElementById('nav-requests-dot');
    if (navDot) navDot.hidden = pendingCount === 0;

    if (requests.length === 0) {
      ownerRequestsTbody.innerHTML = `<tr><td colspan="8" class="text-center p-4 text-muted">No stock requests submitted yet.</td></tr>`;
      return;
    }

    ownerRequestsTbody.innerHTML = requests.map(r => {
      const statusClass = r.status.toLowerCase();
      let actionButtons = '';

      if (r.status === 'PENDING') {
        actionButtons = `
          <button onclick="handleUpdateRequest(${r.id}, 'APPROVED')" class="btn-xs btn-approve">Approve</button>
          <button onclick="handleUpdateRequest(${r.id}, 'REJECTED')" class="btn-xs btn-reject">Reject</button>
        `;
      } else if (r.status === 'APPROVED') {
        actionButtons = `<button onclick="handleUpdateRequest(${r.id}, 'FULFILLED')" class="btn-xs btn-fulfill">Mark Fulfilled</button>`;
      } else {
        actionButtons = `<span class="text-muted fs-xs">Completed</span>`;
      }

      const timelineHTML = renderStatusTimelineHTML(r.status);

      return `<tr>
        <td>#${r.id}</td>
        <td><strong>${r.medicine_name}</strong></td>
        <td>${r.requested_quantity} units</td>
        <td><span class="urgency-badge ${r.urgency.toLowerCase()}">${r.urgency}</span></td>
        <td>${r.notes || '—'}</td>
        <td>${r.requested_by_name}</td>
        <td>
          <span class="status-pill ${statusClass}">${r.status}</span>
          ${timelineHTML}
        </td>
        <td>${actionButtons}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error("Error loading stock requests:", err);
  }
}

window.handleUpdateRequest = async function(id, newStatus) {
  try {
    const res = await fetch(`${API_BASE}/stock-requests/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ status: newStatus })
    });
    if (res.ok) {
      renderOwnerRequestsTable();
    }
  } catch (err) {
    alert("Failed to update status.");
  }
};


// ── INVENTORY DATA LOADING ──────────────────────────────────
async function loadInventoryData() {
  try {
    const res = await fetch(`${API_BASE}/inventory`);
    if (!res.ok) return;

    cachedInventoryData = await res.json();
    renderStaffInventory(cachedInventoryData);
    renderOwnerInventory(cachedInventoryData);
    renderStaffAlerts(cachedInventoryData);
  } catch (err) {
    console.error("Failed to load inventory:", err);
  }
}

// Search Inputs
staffInventorySearchInput?.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase().trim();
  const filtered = cachedInventoryData.filter(item =>
    item.medicine_name.toLowerCase().includes(query) ||
    item.atc_code.toLowerCase().includes(query)
  );
  renderStaffInventory(filtered);
});

ownerInventorySearchInput?.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase().trim();
  const filtered = cachedInventoryData.filter(item =>
    item.medicine_name.toLowerCase().includes(query) ||
    item.atc_code.toLowerCase().includes(query)
  );
  renderOwnerInventory(filtered);
});

function renderStaffInventory(items) {
  if (!items || items.length === 0) {
    staffInventoryTbody.innerHTML = `<tr><td colspan="7" class="text-center p-4 text-muted">No medicines found in stock inventory. Run a prediction to add stock items!</td></tr>`;
    return;
  }

  staffInventoryTbody.innerHTML = items.map(item => {
    const isLow = item.current_stock < item.next_7_day_demand || item.days_to_reorder <= 14;
    const stockStatus = isLow ? '<span class="status-pill high">LOW STOCK</span>' : '<span class="status-pill low">STABLE</span>';
    const riskBadge = `<span class="expiry-badge ${(item.expiry_risk || 'Low').toLowerCase()}">${item.expiry_risk || 'Low'}</span>`;

    return `<tr>
      <td><strong>${item.medicine_name}</strong></td>
      <td><code>${item.atc_code}</code></td>
      <td>${item.current_stock} units</td>
      <td>${item.days_to_expiry} days</td>
      <td>${riskBadge}</td>
      <td>${stockStatus}</td>
      <td>
        <button onclick="prefillStockRequest('${item.medicine_name}', ${item.reorder_quantity || 50})" class="btn-xs btn-request">
          Request Re-order
        </button>
      </td>
    </tr>`;
  }).join('');
}

function renderOwnerInventory(items) {
  if (!items || items.length === 0) {
    ownerInventoryTbody.innerHTML = `<tr><td colspan="8" class="text-center p-4 text-muted">No items in database inventory yet.</td></tr>`;
    return;
  }

  ownerInventoryTbody.innerHTML = items.map(item => {
    const riskBadge = `<span class="expiry-badge ${(item.expiry_risk || 'Low').toLowerCase()}">${item.expiry_risk || 'Low'}</span>`;
    return `<tr>
      <td><strong>${item.medicine_name}</strong></td>
      <td><code>${item.atc_code}</code></td>
      <td>${item.current_stock} units</td>
      <td>${item.past_30_day_avg_sales} /day</td>
      <td>₹${item.price_per_unit}</td>
      <td>${item.days_to_expiry} days</td>
      <td>${riskBadge}</td>
      <td>${item.days_to_reorder} days</td>
    </tr>`;
  }).join('');
}

function renderStaffAlerts(items) {
  if (!staffAlertsGrid) return;
  const lowStock = items.filter(i => i.current_stock < i.next_7_day_demand || i.days_to_reorder <= 14);

  if (lowStock.length === 0) {
    staffAlertsGrid.innerHTML = `<p class="text-muted p-3">All medicine stock levels are currently stable ✓</p>`;
    return;
  }

  staffAlertsGrid.innerHTML = lowStock.map(i => `
    <div class="alert-item-card">
      <div class="alert-item-header">
        <strong>${i.medicine_name}</strong>
        <span class="status-pill high">LOW STOCK</span>
      </div>
      <div class="alert-item-body">
        <span>Current Stock: <strong>${i.current_stock} units</strong></span>
        <span>Predicted Demand: <strong>${i.next_7_day_demand} units</strong></span>
        <span>Stock runs out in: <strong>${i.days_to_reorder} days</strong></span>
      </div>
      <button onclick="prefillStockRequest('${i.medicine_name}', ${i.reorder_quantity || 100})" class="btn-xs btn-request width-100 margin-top-xs">
        Request Re-order from Admin
      </button>
    </div>
  `).join('');
}

window.prefillStockRequest = function(name, qty) {
  reqMedicineInput.value = name;
  reqQuantityInput.value = qty > 0 ? qty : 50;
  // Switch to request tab
  const reqTab = document.querySelector('[data-tab="staff-request-tab"]');
  if (reqTab) reqTab.click();
  reqMedicineInput.focus();
};

// Stock Request Form Handler
stockRequestForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  requestFormMsg.hidden = true;

  const payload = {
    medicine_name: reqMedicineInput.value.trim(),
    requested_quantity: Number(reqQuantityInput.value),
    urgency: reqUrgencyInput.value,
    notes: reqNotesInput.value.trim() || null
  };

  try {
    const res = await fetch(`${API_BASE}/stock-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      requestFormMsg.textContent = '✓ Re-order request sent to Admin/Owner!';
      requestFormMsg.className = 'form-msg success';
      requestFormMsg.hidden = false;
      stockRequestForm.reset();
      loadStaffRequests();
    } else {
      const data = await res.json();
      requestFormMsg.textContent = data.detail || 'Failed to submit request';
      requestFormMsg.className = 'form-msg error';
      requestFormMsg.hidden = false;
    }
  } catch (err) {
    requestFormMsg.textContent = 'Server connection error';
    requestFormMsg.className = 'form-msg error';
    requestFormMsg.hidden = false;
  }
});

async function loadStaffRequests() {
  try {
    const res = await fetch(`${API_BASE}/stock-requests`);
    if (!res.ok) return;

    const requests = await res.json();

    if (requests.length === 0) {
      sentRequestsList.innerHTML = `<p class="text-muted fs-sm">No re-order requests sent yet.</p>`;
      return;
    }

    sentRequestsList.innerHTML = requests.map(r => {
      const timelineHTML = renderStatusTimelineHTML(r.status);
      return `
        <div class="sent-request-item">
          <div class="sent-req-title">
            <strong>${r.medicine_name}</strong>
            <span class="status-pill ${r.status.toLowerCase()}">${r.status}</span>
          </div>
          <div class="sent-req-meta">
            <span>Qty: ${r.requested_quantity}</span> · 
            <span>Urgency: ${r.urgency}</span> · 
            <span>By: ${r.requested_by_name}</span>
          </div>
          ${timelineHTML}
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error("Failed to load staff requests:", err);
  }
}

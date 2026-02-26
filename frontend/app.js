/* ═══════════════════════════════════════════════════════
   IftarFlow — DevSprint 2026
   app.js — Shared Application Logic
═══════════════════════════════════════════════════════ */

'use strict';

/* ── CONFIG ── */
const API_BASE    = 'http://localhost:3000';
const CART_KEY    = 'iftarflow_cart';
const TOKEN_KEY   = 'iftarflow_token';
const USER_KEY    = 'iftarflow_user';
const ORDERS_KEY  = 'iftarflow_orders';
const ATTEMPTS_KEY= 'iftarflow_attempts';

/* ── MENU DATA ── */
const MENU_ITEMS = [
  {
    id: 'piyaju',    emoji: '🥙', name: 'Piyaju / Beguni / Alur Chop',
    desc: 'Crispy lentil fritters, battered eggplant & spiced potato croquettes. Classic Iftar street food.',
    price: 10, unit: 'per piece', stock: 200, max: 200, cat: 'snack'
  },
  {
    id: 'jali-kabab', emoji: '🥩', name: 'Jali Kabab',
    desc: 'Minced beef kabab with aromatic spices, pan-fried to golden perfection.',
    price: 70, unit: 'per piece', stock: 60, max: 80, cat: 'main'
  },
  {
    id: 'beef-suti',  emoji: '🍖', name: 'Beef Suti Kabab',
    desc: 'Tender marinated beef skewers with rich Bangladeshi spice blend.',
    price: 1400, unit: 'per kg', stock: 8, max: 15, cat: 'main'
  },
  {
    id: 'shahi-jilapi', emoji: '🍩', name: 'Shahi Jilapi',
    desc: 'Crispy spiral-shaped sweet soaked in sugar syrup. An Iftar essential.',
    price: 300, unit: 'per kg', stock: 25, max: 30, cat: 'sweet'
  },
  {
    id: 'haleem-sm',  emoji: '🥘', name: 'Mutton Haleem — Small',
    desc: 'Slow-cooked mutton and lentil stew with whole wheat. Rich and hearty.',
    price: 600, unit: 'small', stock: 15, max: 30, cat: 'main'
  },
  {
    id: 'haleem-lg',  emoji: '🍲', name: 'Mutton Haleem — Large',
    desc: 'Generous portion of our signature slow-cooked mutton haleem for sharing.',
    price: 1200, unit: 'large', stock: 3, max: 15, cat: 'main'
  },
  {
    id: 'doi-bora',   emoji: '🥣', name: 'Doi Bora',
    desc: 'Soft lentil dumplings in spiced yogurt, topped with tamarind chutney.',
    price: 250, unit: 'box of 4', stock: 20, max: 40, cat: 'snack'
  },
  {
    id: 'chicken-roast', emoji: '🍗', name: 'Chicken Roast',
    desc: 'Whole leg roasted with Bangladeshi spice rub. Crispy skin, tender inside.',
    price: 160, unit: 'per piece', stock: 0, max: 30, cat: 'main'
  },
  {
    id: 'borhani',    emoji: '🥛', name: 'Borhani',
    desc: 'Traditional spiced yogurt drink with black mustard and mint. Digestive and refreshing.',
    price: 60, unit: 'per glass', stock: 50, max: 100, cat: 'drink'
  },
];

/* ── SERVICE STATE ── */
const SERVICES = {
  'identity-provider': { name: 'Identity Provider', port: 3001, up: true, latency: 48 },
  'order-gateway':     { name: 'Order Gateway',     port: 3002, up: true, latency: 62 },
  'stock-service':     { name: 'Stock Service',     port: 3003, up: true, latency: 30 },
  'kitchen-queue':     { name: 'Kitchen Queue',     port: 3004, up: true, latency: 55 },
  'notification-hub':  { name: 'Notification Hub',  port: 3005, up: true, latency: 22 },
};

/* ── SESSION STATE ── */
const session = {
  ordersPlaced: 0,
  totalSpent: 0,
  loginTime: null,
};

/* ═══════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════ */
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function fmtTime(d) { return (d || new Date()).toTimeString().split(' ')[0]; }
function fmtPrice(n) { return 'Tk ' + n.toLocaleString(); }
function uid() { return Math.random().toString(36).substr(2, 8).toUpperCase(); }

function getToken()    { return localStorage.getItem(TOKEN_KEY); }
function getUser()     { return localStorage.getItem(USER_KEY); }
function getCart()     { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
function setCart(c)    { localStorage.setItem(CART_KEY, JSON.stringify(c)); updateCartUI(); }
function getOrders()   { return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]'); }
function addOrder(o)   {
  const orders = getOrders();
  orders.unshift(o);
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders.slice(0, 20)));
}

/* ─ Guard: redirect to login if no token ─ */
function requireAuth() {
  if (!getToken() && !window.location.pathname.includes('login')) {
    window.location.href = 'login.html';
  }
}

/* ═══════════════════════════════════════════════════════
   CLOCK
═══════════════════════════════════════════════════════ */
function startClock() {
  const update = () => {
    const t = fmtTime();
    const c = document.getElementById('corner-clock');
    const d = document.getElementById('dash-time');
    if (c) c.textContent = t;
    if (d) d.textContent = new Date().toLocaleString('en-US', { weekday:'long', hour:'2-digit', minute:'2-digit', hour12:true });
  };
  update();
  setInterval(update, 1000);
}

/* ═══════════════════════════════════════════════════════
   LOGIN
═══════════════════════════════════════════════════════ */
let loginAttempts = parseInt(localStorage.getItem(ATTEMPTS_KEY) || '0');
let attemptResetTimer = null;

function updateRateBar() {
  const pct = (loginAttempts / 3) * 100;
  const fill = document.getElementById('rate-fill');
  const label = document.getElementById('attempts-label');
  if (!fill) return;
  fill.style.width = pct + '%';
  fill.style.background = loginAttempts >= 3 ? 'var(--red)' : loginAttempts === 2 ? 'var(--gold)' : 'var(--green)';
  if (label) {
    label.textContent = loginAttempts + ' / 3';
    label.style.color = loginAttempts >= 3 ? 'var(--red)' : loginAttempts >= 2 ? 'var(--gold)' : 'var(--green)';
  }
}

async function login() {
  const idInput  = document.getElementById('studentId');
  const pwInput  = document.getElementById('password');
  const alertEl  = document.getElementById('login-alert');
  const btn      = document.getElementById('login-btn');
  const btnText  = document.getElementById('btn-text');
  const spinner  = document.getElementById('btn-spinner');

  if (!idInput || !pwInput) return;

  const id  = idInput.value.trim();
  const pw  = pwInput.value;

  hideAlert(alertEl);

  if (!id || !pw) { showAlert(alertEl, 'error', 'Student ID and password are required.'); return; }

  /* Rate limit check */
  if (loginAttempts >= 3) {
    showAlert(alertEl, 'error', '⚠ Rate limit exceeded. Maximum 3 login attempts per minute. Please wait.');
    return;
  }

  loginAttempts++;
  localStorage.setItem(ATTEMPTS_KEY, loginAttempts);
  updateRateBar();

  /* Reset after 60s */
  if (attemptResetTimer) clearTimeout(attemptResetTimer);
  attemptResetTimer = setTimeout(() => {
    loginAttempts = 0;
    localStorage.setItem(ATTEMPTS_KEY, '0');
    updateRateBar();
  }, 60000);

  /* UI loading state */
  btn.disabled = true;
  btnText.classList.add('hidden');
  spinner.classList.remove('hidden');

  const t0 = Date.now();

  try {
    const res = await fetch(`${API_BASE}/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: id, password: pw }),
    });

    const latency = Date.now() - t0;
    SERVICES['identity-provider'].latency = latency;

    const data = await res.json();

    if (!res.ok) {
      showAlert(alertEl, 'error', data.message || 'Authentication failed. Check your credentials.');
      return;
    }

    /* Success */
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, id);
    loginAttempts = 0;
    localStorage.setItem(ATTEMPTS_KEY, '0');
    session.loginTime = new Date();

    showAlert(alertEl, 'success', `✓ Authenticated! JWT token issued. Redirecting...`);
    await delay(700);
    window.location.href = 'dashboard.html';

  } catch (err) {
    showAlert(alertEl, 'error',
      `Cannot reach Identity Provider at ${API_BASE}. Make sure the backend is running (node server.js).`
    );
  } finally {
    btn.disabled = false;
    btnText.classList.remove('hidden');
    spinner.classList.add('hidden');
  }
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(CART_KEY);
  localStorage.removeItem(ORDERS_KEY);
  window.location.href = 'login.html';
}

/* ═══════════════════════════════════════════════════════
   ALERTS
═══════════════════════════════════════════════════════ */
function showAlert(el, type, msg) {
  if (!el) return;
  el.className = 'alert ' + type + ' show';
  el.textContent = msg;
}
function hideAlert(el) {
  if (!el) return;
  el.className = 'alert';
  el.textContent = '';
}

function showSysAlert(msg) {
  const b = document.getElementById('sys-alert');
  const m = document.getElementById('sys-alert-msg');
  if (!b) return;
  if (m) m.textContent = msg;
  b.classList.add('show');
  setTimeout(() => b.classList.remove('show'), 8000);
}
function closeSysAlert() {
  const b = document.getElementById('sys-alert');
  if (b) b.classList.remove('show');
}

/* ═══════════════════════════════════════════════════════
   CART
═══════════════════════════════════════════════════════ */
function addToCart(itemId) {
  const item = MENU_ITEMS.find(i => i.id === itemId);
  if (!item || item.stock <= 0) return;

  const cart = getCart();
  cart.push({ id: item.id, name: item.name, price: item.price, emoji: item.emoji, unit: item.unit, addedAt: Date.now() });
  setCart(cart);

  /* Visual feedback */
  const btn = document.getElementById('add-btn-' + itemId);
  const card = document.getElementById('item-card-' + itemId);
  if (btn) {
    btn.textContent = '✓ Added!';
    btn.style.background = 'var(--green)';
    setTimeout(() => {
      btn.textContent = 'Add';
      btn.style.background = '';
    }, 1200);
  }
  if (card) {
    card.classList.add('adding');
    setTimeout(() => card.classList.remove('adding'), 350);
  }

  updateCartUI();
}

function removeFromCart(index) {
  const cart = getCart();
  cart.splice(index, 1);
  setCart(cart);
  renderCartPage();
}

function updateCartUI() {
  const cart = getCart();
  const count = cart.length;

  /* Nav badge */
  document.querySelectorAll('#nav-cart-count').forEach(el => {
    el.textContent = count;
    el.style.display = count > 0 ? 'flex' : 'none';
  });

  /* FAB on menu page */
  const fab = document.getElementById('cart-fab');
  const fabCount = document.getElementById('fab-count');
  if (fab) {
    fab.style.display = count > 0 ? 'flex' : 'none';
    if (fabCount) fabCount.textContent = count;
  }
}

/* ═══════════════════════════════════════════════════════
   LOG HELPER (status page)
═══════════════════════════════════════════════════════ */
function addLog(msg, type = '') {
  const log = document.getElementById('live-log');
  if (!log) return;
  const ts  = fmtTime();
  const div = document.createElement('div');
  div.className = 'log-entry log-' + type;
  div.style.animation = 'slideIn .25s ease both';
  div.innerHTML = `<span class="log-ts">[${ts}]</span> <span class="log-msg">${msg}</span>`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

/* ═══════════════════════════════════════════════════════
   ORDER FLOW
═══════════════════════════════════════════════════════ */
async function placeOrder() {
  const cart = getCart();
  if (cart.length === 0) return;

  const token = getToken();
  if (!token) { window.location.href = 'login.html'; return; }

  const btn     = document.getElementById('place-order-btn');
  const btnText = document.getElementById('order-btn-text');
  const spinner = document.getElementById('order-spinner');

  if (btn) btn.disabled = true;
  if (btnText) btnText.classList.add('hidden');
  if (spinner) spinner.classList.remove('hidden');

  /* Check order gateway */
  if (!SERVICES['order-gateway'].up) {
    if (btnText) btnText.classList.remove('hidden');
    if (spinner) spinner.classList.add('hidden');
    if (btn) btn.disabled = false;
    alert('Order Gateway is offline. Cannot process orders.');
    return;
  }

  /* Save order record */
  const orderId = 'ORD-' + uid();
  const total   = cart.reduce((s, i) => s + i.price, 0);
  const orderRecord = { id: orderId, items: [...cart], total, status: 'pending', time: new Date().toISOString() };
  addOrder(orderRecord);

  session.ordersPlaced++;
  session.totalSpent += total;

  /* Clear cart */
  setCart([]);

  /* Redirect to status with order id */
  localStorage.setItem('iftarflow_active_order', JSON.stringify(orderRecord));
  window.location.href = 'status.html';
}

/* ═══════════════════════════════════════════════════════
   STATUS PAGE — ANIMATE ORDER
═══════════════════════════════════════════════════════ */
async function animateOrder(order) {
  const steps      = [0, 1, 2, 3];
  const stepMsgs   = [
    { type: 'info', msg: `→ POST /order { items: ${order.items.length} } [Bearer ...${getToken()?.slice(-6)}]` },
    { type: 'ok',   msg: `STOCK SERVICE — Optimistic lock acquired. All items reserved.` },
    { type: 'ok',   msg: `KITCHEN QUEUE — Order ${order.id} acknowledged in <2s. Cooking started.` },
    { type: 'ok',   msg: `NOTIFICATION HUB — Push sent: "${order.items[0]?.name}" and ${order.items.length - 1} more are READY.` },
  ];
  const stepLabels = ['PENDING', 'STOCK VERIFIED', 'IN KITCHEN', '🍽 READY FOR PICKUP!'];
  const stepColors = ['tag-gold', 'tag-blue', 'tag-blue', 'tag-green'];

  /* Show ETA */
  const etaBox = document.getElementById('eta-box');
  const etaVal = document.getElementById('eta-val');
  if (etaBox) etaBox.style.display = 'flex';

  const cookMs = 4000 + Math.random() * 3000;
  let remaining = Math.ceil(cookMs / 1000);
  if (etaVal) etaVal.textContent = remaining + 's';
  const etaInterval = setInterval(() => {
    remaining--;
    if (etaVal) etaVal.textContent = remaining > 0 ? remaining + 's' : 'Ready!';
    if (remaining <= 0) clearInterval(etaInterval);
  }, 1000);

  for (let i = 0; i < steps.length; i++) {
    /* Set previous steps done */
    for (let j = 0; j < i; j++) setStepState(j, 'done');
    setStepState(i, 'active');

    /* Update pill */
    const pill = document.getElementById('status-pill');
    if (pill) {
      pill.textContent = stepLabels[i];
      pill.className   = 'status-pill tag ' + stepColors[i];
    }

    /* Update notif */
    const notif = document.getElementById('notif-box');
    const msgs  = [
      `🕐 Order ${order.id} received. Validating JWT token with Order Gateway...`,
      `✅ Stock verified! All items reserved. Sending to Kitchen Queue...`,
      `👨‍🍳 Preparing your Iftar... Estimated ${Math.ceil(cookMs / 1000)}s cooking time.`,
      `🔔 Your Iftar is READY for pickup! Head to the cafeteria counter.`,
    ];
    if (notif) notif.innerHTML = msgs[i];

    /* Log entry */
    addLog(stepMsgs[i].msg, stepMsgs[i].type);

    const waitTime = i === 2 ? cookMs : i === 0 ? 900 : 1200;
    await delay(waitTime);
  }

  /* Final state */
  steps.forEach(j => setStepState(j, 'done'));

  /* Add to history */
  const histEl   = document.getElementById('order-history');
  const histEmpty= document.getElementById('history-empty');
  if (histEmpty) histEmpty.style.display = 'none';
  if (histEl) {
    const div = document.createElement('div');
    div.className = 'cart-item reveal';
    div.style.marginBottom = '.5rem';
    div.innerHTML = `
      <span style="font-size:1.3rem;">${order.items[0]?.emoji || '🍱'}</span>
      <div class="cart-item-info">
        <div class="cart-item-name" style="font-size:.8rem;">${order.id}</div>
        <div class="cart-item-meta">${order.items.length} item(s) · ${fmtPrice(order.total)}</div>
      </div>
      <span class="tag tag-green" style="font-size:.6rem;">COMPLETED</span>`;
    histEl.prepend(div);
  }
}

function setStepState(index, state) {
  const el = document.getElementById('step-' + index);
  if (!el) return;
  el.classList.remove('done', 'active');
  if (state) el.classList.add(state);
}

/* ═══════════════════════════════════════════════════════
   RENDER — MENU PAGE
═══════════════════════════════════════════════════════ */
let currentFilter = 'all';

function renderMenu() {
  const grid = document.getElementById('menu-grid');
  if (!grid) return;

  const filtered = currentFilter === 'all'
    ? MENU_ITEMS
    : MENU_ITEMS.filter(i => i.cat === currentFilter);

  grid.innerHTML = '';
  filtered.forEach((item, idx) => {
    const pct     = item.stock / item.max;
    const isOut   = item.stock === 0;
    const isLow   = !isOut && pct < 0.15;
    const stockCls= isOut ? 'out' : isLow ? 'low' : '';
    const stockLbl= isOut ? 'OUT OF STOCK' : isLow ? `⚠ Only ${item.stock} left` : `${item.stock} available`;

    const div = document.createElement('div');
    div.className = 'menu-item';
    div.id = 'item-card-' + item.id;
    div.style.animationDelay = (idx * 0.04) + 's';
    div.style.animation = 'fadeUp .4s ease both';
    div.style.opacity   = isOut ? '.55' : '1';
    div.innerHTML = `
      <div class="menu-item-img">${item.emoji}</div>
      <div class="menu-item-body">
        <div class="menu-item-name">${item.name}</div>
        <div class="menu-item-desc">${item.desc}</div>
        <div class="menu-item-footer">
          <div>
            <div class="menu-item-price">${fmtPrice(item.price)}</div>
            <div class="menu-item-stock ${stockCls}">${stockLbl} · ${item.unit}</div>
          </div>
          <button class="add-btn" id="add-btn-${item.id}"
            onclick="addToCart('${item.id}')"
            ${isOut ? 'disabled' : ''}>
            ${isOut ? 'Sold Out' : 'Add'}
          </button>
        </div>
      </div>`;
    grid.appendChild(div);
  });

  renderStockPills();
}

function filterMenu(cat, btn) {
  currentFilter = cat;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderMenu();
}

function renderStockPills() {
  const container = document.getElementById('stock-pills');
  if (!container) return;
  container.innerHTML = '';
  MENU_ITEMS.slice(0, 6).forEach(item => {
    const isOut = item.stock === 0;
    const span  = document.createElement('span');
    span.className = 'tag ' + (isOut ? 'tag-red' : item.stock < 10 ? 'tag-gold' : 'tag-green');
    span.style.fontSize = '.6rem';
    span.textContent = item.emoji + ' ' + (isOut ? '0' : item.stock);
    container.appendChild(span);
  });
}

/* ═══════════════════════════════════════════════════════
   RENDER — CART PAGE
═══════════════════════════════════════════════════════ */
function renderCartPage() {
  const container = document.getElementById('cart-items-container');
  const empty     = document.getElementById('cart-empty');
  const orderBtn  = document.getElementById('place-order-btn');
  if (!container) return;

  const cart  = getCart();
  const total = cart.reduce((s, i) => s + i.price, 0);
  const token = getToken();

  /* Token strip */
  const strip = document.getElementById('cart-token-preview');
  const auth  = document.getElementById('auth-status-tag');
  if (strip) strip.textContent = token ? (token.substring(0, 40) + '…') : 'Not authenticated — please login';
  if (auth) {
    if (token) {
      auth.className = 'tag tag-green';
      auth.textContent = '✓ JWT Verified';
    } else {
      auth.className = 'tag tag-red';
      auth.textContent = '✗ Not Authenticated';
    }
  }

  /* Summary */
  const sub   = document.getElementById('summary-subtotal');
  const cnt   = document.getElementById('summary-count');
  const tot   = document.getElementById('summary-total');
  if (sub) sub.textContent = total.toLocaleString();
  if (cnt) cnt.textContent = cart.length + ' item' + (cart.length !== 1 ? 's' : '');
  if (tot) tot.textContent = total.toLocaleString();

  if (cart.length === 0) {
    container.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    if (orderBtn) orderBtn.disabled = true;
    return;
  }

  if (empty) empty.classList.add('hidden');
  if (orderBtn) orderBtn.disabled = !token;

  container.innerHTML = '';
  cart.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = 'cart-item';
    div.style.animationDelay = (idx * 0.05) + 's';
    div.innerHTML = `
      <span class="cart-item-emoji">${item.emoji || '🍱'}</span>
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-meta">${item.unit || 'item'}</div>
      </div>
      <span class="cart-item-price">${fmtPrice(item.price)}</span>
      <button class="cart-item-remove" onclick="removeFromCart(${idx})" title="Remove">✕</button>`;
    container.appendChild(div);
  });
}

/* ═══════════════════════════════════════════════════════
   RENDER — DASHBOARD
═══════════════════════════════════════════════════════ */
function renderDashboard() {
  const cart    = getCart();
  const orders  = getOrders();

  const sc = document.getElementById('stat-cart');
  const so = document.getElementById('stat-orders');
  const ss = document.getElementById('stat-services');
  const ct = document.getElementById('cart-tag');

  const upCount = Object.values(SERVICES).filter(s => s.up).length;
  const total   = Object.keys(SERVICES).length;

  if (sc) sc.textContent = cart.length;
  if (so) so.textContent = orders.length;
  if (ss) {
    ss.textContent = `${upCount}/${total}`;
    ss.style.color = upCount < total ? 'var(--red)' : 'var(--green)';
  }
  if (ct) ct.textContent = cart.length > 0 ? cart.length + ' items' : 'Empty cart';

  /* Service pills */
  const pillsEl = document.getElementById('service-status-pills');
  if (pillsEl) {
    pillsEl.innerHTML = '';
    Object.entries(SERVICES).forEach(([, svc]) => {
      const div = document.createElement('div');
      div.className = 'svc-pill ' + (svc.up ? 'up' : 'down');
      div.innerHTML = `<span class="svc-pill-dot"></span>${svc.name}`;
      pillsEl.appendChild(div);
    });
  }
}

/* ═══════════════════════════════════════════════════════
   RENDER — SERVICE HEALTH (STATUS PAGE)
═══════════════════════════════════════════════════════ */
function renderServiceHealth() {
  const grid = document.getElementById('service-health-grid');
  if (!grid) return;
  grid.innerHTML = '';

  Object.entries(SERVICES).forEach(([key, svc]) => {
    const div = document.createElement('div');
    div.className = 'card';
    div.style.padding = '.9rem';
    div.style.borderColor = svc.up ? 'rgba(16,185,129,.25)' : 'rgba(239,68,68,.25)';
    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:.5rem;">
        <div style="font-family:var(--fh); font-weight:700; font-size:.8rem;">${svc.name}</div>
        <div class="tag-dot" style="width:8px;height:8px;border-radius:50;margin-top:2px;
          background:${svc.up ? 'var(--green)' : 'var(--red)'};
          box-shadow:0 0 8px ${svc.up ? 'var(--green)' : 'var(--red)'};
          ${svc.up ? 'animation:pulse 2s infinite' : ''}"></div>
      </div>
      <div style="font-size:.65rem; color:var(--text2);">
        <span style="color:${svc.up ? 'var(--green)' : 'var(--red)'};">${svc.up ? '● HEALTHY' : '● DOWN'}</span>
        · :${svc.port} · ${svc.up ? svc.latency + 'ms' : 'N/A'}
      </div>`;
    grid.appendChild(div);
  });
}

/* ═══════════════════════════════════════════════════════
   RENDER — PROFILE PAGE
═══════════════════════════════════════════════════════ */
function renderProfile() {
  const user   = getUser();
  const token  = getToken();
  const cart   = getCart();
  const orders = getOrders();
  const total  = orders.reduce((s, o) => s + (o.total || 0), 0);

  const setT = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  setT('profile-name', user ? user.split('@')[0] : 'Student');
  setT('profile-email', user || '—');
  setT('pf-id', user ? 'IUT-' + uid().slice(0, 6) : '—');
  setT('pf-email', user || '—');
  setT('pf-session', session.loginTime ? session.loginTime.toLocaleTimeString() : new Date().toLocaleTimeString());
  setT('pf-orders', orders.length);
  setT('pf-cart', cart.length);
  setT('pf-spent', 'Tk ' + total.toLocaleString());

  const pfToken = document.getElementById('pf-token');
  if (pfToken && token) pfToken.textContent = token.substring(0, 60) + '…';

  const navEmail = document.getElementById('nav-user-email');
  if (navEmail) navEmail.textContent = user || '—';
}

/* ═══════════════════════════════════════════════════════
   NAV — SET ACTIVE + USER
═══════════════════════════════════════════════════════ */
function initNav() {
  const user = getUser();
  document.querySelectorAll('#nav-user-email').forEach(el => el.textContent = user || '—');
  updateCartUI();
}

/* ═══════════════════════════════════════════════════════
   PAGE INIT — RUN ON EACH PAGE LOAD
═══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  const page = window.location.pathname.split('/').pop() || 'dashboard.html';

  startClock();
  initNav();

  /* ── LOGIN PAGE ── */
  if (page === 'login.html' || page === '') {
    updateRateBar();

    /* Redirect if already logged in */
    if (getToken()) { window.location.href = 'dashboard.html'; return; }

    /* Enter key support */
    const idIn = document.getElementById('studentId');
    const pwIn = document.getElementById('password');
    if (idIn) idIn.addEventListener('keydown', e => e.key === 'Enter' && login());
    if (pwIn) pwIn.addEventListener('keydown', e => e.key === 'Enter' && login());
    return;
  }

  /* All other pages require auth */
  requireAuth();

  /* ── DASHBOARD ── */
  if (page === 'dashboard.html') {
    renderDashboard();
    return;
  }

  /* ── MENU ── */
  if (page === 'menu.html') {
    renderMenu();
    return;
  }

  /* ── CART ── */
  if (page === 'cart.html') {
    renderCartPage();
    return;
  }

  /* ── STATUS ── */
  if (page === 'status.html') {
    renderServiceHealth();

    const raw = localStorage.getItem('iftarflow_active_order');
    if (!raw) {
      addLog('No active order. Place an order from the cart.', 'warn');
      return;
    }

    localStorage.removeItem('iftarflow_active_order');
    const order = JSON.parse(raw);

    /* Show order info */
    const idEl  = document.getElementById('current-order-id');
    const tagEl = document.getElementById('order-item-tag');
    if (idEl) idEl.textContent = order.id;
    if (tagEl && order.items[0]) {
      tagEl.className = 'tag tag-gold';
      tagEl.textContent = order.items[0].emoji + ' ' + order.items[0].name + (order.items.length > 1 ? ` +${order.items.length - 1} more` : '');
    }

    addLog('Order received. Starting distributed processing...', 'info');
    animateOrder(order);
    return;
  }

  /* ── PROFILE ── */
  if (page === 'profile.html') {
    renderProfile();
    return;
  }
});
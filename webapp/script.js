const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor('#16110d'); } catch (e) {}
}

const SEALS = {
  specials: '🔥',
  noodles: '🍜',
  gravy_noodles: '🍛',
  fried_rice: '🍚',
  chicken_sides: '🍗',
  momos: '🥟',
  soup: '🥣',
};

let MENU = null;
let SETTINGS = { deliveryEnabled: false, helpPhone: '', helpMessage: '' };
// cart key = `${itemId}__${size||'single'}` -> { id, name, size, unitPrice, qty }
const cart = {};
// per-item selected size before adding, key = itemId -> 'half' | 'full'
const sizeChoice = {};
let searchQuery = '';

// Customers without Telegram (QR scan) have no chat-based history, so we
// remember their phone locally to power "My Orders" lookup on this device.
const LAST_PHONE_KEY = 'tangra_last_phone';

const menuListEl = document.getElementById('menuList');
const skeletonWrapEl = document.getElementById('skeletonWrap');
const noResultsEl = document.getElementById('noResults');
const catTabsEl = document.getElementById('catTabs');
const searchInputEl = document.getElementById('searchInput');
const cartBarEl = document.getElementById('cartBar');
const cartCountEl = document.getElementById('cartCount');
const cartTotalEl = document.getElementById('cartTotal');
const drawerOverlayEl = document.getElementById('drawerOverlay');
const cartItemsEl = document.getElementById('cartItems');
const drawerTotalEl = document.getElementById('drawerTotal');
const submitTotalEl = document.getElementById('submitTotal');
const checkoutForm = document.getElementById('checkoutForm');
const orderTypeSeg = document.getElementById('orderTypeSeg');
const custOrderTypeInput = document.getElementById('custOrderType');
const custPhoneInput = document.getElementById('custPhone');
const verifiedNoteEl = document.getElementById('verifiedNote');
const deliverySegBtn = document.getElementById('deliverySegBtn');
const addressFieldEl = document.getElementById('addressField');
const custAddressInput = document.getElementById('custAddress');

const myOrdersBtn = document.getElementById('myOrdersBtn');
const ordersOverlayEl = document.getElementById('ordersOverlay');
const ordersLookupEl = document.getElementById('ordersLookup');
const lookupPhoneInput = document.getElementById('lookupPhone');
const lookupBtn = document.getElementById('lookupBtn');
const ordersListPanelEl = document.getElementById('ordersList');

const helpBtn = document.getElementById('helpBtn');
const helpOverlayEl = document.getElementById('helpOverlay');
const helpMessageTextEl = document.getElementById('helpMessageText');
const helpCallBtn = document.getElementById('helpCallBtn');
const helpWhatsappBtn = document.getElementById('helpWhatsappBtn');
const helpEmptyEl = document.getElementById('helpEmpty');

const webConfirmOverlayEl = document.getElementById('webConfirmOverlay');
const webConfirmTextEl = document.getElementById('webConfirmText');
const webConfirmCloseBtn = document.getElementById('webConfirmCloseBtn');

init();

async function init() {
  try {
    const [menuRes, settingsRes] = await Promise.all([fetch('/api/menu'), fetch('/api/settings')]);
    MENU = await menuRes.json();
    SETTINGS = await settingsRes.json();
  } catch (err) {
    menuListEl.innerHTML = '<div class="no-results"><span>⚠️</span><p>Menu load nahi ho paya. Refresh karo.</p></div>';
    return;
  }
  skeletonWrapEl.remove();
  renderTabs();
  renderMenu();
  bindSearch();
  bindCartBar();
  bindDrawer();
  bindForm();
  bindMyOrders();
  bindHelp();
  applyDeliverySetting();
}

function applyDeliverySetting() {
  if (SETTINGS.deliveryEnabled) {
    deliverySegBtn.hidden = false;
  }
}

function renderTabs() {
  MENU.categories.forEach((cat, idx) => {
    const btn = document.createElement('button');
    btn.className = 'cat-tab' + (idx === 0 ? ' active' : '');
    btn.textContent = cat.name;
    btn.dataset.cat = cat.id;
    btn.addEventListener('click', () => {
      document.getElementById(`section-${cat.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    catTabsEl.appendChild(btn);
  });
}

function itemMatchesSearch(item) {
  if (!searchQuery) return true;
  return item.name.toLowerCase().includes(searchQuery);
}

function renderMenu() {
  menuListEl.innerHTML = '';
  let visibleCount = 0;
  let delay = 0;

  MENU.categories.forEach((cat) => {
    const visibleItems = cat.items.filter(itemMatchesSearch);
    if (visibleItems.length === 0) return;

    const section = document.createElement('section');
    section.id = `section-${cat.id}`;

    const header = document.createElement('div');
    header.className = 'section-header';
    header.innerHTML = `
      <span class="section-seal">${SEALS[cat.id] || '味'}</span>
      <h2>${cat.name}</h2>
      ${cat.note ? `<span class="section-note">${cat.note}</span>` : ''}
    `;
    section.appendChild(header);

    visibleItems.forEach((item) => {
      const card = renderItemCard(item);
      card.style.animationDelay = `${Math.min(delay, 8) * 30}ms`;
      delay++;
      section.appendChild(card);
      visibleCount++;
    });

    menuListEl.appendChild(section);
  });

  noResultsEl.hidden = visibleCount > 0;
  menuListEl.hidden = visibleCount === 0;

  setupScrollSpy();
}

function setupScrollSpy() {
  window.onscroll = () => {
    let currentId = null;
    for (const cat of MENU.categories) {
      const el = document.getElementById(`section-${cat.id}`);
      if (el && el.getBoundingClientRect().top - 150 <= 0) currentId = cat.id;
    }
    if (!currentId) return;
    document.querySelectorAll('.cat-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.cat === currentId);
    });
  };
}

function dietDotHtml(item) {
  if (!item.dietType) return '';
  return `<span class="diet-dot ${item.dietType}" aria-label="${item.dietType}"></span>`;
}

function renderItemCard(item) {
  const card = document.createElement('div');
  card.className = 'item-card' + (item.available === false ? ' sold-out' : '');
  card.dataset.itemId = item.id;

  const hasHalfFull = typeof item.half === 'number' && typeof item.full === 'number';
  if (hasHalfFull && !sizeChoice[item.id]) sizeChoice[item.id] = 'half';

  const priceLabel = hasHalfFull
    ? `<span class="price-tag">₹${item.half} / ₹${item.full}</span>`
    : `<span class="price-tag">₹${item.price}</span>`;

  card.innerHTML = `
    <div>
      <div class="item-name-row">
        ${dietDotHtml(item)}
        <span class="item-name">${item.name}</span>
        ${item.available === false ? '<span class="sold-out-badge">Sold Out</span>' : ''}
      </div>
      <div class="item-note">${priceLabel}${item.note ? ' · ' + item.note : ''}</div>
    </div>
    <div class="item-controls"></div>
  `;

  const controls = card.querySelector('.item-controls');

  if (item.available === false) {
    return card; // no size/qty controls for sold-out items
  }

  if (hasHalfFull) {
    const sizeToggle = document.createElement('div');
    sizeToggle.className = 'size-toggle';
    ['half', 'full'].forEach((size) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'size-btn' + (sizeChoice[item.id] === size ? ' selected' : '');
      b.textContent = size === 'half' ? 'H' : 'F';
      b.addEventListener('click', () => {
        sizeChoice[item.id] = size;
        sizeToggle.querySelectorAll('.size-btn').forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
        refreshQtyControls(item, controls, card);
      });
      sizeToggle.appendChild(b);
    });
    controls.appendChild(sizeToggle);
  }

  refreshQtyControls(item, controls, card);
  return card;
}

function cartKey(item) {
  const size = typeof item.half === 'number' ? sizeChoice[item.id] : 'single';
  return `${item.id}__${size}`;
}

function refreshQtyControls(item, controls, card) {
  const existing = controls.querySelector('.qty-stepper, .add-btn');
  if (existing) existing.remove();

  const key = cartKey(item);
  const qty = cart[key]?.qty || 0;
  card.classList.toggle('in-cart', qty > 0);

  if (qty === 0) {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'add-btn';
    addBtn.textContent = 'Add';
    addBtn.addEventListener('click', () => {
      changeQty(item, 1);
      refreshQtyControls(item, controls, card);
    });
    controls.appendChild(addBtn);
  } else {
    const stepper = document.createElement('div');
    stepper.className = 'qty-stepper';
    stepper.innerHTML = `
      <button type="button" class="qty-btn minus">−</button>
      <span class="qty-value">${qty}</span>
      <button type="button" class="qty-btn plus">+</button>
    `;
    stepper.querySelector('.minus').addEventListener('click', () => {
      changeQty(item, -1);
      refreshQtyControls(item, controls, card);
    });
    stepper.querySelector('.plus').addEventListener('click', () => {
      changeQty(item, 1);
      refreshQtyControls(item, controls, card);
    });
    controls.appendChild(stepper);
  }
}

function changeQty(item, delta) {
  const size = typeof item.half === 'number' ? sizeChoice[item.id] : 'single';
  const key = cartKey(item);
  const unitPrice = size === 'full' ? item.full : size === 'half' ? item.half : item.price;

  if (!cart[key]) {
    cart[key] = { id: item.id, name: item.name, size: size === 'single' ? null : size, unitPrice, qty: 0 };
  }
  cart[key].qty += delta;
  if (cart[key].qty <= 0) delete cart[key];

  if (tg?.HapticFeedback) {
    try { tg.HapticFeedback.impactOccurred('light'); } catch (e) {}
  }

  updateCartBar();
}

function updateCartBar() {
  const entries = Object.values(cart);
  const count = entries.reduce((s, e) => s + e.qty, 0);
  const total = entries.reduce((s, e) => s + e.qty * e.unitPrice, 0);

  if (count === 0) {
    cartBarEl.hidden = true;
    return;
  }
  cartBarEl.hidden = false;
  cartCountEl.textContent = `${count} item${count > 1 ? 's' : ''}`;
  cartTotalEl.textContent = `₹${total}`;
}

function bindSearch() {
  searchInputEl.addEventListener('input', () => {
    searchQuery = searchInputEl.value.trim().toLowerCase();
    renderMenu();
  });
}

function bindCartBar() {
  cartBarEl.addEventListener('click', () => openDrawer(drawerOverlayEl));
}

function openDrawer(overlayEl) {
  overlayEl.hidden = false;
  requestAnimationFrame(() => overlayEl.classList.add('open'));
}

function closeDrawer(overlayEl) {
  overlayEl.classList.remove('open');
  setTimeout(() => { overlayEl.hidden = true; }, 320);
}

function refreshVisibleCardStates() {
  document.querySelectorAll('.item-card').forEach((card) => {
    const itemId = card.dataset.itemId;
    const item = MENU.categories.flatMap((c) => c.items).find((i) => i.id === itemId);
    if (!item || item.available === false) return;
    const controls = card.querySelector('.item-controls');
    refreshQtyControls(item, controls, card);
  });
}

function renderCartDrawer() {
  const entries = Object.entries(cart);
  cartItemsEl.innerHTML = '';
  let total = 0;

  entries.forEach(([key, e]) => {
    total += e.qty * e.unitPrice;
    const row = document.createElement('div');
    row.className = 'cart-row';
    row.innerHTML = `
      <div class="cart-row-name">
        ${e.name}${e.size ? ` (${e.size})` : ''}
        <small>${e.qty} × ₹${e.unitPrice} = ₹${e.qty * e.unitPrice}</small>
      </div>
      <button type="button" class="cart-row-remove" data-key="${key}">Remove</button>
    `;
    cartItemsEl.appendChild(row);
  });

  cartItemsEl.querySelectorAll('.cart-row-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      delete cart[btn.dataset.key];
      renderCartDrawer();
      updateCartBar();
      refreshVisibleCardStates();
    });
  });

  drawerTotalEl.textContent = `₹${total}`;
  submitTotalEl.textContent = `₹${total}`;

  if (entries.length === 0) {
    closeDrawer(drawerOverlayEl);
  }
}

function bindDrawer() {
  drawerOverlayEl.addEventListener('click', (e) => {
    if (e.target === drawerOverlayEl) closeDrawer(drawerOverlayEl);
  });
  cartBarEl.addEventListener('click', renderCartDrawer);

  orderTypeSeg.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      orderTypeSeg.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      custOrderTypeInput.value = btn.dataset.value;
      addressFieldEl.hidden = btn.dataset.value !== 'Delivery';
    });
  });

  const tgUser = tg?.initDataUnsafe?.user;
  if (tgUser?.first_name) {
    document.getElementById('custName').value = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
  }

  // If this customer already verified their number via the bot, prefill and
  // lock the phone field so they don't have to type it (and can't fake it).
  if (tgUser?.id) {
    fetch(`/api/verified-phone/${tgUser.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.phone) {
          custPhoneInput.value = data.phone;
          custPhoneInput.readOnly = true;
          verifiedNoteEl.hidden = false;
        }
      })
      .catch(() => {});
  } else {
    // No Telegram — prefill from the last phone number used on this device.
    const savedPhone = localStorage.getItem(LAST_PHONE_KEY);
    if (savedPhone) custPhoneInput.value = savedPhone;
  }
}

function bindForm() {
  checkoutForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const entries = Object.values(cart);
    if (entries.length === 0) return;

    const phone = document.getElementById('custPhone').value.trim();
    const customer = {
      name: document.getElementById('custName').value.trim(),
      phone,
      orderType: custOrderTypeInput.value,
      address: custOrderTypeInput.value === 'Delivery' ? custAddressInput.value.trim() : '',
      notes: document.getElementById('custNotes').value.trim(),
    };

    const payload = {
      cart: entries.map((e) => ({ id: e.id, size: e.size, qty: e.qty })),
      customer,
    };

    localStorage.setItem(LAST_PHONE_KEY, phone);

    if (tg && tg.sendData) {
      // tg.sendData() already closes the Mini App by itself once the data
      // is delivered — calling tg.close() right after it used to race with
      // that and could cut the send off before it finished, losing the
      // order. Let Telegram handle the close on its own.
      tg.sendData(JSON.stringify(payload));
    } else {
      // No Telegram at all (QR scan on plain web) — place the order for
      // real via the HTTP API instead of just logging it.
      try {
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Order place nahi ho paya.');

        for (const key of Object.keys(cart)) delete cart[key];
        updateCartBar();
        refreshVisibleCardStates();
        closeDrawer(drawerOverlayEl);

        webConfirmTextEl.textContent = data.summary;
        openDrawer(webConfirmOverlayEl);
      } catch (err) {
        alert(`⚠️ ${err.message}`);
      }
    }
  });
}

// --- My Orders ---
function bindMyOrders() {
  myOrdersBtn.addEventListener('click', () => {
    openDrawer(ordersOverlayEl);
    loadMyOrders();
  });
  ordersOverlayEl.addEventListener('click', (e) => {
    if (e.target === ordersOverlayEl) closeDrawer(ordersOverlayEl);
  });
  lookupBtn.addEventListener('click', () => {
    const phone = lookupPhoneInput.value.trim();
    if (!phone) return;
    localStorage.setItem(LAST_PHONE_KEY, phone);
    fetchMyOrders({ phone });
  });
}

function loadMyOrders() {
  const tgUser = tg?.initDataUnsafe?.user;
  if (tgUser?.id) {
    ordersLookupEl.hidden = true;
    fetchMyOrders({ tgUserId: tgUser.id });
    return;
  }
  // No Telegram — ask for (or reuse) the phone number they ordered with.
  ordersLookupEl.hidden = false;
  const savedPhone = localStorage.getItem(LAST_PHONE_KEY);
  if (savedPhone) {
    lookupPhoneInput.value = savedPhone;
    fetchMyOrders({ phone: savedPhone });
  } else {
    ordersListPanelEl.innerHTML = '<p class="orders-empty">Phone number daal ke apne orders dekho.</p>';
  }
}

async function fetchMyOrders(params) {
  ordersListPanelEl.innerHTML = '<p class="orders-empty">Loading…</p>';
  try {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`/api/my-orders?${qs}`);
    const orders = await res.json();
    renderMyOrders(orders);
  } catch (err) {
    ordersListPanelEl.innerHTML = '<p class="orders-empty">Orders load nahi ho paye.</p>';
  }
}

function renderMyOrders(orders) {
  if (!orders || orders.length === 0) {
    ordersListPanelEl.innerHTML = '<p class="orders-empty">Koi order nahi mila.</p>';
    return;
  }
  ordersListPanelEl.innerHTML = '';
  orders.forEach((order) => {
    const card = document.createElement('div');
    card.className = 'my-order-card';
    const time = new Date(order.createdAt).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    const itemsText = order.items.map((it) => `${it.name}${it.size ? ` (${it.size})` : ''} × ${it.qty}`).join(', ');
    card.innerHTML = `
      <div class="my-order-top">
        <span>#${order.orderId}</span>
        <span class="status-badge status-${order.status || 'New'}">${order.status || 'New'}</span>
      </div>
      <div class="my-order-items">${itemsText}</div>
      <div class="my-order-bottom"><span>${time}</span><strong>₹${order.total}</strong></div>
    `;
    ordersListPanelEl.appendChild(card);
  });
}

// --- Help ---
function bindHelp() {
  helpBtn.addEventListener('click', () => {
    openDrawer(helpOverlayEl);
    renderHelp();
  });
  helpOverlayEl.addEventListener('click', (e) => {
    if (e.target === helpOverlayEl) closeDrawer(helpOverlayEl);
  });
}

function renderHelp() {
  if (!SETTINGS.helpPhone) {
    helpMessageTextEl.hidden = true;
    helpCallBtn.hidden = true;
    helpWhatsappBtn.hidden = true;
    helpEmptyEl.hidden = false;
    return;
  }
  helpEmptyEl.hidden = true;
  helpMessageTextEl.hidden = false;
  helpMessageTextEl.textContent = SETTINGS.helpMessage || '';
  helpCallBtn.hidden = false;
  helpCallBtn.href = `tel:${SETTINGS.helpPhone}`;
  helpWhatsappBtn.hidden = false;
  const digitsOnly = SETTINGS.helpPhone.replace(/\D/g, '');
  helpWhatsappBtn.href = `https://wa.me/91${digitsOnly.slice(-10)}`;
}

webConfirmCloseBtn.addEventListener('click', () => closeDrawer(webConfirmOverlayEl));
webConfirmOverlayEl.addEventListener('click', (e) => {
  if (e.target === webConfirmOverlayEl) closeDrawer(webConfirmOverlayEl);
});

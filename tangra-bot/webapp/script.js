const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor('#16110d'); } catch (e) {}
}

const SEALS = {
  specials: '招',
  noodles: '面',
  gravy_noodles: '汁',
  fried_rice: '饭',
  chicken_sides: '鸡',
  momos: '包',
  soup: '汤',
};

let MENU = null;
// cart key = `${itemId}__${size||'single'}` -> { id, name, size, unitPrice, qty }
const cart = {};
// per-item selected size before adding, key = itemId -> 'half' | 'full'
const sizeChoice = {};
let searchQuery = '';

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
const addressField = document.getElementById('addressField');

init();

async function init() {
  try {
    const res = await fetch('/api/menu');
    MENU = await res.json();
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
  card.className = 'item-card';
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
      </div>
      <div class="item-note">${priceLabel}${item.note ? ' · ' + item.note : ''}</div>
    </div>
    <div class="item-controls"></div>
  `;

  const controls = card.querySelector('.item-controls');

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
  cartBarEl.addEventListener('click', () => openDrawer());
}

function openDrawer() {
  renderCartDrawer();
  drawerOverlayEl.hidden = false;
  requestAnimationFrame(() => drawerOverlayEl.classList.add('open'));
}

function closeDrawer() {
  drawerOverlayEl.classList.remove('open');
  setTimeout(() => { drawerOverlayEl.hidden = true; }, 320);
}

function refreshVisibleCardStates() {
  document.querySelectorAll('.item-card').forEach((card) => {
    const itemId = card.dataset.itemId;
    const item = MENU.categories.flatMap((c) => c.items).find((i) => i.id === itemId);
    if (!item) return;
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
    closeDrawer();
  }
}

function bindDrawer() {
  drawerOverlayEl.addEventListener('click', (e) => {
    if (e.target === drawerOverlayEl) closeDrawer();
  });

  orderTypeSeg.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      orderTypeSeg.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      custOrderTypeInput.value = btn.dataset.value;
      addressField.style.display = btn.dataset.value === 'Delivery' ? 'flex' : 'none';
    });
  });
  addressField.style.display = 'none';

  const tgUser = tg?.initDataUnsafe?.user;
  if (tgUser?.first_name) {
    document.getElementById('custName').value = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
  }
}

function bindForm() {
  checkoutForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const entries = Object.values(cart);
    if (entries.length === 0) return;

    const customer = {
      name: document.getElementById('custName').value.trim(),
      phone: document.getElementById('custPhone').value.trim(),
      orderType: custOrderTypeInput.value,
      address: document.getElementById('custAddress').value.trim(),
      notes: document.getElementById('custNotes').value.trim(),
    };

    if (customer.orderType === 'Delivery' && !customer.address) {
      alert('Delivery ke liye address zaroori hai.');
      return;
    }

    const payload = {
      cart: entries.map((e) => ({ id: e.id, size: e.size, qty: e.qty })),
      customer,
    };

    if (tg && tg.sendData) {
      tg.sendData(JSON.stringify(payload));
      tg.close();
    } else {
      console.log('Order payload:', payload);
      alert('Order (test mode, Telegram ke bahar): console dekho.');
    }
  });
}

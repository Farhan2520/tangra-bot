const STATUSES = ['New', 'Preparing', 'Ready', 'Delivered', 'Cancelled'];

let allOrders = [];
let activeFilter = 'All';
let currentMenu = null;
let editingItem = null; // { categoryId, itemId } when editing, null when adding

const ordersListEl = document.getElementById('ordersList');
const filterTabsEl = document.getElementById('filterTabs');
const todayCountEl = document.getElementById('todayCount');
const todayRevenueEl = document.getElementById('todayRevenue');
const refreshBtn = document.getElementById('refreshBtn');

const mainTabsEl = document.getElementById('mainTabs');
const pages = {
  orders: document.getElementById('page-orders'),
  menu: document.getElementById('page-menu'),
  settings: document.getElementById('page-settings'),
};

const menuAdminListEl = document.getElementById('menuAdminList');
const addItemBtn = document.getElementById('addItemBtn');
const addCategoryBtn = document.getElementById('addCategoryBtn');

const itemModalOverlay = document.getElementById('itemModalOverlay');
const itemModalTitle = document.getElementById('itemModalTitle');
const itemForm = document.getElementById('itemForm');
const itemCategorySelect = document.getElementById('itemCategorySelect');
const itemNameInput = document.getElementById('itemNameInput');
const pricingModeSeg = document.getElementById('pricingModeSeg');
const singlePriceField = document.getElementById('singlePriceField');
const halfFullFields = document.getElementById('halfFullFields');
const itemPriceInput = document.getElementById('itemPriceInput');
const itemHalfInput = document.getElementById('itemHalfInput');
const itemFullInput = document.getElementById('itemFullInput');
const itemDietSelect = document.getElementById('itemDietSelect');
const itemNoteInput = document.getElementById('itemNoteInput');
const itemModalCancel = document.getElementById('itemModalCancel');

const categoryModalOverlay = document.getElementById('categoryModalOverlay');
const categoryForm = document.getElementById('categoryForm');
const categoryNameInput = document.getElementById('categoryNameInput');
const categoryModalCancel = document.getElementById('categoryModalCancel');

const deliveryToggle = document.getElementById('deliveryToggle');
const helpPhoneInput = document.getElementById('helpPhoneInput');
const helpMessageInput = document.getElementById('helpMessageInput');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const settingsSavedEl = document.getElementById('settingsSaved');

init();

function init() {
  fetchOrders();
  refreshBtn.addEventListener('click', () => {
    fetchOrders();
    if (currentPage() === 'menu') fetchMenu();
    if (currentPage() === 'settings') fetchSettings();
  });

  filterTabsEl.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      activeFilter = tab.dataset.status;
      filterTabsEl.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      renderOrders();
    });
  });

  mainTabsEl.querySelectorAll('.main-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchPage(tab.dataset.page));
  });

  bindMenuAdmin();
  bindSettings();

  // Auto-refresh orders every 20s so new orders show up without manual reload.
  setInterval(fetchOrders, 20000);
}

function currentPage() {
  return mainTabsEl.querySelector('.main-tab.active')?.dataset.page || 'orders';
}

function switchPage(page) {
  mainTabsEl.querySelectorAll('.main-tab').forEach((t) => t.classList.toggle('active', t.dataset.page === page));
  Object.entries(pages).forEach(([key, el]) => { el.hidden = key !== page; });
  if (page === 'menu' && !currentMenu) fetchMenu();
  if (page === 'settings') fetchSettings();
}

// ==================== ORDERS ====================

async function fetchOrders() {
  try {
    const res = await fetch('/api/admin/orders');
    if (res.status === 401) {
      ordersListEl.innerHTML = '<div class="empty">Login galat hai ya expire ho gaya. Page refresh karke dobara login karo.</div>';
      return;
    }
    allOrders = await res.json();
    renderSummary();
    renderOrders();
  } catch (err) {
    ordersListEl.innerHTML = '<div class="empty">Orders load nahi ho paye. Refresh karo.</div>';
  }
}

function isToday(isoString) {
  const d = new Date(isoString);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function renderSummary() {
  const todays = allOrders.filter((o) => isToday(o.createdAt) && o.status !== 'Cancelled');
  todayCountEl.textContent = todays.length;
  todayRevenueEl.textContent = `₹${todays.reduce((s, o) => s + o.total, 0)}`;
}

function renderOrders() {
  const filtered = activeFilter === 'All' ? allOrders : allOrders.filter((o) => o.status === activeFilter);

  if (filtered.length === 0) {
    ordersListEl.innerHTML = '<div class="empty">Is filter mein koi order nahi hai.</div>';
    return;
  }

  ordersListEl.innerHTML = '';
  filtered.forEach((order) => ordersListEl.appendChild(renderOrderCard(order)));
}

function renderOrderCard(order) {
  const card = document.createElement('div');
  card.className = 'order-card';

  const time = new Date(order.createdAt).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  const itemsHtml = order.items
    .map(
      (it) => `<div><span>${it.name}${it.size ? ` (${it.size})` : ''} × ${it.qty}</span><small>₹${it.lineTotal}</small></div>`
    )
    .join('');

  const sourceTag = order.source === 'web' ? ' 🌐' : '';

  card.innerHTML = `
    <div class="order-card-top">
      <div>
        <div class="order-id">#${order.orderId}${sourceTag}</div>
        <div class="order-time">${time}</div>
      </div>
      <span class="status-badge status-${order.status || 'New'}">${order.status || 'New'}</span>
    </div>
    <div class="order-customer">
      <b>${order.customer.name || 'N/A'}</b> · ${order.customer.phone || 'N/A'}${order.customer.phoneVerified ? ' ✅' : ''}<br/>
      ${order.customer.orderType || ''}
      ${order.customer.address ? `<br/>📍 ${order.customer.address}` : ''}
      ${order.customer.notes ? `<br/>📝 ${order.customer.notes}` : ''}
    </div>
    <div class="order-items">${itemsHtml}</div>
    <div class="order-total-row"><span>Total</span><span>₹${order.total}</span></div>
    <div class="status-actions"></div>
  `;

  const actions = card.querySelector('.status-actions');
  STATUSES.forEach((s) => {
    const btn = document.createElement('button');
    btn.className = 'status-btn' + (order.status === s ? ' current' : '');
    btn.textContent = s;
    btn.addEventListener('click', () => updateStatus(order.orderId, s, card));
    actions.appendChild(btn);
  });

  return card;
}

async function updateStatus(orderId, status, card) {
  try {
    const res = await fetch(`/api/admin/orders/${orderId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error('failed');
    const data = await res.json();

    const idx = allOrders.findIndex((o) => o.orderId === orderId);
    if (idx !== -1) allOrders[idx] = data.order;
    renderSummary();
    renderOrders();
  } catch (err) {
    alert('Status update nahi ho paya, dobara try karo.');
  }
}

// ==================== MENU MANAGEMENT ====================

async function fetchMenu() {
  menuAdminListEl.innerHTML = '<div class="loading">Menu load ho raha hai…</div>';
  try {
    const res = await fetch('/api/admin/menu');
    currentMenu = await res.json();
    renderMenuAdmin();
  } catch (err) {
    menuAdminListEl.innerHTML = '<div class="empty">Menu load nahi ho paya.</div>';
  }
}

function renderMenuAdmin() {
  menuAdminListEl.innerHTML = '';
  currentMenu.categories.forEach((cat) => {
    const section = document.createElement('section');
    section.className = 'menu-admin-section';

    const header = document.createElement('div');
    header.className = 'menu-admin-section-header';
    header.innerHTML = `<h2>${cat.name}</h2>`;
    const delCatBtn = document.createElement('button');
    delCatBtn.className = 'text-danger-btn';
    delCatBtn.textContent = 'Delete Category';
    delCatBtn.addEventListener('click', () => deleteCategory(cat.id));
    header.appendChild(delCatBtn);
    section.appendChild(header);

    cat.items.forEach((item) => {
      section.appendChild(renderMenuItemRow(cat, item));
    });

    if (cat.items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'menu-admin-empty';
      empty.textContent = 'Is category mein abhi koi item nahi hai.';
      section.appendChild(empty);
    }

    menuAdminListEl.appendChild(section);
  });
}

function renderMenuItemRow(cat, item) {
  const row = document.createElement('div');
  row.className = 'menu-item-row' + (item.available === false ? ' unavailable' : '');

  const priceText = typeof item.price === 'number'
    ? `₹${item.price}`
    : `₹${item.half} / ₹${item.full}`;

  row.innerHTML = `
    <div class="menu-item-row-main">
      <span class="menu-item-row-name">${item.name}</span>
      <span class="menu-item-row-price">${priceText}${item.note ? ` · ${item.note}` : ''}</span>
    </div>
    <div class="menu-item-row-actions"></div>
  `;

  const actions = row.querySelector('.menu-item-row-actions');

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'toggle-avail-btn' + (item.available === false ? ' is-off' : '');
  toggleBtn.textContent = item.available === false ? 'Unavailable' : 'Available';
  toggleBtn.addEventListener('click', () => toggleAvailability(cat.id, item.id));
  actions.appendChild(toggleBtn);

  const editBtn = document.createElement('button');
  editBtn.className = 'icon-only-btn';
  editBtn.textContent = '✏️';
  editBtn.addEventListener('click', () => openItemModal(cat.id, item));
  actions.appendChild(editBtn);

  const delBtn = document.createElement('button');
  delBtn.className = 'icon-only-btn';
  delBtn.textContent = '🗑️';
  delBtn.addEventListener('click', () => deleteItem(cat.id, item.id));
  actions.appendChild(delBtn);

  return row;
}

async function toggleAvailability(categoryId, itemId) {
  try {
    const res = await fetch(`/api/admin/menu/item/${categoryId}/${itemId}/toggle`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    currentMenu = data.menu;
    renderMenuAdmin();
  } catch (err) {
    alert('Update nahi ho paya.');
  }
}

async function deleteItem(categoryId, itemId) {
  if (!confirm('Yeh item delete karna hai?')) return;
  try {
    const res = await fetch(`/api/admin/menu/item/${categoryId}/${itemId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    currentMenu = data.menu;
    renderMenuAdmin();
  } catch (err) {
    alert('Delete nahi ho paya.');
  }
}

async function deleteCategory(categoryId) {
  if (!confirm('Poori category (aur uske sab items) delete karni hai?')) return;
  try {
    const res = await fetch(`/api/admin/menu/category/${categoryId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    currentMenu = data.menu;
    renderMenuAdmin();
  } catch (err) {
    alert('Delete nahi ho paya.');
  }
}

function closeAllModals() {
  itemModalOverlay.hidden = true;
  categoryModalOverlay.hidden = true;
}

function bindMenuAdmin() {
  addItemBtn.addEventListener('click', () => openItemModal(null, null));
  addCategoryBtn.addEventListener('click', () => {
    closeAllModals();
    categoryNameInput.value = '';
    categoryModalOverlay.hidden = false;
  });
  categoryModalCancel.addEventListener('click', () => { categoryModalOverlay.hidden = true; });
  categoryModalOverlay.addEventListener('click', (e) => {
    if (e.target === categoryModalOverlay) categoryModalOverlay.hidden = true;
  });
  itemModalOverlay.addEventListener('click', (e) => {
    if (e.target === itemModalOverlay) itemModalOverlay.hidden = true;
  });

  categoryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/menu/category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: categoryNameInput.value.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      currentMenu = data.menu;
      renderMenuAdmin();
      categoryModalOverlay.hidden = true;
    } catch (err) {
      alert(err.message || 'Category add nahi ho payi.');
    }
  });

  pricingModeSeg.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      pricingModeSeg.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      const isHalfFull = btn.dataset.mode === 'half_full';
      singlePriceField.hidden = isHalfFull;
      halfFullFields.hidden = !isHalfFull;
    });
  });

  itemModalCancel.addEventListener('click', () => { itemModalOverlay.hidden = true; });

  itemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const isHalfFull = !halfFullFields.hidden;

    const item = {
      id: editingItem?.itemId,
      name: itemNameInput.value.trim(),
      dietType: itemDietSelect.value || null,
      note: itemNoteInput.value.trim() || undefined,
    };
    if (isHalfFull) {
      item.half = Number(itemHalfInput.value) || 0;
      item.full = Number(itemFullInput.value) || 0;
    } else {
      item.price = Number(itemPriceInput.value) || 0;
    }

    try {
      const res = await fetch('/api/admin/menu/item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId: itemCategorySelect.value, item }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      currentMenu = data.menu;
      renderMenuAdmin();
      itemModalOverlay.hidden = true;
    } catch (err) {
      alert(err.message || 'Item save nahi hua.');
    }
  });
}

function openItemModal(categoryId, item) {
  closeAllModals();
  itemCategorySelect.innerHTML = currentMenu.categories
    .map((c) => `<option value="${c.id}">${c.name}</option>`)
    .join('');

  if (item) {
    editingItem = { categoryId, itemId: item.id };
    itemModalTitle.textContent = 'Item Edit Karo';
    itemCategorySelect.value = categoryId;
    itemNameInput.value = item.name;
    itemDietSelect.value = item.dietType || '';
    itemNoteInput.value = item.note || '';
    const isHalfFull = typeof item.half === 'number';
    pricingModeSeg.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('selected', (b.dataset.mode === 'half_full') === isHalfFull);
    });
    singlePriceField.hidden = isHalfFull;
    halfFullFields.hidden = !isHalfFull;
    if (isHalfFull) {
      itemHalfInput.value = item.half;
      itemFullInput.value = item.full;
    } else {
      itemPriceInput.value = item.price;
    }
  } else {
    editingItem = null;
    itemModalTitle.textContent = 'Naya Item';
    itemForm.reset();
    pricingModeSeg.querySelectorAll('.seg-btn').forEach((b, i) => b.classList.toggle('selected', i === 0));
    singlePriceField.hidden = false;
    halfFullFields.hidden = true;
  }

  itemModalOverlay.hidden = false;
}

// ==================== SETTINGS ====================

async function fetchSettings() {
  try {
    const res = await fetch('/api/admin/settings');
    const settings = await res.json();
    deliveryToggle.checked = !!settings.deliveryEnabled;
    helpPhoneInput.value = settings.helpPhone || '';
    helpMessageInput.value = settings.helpMessage || '';
  } catch (err) {
    alert('Settings load nahi hue.');
  }
}

function bindSettings() {
  saveSettingsBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryEnabled: deliveryToggle.checked,
          helpPhone: helpPhoneInput.value.trim(),
          helpMessage: helpMessageInput.value.trim(),
        }),
      });
      if (!res.ok) throw new Error('failed');
      settingsSavedEl.hidden = false;
      setTimeout(() => { settingsSavedEl.hidden = true; }, 2000);
    } catch (err) {
      alert('Save nahi hua, dobara try karo.');
    }
  });
}

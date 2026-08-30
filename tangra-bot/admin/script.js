const STATUSES = ['New', 'Preparing', 'Ready', 'Delivered', 'Cancelled'];

let allOrders = [];
let activeFilter = 'All';

const ordersListEl = document.getElementById('ordersList');
const filterTabsEl = document.getElementById('filterTabs');
const todayCountEl = document.getElementById('todayCount');
const todayRevenueEl = document.getElementById('todayRevenue');
const refreshBtn = document.getElementById('refreshBtn');

init();

function init() {
  fetchOrders();
  refreshBtn.addEventListener('click', fetchOrders);

  filterTabsEl.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      activeFilter = tab.dataset.status;
      filterTabsEl.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      renderOrders();
    });
  });

  // Auto-refresh every 20s so new orders show up without manual reload.
  setInterval(fetchOrders, 20000);
}

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

  card.innerHTML = `
    <div class="order-card-top">
      <div>
        <div class="order-id">#${order.orderId}</div>
        <div class="order-time">${time}</div>
      </div>
      <span class="status-badge status-${order.status || 'New'}">${order.status || 'New'}</span>
    </div>
    <div class="order-customer">
      <b>${order.customer.name || 'N/A'}</b> · ${order.customer.phone || 'N/A'}<br/>
      ${order.customer.orderType || ''}${order.customer.address ? ' — ' + order.customer.address : ''}
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

    // update local cache + re-render just this card
    const idx = allOrders.findIndex((o) => o.orderId === orderId);
    if (idx !== -1) allOrders[idx] = data.order;
    renderSummary();
    renderOrders();
  } catch (err) {
    alert('Status update nahi ho paya, dobara try karo.');
  }
}

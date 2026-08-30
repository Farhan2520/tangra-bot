require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Telegraf, Markup } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!BOT_TOKEN) {
  console.error('ERROR: BOT_TOKEN missing hai. .env file check karo (.env.example dekho).');
  process.exit(1);
}
if (!OWNER_CHAT_ID) {
  console.warn('WARNING: OWNER_CHAT_ID set nahi hai — order notifications kahin nahi jayenge.');
}
if (!PUBLIC_URL) {
  console.warn('WARNING: PUBLIC_URL set nahi hai — Web App button kaam nahi karega jab tak deploy na ho.');
}
if (!ADMIN_PASSWORD) {
  console.warn('WARNING: ADMIN_PASSWORD set nahi hai — /admin dashboard access nahi kar paoge jab tak set na karo.');
}

const VALID_STATUSES = ['New', 'Preparing', 'Ready', 'Delivered', 'Cancelled'];

const MENU_PATH = path.join(__dirname, 'data', 'menu.json');
const ORDERS_PATH = path.join(__dirname, 'data', 'orders.json');

function loadMenu() {
  return JSON.parse(fs.readFileSync(MENU_PATH, 'utf8'));
}

function loadOrders() {
  if (!fs.existsSync(ORDERS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function saveOrder(order) {
  const orders = loadOrders();
  orders.push(order);
  fs.writeFileSync(ORDERS_PATH, JSON.stringify(orders, null, 2));
}

function updateOrderStatus(orderId, status) {
  const orders = loadOrders();
  const order = orders.find((o) => o.orderId === orderId);
  if (!order) return null;
  order.status = status;
  order.statusUpdatedAt = new Date().toISOString();
  fs.writeFileSync(ORDERS_PATH, JSON.stringify(orders, null, 2));
  return order;
}

// Simple HTTP Basic Auth guard for the admin dashboard + its API.
// Good enough for a single-owner small-business tool; not meant for
// multi-user/team access control.
function basicAuth(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).send('Admin password configure nahi hui hai (ADMIN_PASSWORD env var set karo).');
  }
  const header = req.headers.authorization || '';
  if (header.startsWith('Basic ')) {
    const [user, pass] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
    if (user === ADMIN_USER && pass === ADMIN_PASSWORD) {
      return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="Tangra Admin"');
  return res.status(401).send('Login required.');
}

// Build a lookup of every sellable item (id -> canonical name/price info) so
// we never trust client-supplied prices blindly — always recompute server-side.
function buildItemIndex(menu) {
  const index = {};
  for (const cat of menu.categories) {
    for (const item of cat.items) {
      index[item.id] = { ...item, category: cat.name };
    }
  }
  return index;
}

function priceFor(item, size) {
  if (typeof item.price === 'number') return item.price;
  if (size === 'full' && typeof item.full === 'number') return item.full;
  if (typeof item.half === 'number') return item.half;
  return 0;
}

function formatOrderText(order) {
  const lines = order.items.map((it) => {
    const sizeLabel = it.size ? ` (${it.size})` : '';
    return `• ${it.name}${sizeLabel} × ${it.qty} — ₹${it.lineTotal}`;
  });
  return [
    `🧾 Order #${order.orderId}`,
    `👤 ${order.customer.name || 'N/A'}  📞 ${order.customer.phone || 'N/A'}`,
    `🚚 ${order.customer.orderType || 'N/A'}${order.customer.address ? ' — ' + order.customer.address : ''}`,
    order.customer.notes ? `📝 ${order.customer.notes}` : null,
    '',
    ...lines,
    '',
    `💰 Total: ₹${order.total}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  const webAppUrl = PUBLIC_URL ? `${PUBLIC_URL}/webapp` : null;
  const menu = loadMenu();

  const introText =
    `🥡 *${menu.restaurant.name}*\n` +
    `${menu.restaurant.tagline}\n\n` +
    `Order karne ke liye niche button dabao 👇`;

  if (webAppUrl) {
    return ctx.replyWithMarkdown(
      introText,
      Markup.keyboard([Markup.button.webApp('🍜 Order Now', webAppUrl)]).resize()
    );
  }
  return ctx.replyWithMarkdown(
    introText + '\n\n⚠️ Web App abhi configure nahi hui (PUBLIC_URL missing).'
  );
});

bot.help((ctx) => {
  ctx.reply(
    'Order karne ke liye /start bhejo aur "Order Now" button dabao.\n' +
      'Koi dikkat ho to seedha yahan message karo, hum dekh lenge.'
  );
});

// Handle data sent back from the Mini App when customer taps "Place Order"
bot.on('web_app_data', async (ctx) => {
  let payload;
  try {
    payload = JSON.parse(ctx.webAppData.data);
  } catch (err) {
    return ctx.reply('⚠️ Order padhne mein dikkat aayi, dobara try karo.');
  }

  const menu = loadMenu();
  const itemIndex = buildItemIndex(menu);

  if (!Array.isArray(payload.cart) || payload.cart.length === 0) {
    return ctx.reply('⚠️ Cart khali hai, kuch items add karke dobara try karo.');
  }

  // Recompute every line item and the total from menu.json — never trust the
  // client's numbers directly, in case of tampering or stale prices.
  const items = [];
  let total = 0;
  for (const line of payload.cart) {
    const item = itemIndex[line.id];
    if (!item) continue; // unknown id, skip silently
    const qty = Math.max(1, parseInt(line.qty, 10) || 1);
    const unit = priceFor(item, line.size);
    const lineTotal = unit * qty;
    total += lineTotal;
    items.push({ id: item.id, name: item.name, size: line.size || null, qty, unit, lineTotal });
  }

  if (items.length === 0) {
    return ctx.reply('⚠️ Order mein koi valid item nahi mila, dobara try karo.');
  }

  const order = {
    orderId: Date.now().toString(36).toUpperCase(),
    createdAt: new Date().toISOString(),
    telegramUserId: ctx.from.id,
    telegramUsername: ctx.from.username || null,
    customer: {
      name: payload.customer?.name || ctx.from.first_name || '',
      phone: payload.customer?.phone || '',
      orderType: payload.customer?.orderType || '',
      address: payload.customer?.address || '',
      notes: payload.customer?.notes || '',
    },
    items,
    total,
    status: 'New',
  };

  saveOrder(order);

  const summaryText = formatOrderText(order);

  await ctx.reply(
    `✅ Order mil gaya, dhanyavaad!\n\n${summaryText}\n\nHum jaldi confirm karenge.`
  );

  if (OWNER_CHAT_ID) {
    try {
      await ctx.telegram.sendMessage(OWNER_CHAT_ID, `🔔 Naya Order!\n\n${summaryText}`);
    } catch (err) {
      console.error('Owner ko notify karne mein error:', err.message);
    }
  }
});

bot.catch((err, ctx) => {
  console.error(`Bot error for ${ctx.updateType}:`, err);
});

// --- Express server: serves the Mini App static files + a menu API ---
const app = express();
app.use(express.json());
app.use('/webapp', express.static(path.join(__dirname, 'webapp')));

app.get('/api/menu', (req, res) => {
  res.json(loadMenu());
});

// --- Admin dashboard (password-protected) ---
app.use('/admin', basicAuth, express.static(path.join(__dirname, 'admin')));

app.get('/api/admin/orders', basicAuth, (req, res) => {
  const orders = loadOrders().slice().reverse(); // newest first
  res.json(orders);
});

app.post('/api/admin/orders/:orderId/status', basicAuth, async (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body || {};

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  const order = updateOrderStatus(orderId, status);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  // Best-effort: let the customer know their order status changed.
  try {
    await bot.telegram.sendMessage(
      order.telegramUserId,
      `📦 Order #${order.orderId} update: *${status}*`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Customer ko status update bhejne mein error:', err.message);
  }

  res.json({ ok: true, order });
});

app.get('/', (req, res) => {
  res.send('Tangra Square bot is running. Open the Telegram bot and tap "Order Now".');
});

app.listen(PORT, () => {
  console.log(`Web server chal raha hai port ${PORT} par`);
  bot.launch().then(() => console.log('Telegram bot polling shuru ho gaya ✅'));
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

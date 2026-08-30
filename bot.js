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
const CONTACTS_PATH = path.join(__dirname, 'data', 'contacts.json');
const SETTINGS_PATH = path.join(__dirname, 'data', 'settings.json');

const DEFAULT_SETTINGS = {
  deliveryEnabled: false,
  helpPhone: '',
  helpMessage: 'Kisi bhi order ya query ke liye call/WhatsApp karo.',
};

function loadMenu() {
  return JSON.parse(fs.readFileSync(MENU_PATH, 'utf8'));
}

function saveMenu(menu) {
  fs.writeFileSync(MENU_PATH, JSON.stringify(menu, null, 2));
}

function loadOrders() {
  if (!fs.existsSync(ORDERS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function loadContacts() {
  if (!fs.existsSync(CONTACTS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONTACTS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function loadSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// Telegram's "request_contact" keyboard button only ever lets a user share
// their OWN account's phone number — Telegram enforces this, so once we
// receive it here it's a verified number, not something the user typed in.
function saveVerifiedContact(telegramUserId, phone) {
  const contacts = loadContacts();
  contacts[telegramUserId] = { phone, verifiedAt: new Date().toISOString() };
  fs.writeFileSync(CONTACTS_PATH, JSON.stringify(contacts, null, 2));
}

function saveOrder(order) {
  const orders = loadOrders();
  orders.push(order);
  fs.writeFileSync(ORDERS_PATH, JSON.stringify(orders, null, 2));
  return order;
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
  const verifiedTag = order.customer.phoneVerified ? ' ✅' : '';
  const sourceTag = order.source === 'web' ? ' 🌐' : '';
  return [
    `🧾 Order #${order.orderId}${sourceTag}`,
    `👤 ${order.customer.name || 'N/A'}  📞 ${order.customer.phone || 'N/A'}${verifiedTag}`,
    `🍽️ ${order.customer.orderType || 'N/A'}`,
    order.customer.address ? `📍 ${order.customer.address}` : null,
    order.customer.notes ? `📝 ${order.customer.notes}` : null,
    '',
    ...lines,
    '',
    `💰 Total: ₹${order.total}`,
  ]
    .filter(Boolean)
    .join('\n');
}

// Shared order-building logic used by both the Telegram web_app_data handler
// and the plain-web /api/orders endpoint (for QR/no-Telegram customers).
function buildOrderFromPayload(payload, { telegramUserId, telegramUsername, source }) {
  const menu = loadMenu();
  const itemIndex = buildItemIndex(menu);

  if (!Array.isArray(payload.cart) || payload.cart.length === 0) {
    return { error: 'Cart khali hai, kuch items add karke dobara try karo.' };
  }

  const items = [];
  let total = 0;
  for (const line of payload.cart) {
    const item = itemIndex[line.id];
    if (!item || item.available === false) continue; // unknown/unavailable id, skip silently
    const qty = Math.max(1, parseInt(line.qty, 10) || 1);
    const unit = priceFor(item, line.size);
    const lineTotal = unit * qty;
    total += lineTotal;
    items.push({ id: item.id, name: item.name, size: line.size || null, qty, unit, lineTotal });
  }

  if (items.length === 0) {
    return { error: 'Order mein koi valid item nahi mila, dobara try karo.' };
  }

  const contacts = loadContacts();
  const verified = telegramUserId ? contacts[telegramUserId] : null;
  const phone = verified?.phone || payload.customer?.phone || '';

  const order = {
    orderId: Date.now().toString(36).toUpperCase(),
    createdAt: new Date().toISOString(),
    source: source || 'telegram',
    telegramUserId: telegramUserId || null,
    telegramUsername: telegramUsername || null,
    customer: {
      name: payload.customer?.name || '',
      phone,
      phoneVerified: !!verified,
      orderType: payload.customer?.orderType || '',
      address: payload.customer?.address || '',
      notes: payload.customer?.notes || '',
    },
    items,
    total,
    status: 'New',
  };

  return { order };
}

const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  const webAppUrl = PUBLIC_URL ? `${PUBLIC_URL}/webapp` : null;
  const menu = loadMenu();
  const contacts = loadContacts();
  const isVerified = !!contacts[ctx.from.id];

  const introText =
    `🥡 *${menu.restaurant.name}*\n` +
    `${menu.restaurant.tagline}\n\n` +
    (isVerified
      ? `Order karne ke liye niche button dabao 👇`
      : `Order karne se pehle apna number verify kar lo (ek baar), fir order karo 👇`);

  const rows = [];
  if (webAppUrl) rows.push([Markup.button.webApp('🍜 Order Now', webAppUrl)]);
  if (!isVerified) rows.push([Markup.button.contactRequest('📱 Share & Verify My Number')]);

  if (rows.length === 0) {
    return ctx.replyWithMarkdown(introText + '\n\n⚠️ Web App abhi configure nahi hui (PUBLIC_URL missing).');
  }
  return ctx.replyWithMarkdown(introText, Markup.keyboard(rows).resize());
});

bot.help((ctx) => {
  const settings = loadSettings();
  const helpLine = settings.helpPhone
    ? `\n\n📞 Help/Contact: ${settings.helpPhone}${settings.helpMessage ? ` — ${settings.helpMessage}` : ''}`
    : '';
  ctx.reply(
    'Order karne ke liye /start bhejo, apna number verify karo (ek baar), aur "Order Now" button dabao.\n' +
      'Apne purane orders "My Orders" section mein (Order Now ke andar) dekh sakte ho.' +
      helpLine
  );
});

// Telegram guarantees this contact belongs to the sender's own account.
bot.on('message', async (ctx, next) => {
  if (ctx.message?.contact) {
    const contact = ctx.message.contact;
    if (contact.user_id && contact.user_id !== ctx.from.id) {
      return ctx.reply('⚠️ Sirf apna khud ka number share kar sakte ho.');
    }
    saveVerifiedContact(ctx.from.id, contact.phone_number);
    return ctx.reply(
      `✅ Number verify ho gaya: ${contact.phone_number}\n\nAb "Order Now" dabao aur order karo.`,
      Markup.keyboard([
        Markup.button.webApp('🍜 Order Now', PUBLIC_URL ? `${PUBLIC_URL}/webapp` : '#'),
      ]).resize()
    );
  }
  return next();
});

// Handle data sent back from the Mini App when customer taps "Place Order"
bot.on('web_app_data', async (ctx) => {
  let payload;
  try {
    payload = JSON.parse(ctx.webAppData.data);
  } catch (err) {
    return ctx.reply('⚠️ Order padhne mein dikkat aayi, dobara try karo.');
  }

  const result = buildOrderFromPayload(payload, {
    telegramUserId: ctx.from.id,
    telegramUsername: ctx.from.username || null,
    source: 'telegram',
  });

  if (result.error) return ctx.reply(`⚠️ ${result.error}`);

  const order = result.order;
  if (!order.customer.name) order.customer.name = ctx.from.first_name || '';
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

app.get('/api/settings', (req, res) => {
  const { deliveryEnabled, helpPhone, helpMessage } = loadSettings();
  res.json({ deliveryEnabled, helpPhone, helpMessage });
});

app.get('/api/verified-phone/:tgUserId', (req, res) => {
  const contacts = loadContacts();
  const entry = contacts[req.params.tgUserId];
  res.json(entry ? { phone: entry.phone } : { phone: null });
});

// "My Orders" — Telegram users lookup by their tgUserId, QR/web users (no
// Telegram) lookup by the phone number they used at checkout.
app.get('/api/my-orders', (req, res) => {
  const { tgUserId, phone } = req.query;
  const orders = loadOrders();
  let mine = [];
  if (tgUserId) {
    mine = orders.filter((o) => String(o.telegramUserId) === String(tgUserId));
  } else if (phone) {
    const cleanPhone = String(phone).replace(/\D/g, '');
    mine = orders.filter((o) => (o.customer.phone || '').replace(/\D/g, '') === cleanPhone);
  }
  res.json(mine.slice().reverse());
});

// Plain-web order placement — for customers who scan the QR code and don't
// have Telegram at all. Same validation/pricing logic as the bot path.
app.post('/api/orders', async (req, res) => {
  const result = buildOrderFromPayload(req.body || {}, { source: 'web' });
  if (result.error) return res.status(400).json({ error: result.error });

  const order = saveOrder(result.order);
  res.json({ ok: true, order, summary: formatOrderText(order) });

  if (OWNER_CHAT_ID) {
    try {
      await bot.telegram.sendMessage(OWNER_CHAT_ID, `🔔 Naya Order! (Web/QR)\n\n${formatOrderText(order)}`);
    } catch (err) {
      console.error('Owner ko notify karne mein error:', err.message);
    }
  }
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

  // Best-effort: let the customer know their order status changed (only
  // possible for Telegram orders — web/QR orders have no chat to message).
  if (order.telegramUserId) {
    try {
      await bot.telegram.sendMessage(
        order.telegramUserId,
        `📦 Order #${order.orderId} update: *${status}*`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.error('Customer ko status update bhejne mein error:', err.message);
    }
  }

  res.json({ ok: true, order });
});

// --- Admin: menu management (add/edit/delete items, toggle availability) ---
app.get('/api/admin/menu', basicAuth, (req, res) => {
  res.json(loadMenu());
});

app.post('/api/admin/menu/category', basicAuth, (req, res) => {
  const { name, priceType } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Category name chahiye.' });

  const menu = loadMenu();
  const id = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `cat${Date.now()}`;
  if (menu.categories.some((c) => c.id === id)) {
    return res.status(400).json({ error: 'Is naam ki category pehle se hai.' });
  }
  menu.categories.push({ id, name, priceType: priceType || 'single', items: [] });
  saveMenu(menu);
  res.json({ ok: true, menu });
});

app.delete('/api/admin/menu/category/:categoryId', basicAuth, (req, res) => {
  const menu = loadMenu();
  const before = menu.categories.length;
  menu.categories = menu.categories.filter((c) => c.id !== req.params.categoryId);
  if (menu.categories.length === before) return res.status(404).json({ error: 'Category nahi mili.' });
  saveMenu(menu);
  res.json({ ok: true, menu });
});

// Add a new item, or update an existing one if item.id matches one already
// present in that category.
app.post('/api/admin/menu/item', basicAuth, (req, res) => {
  const { categoryId, item } = req.body || {};
  if (!categoryId || !item || !item.name) {
    return res.status(400).json({ error: 'categoryId aur item.name chahiye.' });
  }

  const menu = loadMenu();
  const cat = menu.categories.find((c) => c.id === categoryId);
  if (!cat) return res.status(404).json({ error: 'Category nahi mili.' });

  const hasHalfFull = typeof item.half === 'number' && typeof item.full === 'number';
  const cleanItem = {
    name: item.name,
    dietType: item.dietType || null,
    available: item.available !== false,
  };
  if (hasHalfFull) {
    cleanItem.half = item.half;
    cleanItem.full = item.full;
  } else {
    cleanItem.price = typeof item.price === 'number' ? item.price : 0;
  }
  if (item.note) cleanItem.note = item.note;

  if (item.id) {
    const existing = cat.items.find((it) => it.id === item.id);
    if (existing) {
      Object.assign(existing, cleanItem);
      saveMenu(menu);
      return res.json({ ok: true, menu });
    }
  }

  const newId = item.id || `${categoryId.slice(0, 2)}${Date.now().toString(36)}`;
  cat.items.push({ id: newId, ...cleanItem });
  saveMenu(menu);
  res.json({ ok: true, menu });
});

app.delete('/api/admin/menu/item/:categoryId/:itemId', basicAuth, (req, res) => {
  const menu = loadMenu();
  const cat = menu.categories.find((c) => c.id === req.params.categoryId);
  if (!cat) return res.status(404).json({ error: 'Category nahi mili.' });
  const before = cat.items.length;
  cat.items = cat.items.filter((it) => it.id !== req.params.itemId);
  if (cat.items.length === before) return res.status(404).json({ error: 'Item nahi mila.' });
  saveMenu(menu);
  res.json({ ok: true, menu });
});

app.post('/api/admin/menu/item/:categoryId/:itemId/toggle', basicAuth, (req, res) => {
  const menu = loadMenu();
  const cat = menu.categories.find((c) => c.id === req.params.categoryId);
  const item = cat?.items.find((it) => it.id === req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Item nahi mila.' });
  item.available = !item.available;
  saveMenu(menu);
  res.json({ ok: true, menu });
});

// --- Admin: settings (home delivery toggle, help contact number) ---
app.get('/api/admin/settings', basicAuth, (req, res) => {
  res.json(loadSettings());
});

app.post('/api/admin/settings', basicAuth, (req, res) => {
  const current = loadSettings();
  const { deliveryEnabled, helpPhone, helpMessage } = req.body || {};
  const updated = {
    deliveryEnabled: typeof deliveryEnabled === 'boolean' ? deliveryEnabled : current.deliveryEnabled,
    helpPhone: typeof helpPhone === 'string' ? helpPhone : current.helpPhone,
    helpMessage: typeof helpMessage === 'string' ? helpMessage : current.helpMessage,
  };
  saveSettings(updated);
  res.json({ ok: true, settings: updated });
});

app.get('/', (req, res) => {
  res.send('Tangra Square bot is running. Open the Telegram bot and tap "Order Now", or scan the table QR code.');
});

app.listen(PORT, () => {
  console.log(`Web server chal raha hai port ${PORT} par`);
  bot.launch().then(() => console.log('Telegram bot polling shuru ho gaya ✅'));
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

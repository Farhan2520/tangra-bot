# Tangra Square — Telegram Order Bot (Mini App)

## 📌 Sabse pehle: exactly kya karna hai (7 steps, TL;DR)

1. **@BotFather** ko Telegram pe message karo → `/newbot` → token milega.
2. **@userinfobot** ko message karo → tumhara chat ID milega.
3. Yeh poora folder GitHub pe push karo.
4. **render.com** pe free account banao → New → Web Service → apna GitHub repo select karo. Build: `npm install`, Start: `npm start`.
5. Render ke Environment tab mein `BOT_TOKEN`, `OWNER_CHAT_ID`, `ADMIN_USER`, `ADMIN_PASSWORD` daalo.
6. Deploy hone ke baad jo URL mile (jaise `xyz.onrender.com`), usko `PUBLIC_URL` env variable mein bhi daalo aur service restart karo. **(Koi domain kharidne ki zaroorat nahi — yeh free URL hi kaafi hai.)**
7. @BotFather → `/mybots` → apna bot → Menu Button → URL do: `https://xyz.onrender.com/webapp`

Bas. Ab Telegram mein apne bot ko `/start` bhejo — order button aa jayega.

Neeche detail mein poora explain kiya hai, ek-ek step ka.

---

Yeh ek Telegram bot hai jisme "Order Now" button dabate hi ek **Mini App** (Web App)
khulti hai — poora menu, cart, aur checkout form. Order place hote hi:
1. Customer ko confirmation milta hai bot mein.
2. Owner (aap) ko notification milta hai poore order details ke saath.
3. Order `data/orders.json` file mein save ho jaata hai (history ke liye).

---

## 1. Bot banao (BotFather)

1. Telegram mein **@BotFather** ko message karo.
2. `/newbot` bhejo, naam aur username do (username `_bot` se end hona chahiye).
3. Jo **token** milega, wo copy kar lo — isko `BOT_TOKEN` mein daalna hai.

## 2. Apna Telegram Chat ID nikalo (order notifications ke liye)

1. **@userinfobot** ko koi bhi message bhejo.
2. Wo aapka numeric **ID** bhejega — isko `OWNER_CHAT_ID` mein daalna hai.

## 3. Files setup karo

1. Is poore folder ko apne computer/server pe rakho.
2. `.env.example` ko copy karke `.env` banao:
   ```bash
   cp .env.example .env
   ```
3. `.env` file kholo aur fill karo:
   ```
   BOT_TOKEN=<BotFather wala token>
   OWNER_CHAT_ID=<apna chat id>
   PUBLIC_URL=<step 5 ke baad milega, abhi khali chhodo ya placeholder rakho>
   PORT=3000
   ```

## 4. Menu edit karna (zaroori check)

`data/menu.json` mein poora menu already bhara hua hai (aapki dono photos se).
Agar koi item/price change karna ho, seedha yeh file edit kar do — bot aur
webapp dono isi file se data lete hain, dusri jagah kuch change nahi karna
padta.

⚠️ **Important**: Menu photo se jo prices maine padhe hain wo double-check
kar lena ek baar khud bhi — kahin OCR jaisi galti na ho.

## 5. Deploy karo (free — Render.com use karke)

Bot ko 24x7 chalu rakhne ke liye kisi server pe deploy karna hoga. Sabse
aasaan free option **Render.com**:

1. Is folder ko GitHub repo mein push karo.
2. [render.com](https://render.com) pe account banao → **New → Web Service**.
3. Apna GitHub repo select karo.
4. Settings:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. **Environment Variables** section mein `.env` wali values daal do
   (`BOT_TOKEN`, `OWNER_CHAT_ID`) — `PORT` Render khud set kar dega.
6. Deploy hone ke baad Render ek URL dega, jaise:
   `https://tangra-square-bot.onrender.com`
7. Isko `PUBLIC_URL` env variable mein daal do (Render dashboard mein hi
   update kar sakte ho) aur service ko **restart** kar do.

> Railway.app, Fly.io, ya apna VPS bhi use kar sakte ho — process same hai:
> Node app deploy karo, env vars set karo, aur jo public HTTPS URL milega
> wo `PUBLIC_URL` mein daal do.

## 6. BotFather mein Web App set karo

Telegram Web Apps ko **HTTPS** chahiye hi hoti hai (jo Render apne aap deta
hai), toh local testing ke alawa yeh step deploy ke baad hi karo:

1. @BotFather ko `/mybots` bhejo → apna bot select karo.
2. **Bot Settings → Menu Button** → **Configure Menu Button**.
3. URL do: `https://<PUBLIC_URL>/webapp`
4. Button text: `Order Now` (ya jo chaho).

Isse ek permanent menu button bhi ban jayega bot ke chat window mein, upar
"Order Now" button ke alawa.

## 7. Admin Dashboard (orders dekhne aur status update karne ke liye)

Deploy hone ke baad yahan jao:

```
https://<PUBLIC_URL>/admin
```

Browser ek login popup dikhayega — `.env` mein diya hua `ADMIN_USER` /
`ADMIN_PASSWORD` daalo. Dashboard mein milega:

- **Today's Orders / Today's Revenue** summary
- Sabhi orders ki list (naya sabse upar), filter by status
- Har order pe status change karne ke buttons: **New → Preparing → Ready →
  Delivered** (ya **Cancelled**)
- Jab bhi status change karo, customer ko automatically Telegram pe
  update chala jaata hai ("Order #XXX update: Ready" jaisa message)

⚠️ Yeh simple HTTP login hai (ek hi owner/staff ke liye) — team ke multiple
logins ya roles ke liye isko baad mein extend karna padega.

## 8. Local pe test karna (optional, deploy se pehle)

```bash
npm install
npm start
```

Bot polling shuru ho jayega. Web App ke liye HTTPS chahiye, toh local test
ke liye **ngrok** jaisa tool use karo:

```bash
ngrok http 3000
```

Jo `https://xxxx.ngrok-free.app` URL mile, usko temporarily `PUBLIC_URL`
mein daal ke bot restart karo, phir Telegram mein `/start` bhejo.

---

## Project structure

```
tangra-bot/
├── bot.js              # Bot logic + Express server (single deployable service)
├── data/
│   ├── menu.json       # Poora menu — yahi file edit karo prices/items ke liye
│   └── orders.json     # Auto-generate hoti hai, saare orders yahan save hote hain
├── webapp/
│   ├── index.html      # Customer-facing Mini App UI (menu + cart + checkout)
│   ├── style.css
│   └── script.js
├── admin/
│   ├── index.html      # Owner-facing dashboard (orders + status)
│   ├── style.css
│   └── script.js
├── package.json
└── .env.example
```

## Aage badhane ke liye ideas (abhi included nahi hai)

- **Payment**: Abhi order sirf place hota hai (COD jaisa) — UPI/Razorpay
  integration baad mein add ho sakta hai jab decide kar lo.
- **Order status updates**: Owner ko "Accept/Reject" inline buttons dena.
- **Order history for customer**: `/myorders` command.
- **Telegram initData verification**: Abhi customer ka Telegram data
  (`initDataUnsafe`) bina cryptographic verify kiye use ho raha hai — chhote
  scale ke liye theek hai, lekin production-grade security ke liye
  `initData` ka hash verify karna chahiye (Telegram docs: Validating data
  received via the Mini App).

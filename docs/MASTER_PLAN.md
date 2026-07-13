# MASTER_PLAN — UltimateArbitrageHFT (Hermes + Copilot)

العربية: خطة واضحة لتحليل وتنفيذ المتبقي من المشروع. مرجع مشترك لـ Hermes (محلي) و Copilot (GitHub Actions).

## 1. Frontend (React / Cloudflare Pages)
**الوضع:** الواجهة الحيّة = `App.js` + `components/Dashboard.js` (REST/axios → api.ecostamp.net).
`App.jsx` + `pages/*` + `Layout.jsx` = كود ميت (تبعيات ناقصة: react-router-dom, framer-motion, lucide-react, recharts).
**مشكلة حرجة:** صفحة `/login` ترجّع لنفسها بعد إدخال التوكن (SPA redirect معطوب).
**خطوات:**
1. إصلاح `Login.js`: أكمل استخدام `setToken` (حالياً unused) + توجيه صحيح لـ `/control-panel` بعد النجاح.
2. تحقق من `lib/api.js`: `setToken` يخزّن التوكن في cookie/localStorage والـ Dashboard يقرأه.
3. حذف `App.jsx`/`pages/` الميتة من البناء (أو دمجها لاحقاً بخطة منفصلة).
4. إعادة نشر Pages بعد الإصلاح.

## 2. Backend (Cloudflare Worker / index.js)
**الوضع:** منشور `1e7d48ef`. ثغرة أمنية مُصلحة (ADMIN_TOKEN guard). أداء مُحسّن (Promise.any, balance:null).
**خطوات:**
1. مراجعة endpoints المتبقية: `/opportunities` يرد 404 (يحتاج alias مثل `/api/scan`).
2. توحيد أسماء endpoints بين backend (`/api/*`) والـ frontend الجديد (`/bot/*` في App.jsx الميت).
3. kill-switch: تفعيل كامل (hard/soft) قبل Live mode.
4. فحص `src/infra/security.js` (المحدّث) ضد ثغرات.

## 3. Database (Cloudflare D1)
**الوضع:** D1 مع جداول عبر `ensureSchema`. snapshots في `db.js`.
**خطوات:**
1. فحص schema: جداول `blobs`, `paper_positions`, `balances`, `trades`.
2. التأكد من parameterized queries (لا string concat) — تم التحقق سابقاً ✅.
3. نسخ احتياطي دوري (cron job).

## 4. Proxy & 24/7 (مكتمل تقريباً)
- ✅ gw.ecostamp.net (cloudflared tunnel) + gateway :8080 + self-healing.
- ⏳ توصيل proxy01 كـ upstream اختياري (لـ KuCoin/Binance geo-block).

## 5. الإطلاق (Live Mode) — محجوب حتى موافقتك
- Paper أسبوع ← Live برأس مال صغير.
- kill-switch مفعل + مراقبة 24/7.

## الأولويات
1. 🔴 إصلاح الدخول للوحة (Frontend #1)
2. 🟠 /opportunities 404 (Backend #1)
3. 🟡 حذف الكود الميت + إعادة نشر
4. 🟢 proxy01 upstream
5. ⚪ Live mode (بعد الموافقة)

## التنسيق (Hermes ↔ Copilot)
- Hermes: تعديلات محلية + دفع لـ main.
- Copilot: مراجعة PRs + تنظيف + workflows (Telegram handoff مفعّل).
- كل تغيير كبير = PR + مراجعة متبادلة.

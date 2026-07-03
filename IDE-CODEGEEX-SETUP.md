# تكامل CodeGeeX المحلي مع IDE

## VS Code - تكوين الامتداد

### الخطوة 1: تثبيت الامتداد
1. انقر على **Extensions** (Ctrl+Shift+X)
2. ابحث عن **CodeGeeX**
3. ثبّت الامتداد الرسمي من Zhipu AI

[رابط المتجر](https://marketplace.visualstudio.com/items?itemName=aminer.codegeex)

### الخطوة 2: تفعيل الوضع المحلي
1. اذهب إلى **Settings** (Ctrl+,)
2. ابحث عن **CodeGeeX**
3. فعّل **Local Mode** (ضع علامة على المربع)

### الخطوة 3: إدخال عنوان API المحلي
1. ابقَ في إعدادات CodeGeeX
2. ابحث عن **API URL** أو **Local Endpoint**
3. أدخل: `http://127.0.0.1:8000`
4. ابحث عن **Model Name** أو **Model ID**
5. أدخل: `codegeex4`

### الخطوة 4: اختبر الاتصال
```json
{
  "codegeex.localMode": true,
  "codegeex.apiUrl": "http://127.0.0.1:8000",
  "codegeex.modelName": "codegeex4",
  "codegeex.temperature": 0.3,
  "codegeex.maxTokens": 256
}
```

أضف هذه الإعدادات إلى `.vscode/settings.json` في جذر المشروع

---

## JetBrains (IntelliJ IDEA, PyCharm, WebStorm)

### الخطوة 1: تثبيت الامتداد
1. اذهب إلى **Preferences/Settings** → **Plugins**
2. ابحث عن **CodeGeeX**
3. ثبّت امتداد CodeGeeX

[رابط المتجر](https://plugins.jetbrains.com/plugin/20587-codegeex)

### الخطوة 2: تكوين نقطة النهاية
1. اذهب إلى **Preferences/Settings** → **Tools** → **CodeGeeX**
2. اختر **Local Mode**
3. في **API Endpoint**، أدخل: `http://127.0.0.1:8000`
4. في **Model Name**، أدخل: `codegeex4`

### الخطوة 3: احفظ وأعد تشغيل
- اضغط **Apply** ثم **OK**
- أعد تشغيل IDE
- استخدم اختصار CodeGeeX (عادة **Ctrl+\\** أو **Cmd+\\**)

---

## اختبار التكامل

### اختبار سريع في VS Code:
```javascript
// اكتب هذا التعليق ثم استدعِ CodeGeeX
// function calculateArbitrage(prices) {
//   // CodeGeeX سيكمل هنا
```

1. اكتب التعليق أعلاه
2. اضغط **Ctrl+Alt+\\** (أو الاختصار المخصص)
3. CodeGeeX المحلي سيولد الكود

### اختبار سريع في JetBrains:
1. ضع المؤشر بعد سطر التعليق
2. اضغط **Ctrl+\\** (اختصار CodeGeeX)
3. اختر من القائمة: **CodeGeeX Completion**
4. انتظر النتيجة (قد تستغرق 30-60 ثانية على CPU)

---

## استكشاف الأخطاء

### ❌ "Connection refused"
- تأكد من أن خادم CodeGeeX يعمل:
```powershell
.\start-codegeex-server.ps1
```
- تحقق من أن Ollama يعمل أيضاً

### ❌ "Model not found"
- تأكد من اسم النموذج: `codegeex4`
- تحقق من أن النموذج مثبت:
```powershell
ollama list
```

### ❌ "Timeout"
- الكمبيوتر بطيء؟ استخدم 60-90 ثانية كحد أدنى
- استخدم نموذج أصغر إذا كان متاحاً:
```
THUDM/codegeex4-all-1b
```

### ❌ "Invalid API key"
- في الوضع المحلي، لا تحتاج إلى مفتاح API
- تأكد من أن **Local Mode** مفعّل
- امسح ملفات التخزين المؤقت واستأنف

---

## الأداء المتوقع

| البيئة | الزمن | التكلفة | الملاحظات |
|---|---|---|---|
| **Windows CPU** | 60-180 ثانية | 0 $ | جيد للتطوير |
| **NVIDIA GPU** | 3-10 ثواني | 0 $ | ممتاز للاختبار السريع |
| **Cloudflare Workers** | 0.5-1 ثانية | متغير | الأفضل للإنتاج |

---

## نصائح متقدمة

### استخدام متغيرات البيئة:
```powershell
# Windows
$env:CODEGEEX_API_URL = "http://127.0.0.1:8000"
$env:CODEGEEX_MODEL = "codegeex4"

# Linux/macOS
export CODEGEEX_API_URL="http://127.0.0.1:8000"
export CODEGEEX_MODEL="codegeex4"
```

### التبديل بين الأوضاع:
- **للتطوير المحلي:** الوضع المحلي (مجاني، أبطأ)
- **للاختبار المكثف:** Ollama GPU إن أمكن
- **للإنتاج:** Cloudflare Workers (سريع، آمن)

---

## الخطوات التالية

1. ✓ شغّل خادم CodeGeeX المحلي
2. ✓ ثبّت امتداد IDE
3. ✓ كوّن نقطة النهاية المحلية
4. **اختبر الكمال:** اكتب تعليق واستدعِ CodeGeeX
5. استخدم في تطويرك اليومي!

---

## الدعم والمراجع

- **الموقع الرسمي:** https://codegeex.ai/
- **GitHub:** https://github.com/THUDM/CodeGeeX4
- **البرنامج التعليمي الرسمي:** https://zhipu-ai.feishu.cn/wiki/space/7304237817729810433
- **الوثيقة المحلية:** [CODEGEEX-SETUP.md](CODEGEEX-SETUP.md)

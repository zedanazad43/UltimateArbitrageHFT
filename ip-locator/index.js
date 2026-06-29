// index.js - كاشف عنوان IP لبوت المراجحة (يدعم IPv4 و IPv6)
export default {
    async fetch(request, env) {
        // 1. جلب عنوان IPv4
        let ipv4 = 'غير متاح';
        try {
            const res = await fetch('https://api.ipify.org?format=json');
            const data = await res.json();
            ipv4 = data.ip;
        } catch (e) {
            console.error('IPv4 fetch error:', e);
        }

        // 2. جلب عنوان IPv6 (للمعلومية)
        let ipv6 = 'غير متاح';
        try {
            const res = await fetch('https://api6.ipify.org?format=json');
            const data = await res.json();
            ipv6 = data.ip;
        } catch (e) {
            console.error('IPv6 fetch error:', e);
        }

        // 3. معلومات إضافية
        const colo = request.cf?.colo || 'غير معروف';
        const city = request.cf?.city || 'غير معروف';
        const country = request.cf?.country || 'غير معروف';

        // 4. إنشاء صفحة HTML بالعربية
        const html = `
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>كاشف عنوان IP - بوت المراجحة</title>
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, sans-serif;
                    background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
                    color: white;
                    padding: 20px;
                    min-height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                }
                .card {
                    background: rgba(255,255,255,0.1);
                    backdrop-filter: blur(10px);
                    border-radius: 24px;
                    padding: 30px;
                    max-width: 650px;
                    margin: auto;
                    text-align: center;
                }
                h1 { margin-bottom: 20px; font-size: 24px; }
                .ip-box {
                    background: rgba(0,0,0,0.5);
                    padding: 15px;
                    border-radius: 12px;
                    margin: 20px 0;
                    direction: ltr;
                    text-align: center;
                }
                .ip-value {
                    font-size: 28px;
                    font-weight: bold;
                    color: #00cec9;
                    font-family: monospace;
                    word-break: break-all;
                }
                .instruction {
                    background: rgba(0,0,0,0.3);
                    padding: 15px;
                    border-radius: 12px;
                    margin: 20px 0;
                    text-align: right;
                }
                .instruction ol, .instruction ul {
                    margin-right: 20px;
                    margin-top: 10px;
                    text-align: right;
                }
                .instruction li { margin: 10px 0; line-height: 1.6; }
                .copy-btn {
                    background: #00b894;
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 10px;
                    cursor: pointer;
                    font-size: 14px;
                    margin-top: 10px;
                }
                .copy-btn:hover { opacity: 0.8; }
                .note {
                    font-size: 12px;
                    opacity: 0.7;
                    margin-top: 20px;
                }
                code {
                    background: rgba(0,0,0,0.5);
                    padding: 4px 8px;
                    border-radius: 6px;
                    font-family: monospace;
                }
                .info-row {
                    display: flex;
                    justify-content: space-between;
                    margin: 8px 0;
                    font-size: 14px;
                }
                hr { border-color: rgba(255,255,255,0.2); margin: 15px 0; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>📍 كاشف عنوان IP لبوت المراجحة</h1>
                
                <div class="ip-box">
                    <div style="margin-bottom: 10px;">🌐 <strong>عنوان IPv4 (الذي سيراه KuCoin):</strong></div>
                    <div class="ip-value" id="ipv4">${ipv4}</div>
                    <button class="copy-btn" onclick="copyToClipboard('ipv4')">📋 نسخ عنوان IPv4</button>
                </div>
                
                <div class="ip-box">
                    <div style="margin-bottom: 10px;">🪐 <strong>عنوان IPv6 (للمعلومية فقط):</strong></div>
                    <div class="ip-value" style="font-size: 18px;">${ipv6}</div>
                </div>
                
                <div class="instruction">
                    <strong>📌 تعليمات مهمة:</strong>
                    <ol>
                        <li>انسخ عنوان <strong>IPv4</strong> أعلاه (<code>${ipv4}</code>)</li>
                        <li>اذهب إلى إعدادات API في حساب <strong>KuCoin</strong></li>
                        <li>أضف هذا العنوان إلى قائمة <strong>"IP Whitelist"</strong> (عناوين IP المسموح بها)</li>
                        <li>تأكد من إدخال العنوان بالضبط بدون أي مسافات إضافية</li>
                    </ol>
                </div>
                
                <div class="instruction">
                    <strong>ℹ️ معلومات إضافية:</strong>
                    <div class="info-row"><span>📍 مركز البيانات (Colo):</span> <code>${colo}</code></div>
                    <div class="info-row"><span>🏙️ المدينة:</span> <code>${city}</code></div>
                    <div class="info-row"><span>🇩🇪 الدولة:</span> <code>${country}</code></div>
                    <div class="info-row"><span>⏰ الوقت:</span> <code>${new Date().toLocaleString('ar-EG')}</code></div>
                </div>
                
                <div class="note">
                    ⚠️ <strong>ملاحظة:</strong> إذا توقف البوت عن العمل لاحقاً، قد يكون عنوان IP قد تغير (نادراً). أعد زيارة هذه الصفحة للحصول على العنوان الجديد وأضفه إلى KuCoin مرة أخرى.
                </div>
            </div>
            
            <script>
                function copyToClipboard(type) {
                    const ip = document.getElementById(type).innerText;
                    navigator.clipboard.writeText(ip).then(() => {
                        alert('✅ تم نسخ العنوان: ' + ip);
                    }).catch(() => {
                        alert('❌ فشل النسخ، يمكنك نسخه يدوياً');
                    });
                }
            </script>
        </body>
        </html>
        `;

        return new Response(html, {
            headers: { "Content-Type": "text/html; charset=UTF-8" }
        });
    }
};
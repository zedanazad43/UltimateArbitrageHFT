// ip-locator.js – كاشف عنوان IP الخاص بـ Cloudflare Worker
export default {
    async fetch(request, env) {
        // طريقة موثوقة للحصول على IP العام للـ Worker
        const ipResponse = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipResponse.json();
        const workerIp = ipData.ip;

        // الحصول على كود مركز البيانات (colo) – اختياري
        const colo = request.cf?.colo || 'غير معروف';

        const html = `
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>كاشف عنوان IP لبوت Bitmart</title>
            <style>
                body {
                    font-family: system-ui, 'Segoe UI', Tahoma, sans-serif;
                    background: #0f0c29;
                    color: white;
                    padding: 20px;
                    text-align: center;
                }
                .container {
                    max-width: 600px;
                    margin: 0 auto;
                    background: rgba(255,255,255,0.1);
                    border-radius: 20px;
                    padding: 30px;
                }
                code {
                    background: #000;
                    padding: 12px 20px;
                    display: inline-block;
                    font-size: 24px;
                    font-weight: bold;
                    border-radius: 12px;
                    margin: 20px 0;
                    direction: ltr;
                }
                .note {
                    background: rgba(255,255,255,0.2);
                    padding: 15px;
                    border-radius: 12px;
                    margin-top: 20px;
                    font-size: 14px;
                }
                button {
                    background: #00b894;
                    border: none;
                    color: white;
                    padding: 10px 20px;
                    border-radius: 10px;
                    cursor: pointer;
                    font-size: 16px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>📍 عنوان IP الخاص بـ Cloudflare Worker</h1>
                <p>انسخ هذا العنوان وأضفه إلى قائمة <strong>IP Whitelist</strong> في إعدادات API الخاصة بـ Bitmart:</p>
                <code id="ip">${workerIp}</code>
                <br>
                <button onclick="copyToClipboard()">📋 نسخ العنوان</button>
                <div class="note">
                    <strong>ℹ️ معلومات إضافية:</strong><br>
                    مركز البيانات (Colo): ${colo}<br>
                    الوقت: ${new Date().toLocaleString('ar-EG')}
                </div>
                <div class="note">
                    ⚠️ بعد إضافة هذا العنوان في Bitmart، انتظر دقيقة ثم أعد تشغيل البوت (أو افتح رابط <code>/run</code>).
                </div>
            </div>
            <script>
                function copyToClipboard() {
                    const ip = document.getElementById('ip').innerText;
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
            headers: { 'Content-Type': 'text/html; charset=UTF-8' }
        });
    }
};
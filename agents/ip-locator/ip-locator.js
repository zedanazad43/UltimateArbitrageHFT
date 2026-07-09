// ip-locator.js - كشف عنوان IP الخاص بـ Cloudflare Worker
export default {
    async fetch(request, _env) {
        // استخدام API مخصص لجلب عنوان IP للـ Worker نفسه
        // ملاحظة: هذا يعمل من داخل بيئة Worker ويعيد الـ IP الذي يستخدمه للاتصال بالخارج
        const ipResponse = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipResponse.json();
        
        // الحصول على كود مركز البيانات (colo)
        const colo = request.cf?.colo || 'غير معروف';
        
        // إرجاع المعلومات بشكل منسق
        const html = `
        <!DOCTYPE html>
        <html>
        <head><title>IP Locator for Arbitrage Bot</title></head>
        <body style="font-family: monospace; padding: 20px;">
            <h1>📍 معلومات عنوان IP لبوت المراجحة</h1>
            <p><strong>عنوان IP الذي سيراه KuCoin:</strong> <code style="background: #f0f0f0; padding: 8px; display: inline-block;">${ipData.ip}</code></p>
            <p><strong>مركز البيانات (Colo):</strong> ${colo}</p>
            <p><strong>التاريخ والوقت:</strong> ${new Date().toLocaleString()}</p>
            <hr>
            <p>⚠️ <strong>تعليمات مهمة:</strong><br>
            1. انسخ عنوان IP أعلاه (<code>${ipData.ip}</code>)<br>
            2. اذهب إلى إعدادات API في حساب KuCoin<br>
            3. أضف هذا العنوان إلى قائمة "IP Whitelist" (عناوين IP المسموح بها)<br>
            4. تأكد من أنك تستخدم هذا العنوان بالضبط (لا تضف نطاقات CIDR)</p>
            <p>✅ بعد إضافة هذا العنوان إلى KuCoin، سيعمل البوت بشكل طبيعي.</p>
        </body>
        </html>
        `;
        
        return new Response(html, {
            headers: { "Content-Type": "text/html" }
        });
    }
};
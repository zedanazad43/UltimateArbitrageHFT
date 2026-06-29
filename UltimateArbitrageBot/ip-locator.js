// ip-locator.js
export default {
    async fetch(request, env) {
        // جلب عنوان IPv4 الخاص بالـ Worker
        const ipResponse = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipResponse.json();
        
        // جلب عنوان IPv6 أيضاً للمقارنة
        const ipv6Response = await fetch('https://api6.ipify.org?format=json');
        const ipv6Data = await ipv6Response.json();
        
        const html = `
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>عنوان IP لبوت المراجحة</title>
        </head>
        <body>
            <h1>📍 عنوان IP الذي سيراه KuCoin</h1>
            <p><strong>عنوان IPv4 (أضف هذا إلى KuCoin):</strong> <code>${ipData.ip}</code></p>
            <p><strong>عنوان IPv6 الخاص بك (للمعلومية):</strong> <code>${ipv6Data.ip}</code></p>
            <p>⚠️ أضف عنوان IPv4 فقط إلى القائمة البيضاء في KuCoin.</p>
        </body>
        </html>`;
        
        return new Response(html, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
    }
};
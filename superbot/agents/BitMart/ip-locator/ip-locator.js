// ip-locator.js
export default {
    async fetch(request) {
        const ip = request.headers.get('CF-Connecting-IP');
        const colo = request.cf?.colo || 'unknown';
        return new Response(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><title>IP Locator</title></head>
        <body>
            <h1>📍 عنوان IP الخاص بـ Cloudflare Worker</h1>
            <p><strong>أضف هذا IP إلى القائمة البيضاء في Bitget و Bitmart:</strong></p>
            <code style="font-size:24px;background:#f0f0f0;padding:10px;display:inline-block">${ip}</code>
            <p><strong>مركز البيانات:</strong> ${colo}</p>
            <p>⚠️ قد يكون هناك عدة عناوين IP. إذا لم ينجح هذا، قد تحتاج إلى إضافة النطاق <code>100.64.0.0/10</code> (Cloudflare WARP).</p>
        </body>
        </html>
        `, { headers: { 'Content-Type': 'text/html' } });
    }
};
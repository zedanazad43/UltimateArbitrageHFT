export default {
    async fetch(request) {
        let ip = request.headers.get('CF-Connecting-IP');
        if (!ip) {
            const res = await fetch('https://api.ipify.org?format=json');
            const data = await res.json();
            ip = data.ip;
        }
        return new Response(ip);
    }
};

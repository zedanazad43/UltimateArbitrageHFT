export default {
    async fetch(request) {
        const ip = request.headers.get('CF-Connecting-IP');
        return new Response(ip);
    }
};
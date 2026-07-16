import { Hono } from 'hono';
const app = new Hono();
app.get('/rocket-verify', (c) => c.json({
  name: 'Rocket HFT', version: '3.0.0', status: 'operational',
  timestamp: new Date().toISOString(), features: ['minimal-deploy']
}));
app.get('/', (c) => c.text('Rocket HFT minimal Worker is running'));
export default app;

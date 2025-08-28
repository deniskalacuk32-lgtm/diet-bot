import 'dotenv/config';
import express from 'express';

const app = express();
app.use(express.json());

// простое логирование всех запросов
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

// корень — на всякий случай
app.get('/', (_req, res) => {
  res.type('text').send('OK /');
});

// health-check (два варианта пути)
app.get('/health', (_req, res) => {
  res.json({ ok: true, path: '/health' });
});
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, path: '/healthz' });
});

// тестовый чат
app.post('/diet-chat', (req, res) => {
  const { user_id, text } = req.body || {};
  res.json({ message: `Привет, ${user_id}! Ты написал: ${text}` });
});

// отладочный catch-all (покажет какой путь пришёл)
app.use((req, res) => {
  res.status(404).type('text').send(`No route for: ${req.method} ${req.path}`);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server running on port ${port}`));


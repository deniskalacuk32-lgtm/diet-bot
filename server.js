import 'dotenv/config';
import express from 'express';

const app = express();
app.use(express.json());

// Корневой маршрут
app.get('/', (req, res) => {
  res.json({ ok: true, message: 'Diet Bot API is running' });
});

// Проверка
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Тестовый чат
app.post('/diet-chat', (req, res) => {
  const { user_id, text } = req.body || {};
  res.json({ message: `Привет, ${user_id || 'user'}! Ты написал: ${text || ''}` });
});

// 404 — если путь не найден
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not Found' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server running on port ${port}`));




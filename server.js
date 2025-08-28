import 'dotenv/config';
import express from 'express';

const app = express();
app.use(express.json());

// Проверка: жив ли сервер
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Простой чат-эндпоинт (для теста)
app.post('/diet-chat', (req, res) => {
  const { user_id, text } = req.body;
  res.json({ message: `Привет, ${user_id}! Ты написал: ${text}` });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server running on port ${port}`));

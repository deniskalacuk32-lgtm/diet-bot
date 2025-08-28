import 'dotenv/config';
import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json({ limit: '25mb' }));

// --- корень/проверка ---
app.get('/', (_, res) => res.json({ ok: true, message: 'Diet Bot API is running' }));
app.get('/health', (_, res) => res.json({ ok: true }));

// --- системный промт диетолога ---
const SYSTEM_PROMPT = `
Ты — персональный диетолог-нутрициолог. Отвечай кратко, дружелюбно и по делу.
Учитывай цель пользователя (похудение/поддержание), давай практичные советы.
Если спрашивают про меню — предложи 3–5 вариантов с примерной калорийностью и Б/Ж/У.
Если не уверен — явно укажи, что оценка приблизительная и попроси уточнения.
`;

// --- помощник для чата OpenAI ---
async function dietChatReply(userText) {
  const r = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4o',
    temperature: 0.3,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userText }
    ]
  }, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
  return r.data.choices[0]?.message?.content?.trim() || 'Извини, не удалось сформировать ответ.';
}

// --- эндпоинт чата (Salesbot/тесты) ---
app.post('/diet-chat', async (req, res) => {
  try {
    const { user_id, text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text_required' });
    const reply = await dietChatReply(text);
    // На MVP просто возвращаем текст (позже добавим память, лимиты, оплату)
    res.json({ user_id, message: reply });
  } catch (e) {
    console.error('diet-chat error', e?.response?.data || e.message);
    res.status(500).json({ error: 'chat_failed' });
  }
});

// --- 404 ---
app.use((req, res) => res.status(404).json({ ok: false, error: 'Not Found' }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server running on port ${port}`));






import 'dotenv/config';
import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json({ limit: '25mb' }));

// --- базовые маршруты ---
app.get('/', (_, res) => res.json({ ok: true, message: 'Diet Bot API is running' }));
app.get('/health', (_, res) => res.json({ ok: true }));

// --- тестовая HTML-страница, чтобы проверять без Postman ---
app.get('/test', (_, res) => {
  res.send(`<!doctype html><meta charset="utf-8">
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;max-width:900px;margin:auto}
    textarea,input,button{font-size:16px}
    textarea{width:100%;height:140px}
    pre{background:#111;color:#0f0;padding:12px;border-radius:8px;white-space:pre-wrap}
    .row{margin:12px 0}
  </style>
  <h1>Diet Bot — /diet-chat tester</h1>
  <div class="row"><label>User ID: <input id="uid" value="webtest"></label></div>
  <div class="row"><textarea id="t">Мне 34 года, цель -5 кг. Какие 3 варианта завтрака посоветуешь?</textarea></div>
  <div class="row"><button onclick="send()">Отправить</button></div>
  <pre id="out"></pre>
  <script>
    async function send(){
      const body = { user_id: document.querySelector('#uid').value, text: document.querySelector('#t').value };
      const r = await fetch('/diet-chat', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const j = await r.json();
      document.querySelector('#out').textContent = JSON.stringify(j, null, 2);
    }
  </script>`);
});

// --- системный промт диетолога ---
const SYSTEM_PROMPT = `
Ты — персональный диетолог-нутрициолог. Отвечай кратко, дружелюбно и по делу.
Если просят меню — дай 3–5 вариантов с примерной калорийностью и Б/Ж/У.
Если не уверен — укажи, что оценка приблизительная, и что для точности нужна масса/рецепт.
`;

// --- запрос к OpenAI ---
async function dietChatReply(userText) {
  const r = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o',
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userText }
      ]
    },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
  );
  return r.data?.choices?.[0]?.message?.content?.trim() || 'Не удалось сформировать ответ.';
}

// --- основной эндпоинт для Salesbot/тестов ---
app.post('/diet-chat', async (req, res) => {
  try {
    const { user_id, text } = req.body || {};
    if (!text) return res.status(400).json({ ok: false, error: 'text_required' });
    const reply = await dietChatReply(text);
    res.json({ ok: true, user_id, message: reply });
  } catch (e) {
    console.error('diet-chat error:', e?.response?.data || e.message);
    res.status(500).json({ ok: false, error: 'chat_failed' });
  }
});

// --- 404 на прочие пути ---
app.use((_, res) => res.status(404).json({ ok: false, error: 'Not Found' }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server running on ${port}`));







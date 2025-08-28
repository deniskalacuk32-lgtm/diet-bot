import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import FormData from 'form-data';
import Database from 'better-sqlite3';

const app = express();
app.use(express.json({ limit: '25mb' }));

/* ---------- БАЗА (память пользователя) ---------- */
const db = new Database('./bot.db');
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  user_id TEXT PRIMARY KEY,
  is_paid INTEGER DEFAULT 0,
  free_left INTEGER DEFAULT 10,
  paid_until TEXT,
  profile_json TEXT,
  summary TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  dt TEXT DEFAULT (datetime('now')),
  role TEXT,
  text TEXT
);
CREATE TABLE IF NOT EXISTS meals(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  dt TEXT DEFAULT (datetime('now')),
  source TEXT,
  item_json TEXT,
  kcal INTEGER,
  b REAL, j REAL, u REAL
);
`);

const getUser = (id) => {
  let u = db.prepare('SELECT * FROM users WHERE user_id=?').get(id);
  if (!u) {
    db.prepare('INSERT INTO users(user_id) VALUES(?)').run(id);
    u = db.prepare('SELECT * FROM users WHERE user_id=?').get(id);
  }
  return u;
};
const setProfile = (id, p) =>
  db.prepare('UPDATE users SET profile_json=? WHERE user_id=?').run(JSON.stringify(p), id);
const setPaid = (id) =>
  db.prepare('UPDATE users SET is_paid=1, free_left=99999 WHERE user_id=?').run(id);
const decFree = (id) =>
  db.prepare('UPDATE users SET free_left=MAX(free_left-1,0) WHERE user_id=?').run(id);
const saveMsg = (id, role, text) =>
  db.prepare('INSERT INTO messages(user_id, role, text) VALUES(?,?,?)').run(id, role, text);
const lastMsgs = (id, n = 10) =>
  db.prepare('SELECT role, text FROM messages WHERE user_id=? ORDER BY id DESC LIMIT ?')
    .all(id, n)
    .reverse();
const saveMeal = (id, obj) =>
  db.prepare('INSERT INTO meals(user_id, source, item_json, kcal, b, j, u) VALUES(?,?,?,?,?,?,?)')
    .run(id, 'photo', JSON.stringify(obj.raw || {}), obj.kcal || 0, obj.b || 0, obj.j || 0, obj.u || 0);

/* ---------- ЛОГИ ---------- */
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

/* ---------- Константы и промпты ---------- */
const SYSTEM_PROMPT = `
Ты — персональный диетолог-нутрициолог. Отвечай кратко и по делу, дружелюбно.
Всегда учитывай профиль клиента (пол, возраст, рост, вес, цель, активность, аллергии/запреты, предпочтения).
Фото: оценивай ПРИБЛИЗИТЕЛЬНУЮ массу, калории и БЖУ; дай 1–2 практичных совета.
Идеи меню: 3–5 вариантов под целевую калорийность с ~ккал и Б/Ж/У.
Если не уверен — так и пиши. Никаких опасных рекомендаций.
Форматируй списками.
`;
const IMAGE_PROMPT = `
Определи продукты на фото и оцени примерную массу.
Верни СТРОГО JSON (без лишнего текста):
{
  "items":[{"name":"...", "portion_g":число, "kcal":число, "b":число, "j":число, "u":число}],
  "total":{"kcal":число,"b":число,"j":число,"u":число},
  "advice":"1–2 предложения с практичным советом"
}
Если блюд несколько — каждый в items; если сомневаешься — отметь это в advice.
`;

/* ---------- OpenAI helpers ---------- */
const openaiHeaders = { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` };

async function chatOpenAI(messages, temperature = 0.3) {
  const r = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    { model: 'gpt-4o', temperature, messages },
    { headers: openaiHeaders }
  );
  return r.data.choices[0].message.content.trim();
}

async function visionAnalyze(imageUrlOrData) {
  const r = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: IMAGE_PROMPT },
            { type: 'image_url', image_url: { url: imageUrlOrData } }
          ]
        }
      ]
    },
    { headers: openaiHeaders }
  );
  return JSON.parse(r.data.choices[0].message.content);
}

async function whisperTranscribe(audioBuffer) {
  const form = new FormData();
  form.append('file', audioBuffer, { filename: 'audio.ogg' });
  form.append('model', 'whisper-1');
  const r = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
    headers: { ...openaiHeaders, ...form.getHeaders() }
  });
  return r.data.text;
}

/* ---------- Вспомогательная логика ---------- */
const PAYWALL =
  'Бесплатный лимит исчерпан. Оформи подписку — и я продолжу разборы, подсчёт ккал и персональные меню 👇';
const gate = (u) => u.is_paid || u.free_left > 0;

function buildContext(u) {
  const profile = u.profile_json ? JSON.parse(u.profile_json) : {};
  const memory = u.summary || '';
  const msgs = lastMsgs(u.user_id, 10);
  return {
    context: `ПРОФИЛЬ: ${JSON.stringify(profile)}${memory ? `\nКРАТКАЯ ВЫЖИМКА: ${memory}` : ''}`,
    msgs
  };
}

async function maybeUpdateSummary(user_id) {
  const cnt = db.prepare('SELECT COUNT(*) c FROM messages WHERE user_id=?').get(user_id).c;
  if (cnt % 15 !== 0) return;
  const history = db
    .prepare('SELECT role, text FROM messages WHERE user_id=? ORDER BY id DESC LIMIT 50')
    .all(user_id);
  const sum = await chatOpenAI(
    [
      { role: 'system', content: 'Ты помощник. Сожми факты о клиенте для диетолога.' },
      {
        role: 'user',
        content: `История: ${JSON.stringify(
          history
        )}. Дай 3–6 строк: цель, запреты/аллергии, предпочтения, что мотивирует.`
      }
    ],
    0.2
  );
  db.prepare('UPDATE users SET summary=? WHERE user_id=?').run(sum, user_id);
}

/* ---------- Технические эндпоинты ---------- */
app.get('/', (_req, res) => res.type('text').send('OK /'));
app.get('/health', (_req, res) => res.json({ ok: true, path: '/health' }));
app.get('/healthz', (_req, res) => res.json({ ok: true, path: '/healthz' }));

/* ---------- Бизнес-эндпоинты ---------- */
app.post('/update-profile', (req, res) => {
  const { user_id, profile } = req.body || {};
  if (!user_id || !profile) return res.status(400).json({ error: 'bad_request' });
  getUser(user_id);
  setProfile(user_id, profile);
  return res.json({ ok: true });
});

app.post('/diet-chat', async (req, res) => {
  try {
    const { user_id, text } = req.body || {};
    const u = getUser(user_id);
    if (!gate(u)) return res.json({ paywall: true, message: PAYWALL });

    saveMsg(user_id, 'user', text);
    const { context, msgs } = buildContext(u);
    const reply = await chatOpenAI(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Контекст клиента:\n${context}\n\nВопрос: ${text}` },
        ...msgs.map((m) => ({ role: m.role, content: m.text }))
      ],
      0.3
    );
    saveMsg(user_id, 'assistant', reply);
    if (!u.is_paid) decFree(user_id);
    await maybeUpdateSummary(user_id);
    res.json({ paywall: false, message: reply });
  } catch {
    res.status(500).json({ error: 'chat_failed' });
  }
});

app.post('/analyze-photo', async (req, res) => {
  try {
    const { user_id, image } = req.body || {};
    const u = getUser(user_id);
    if (!gate(u)) return res.json({ paywall: true, message: PAYWALL });

    const result = await visionAnalyze(image);
    const total = result.total || { kcal: 0, b: 0, j: 0, u: 0 };
    saveMeal(user_id, { kcal: total.kcal, b: total.b, j: total.j, u: total.u, raw: result });

    const text = [
      'Разбор блюда(ов):',
      ...(result.items || []).map(
        (it, i) =>
          `${i + 1}) ${it.name}: ~${it.portion_g || '?'} г — ${it.kcal || '?'} ккал (Б ${
            it.b || '?'
          } / Ж ${it.j || '?'} / У ${it.u || '?'})`
      ),
      `ИТОГО: ${total.kcal || '?'} ккал (Б ${total.b || '?'} / Ж ${total.j || '?'} / У ${
        total.u || '?'
      })`,
      `Совет: ${result.advice || '—'}`
    ].join('\n');

    saveMsg(user_id, 'user', '[Фото еды]');
    saveMsg(user_id, 'assistant', text);
    if (!u.is_paid) decFree(user_id);
    await maybeUpdateSummary(user_id);
    res.json({ paywall: false, message: text, total });
  } catch {
    res.status(500).json({ error: 'image_failed' });
  }
});

app.post('/analyze-voice', async (req, res) => {
  try {
    const { user_id, audio_base64 } = req.body || {};
    const u = getUser(user_id);
    if (!gate(u)) return res.json({ paywall: true, message: PAYWALL });

    const buf = Buffer.from(audio_base64, 'base64');
    const transcript = await whisperTranscribe(buf);
    saveMsg(user_id, 'user', `[Голос → текст]: ${transcript}`);

    const { context, msgs } = buildContext(u);
    const reply = await chatOpenAI(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Контекст клиента:\n${context}\n\nСообщение (текст): ${transcript}` },
        ...msgs.map((m) => ({ role: m.role, content: m.text }))
      ],
      0.3
    );

    saveMsg(user_id, 'assistant', reply);
    if (!u.is_paid) decFree(user_id);
    await maybeUpdateSummary(user_id);
    res.json({ paywall: false, message: reply, transcript });
  } catch {
    res.status(500).json({ error: 'voice_failed' });
  }
});

app.post('/suggest-meals', async (req, res) => {
  try {
    const { user_id, type = 'breakfast' } = req.body || {};
    const map = { breakfast: 'завтраков', lunch: 'обедов', snack: 'перекусов' };
    const u = getUser(user_id);
    if (!gate(u)) return res.json({ paywall: true, message: PAYWALL });

    const { context, msgs } = buildContext(u);
    const ask = `Дай 3–5 идей ${map[type] || 'блюд'} под цель калорий клиента. Для каждой: название, ~ккал, Б/Ж/У, очень короткий рецепт.`;
    const reply = await chatOpenAI(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Контекст клиента:\n${context}\n\n${ask}` },
        ...msgs.map((m) => ({ role: m.role, content: m.text }))
      ],
      0.4
    );

    saveMsg(user_id, 'user', `[Запрос идей: ${type}]`);
    saveMsg(user_id, 'assistant', reply);
    if (!u.is_paid) decFree(user_id);
    await maybeUpdateSummary(user_id);
    res.json({ paywall: false, message: reply });
  } catch {
    res.status(500).json({ error: 'suggest_failed' });
  }
});

app.post('/payment-confirm', (req, res) => {
  const { user_id, payment_status } = req.body || {};
  if (payment_status === 'success') {
    setPaid(user_id);
    return res.json({ ok: true });
  }
  res.json({ ok: false });
});

/* ---------- CATCH-ALL 404 ---------- */
app.use((req, res) => {
  res.status(404).type('text').send(`No route for: ${req.method} ${req.path}`);
});

/* ---------- START ---------- */
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server running on port ${port}`));







import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import composeVideoRouter from './routes/compose-video';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

// ── Middleware ──────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// ── Routes ──────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/compose-video', composeVideoRouter);

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Adify backend listening on http://localhost:${PORT}`);
});

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleExtractWorksheetHttpRequest } from './src/server/pdfWorksheetHandler';
import {
  generateSequentialPpicReport,
  handleAiChatPayload,
} from './src/server/aiHandlers';
import { sendJson } from './src/server/vercelHttp';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();

function getPort(): number {
  const portArgIdx = process.argv.indexOf('--port');
  if (portArgIdx !== -1 && process.argv[portArgIdx + 1]) {
    const parsed = parseInt(process.argv[portArgIdx + 1], 10);
    if (!isNaN(parsed)) return parsed;
  }
  return process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
}

function getHost(): string {
  const hostArgIdx = process.argv.indexOf('--host');
  if (hostArgIdx !== -1 && process.argv[hostArgIdx + 1] && !process.argv[hostArgIdx + 1].startsWith('-')) {
    return process.argv[hostArgIdx + 1];
  }
  return process.env.HOST || '0.0.0.0';
}

const PORT = getPort();
const HOST = getHost();

app.use(express.json({ limit: '25mb' }));

// Endpoint for 3-Step Sequential Pipeline
app.post('/api/ai/sequential-workflow', async (req, res) => {
  try {
    const { contextData } = req.body || {};
    const report = generateSequentialPpicReport(contextData);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint for PDF Worksheet Extraction (JSON base64, multipart/form-data, & binary PDF)
app.all('/api/pdf/extract-worksheet', async (req, res) => {
  try {
    const result = await handleExtractWorksheetHttpRequest(req);
    sendJson(res, result.status, result.body);
  } catch (err: any) {
    console.error('Error in /api/pdf/extract-worksheet:', err);
    sendJson(res, 500, {
      success: false,
      error: `Terjadi kesalahan internal saat memproses PDF: ${err?.message || 'Internal error'}`,
    });
  }
});

// Endpoint for General AI Chat
app.post('/api/ai/chat', async (req, res) => {
  try {
    const result = await handleAiChatPayload(req.body || {});
    return res.status(result.status).json(result.body);
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Terjadi kesalahan internal pada endpoint AI chat.',
    });
  }
});

// Ensure unknown /api routes ALWAYS return JSON (never fall through to SPA/Vite HTML or plain text 404)
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: `Endpoint API ${req.method} ${req.originalUrl} tidak ditemukan.`,
  });
});

// Structured JSON error middleware for /api (handles payload too large 413, malformed JSON 400, and 5xx)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.path.startsWith('/api')) {
    if (err?.type === 'entity.too.large' || err?.status === 413) {
      return res.status(413).json({
        success: false,
        error: 'Ukuran berkas PDF terlalu besar untuk diproses (maksimal 25MB). Silakan kompres PDF terlebih dahulu.',
      });
    }
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({
        success: false,
        error: 'Format payload JSON ke server tidak valid.',
      });
    }
    return res.status(err?.status || 500).json({
      success: false,
      error: err?.message || 'Terjadi kesalahan internal pada server API.',
    });
  }
  return next(err);
});

// Development with Vite vs Production setup
async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`  ➜  Local:   http://localhost:${PORT}/`);
    console.log(`  ➜  Network: http://${HOST}:${PORT}/`);
    console.log(`PPIC System running on http://${HOST}:${PORT}`);
  });

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((err) => {
  console.error('Failed to start PPIC server:', err);
  process.exit(1);
});

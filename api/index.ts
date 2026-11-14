import { handleExtractWorksheetHttpRequest } from '../src/server/pdfWorksheetHandler';
import {
  generateSequentialPpicReport,
  handleAiChatPayload,
} from '../src/server/aiHandlers';
import {
  HttpPayloadError,
  readParsedRequestBody,
  sendJson,
  type VercelLikeRequest,
  type VercelLikeResponse,
} from '../src/server/vercelHttp';

function resolveApiPathname(req: VercelLikeRequest): string {
  const rawUrl = (req.url || '/api').split('?')[0];
  if (rawUrl && rawUrl !== '/api' && rawUrl !== '/api/index') {
    return rawUrl;
  }
  const queryPath = req.query?.path;
  if (typeof queryPath === 'string' && queryPath.trim()) {
    return `/api/${queryPath.replace(/^\/+/, '')}`;
  }
  if (Array.isArray(queryPath) && queryPath.length > 0) {
    return `/api/${queryPath.join('/').replace(/^\/+/, '')}`;
  }
  return rawUrl || '/api';
}

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    res.end();
    return;
  }

  const pathname = resolveApiPathname(req);

  if (pathname === '/api/pdf/extract-worksheet') {
    const result = await handleExtractWorksheetHttpRequest(req);
    sendJson(res, result.status, result.body);
    return;
  }

  if (pathname === '/api/ai/chat') {
    if (req.method !== 'POST') {
      sendJson(res, 405, {
        success: false,
        error: `Metode ${req.method || 'UNKNOWN'} tidak diizinkan untuk /api/ai/chat. Gunakan POST.`,
      });
      return;
    }
    try {
      const { parsedBody } = await readParsedRequestBody(req);
      const result = await handleAiChatPayload(parsedBody || {});
      sendJson(res, result.status, result.body);
    } catch (err: any) {
      if (err instanceof HttpPayloadError) {
        sendJson(res, err.statusCode, { success: false, error: err.message });
        return;
      }
      sendJson(res, 500, {
        success: false,
        error: err?.message || 'Terjadi kesalahan internal pada endpoint AI chat.',
      });
    }
    return;
  }

  if (pathname === '/api/ai/sequential-workflow') {
    if (req.method !== 'POST') {
      sendJson(res, 405, {
        success: false,
        error: `Metode ${req.method || 'UNKNOWN'} tidak diizinkan untuk /api/ai/sequential-workflow. Gunakan POST.`,
      });
      return;
    }
    try {
      const { parsedBody } = await readParsedRequestBody(req);
      const report = generateSequentialPpicReport(parsedBody?.contextData);
      sendJson(res, 200, report);
    } catch (err: any) {
      if (err instanceof HttpPayloadError) {
        sendJson(res, err.statusCode, { success: false, error: err.message });
        return;
      }
      sendJson(res, 500, {
        success: false,
        error: err?.message || 'Terjadi kesalahan internal pada sequential workflow.',
      });
    }
    return;
  }

  sendJson(res, 404, {
    success: false,
    error: `Endpoint API ${req.method || 'GET'} ${pathname} tidak ditemukan.`,
  });
}

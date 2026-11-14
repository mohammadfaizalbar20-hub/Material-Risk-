import { generateSequentialPpicReport } from '../../src/server/aiHandlers';
import {
  HttpPayloadError,
  readParsedRequestBody,
  sendJson,
  type VercelLikeRequest,
  type VercelLikeResponse,
} from '../../src/server/vercelHttp';

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Allow', 'POST, OPTIONS');
    res.end();
    return;
  }

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
}

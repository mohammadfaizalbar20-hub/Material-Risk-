import { handleExtractWorksheetHttpRequest } from '../../src/server/pdfWorksheetHandler';
import {
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

  try {
    const result = await handleExtractWorksheetHttpRequest(req);
    sendJson(res, result.status, result.body);
  } catch (err: any) {
    console.error('Unhandled error in api/pdf/extract-worksheet:', err);
    sendJson(res, 500, {
      success: false,
      error: `Terjadi kesalahan internal saat memproses PDF: ${err?.message || 'Internal error'}`,
    });
  }
}

import type { IncomingMessage, ServerResponse } from 'http';

export const MAX_PDF_PAYLOAD_BYTES = 25 * 1024 * 1024; // 25MB

export type VercelLikeRequest = IncomingMessage & {
  body?: unknown;
  query?: Record<string, unknown>;
};

export type VercelLikeResponse = ServerResponse & {
  status?: (code: number) => VercelLikeResponse;
  json?: (body: unknown) => void;
};

export class HttpPayloadError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'HttpPayloadError';
  }
}

export function sendJson(res: VercelLikeResponse, statusCode: number, payload: unknown): void {
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

export function getHeaderValue(
  headers: IncomingMessage['headers'] | undefined,
  name: string
): string {
  if (!headers) return '';
  const val = headers[name.toLowerCase()];
  if (Array.isArray(val)) return val.join(', ');
  return typeof val === 'string' ? val : '';
}

export async function readRawRequestBuffer(
  req: VercelLikeRequest,
  maxBytes: number = MAX_PDF_PAYLOAD_BYTES
): Promise<Buffer> {
  // Check Content-Length upfront if provided
  const contentLengthRaw = getHeaderValue(req.headers, 'content-length');
  if (contentLengthRaw) {
    const contentLength = Number(contentLengthRaw);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new HttpPayloadError(
        413,
        'Ukuran berkas PDF terlalu besar untuk diproses (maksimal 25MB). Silakan kompres PDF terlebih dahulu.'
      );
    }
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > maxBytes) {
      throw new HttpPayloadError(
        413,
        'Ukuran berkas PDF terlalu besar untuk diproses (maksimal 25MB). Silakan kompres PDF terlebih dahulu.'
      );
    }
    chunks.push(buf);
  }

  return Buffer.concat(chunks);
}

/**
 * Parses JSON, multipart/form-data, or raw PDF payloads from either:
 * - Pre-parsed `req.body` (Express or Vercel runtime), or
 * - Raw Node HTTP stream (`IncomingMessage`).
 */
export async function readParsedRequestBody(
  req: VercelLikeRequest,
  maxBytes: number = MAX_PDF_PAYLOAD_BYTES
): Promise<{
  contentType: string;
  parsedBody: Record<string, any> | null;
  rawBuffer: Buffer | null;
}> {
  const contentType = getHeaderValue(req.headers, 'content-type').toLowerCase();

  // Case 1: Body already parsed by Vercel runtime or Express middleware
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) {
      if (req.body.length > maxBytes) {
        throw new HttpPayloadError(
          413,
          'Ukuran berkas PDF terlalu besar untuk diproses (maksimal 25MB). Silakan kompres PDF terlebih dahulu.'
        );
      }
      if (contentType.includes('application/json') || !contentType) {
        const text = req.body.toString('utf8').trim();
        if (!text) return { contentType, parsedBody: {}, rawBuffer: req.body };
        try {
          const parsed = JSON.parse(text);
          return {
            contentType,
            parsedBody: parsed && typeof parsed === 'object' ? parsed : {},
            rawBuffer: req.body,
          };
        } catch {
          throw new HttpPayloadError(400, 'Format payload JSON ke server tidak valid.');
        }
      }
      return { contentType, parsedBody: null, rawBuffer: req.body };
    }

    if (typeof req.body === 'string') {
      const byteLen = Buffer.byteLength(req.body, 'utf8');
      if (byteLen > maxBytes) {
        throw new HttpPayloadError(
          413,
          'Ukuran berkas PDF terlalu besar untuk diproses (maksimal 25MB). Silakan kompres PDF terlebih dahulu.'
        );
      }
      if (contentType.includes('multipart/form-data')) {
        return {
          contentType,
          parsedBody: null,
          rawBuffer: Buffer.from(req.body, 'latin1'),
        };
      }
      const trimmed = req.body.trim();
      if (!trimmed) {
        return { contentType, parsedBody: {}, rawBuffer: null };
      }
      try {
        const parsed = JSON.parse(trimmed);
        return {
          contentType,
          parsedBody: parsed && typeof parsed === 'object' ? parsed : {},
          rawBuffer: null,
        };
      } catch {
        throw new HttpPayloadError(400, 'Format payload JSON ke server tidak valid.');
      }
    }

    if (typeof req.body === 'object') {
      return {
        contentType,
        parsedBody: req.body as Record<string, any>,
        rawBuffer: null,
      };
    }
  }

  // Case 2: Read raw stream (when runtime did not pre-parse req.body)
  const rawBuffer = await readRawRequestBuffer(req, maxBytes);

  if (
    contentType.includes('multipart/form-data') ||
    contentType.includes('application/pdf') ||
    contentType.includes('application/octet-stream')
  ) {
    return { contentType, parsedBody: null, rawBuffer };
  }

  const rawText = rawBuffer.toString('utf8').trim();
  if (!rawText) {
    return { contentType, parsedBody: {}, rawBuffer };
  }

  try {
    const parsed = JSON.parse(rawText);
    return {
      contentType,
      parsedBody: parsed && typeof parsed === 'object' ? parsed : {},
      rawBuffer,
    };
  } catch {
    throw new HttpPayloadError(400, 'Format payload JSON ke server tidak valid.');
  }
}

export interface MultipartPdfPart {
  pdfBuffer: Buffer;
  fileName: string;
}

/**
 * Lightweight RFC-7578 multipart/form-data parser for PDF uploads (`file`, `pdf`, or first PDF part).
 */
export function parseMultipartPdfUpload(
  rawBuffer: Buffer,
  contentType: string
): MultipartPdfPart | null {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  if (!boundaryMatch) return null;

  const boundary = (boundaryMatch[1] || boundaryMatch[2] || '').trim();
  if (!boundary) return null;

  const delimiter = `--${boundary}`;
  const rawLatin1 = rawBuffer.toString('latin1');
  const sections = rawLatin1.split(delimiter);

  let foundFileName = 'Worksheet.pdf';
  let foundPdfBuffer: Buffer | null = null;

  for (const section of sections) {
    if (!section || section === '--' || section === '--\r\n') continue;

    const headerEndIdx = section.indexOf('\r\n\r\n');
    if (headerEndIdx === -1) continue;

    const headersPart = section.slice(0, headerEndIdx);
    let bodyPart = section.slice(headerEndIdx + 4);
    if (bodyPart.endsWith('\r\n')) {
      bodyPart = bodyPart.slice(0, -2);
    }

    const nameMatch = headersPart.match(/name="([^"]+)"/i);
    const fieldName = nameMatch ? nameMatch[1].toLowerCase() : '';
    const filenameMatch = headersPart.match(/filename="([^"]*)"/i);

    if (fieldName === 'filename' && !filenameMatch) {
      const textVal = Buffer.from(bodyPart, 'latin1').toString('utf8').trim();
      if (textVal) foundFileName = textVal;
      continue;
    }

    if (filenameMatch || fieldName === 'file' || fieldName === 'pdf' || fieldName === 'document') {
      if (filenameMatch && filenameMatch[1]) {
        foundFileName = filenameMatch[1].trim() || foundFileName;
      }
      const partBuf = Buffer.from(bodyPart, 'latin1');
      if (partBuf.length > 0) {
        foundPdfBuffer = partBuf;
      }
    }
  }

  if (!foundPdfBuffer) return null;
  return {
    pdfBuffer: foundPdfBuffer,
    fileName: foundFileName,
  };
}

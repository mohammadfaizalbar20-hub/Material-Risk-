import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import extractWorksheetHandler from '../api/pdf/extract-worksheet';
import apiIndexHandler from '../api/index';
import aiChatHandler from '../api/ai/chat';
import sequentialWorkflowHandler from '../api/ai/sequential-workflow';
import type { VercelLikeRequest, VercelLikeResponse } from '../src/server/vercelHttp';

function buildSampleWorksheetPdfBuffer(): Buffer {
  const objects: string[] = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n');
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const drawAt = (x: number, y: number, text: string) =>
    `BT /F1 9 Tf 1 0 0 1 ${x} ${y} Tm (${esc(text)}) Tj ET`;

  const stream = [
    drawAt(40, 740, 'NO. WORKSHEET :'),
    drawAt(135, 740, 'WH/MO/22512 - Lot 1'),
    drawAt(330, 740, 'NO. OR :'),
    drawAt(395, 740, 'OR/2026/05/1014'),
    drawAt(330, 720, 'STYLE NO :'),
    drawAt(395, 720, '[KAIS08-2] KAIS TOPI PRMI 05'),
    drawAt(330, 700, 'TOTAL QTY :'),
    drawAt(395, 700, '2.498'),
    drawAt(40, 665, 'MATERIAL & KONSUMSI'),
    drawAt(60, 645, 'CODE ACC'),
    drawAt(140, 645, 'DESCRIPTION'),
    drawAt(330, 645, 'CONS'),
    drawAt(380, 645, 'UNIT'),
    drawAt(425, 645, 'TOTAL'),
    drawAt(480, 645, 'RETURN'),
    drawAt(535, 645, 'BALANCE'),
    drawAt(60, 625, 'UNI-KAIS9122'),
    drawAt(140, 625, 'BATIK COTTON UNTUK TOPI KAIS'),
    drawAt(330, 625, '0,0420'),
    drawAt(380, 625, 'yard'),
    drawAt(425, 625, '104,9160'),
    drawAt(480, 625, '0'),
    drawAt(535, 625, '104,9160'),
    drawAt(60, 605, 'UNI-ACC10141'),
    drawAt(140, 605, 'HANGTAG TERATAI'),
    drawAt(330, 605, '1,0000'),
    drawAt(380, 605, 'Pcs'),
    drawAt(480, 605, '0'),
    drawAt(535, 605, '2.498,0000'),
  ].join('\n');

  objects.push(
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>\nendobj\n'
  );
  objects.push(
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`
  );

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefPos = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

function createMockReqRes(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
  rawStreamBody?: Buffer | string;
}) {
  const chunks =
    options.rawStreamBody !== undefined
      ? [Buffer.isBuffer(options.rawStreamBody) ? options.rawStreamBody : Buffer.from(options.rawStreamBody)]
      : [];
  const req = Readable.from(chunks) as unknown as VercelLikeRequest;
  req.method = options.method || 'POST';
  req.url = options.url || '/api/pdf/extract-worksheet';
  req.headers = {};
  for (const [k, v] of Object.entries(options.headers || {})) {
    req.headers[k.toLowerCase()] = v;
  }
  if (options.body !== undefined) {
    req.body = options.body;
  }

  const responseHeaders: Record<string, string> = {};
  const bodyChunks: Buffer[] = [];
  const res = new Writable({
    write(chunk, _enc, cb) {
      bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  }) as unknown as VercelLikeResponse;

  res.statusCode = 200;
  Object.defineProperty(res, 'headersSent', { value: false, configurable: true });
  res.setHeader = (name: string, value: string | number | readonly string[]) => {
    responseHeaders[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
    return res;
  };
  res.getHeader = (name: string) => responseHeaders[name.toLowerCase()];

  const getJson = () => {
    const raw = Buffer.concat(bodyChunks).toString('utf8');
    return {
      statusCode: res.statusCode,
      contentType: responseHeaders['content-type'] || '',
      raw,
      json: raw ? JSON.parse(raw) : null,
    };
  };

  return { req, res, getJson };
}

test('1. Konfigurasi vercel.json valid: Vite output, serverless PDF worker assets, dan rewrite SPA tidak menelan /api/*', () => {
  const vercelJsonPath = path.resolve(process.cwd(), 'vercel.json');
  assert.equal(fs.existsSync(vercelJsonPath), true);
  const config = JSON.parse(fs.readFileSync(vercelJsonPath, 'utf8'));

  assert.equal(config.framework, 'vite');
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, 'dist');
  assert.ok(config.functions?.['api/pdf/extract-worksheet.ts']?.includeFiles?.includes('pdfjs-dist'));
  assert.ok(config.functions?.['api/index.ts']?.includeFiles?.includes('pdfjs-dist'));

  const rewrites: Array<{ source: string; destination: string }> = config.rewrites || [];
  assert.ok(rewrites.some((r) => r.source.includes('/api') && r.destination === '/api/index'));
  assert.ok(rewrites.some((r) => r.source.includes('(?!api/)') && r.destination === '/index.html'));
});

test('2. Vercel handler POST /api/pdf/extract-worksheet (JSON base64 pre-parsed) mengembalikan JSON ekstraksi valid & TOTAL kosong tetap null', async () => {
  const pdfBuf = buildSampleWorksheetPdfBuffer();
  const { req, res, getJson } = createMockReqRes({
    method: 'POST',
    url: '/api/pdf/extract-worksheet',
    headers: { 'content-type': 'application/json' },
    body: {
      pdfBase64: pdfBuf.toString('base64'),
      fileName: 'WORKSHEET - WH_MO_22512.pdf',
    },
  });

  await extractWorksheetHandler(req, res);
  const out = getJson();
  assert.equal(out.statusCode, 200);
  assert.match(out.contentType, /application\/json/i);
  assert.equal(out.json.success, true);
  assert.equal(out.json.data.orNumber, '1014');
  assert.equal(out.json.data.style, '[KAIS08-2] KAIS TOPI PRMI 05');
  assert.equal(out.json.data.target, 2498);
  assert.equal(out.json.data.materials.length, 2);
  assert.equal(out.json.data.materials[0].total, 104.916);
  assert.equal(out.json.data.materials[1].total, null);
});

test('3. Vercel handler POST /api/pdf/extract-worksheet mendukung raw stream JSON & multipart/form-data', async () => {
  const pdfBuf = buildSampleWorksheetPdfBuffer();

  // A. Raw JSON stream (req.body belum diparse)
  const rawPayload = JSON.stringify({
    pdfBase64: `data:application/pdf;base64,${pdfBuf.toString('base64')}`,
    fileName: 'StreamTest.pdf',
  });
  const streamCase = createMockReqRes({
    method: 'POST',
    url: '/api/pdf/extract-worksheet',
    headers: { 'content-type': 'application/json' },
    rawStreamBody: rawPayload,
  });
  await extractWorksheetHandler(streamCase.req, streamCase.res);
  const streamOut = streamCase.getJson();
  assert.equal(streamOut.statusCode, 200);
  assert.equal(streamOut.json.success, true);
  assert.equal(streamOut.json.data.orNumber, '1014');

  // B. Multipart/form-data upload
  const boundary = '----TestBoundary12345';
  const multipartBody = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="MultipartWorksheet.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      'utf8'
    ),
    pdfBuf,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);

  const multipartCase = createMockReqRes({
    method: 'POST',
    url: '/api/pdf/extract-worksheet',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    rawStreamBody: multipartBody,
  });
  await extractWorksheetHandler(multipartCase.req, multipartCase.res);
  const multipartOut = multipartCase.getJson();
  assert.equal(multipartOut.statusCode, 200);
  assert.match(multipartOut.contentType, /application\/json/i);
  assert.equal(multipartOut.json.success, true);
  assert.equal(multipartOut.json.data.fileName, 'MultipartWorksheet.pdf');
  assert.equal(multipartOut.json.data.materials[1].total, null);
});

test('4. Vercel handler error responses: selalu JSON dengan HTTP status tepat (405, 400, 413)', async () => {
  // 405 Method Not Allowed
  const getCase = createMockReqRes({ method: 'GET', url: '/api/pdf/extract-worksheet' });
  await extractWorksheetHandler(getCase.req, getCase.res);
  const getOut = getCase.getJson();
  assert.equal(getOut.statusCode, 405);
  assert.match(getOut.contentType, /application\/json/i);
  assert.equal(getOut.json.success, false);

  // 400 Empty payload
  const emptyCase = createMockReqRes({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {},
  });
  await extractWorksheetHandler(emptyCase.req, emptyCase.res);
  const emptyOut = emptyCase.getJson();
  assert.equal(emptyOut.statusCode, 400);
  assert.match(emptyOut.contentType, /application\/json/i);
  assert.equal(emptyOut.json.success, false);

  // 400 Invalid PDF header
  const nonPdfCase = createMockReqRes({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      pdfBase64: Buffer.from('NOT A PDF FILE CONTENT').toString('base64'),
      fileName: 'Fake.pdf',
    },
  });
  await extractWorksheetHandler(nonPdfCase.req, nonPdfCase.res);
  const nonPdfOut = nonPdfCase.getJson();
  assert.equal(nonPdfOut.statusCode, 400);
  assert.match(nonPdfOut.contentType, /application\/json/i);
  assert.equal(nonPdfOut.json.success, false);

  // 400 Malformed JSON
  const badJsonCase = createMockReqRes({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    rawStreamBody: '{invalid-json',
  });
  await extractWorksheetHandler(badJsonCase.req, badJsonCase.res);
  const badJsonOut = badJsonCase.getJson();
  assert.equal(badJsonOut.statusCode, 400);
  assert.match(badJsonOut.contentType, /application\/json/i);
  assert.equal(badJsonOut.json.success, false);

  // 413 Payload Too Large (> 25MB Content-Length)
  const oversizedCase = createMockReqRes({
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(26 * 1024 * 1024),
    },
    rawStreamBody: '{}',
  });
  await extractWorksheetHandler(oversizedCase.req, oversizedCase.res);
  const oversizedOut = oversizedCase.getJson();
  assert.equal(oversizedOut.statusCode, 413);
  assert.match(oversizedOut.contentType, /application\/json/i);
  assert.equal(oversizedOut.json.success, false);
});

test('5. Router api/index.ts & endpoint AI lain (/api/ai/chat, /api/ai/sequential-workflow) serta JSON 404 fallback', async () => {
  const pdfBuf = buildSampleWorksheetPdfBuffer();

  // Rewrite ke /api/index dengan URL /api/pdf/extract-worksheet
  const routedPdf = createMockReqRes({
    method: 'POST',
    url: '/api/pdf/extract-worksheet',
    headers: { 'content-type': 'application/json' },
    body: { pdfBase64: pdfBuf.toString('base64'), fileName: 'Routed.pdf' },
  });
  await apiIndexHandler(routedPdf.req, routedPdf.res);
  assert.equal(routedPdf.getJson().statusCode, 200);
  assert.equal(routedPdf.getJson().json.success, true);

  // Unknown API path -> JSON 404 (bukan HTML / plain text)
  const unknownApi = createMockReqRes({
    method: 'POST',
    url: '/api/tidak-ada',
    headers: { 'content-type': 'application/json' },
    body: {},
  });
  await apiIndexHandler(unknownApi.req, unknownApi.res);
  const unknownOut = unknownApi.getJson();
  assert.equal(unknownOut.statusCode, 404);
  assert.match(unknownOut.contentType, /application\/json/i);
  assert.equal(unknownOut.json.success, false);

  // AI endpoints tetap berfungsi
  const chatReq = createMockReqRes({
    method: 'POST',
    url: '/api/ai/chat',
    headers: { 'content-type': 'application/json' },
    body: { message: 'shortage', contextData: {} },
  });
  await aiChatHandler(chatReq.req, chatReq.res);
  assert.equal(chatReq.getJson().statusCode, 200);
  assert.ok(chatReq.getJson().json.reply);

  const seqReq = createMockReqRes({
    method: 'POST',
    url: '/api/ai/sequential-workflow',
    headers: { 'content-type': 'application/json' },
    body: { contextData: { orSummaries: [] } },
  });
  await sequentialWorkflowHandler(seqReq.req, seqReq.res);
  assert.equal(seqReq.getJson().statusCode, 200);
  assert.ok(seqReq.getJson().json.stage1);
});

test('6. Esbuild bundling verification: seluruh entry point /api/*.ts terkompilasi bersih untuk Vercel Node.js serverless', async () => {
  const esbuild = await import('esbuild');
  const entryPoints = [
    'api/pdf/extract-worksheet.ts',
    'api/ai/chat.ts',
    'api/ai/sequential-workflow.ts',
    'api/index.ts',
  ];

  const buildResult = await esbuild.build({
    entryPoints,
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outdir: 'tmp-vercel-check',
    packages: 'external',
  });

  assert.equal(buildResult.errors.length, 0);
  assert.equal(buildResult.outputFiles.length, entryPoints.length);
});

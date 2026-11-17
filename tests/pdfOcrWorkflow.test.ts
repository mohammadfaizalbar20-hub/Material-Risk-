import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { ThinkingLevel } from '@google/genai';
import {
  getPendingOcrPageNumbers,
  isRetryableOcrError,
  mergePageOcrExtractions,
  validateUsableOcrWorksheet,
  type PageOcrExtraction,
} from '../src/utils/pdfOcrWorkflow.js';
import { parseExtractWorksheetHttpResponse } from '../src/utils/pdfWorksheetParser.js';
import {
  handleExtractWorksheetHttpRequest,
  type GeminiGenerateFn,
} from '../src/server/pdfWorksheetHandler.js';
import type { VercelLikeRequest, VercelLikeResponse } from '../src/server/vercelHttp.js';

function buildTextPdfBuffer(): Buffer {
  const objects: string[] = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n');
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const drawAt = (x: number, y: number, text: string) =>
    `BT /F1 9 Tf 1 0 0 1 ${x} ${y} Tm (${esc(text)}) Tj ET`;

  const stream = [
    drawAt(40, 740, 'NO. WORKSHEET :'),
    drawAt(135, 740, 'WH/MO/22743 - Lot 1'),
    drawAt(330, 740, 'NO. OR :'),
    drawAt(395, 740, 'OR/2026/05/1025'),
    drawAt(330, 720, 'STYLE NO :'),
    drawAt(395, 720, '[STYLE-A] POLO DRY FIT'),
    drawAt(330, 700, 'TOTAL QTY :'),
    drawAt(395, 700, '1.200'),
    drawAt(40, 665, 'MATERIAL & KONSUMSI'),
    drawAt(60, 645, 'CODE ACC'),
    drawAt(140, 645, 'DESCRIPTION'),
    drawAt(330, 645, 'CONS'),
    drawAt(380, 645, 'UNIT'),
    drawAt(425, 645, 'TOTAL'),
    drawAt(480, 645, 'RETURN'),
    drawAt(535, 645, 'BALANCE'),
    drawAt(60, 625, 'FAB-01'),
    drawAt(140, 625, 'KAIN PIQUE'),
    drawAt(330, 625, '1,2000'),
    drawAt(380, 625, 'yard'),
    drawAt(425, 625, '1.440,0000'),
    drawAt(480, 625, '0'),
    drawAt(535, 625, '1.440,0000'),
    drawAt(60, 605, 'ACC-02'),
    drawAt(140, 605, 'HANGTAG'),
    drawAt(330, 605, '1,0000'),
    drawAt(380, 605, 'Pcs'),
    drawAt(480, 605, '0'),
    drawAt(535, 605, '1.200,0000'),
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

function buildBlankScanPdfBuffer(numPages = 1): Buffer {
  const pageKids = Array.from({ length: numPages }, (_, idx) => `${4 + idx} 0 R`).join(' ');
  const objects: string[] = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${pageKids}] /Count ${numPages} >>\nendobj\n`);
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  for (let i = 0; i < numPages; i++) {
    objects.push(
      `${4 + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n`
    );
  }
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

function createJsonReq(body: unknown): VercelLikeRequest {
  const req = Readable.from([]) as unknown as VercelLikeRequest;
  req.method = 'POST';
  req.url = '/api/pdf/extract-worksheet';
  req.headers = { 'content-type': 'application/json' };
  req.body = body;
  return req;
}

test('1. PDF dengan lapisan teks (preferPageByPageOcr: true): langsung diekstrak deterministik tanpa OCR dan TOTAL kosong tetap null', async () => {
  let aiInvocations = 0;
  const mockGemini: GeminiGenerateFn = async () => {
    aiInvocations++;
    return { text: '{}' };
  };

  const res = await handleExtractWorksheetHttpRequest(
    createJsonReq({
      pdfBase64: buildTextPdfBuffer().toString('base64'),
      fileName: 'WORKSHEET - WH_MO_22743.pdf',
      preferPageByPageOcr: true,
    }),
    {
      apiKey: 'fake-test-key-for-mock-runner',
      generateContentFn: mockGemini,
    }
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(aiInvocations, 0, 'PDF dengan lapisan teks tidak boleh memanggil OCR/AI');
  assert.equal(res.body.data?.orNumber, '1025');
  assert.equal(res.body.data?.target, 1200);
  assert.equal(res.body.data?.materials.length, 2);
  assert.equal(res.body.data?.materials[0].total, 1440);
  assert.equal(res.body.data?.materials[1].total, null);
});

test('2. Deteksi PDF hasil scan (multi-halaman) -> server meminta mode OCR bertahap per halaman (requiresPageOcr)', async () => {
  const res = await handleExtractWorksheetHttpRequest(
    createJsonReq({
      pdfBase64: buildBlankScanPdfBuffer(3).toString('base64'),
      fileName: 'WORKSHEET - WH_MO_22744.pdf',
      preferPageByPageOcr: true,
    }),
    {
      apiKey: 'fake-test-key-for-mock-runner',
    }
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.success, false);
  assert.equal(res.body.requiresPageOcr, true);
  assert.equal(res.body.numPages, 3);

  const parsedClient = parseExtractWorksheetHttpResponse(
    res.status,
    'application/json',
    JSON.stringify(res.body)
  );
  assert.equal(parsedClient.requiresPageOcr, true);
  assert.equal(parsedClient.numPages, 3);
});

test('3. OCR 1 halaman scan memakai ThinkingLevel.LOW + abortSignal + menjaga TOTAL kosong tetap null', async () => {
  let capturedConfig: any = null;
  const mockGemini: GeminiGenerateFn = async (params) => {
    capturedConfig = params.config;
    return {
      text: JSON.stringify({
        isNonTablePage: false,
        orNumberRaw: 'OR/2026/05/1026',
        worksheetNo: 'WH/MO/22744 · Lot - 1',
        style: '[KAIS09] JAKET CANVAS',
        totalQtyRaw: '1.500',
        materials: [
          {
            materialCode: 'MAT-CNV-01',
            materialName: 'CANVAS COTTON',
            unit: 'yard',
            totalRaw: '375,5000',
          },
          {
            materialCode: 'ACC-TAG-02',
            materialName: 'HANGTAG UTAMA',
            unit: 'Pcs',
            totalRaw: '',
          },
        ],
      }),
    };
  };

  const tinyJpegB64 = Buffer.from('fake-jpeg-bytes').toString('base64');
  const res = await handleExtractWorksheetHttpRequest(
    createJsonReq({
      pageImageBase64: tinyJpegB64,
      pageMimeType: 'image/jpeg',
      pageNumber: 1,
      totalPages: 1,
      fileName: 'SingleScan.pdf',
    }),
    {
      apiKey: 'fake-test-key-for-mock-runner',
      generateContentFn: mockGemini,
    }
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(capturedConfig?.thinkingConfig?.thinkingLevel, ThinkingLevel.LOW);
  assert.ok(capturedConfig?.abortSignal);
  assert.equal(res.body.pageExtraction?.orNumber, '1026');
  assert.equal(res.body.pageExtraction?.target, 1500);
  assert.equal(res.body.pageExtraction?.materials.length, 2);
  assert.equal(res.body.pageExtraction?.materials[0].total, 375.5);
  assert.equal(res.body.pageExtraction?.materials[1].total, null);
  assert.equal(res.body.pageExtraction?.materials[1].totalStatus, 'empty');
});

test('4. Retry terbatas pada timeout sementara berhasil memulihkan halaman & mengembalikan HTTP 504 retryable saat semua percobaan habis', async () => {
  // Case A: Attempt 1 times out, attempt 2 succeeds -> recovered transparently!
  let attemptCountA = 0;
  const flakyThenOkGemini: GeminiGenerateFn = async () => {
    attemptCountA++;
    if (attemptCountA === 1) {
      // Wait longer than perAttemptTimeoutMs (40ms) to trigger genuine abort/timeout
      await new Promise((r) => setTimeout(r, 120));
    }
    return {
      text: JSON.stringify({
        isNonTablePage: false,
        orNumberRaw: 'OR/2026/05/1026',
        worksheetNo: 'WH/MO/22744',
        style: 'STYLE RECOVERED',
        totalQtyRaw: '500',
        materials: [
          { materialCode: 'MAT-01', materialName: 'KAIN A', unit: 'yard', totalRaw: '250' },
        ],
      }),
    };
  };

  const recoveredRes = await handleExtractWorksheetHttpRequest(
    createJsonReq({
      pageImageBase64: Buffer.from('img').toString('base64'),
      pageMimeType: 'image/jpeg',
      pageNumber: 1,
      totalPages: 2,
      fileName: 'WORKSHEET - WH_MO_22744.pdf',
    }),
    {
      apiKey: 'fake-test-key-for-mock-runner',
      generateContentFn: flakyThenOkGemini,
      perAttemptTimeoutMs: 40,
      maxAttempts: 2,
      maxTotalBudgetMs: 2500,
    }
  );

  assert.equal(recoveredRes.status, 200);
  assert.equal(recoveredRes.body.success, true);
  assert.equal(attemptCountA, 2);
  assert.equal(recoveredRes.body.pageExtraction?.orNumber, '1026');

  // Case B: Always times out -> bounded to maxAttempts=2 and returns HTTP 504 + retryable: true
  let attemptCountB = 0;
  const alwaysHangGemini: GeminiGenerateFn = async ({ config }) => {
    attemptCountB++;
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 250);
      config?.abortSignal?.addEventListener('abort', () => {
        clearTimeout(t);
        resolve(undefined);
      });
    });
    return { text: '{}' };
  };

  const failRes = await handleExtractWorksheetHttpRequest(
    createJsonReq({
      pageImageBase64: Buffer.from('img').toString('base64'),
      pageMimeType: 'image/jpeg',
      pageNumber: 2,
      totalPages: 3,
      fileName: 'WORKSHEET - WH_MO_22744.pdf',
    }),
    {
      apiKey: 'fake-test-key-for-mock-runner',
      generateContentFn: alwaysHangGemini,
      perAttemptTimeoutMs: 35,
      maxAttempts: 2,
      maxTotalBudgetMs: 2000,
    }
  );

  assert.equal(failRes.status, 504);
  assert.equal(failRes.body.success, false);
  assert.equal(failRes.body.retryable, true);
  assert.equal(attemptCountB, 2);
  assert.match(failRes.body.error || '', /halaman 2\/3/i);
  assert.equal(isRetryableOcrError(failRes.status, failRes.body.error), true);
});

test('5. PDF scan multi-halaman & resume parsial: tidak mengulang halaman yang sudah berhasil dan tidak menduplikasi / menghilangkan baris', () => {
  const completedPages: Record<number, PageOcrExtraction> = {
    1: {
      pageNumber: 1,
      totalPages: 3,
      isNonTablePage: false,
      orNumber: '1026',
      rawOrNumber: 'OR/2026/05/1026',
      worksheetNo: 'WH/MO/22744 · Lot - 1',
      style: '[KAIS09] JAKET',
      target: 1500,
      rawTarget: '1.500',
      materials: [
        { materialCode: 'FAB-01', materialName: 'MAIN FABRIC', unit: 'yard', total: 1200, rawTotal: '1.200' },
        { materialCode: 'ZIP-CHC-26', materialName: 'ZIPPER FRONT', unit: 'Pcs', total: 1500, rawTotal: '1.500' },
      ],
    },
  };

  // Suppose page 2 failed earlier: retrying ONLY asks for [2, 3], NEVER re-running page 1
  const pendingAfterPage1 = getPendingOcrPageNumbers(3, completedPages);
  assert.deepEqual(pendingAfterPage1, [2, 3]);

  // Retry succeeds for page 2 (continuation table with duplicate material code ZIP-CHC-26) & page 3 (Material Card ignored)
  completedPages[2] = {
    pageNumber: 2,
    totalPages: 3,
    isNonTablePage: false,
    orNumber: '',
    style: '',
    target: null,
    materials: [
      { materialCode: 'ZIP-CHC-26', materialName: 'ZIPPER POCKET', unit: 'Pcs', total: 3000, rawTotal: '3.000' },
      { materialCode: 'ACC-LBL', materialName: 'CARE LABEL', unit: 'Pcs', total: null, rawTotal: '', totalStatus: 'empty' },
    ],
  };
  completedPages[3] = {
    pageNumber: 3,
    totalPages: 3,
    isNonTablePage: true,
    orNumber: '',
    style: '',
    target: null,
    materials: [],
  };

  assert.deepEqual(getPendingOcrPageNumbers(3, completedPages), []);

  const merged = mergePageOcrExtractions(completedPages, 'WORKSHEET - WH_MO_22744.pdf');
  assert.equal(merged.isValidatedUsable, true);
  assert.deepEqual(merged.processedPageNumbers, [1, 2, 3]);
  assert.deepEqual(merged.nonTablePageNumbers, [3]);

  // Header preserved from Page 1 (never overwritten by blank Page 2/3)
  assert.equal(merged.worksheet.orNumber, '1026');
  assert.equal(merged.worksheet.style, '[KAIS09] JAKET');
  assert.equal(merged.worksheet.target, 1500);

  // All 4 rows across Page 1 + Page 2 preserved cleanly in order, no duplicates, no dropped codes, empty TOTAL kept null
  assert.equal(merged.worksheet.materials.length, 4);
  assert.deepEqual(
    merged.worksheet.materials.map((m) => m.materialCode),
    ['FAB-01', 'ZIP-CHC-26', 'ZIP-CHC-26', 'ACC-LBL']
  );
  assert.equal(merged.worksheet.materials[1].materialName, 'ZIPPER FRONT');
  assert.equal(merged.worksheet.materials[2].materialName, 'ZIPPER POCKET');
  assert.equal(merged.worksheet.materials[3].total, null);
  assert.equal(merged.worksheet.materials[3].totalStatus, 'empty');
});

test('6. Hasil OCR kosong / seluruh halaman non-tabel ditolak validasinya (tidak mengklaim OCR berhasil)', () => {
  const unusable = mergePageOcrExtractions(
    {
      1: {
        pageNumber: 1,
        totalPages: 1,
        isNonTablePage: true,
        orNumber: '',
        style: '',
        target: null,
        materials: [],
      },
    },
    'BlankScan.pdf'
  );

  assert.equal(unusable.isValidatedUsable, false);
  assert.equal(validateUsableOcrWorksheet(unusable.worksheet), false);
  assert.equal(unusable.worksheet.needsReview, true);
});

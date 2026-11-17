import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { ThinkingLevel } from '@google/genai';
import {
  buildWorksheetFromFirstPageOcr,
  isRetryableOcrError,
  validateUsableOcrWorksheet,
  type PageOcrExtraction,
} from '../src/utils/pdfOcrWorkflow.js';
import { parseExtractWorksheetHttpResponse } from '../src/utils/pdfWorksheetParser.js';
import {
  handleExtractWorksheetHttpRequest,
  type GeminiGenerateFn,
} from '../src/server/pdfWorksheetHandler.js';
import type { VercelLikeRequest } from '../src/server/vercelHttp.js';

function escPdfText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function drawAt(x: number, y: number, text: string): string {
  return `BT /F1 9 Tf 1 0 0 1 ${x} ${y} Tm (${escPdfText(text)}) Tj ET`;
}

function buildMultiPageTextPdfBuffer(pageStreams: string[]): Buffer {
  const numPages = pageStreams.length;
  const pageObjNums: number[] = [];
  const objects: string[] = [];

  // Obj 1: Catalog, Obj 2: Pages, Obj 3: Font
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  for (let i = 0; i < numPages; i++) {
    pageObjNums.push(4 + i * 2);
  }
  const kidsRef = pageObjNums.map((n) => `${n} 0 R`).join(' ');
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${kidsRef}] /Count ${numPages} >>\nendobj\n`);
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  for (let i = 0; i < numPages; i++) {
    const pageNumObj = 4 + i * 2;
    const contentNumObj = pageNumObj + 1;
    const stream = pageStreams[i];
    objects.push(
      `${pageNumObj} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumObj} 0 R >>\nendobj\n`
    );
    objects.push(
      `${contentNumObj} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`
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

function buildWorksheetStream(opts: {
  worksheetNo: string;
  orText: string;
  styleText: string;
  totalQty: string;
  rows: Array<{ code: string; desc: string; cons: string; unit: string; total?: string; ret?: string; bal: string }>;
}): string {
  const lines: string[] = [
    drawAt(40, 740, 'NO. WORKSHEET :'),
    drawAt(135, 740, opts.worksheetNo),
    drawAt(330, 740, 'NO. OR :'),
    drawAt(395, 740, opts.orText),
    drawAt(330, 720, 'STYLE NO :'),
    drawAt(395, 720, opts.styleText),
    drawAt(330, 700, 'TOTAL QTY :'),
    drawAt(395, 700, opts.totalQty),
    drawAt(40, 665, 'MATERIAL & KONSUMSI'),
    drawAt(60, 645, 'CODE ACC'),
    drawAt(140, 645, 'DESCRIPTION'),
    drawAt(330, 645, 'CONS'),
    drawAt(380, 645, 'UNIT'),
    drawAt(425, 645, 'TOTAL'),
    drawAt(480, 645, 'RETURN'),
    drawAt(535, 645, 'BALANCE'),
  ];

  opts.rows.forEach((r, idx) => {
    const y = 625 - idx * 20;
    lines.push(drawAt(60, y, r.code));
    lines.push(drawAt(140, y, r.desc));
    lines.push(drawAt(330, y, r.cons));
    lines.push(drawAt(380, y, r.unit));
    if (r.total !== undefined && r.total !== '') {
      lines.push(drawAt(425, y, r.total));
    }
    lines.push(drawAt(480, y, r.ret ?? '0'));
    lines.push(drawAt(535, y, r.bal));
  });

  return lines.join('\n');
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

test('1. PDF satu halaman berbasis teks: berhasil diekstrak tanpa memanggil OCR/AI dan TOTAL kosong tetap null', async () => {
  let aiInvocations = 0;
  const mockGemini: GeminiGenerateFn = async () => {
    aiInvocations++;
    return { text: '{}' };
  };

  const singlePagePdf = buildMultiPageTextPdfBuffer([
    buildWorksheetStream({
      worksheetNo: 'WH/MO/22743 - Lot 1',
      orText: 'OR/2026/05/1025',
      styleText: '[STYLE-A] POLO DRY FIT',
      totalQty: '1.200',
      rows: [
        { code: 'FAB-01', desc: 'KAIN PIQUE', cons: '1,2000', unit: 'yard', total: '1.440,0000', bal: '1.440,0000' },
        { code: 'ACC-02', desc: 'HANGTAG', cons: '1,0000', unit: 'Pcs', total: '', bal: '1.200,0000' },
      ],
    }),
  ]);

  const res = await handleExtractWorksheetHttpRequest(
    createJsonReq({
      pdfBase64: singlePagePdf.toString('base64'),
      fileName: 'SinglePage.pdf',
      preferPageByPageOcr: true,
    }),
    {
      apiKey: 'fake-test-key-for-mock-runner',
      generateContentFn: mockGemini,
    }
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(aiInvocations, 0, 'PDF berbasis teks tidak boleh memanggil OCR/AI');
  assert.equal(res.body.data?.orNumber, '1025');
  assert.equal(res.body.data?.target, 1200);
  assert.equal(res.body.data?.materials.length, 2);
  assert.equal(res.body.data?.materials[0].total, 1440);
  assert.equal(res.body.data?.materials[1].total, null);
});

test('2. PDF multi-halaman berbasis teks: hanya mengambil data halaman 1 dan mengabaikan material/OR di halaman 2', async () => {
  let aiInvocations = 0;
  const page1Stream = buildWorksheetStream({
    worksheetNo: 'WH/MO/22743 - Lot 1',
    orText: 'OR/2026/05/1025',
    styleText: '[STYLE-A] POLO DRY FIT',
    totalQty: '1.200',
    rows: [
      { code: 'FAB-01', desc: 'KAIN PIQUE HAL 1', cons: '1,2000', unit: 'yard', total: '1.440,0000', bal: '1.440,0000' },
    ],
  });
  const page2Stream = buildWorksheetStream({
    worksheetNo: 'WH/MO/99999 - Lot 2',
    orText: 'OR/2026/05/9999',
    styleText: '[STYLE-B] EXTRA PAGE 2',
    totalQty: '8.888',
    rows: [
      { code: 'MAT-PAGE2-IGNORED', desc: 'MATERIAL HALAMAN 2', cons: '2,0000', unit: 'Pcs', total: '999,0000', bal: '999,0000' },
      { code: 'ACC-PAGE2-IGNORED', desc: 'KANCING HALAMAN 2', cons: '1,0000', unit: 'Pcs', total: '500,0000', bal: '500,0000' },
    ],
  });

  const twoPagePdf = buildMultiPageTextPdfBuffer([page1Stream, page2Stream]);

  const res = await handleExtractWorksheetHttpRequest(
    createJsonReq({
      pdfBase64: twoPagePdf.toString('base64'),
      fileName: 'MultiPageText.pdf',
      preferPageByPageOcr: true,
    }),
    {
      apiKey: 'fake-test-key-for-mock-runner',
      generateContentFn: async () => {
        aiInvocations++;
        return { text: '{}' };
      },
    }
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(aiInvocations, 0);
  assert.equal(res.body.data?.orNumber, '1025', 'OR harus tetap dari halaman 1');
  assert.equal(res.body.data?.target, 1200, 'Target harus tetap dari halaman 1');
  assert.equal(res.body.data?.style, '[STYLE-A] POLO DRY FIT');
  assert.equal(res.body.data?.materials.length, 1, 'Material halaman 2 tidak boleh masuk ke hasil');
  assert.equal(res.body.data?.materials[0].materialCode, 'FAB-01');
  assert.ok(
    !res.body.data?.materials.some((m) => m.materialCode.includes('PAGE2-IGNORED')),
    'Material dari halaman 2 wajib diabaikan'
  );
});

test('3. Halaman 1 tidak berisi worksheet (hanya cover/catatan) meski halaman 2 punya worksheet -> wajib ditolak dan tidak otomatis membaca halaman 2', async () => {
  let aiInvocations = 0;
  const page1CoverOnly = [
    drawAt(60, 720, 'INTERNAL COVER SHEET'),
    drawAt(60, 700, 'CATATAN PENGIRIMAN DOKUMEN PRODUKSI'),
    drawAt(60, 680, 'HARAP PERIKSA LAMPIRAN BERIKUTNYA'),
  ].join('\n');
  const page2Worksheet = buildWorksheetStream({
    worksheetNo: 'WH/MO/22750 - Lot 1',
    orText: 'OR/2026/05/1050',
    styleText: '[STYLE-P2] JACKET PAGE 2',
    totalQty: '900',
    rows: [
      { code: 'MAT-PAGE2-ONLY', desc: 'KAIN HALAMAN 2', cons: '1,0000', unit: 'yard', total: '900,0000', bal: '900,0000' },
    ],
  });

  const coverThenWorksheetPdf = buildMultiPageTextPdfBuffer([page1CoverOnly, page2Worksheet]);

  const res = await handleExtractWorksheetHttpRequest(
    createJsonReq({
      pdfBase64: coverThenWorksheetPdf.toString('base64'),
      fileName: 'CoverPage1Only.pdf',
      preferPageByPageOcr: true,
    }),
    {
      apiKey: 'fake-test-key-for-mock-runner',
      generateContentFn: async () => {
        aiInvocations++;
        return { text: '{}' };
      },
    }
  );

  assert.equal(res.status, 422);
  assert.equal(res.body.success, false);
  assert.equal(res.body.retryable, false);
  assert.equal(aiInvocations, 0, 'Cover teks di halaman 1 tidak boleh jatuh ke OCR atau membaca halaman 2');
  assert.match(res.body.error || '', /data worksheet tidak ditemukan pada halaman pertama/i);
});

test('4. PDF hasil scan multi-halaman (3 halaman): server hanya meminta OCR halaman 1 (numPages: 1) dan menolak pageNumber > 1', async () => {
  const probeRes = await handleExtractWorksheetHttpRequest(
    createJsonReq({
      pdfBase64: buildBlankScanPdfBuffer(3).toString('base64'),
      fileName: 'Scanned3Pages.pdf',
      preferPageByPageOcr: true,
    }),
    {
      apiKey: 'fake-test-key-for-mock-runner',
    }
  );

  assert.equal(probeRes.status, 200);
  assert.equal(probeRes.body.success, false);
  assert.equal(probeRes.body.requiresPageOcr, true);
  assert.equal(probeRes.body.numPages, 1, 'Walau PDF scan 3 halaman, hanya halaman 1 yang dijadwalkan untuk OCR');

  const parsedClient = parseExtractWorksheetHttpResponse(
    probeRes.status,
    'application/json',
    JSON.stringify(probeRes.body)
  );
  assert.equal(parsedClient.requiresPageOcr, true);
  assert.equal(parsedClient.numPages, 1);

  // Permintaan OCR eksplisit untuk halaman 2 atau 3 harus ditolak langsung dengan HTTP 400
  let geminiCalledForPage2 = false;
  const page2Res = await handleExtractWorksheetHttpRequest(
    createJsonReq({
      pageImageBase64: Buffer.from('img-p2').toString('base64'),
      pageMimeType: 'image/jpeg',
      pageNumber: 2,
      totalPages: 3,
      fileName: 'Scanned3Pages.pdf',
    }),
    {
      apiKey: 'fake-test-key-for-mock-runner',
      generateContentFn: async () => {
        geminiCalledForPage2 = true;
        return { text: '{}' };
      },
    }
  );

  assert.equal(page2Res.status, 400);
  assert.equal(page2Res.body.success, false);
  assert.equal(page2Res.body.retryable, false);
  assert.equal(geminiCalledForPage2, false, 'Halaman 2 tidak boleh pernah dikirim ke Gemini');
  assert.match(page2Res.body.error || '', /hanya memproses halaman pertama/i);
});

test('5. OCR Halaman 1 scan menggunakan ThinkingLevel.LOW + abortSignal + menjaga TOTAL kosong tetap null + fallback PDF raw menginstruksikan Halaman 1 saja', async () => {
  let capturedConfig: any = null;
  let capturedPrompt = '';
  const mockGemini: GeminiGenerateFn = async (params) => {
    capturedConfig = params.config;
    capturedPrompt = String(params.contents?.[0]?.parts?.find((p: any) => p.text)?.text || '');
    return {
      text: JSON.stringify({
        isNonTablePage: false,
        orNumberRaw: 'OR/2026/05/1026',
        worksheetNo: 'WH/MO/22744 · Lot - 1',
        style: '[KAIS09] JAKET CANVAS',
        totalQtyRaw: '1.500',
        materials: [
          { materialCode: 'MAT-CNV-01', materialName: 'CANVAS COTTON', unit: 'yard', totalRaw: '375,5000' },
          { materialCode: 'ACC-TAG-02', materialName: 'HANGTAG UTAMA', unit: 'Pcs', totalRaw: '' },
        ],
      }),
    };
  };

  const page1OcrRes = await handleExtractWorksheetHttpRequest(
    createJsonReq({
      pageImageBase64: Buffer.from('fake-jpeg-bytes').toString('base64'),
      pageMimeType: 'image/jpeg',
      pageNumber: 1,
      totalPages: 1,
      fileName: 'Scanned3Pages.pdf',
    }),
    {
      apiKey: 'fake-test-key-for-mock-runner',
      generateContentFn: mockGemini,
    }
  );

  assert.equal(page1OcrRes.status, 200);
  assert.equal(page1OcrRes.body.success, true);
  assert.equal(capturedConfig?.thinkingConfig?.thinkingLevel, ThinkingLevel.LOW);
  assert.ok(capturedConfig?.abortSignal);
  assert.match(capturedPrompt, /HALAMAN PERTAMA/i);
  assert.equal(page1OcrRes.body.data?.orNumber, '1026');
  assert.equal(page1OcrRes.body.data?.target, 1500);
  assert.equal(page1OcrRes.body.data?.materials.length, 2);
  assert.equal(page1OcrRes.body.data?.materials[0].total, 375.5);
  assert.equal(page1OcrRes.body.data?.materials[1].total, null);

  // Direct PDF fallback (tanpa preferPageByPageOcr) untuk scan multi-halaman juga menginstruksikan Gemini hanya membaca Halaman 1
  let rawFallbackPrompt = '';
  const rawFallbackRes = await handleExtractWorksheetHttpRequest(
    createJsonReq({
      pdfBase64: buildBlankScanPdfBuffer(2).toString('base64'),
      fileName: 'RawDirectScan.pdf',
      preferPageByPageOcr: false,
    }),
    {
      apiKey: 'fake-test-key-for-mock-runner',
      generateContentFn: async (params) => {
        rawFallbackPrompt = String(params.contents?.[0]?.parts?.find((p: any) => p.text)?.text || '');
        return {
          text: JSON.stringify({
            orNumberRaw: 'OR/2026/05/1027',
            worksheetNo: 'WH/MO/22745',
            style: 'JACKET P1',
            totalQtyRaw: '800',
            materials: [{ materialCode: 'FAB-P1', materialName: 'DENIM', unit: 'yard', totalRaw: '800' }],
          }),
        };
      },
    }
  );

  assert.equal(rawFallbackRes.status, 200);
  assert.equal(rawFallbackRes.body.success, true);
  assert.match(rawFallbackPrompt, /Halaman 1.*jangan baca halaman 2/is);
  assert.equal(rawFallbackRes.body.data?.orNumber, '1027');
});

test('6. Retry pada timeout Halaman 1: mengulang halaman 1 saja hingga berhasil atau mengembalikan HTTP 504 retryable', async () => {
  // Case A: Percobaan 1 timeout -> percobaan 2 sukses pada halaman 1
  let attemptCountA = 0;
  const flakyThenOkGemini: GeminiGenerateFn = async () => {
    attemptCountA++;
    if (attemptCountA === 1) {
      await new Promise((r) => setTimeout(r, 120));
    }
    return {
      text: JSON.stringify({
        isNonTablePage: false,
        orNumberRaw: 'OR/2026/05/1026',
        worksheetNo: 'WH/MO/22744',
        style: 'STYLE RECOVERED P1',
        totalQtyRaw: '500',
        materials: [{ materialCode: 'MAT-01', materialName: 'KAIN A', unit: 'yard', totalRaw: '250' }],
      }),
    };
  };

  const recoveredRes = await handleExtractWorksheetHttpRequest(
    createJsonReq({
      pageImageBase64: Buffer.from('img-p1').toString('base64'),
      pageMimeType: 'image/jpeg',
      pageNumber: 1,
      totalPages: 1,
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
  assert.equal(recoveredRes.body.data?.style, 'STYLE RECOVERED P1');

  // Case B: Semua percobaan halaman 1 timeout -> mengembalikan HTTP 504 + retryable: true
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
      pageImageBase64: Buffer.from('img-p1').toString('base64'),
      pageMimeType: 'image/jpeg',
      pageNumber: 1,
      totalPages: 1,
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
  assert.match(failRes.body.error || '', /halaman pertama/i);
  assert.equal(isRetryableOcrError(failRes.status, failRes.body.error), true);
});

test('7. Hasil OCR halaman 1 kosong/non-tabel & input pageNumber !== 1 ditolak validasinya (Data worksheet tidak ditemukan pada halaman pertama)', async () => {
  const nonTablePage1: PageOcrExtraction = {
    pageNumber: 1,
    totalPages: 1,
    isNonTablePage: true,
    orNumber: '',
    style: '',
    target: null,
    materials: [],
  };
  const builtEmpty = buildWorksheetFromFirstPageOcr(nonTablePage1, 'BlankCoverScan.pdf');
  assert.equal(builtEmpty.isValidatedUsable, false);
  assert.equal(validateUsableOcrWorksheet(builtEmpty.worksheet), false);
  assert.match(builtEmpty.worksheet.reviewReasons?.[0] || '', /halaman pertama/i);

  // Page 2 payload must also be rejected by buildWorksheetFromFirstPageOcr even if it contains data
  const rejectedPage2 = buildWorksheetFromFirstPageOcr(
    {
      pageNumber: 2,
      totalPages: 2,
      isNonTablePage: false,
      orNumber: '9999',
      style: 'PAGE2 STYLE',
      target: 1000,
      materials: [{ materialCode: 'MAT-P2', materialName: 'IGNORED', unit: 'Pcs', total: 100 }],
    },
    'MultiScan.pdf'
  );
  assert.equal(rejectedPage2.isValidatedUsable, false);
  assert.equal(rejectedPage2.worksheet.materials.length, 0);

  // Server OCR endpoint rejects non-table Page 1 with non-retryable 422
  const serverEmptyRes = await handleExtractWorksheetHttpRequest(
    createJsonReq({
      pageImageBase64: Buffer.from('img-blank-p1').toString('base64'),
      pageMimeType: 'image/jpeg',
      pageNumber: 1,
      totalPages: 1,
      fileName: 'BlankCoverScan.pdf',
    }),
    {
      apiKey: 'fake-test-key-for-mock-runner',
      generateContentFn: async () => ({
        text: JSON.stringify({
          isNonTablePage: true,
          orNumberRaw: '',
          worksheetNo: '',
          style: '',
          totalQtyRaw: '',
          materials: [],
        }),
      }),
    }
  );

  assert.equal(serverEmptyRes.status, 422);
  assert.equal(serverEmptyRes.body.success, false);
  assert.equal(serverEmptyRes.body.retryable, false);
  assert.match(serverEmptyRes.body.error || '', /data worksheet tidak ditemukan pada halaman pertama/i);
  assert.equal(isRetryableOcrError(serverEmptyRes.status, serverEmptyRes.body.error), false);
});

test('8. Endpoint coordinatePages multi-halaman hanya memproses halaman 1 dan mengabaikan material halaman 2', async () => {
  const res = await handleExtractWorksheetHttpRequest(
    createJsonReq({
      fileName: 'LargeCoordinate.pdf',
      coordinatePages: [
        {
          pageNum: 1,
          items: [
            { str: 'NO. OR : OR/2026/05/1030', x: 40, y: 740, width: 140, height: 10 },
            { str: 'STYLE NO : [S1] SHIRT', x: 40, y: 720, width: 120, height: 10 },
            { str: 'TOTAL QTY : 600', x: 40, y: 700, width: 100, height: 10 },
            { str: 'MATERIAL & KONSUMSI', x: 40, y: 670, width: 140, height: 10 },
            { str: 'CODE ACC', x: 40, y: 650, width: 60, height: 9 },
            { str: 'DESCRIPTION', x: 130, y: 650, width: 100, height: 9 },
            { str: 'UNIT', x: 375, y: 650, width: 35, height: 9 },
            { str: 'TOTAL', x: 430, y: 650, width: 45, height: 9 },
            { str: 'FAB-P1', x: 40, y: 630, width: 60, height: 9 },
            { str: 'COTTON HAL 1', x: 130, y: 630, width: 100, height: 9 },
            { str: 'yard', x: 375, y: 630, width: 25, height: 9 },
            { str: '600,0000', x: 430, y: 630, width: 45, height: 9 },
          ],
        },
        {
          pageNum: 2,
          items: [
            { str: 'MATERIAL & KONSUMSI', x: 40, y: 670, width: 140, height: 10 },
            { str: 'CODE ACC', x: 40, y: 650, width: 60, height: 9 },
            { str: 'DESCRIPTION', x: 130, y: 650, width: 100, height: 9 },
            { str: 'UNIT', x: 375, y: 650, width: 35, height: 9 },
            { str: 'TOTAL', x: 430, y: 650, width: 45, height: 9 },
            { str: 'MAT-P2-SKIP', x: 40, y: 630, width: 80, height: 9 },
            { str: 'MATERIAL HALAMAN 2', x: 130, y: 630, width: 120, height: 9 },
            { str: 'Pcs', x: 375, y: 630, width: 25, height: 9 },
            { str: '1.200,0000', x: 430, y: 630, width: 50, height: 9 },
          ],
        },
      ],
    }),
    { apiKey: 'fake-test-key-for-mock-runner' }
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data?.orNumber, '1030');
  assert.equal(res.body.data?.materials.length, 1);
  assert.equal(res.body.data?.materials[0].materialCode, 'FAB-P1');
});

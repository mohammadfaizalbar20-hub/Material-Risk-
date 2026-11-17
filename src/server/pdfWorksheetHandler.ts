import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  extractWorksheetFromPdfCoordinates,
  parseWorksheetText,
  reconcileWorksheetExtractions,
  extractOrNumberFromIdentifier,
  detectDocumentNumberLocale,
  parsePdfNumberWithContext,
  type ExtractedPdfWorksheet,
  type ExtractedWorksheetMaterial,
  type PdfCoordinatePage,
} from '../utils/pdfWorksheetParser.js';
import {
  isRetryableOcrError,
  type PageOcrExtraction,
} from '../utils/pdfOcrWorkflow.js';
import {
  MAX_PDF_PAYLOAD_BYTES,
  parseMultipartPdfUpload,
  type VercelLikeRequest,
  readParsedRequestBody,
  HttpPayloadError,
} from './vercelHttp.js';

export const DEFAULT_OCR_ATTEMPT_TIMEOUT_MS = 18000;
export const DEFAULT_OCR_MAX_ATTEMPTS = 2;
export const DEFAULT_HANDLER_BUDGET_MS = 45000;
export const MAX_PAGE_IMAGE_BYTES = 4 * 1024 * 1024;

export interface ExtractWorksheetHttpResult {
  status: number;
  body: {
    success: boolean;
    data?: ExtractedPdfWorksheet;
    pageExtraction?: PageOcrExtraction;
    requiresPageOcr?: boolean;
    numPages?: number;
    retryable?: boolean;
    error?: string;
  };
}

export type GeminiGenerateFn = (params: {
  model: string;
  contents: any;
  config: any;
}) => Promise<{ text?: string }>;

export interface PdfWorksheetHandlerOptions {
  apiKey?: string;
  generateContentFn?: GeminiGenerateFn;
  perAttemptTimeoutMs?: number;
  maxAttempts?: number;
  maxTotalBudgetMs?: number;
}

let workerPreloaded = false;

async function ensurePdfJsWorkerLoaded(): Promise<void> {
  if (workerPreloaded && (globalThis as any).pdfjsWorker?.WorkerMessageHandler) {
    return;
  }
  try {
    const workerModule = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    if (workerModule && !(globalThis as any).pdfjsWorker) {
      (globalThis as any).pdfjsWorker = workerModule;
    }
    workerPreloaded = true;
  } catch {
    // Allow pdf-parse default resolution if direct worker import isn't needed
  }
}

function resolveGeminiKey(explicitKey?: string): { apiKey: string; isRealKey: boolean } {
  const resolvedApiKey = (explicitKey ?? process.env.GEMINI_API_KEY ?? '').trim();
  const isRealKey = Boolean(
    resolvedApiKey && resolvedApiKey !== 'MY_GEMINI_API_KEY' && resolvedApiKey.length > 10
  );
  return { apiKey: resolvedApiKey, isRealKey };
}

function buildWorksheetSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      isNonTablePage: { type: Type.BOOLEAN },
      orNumberRaw: { type: Type.STRING },
      worksheetNo: { type: Type.STRING },
      style: { type: Type.STRING },
      totalQtyRaw: { type: Type.STRING },
      materials: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            materialCode: { type: Type.STRING },
            materialName: { type: Type.STRING },
            unit: { type: Type.STRING },
            totalRaw: { type: Type.STRING },
          },
          required: ['materialCode', 'materialName', 'unit', 'totalRaw'],
        },
      },
    },
    required: ['orNumberRaw', 'worksheetNo', 'style', 'totalQtyRaw', 'materials'],
  };
}

function mapGeminiJsonToMaterials(
  rawMaterials: unknown,
  locale: ReturnType<typeof detectDocumentNumberLocale>
): ExtractedWorksheetMaterial[] {
  if (!Array.isArray(rawMaterials)) return [];
  return rawMaterials
    .map((m: any): ExtractedWorksheetMaterial => {
      const code = String(m?.materialCode || '').trim();
      const name = String(m?.materialName || '').trim();
      const unit = String(m?.unit || '').trim();
      const totalRawStr = String(m?.totalRaw ?? '').trim();
      const totalEmpty = totalRawStr === '' || totalRawStr === '-';
      const parsedTot = parsePdfNumberWithContext(totalRawStr, locale);
      return {
        materialCode: code,
        materialName: name,
        unit,
        total: totalEmpty ? null : parsedTot.value,
        rawTotal: totalEmpty ? '' : parsedTot.raw || totalRawStr,
        totalStatus: totalEmpty
          ? 'empty'
          : parsedTot.value === null
            ? 'unreadable'
            : 'present',
        isTotalAmbiguous:
          !totalEmpty && (parsedTot.isAmbiguous || parsedTot.value === null),
        needsReview:
          !code ||
          !name ||
          !unit ||
          (!totalEmpty && (parsedTot.isAmbiguous || parsedTot.value === null)),
        reviewNote: totalEmpty ? 'Kolom TOTAL kosong pada PDF.' : parsedTot.reason,
      };
    })
    .filter((m: ExtractedWorksheetMaterial) => Boolean(m.materialCode || m.materialName));
}

function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes a Gemini structured OCR call with:
 * - Low thinking latency (`ThinkingLevel.LOW`)
 * - `AbortController` + strict per-attempt timeout
 * - Bounded retry for transient timeout/rate-limit/5xx errors within a Vercel Hobby budget
 */
async function invokeGeminiOcrWithRetry(params: {
  mimeType: string;
  base64Data: string;
  prompt: string;
  systemInstruction: string;
  apiKey: string;
  generateContentFn?: GeminiGenerateFn;
  perAttemptTimeoutMs?: number;
  maxAttempts?: number;
  maxTotalBudgetMs?: number;
  labelForError: string;
}): Promise<{ text: string; attemptsUsed: number }> {
  const perAttemptMs = params.perAttemptTimeoutMs ?? DEFAULT_OCR_ATTEMPT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, params.maxAttempts ?? DEFAULT_OCR_MAX_ATTEMPTS);
  const totalBudgetMs = params.maxTotalBudgetMs ?? DEFAULT_HANDLER_BUDGET_MS;
  const startedAt = Date.now();

  const generateFn: GeminiGenerateFn =
    params.generateContentFn ||
    (async (reqParams) => {
      const ai = new GoogleGenAI({
        apiKey: params.apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
      return ai.models.generateContent(reqParams);
    });

  let lastError: Error | null = null;

  const minAttemptWindowMs = Math.min(Math.floor(perAttemptMs * 0.25), 2500);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const elapsedMs = Date.now() - startedAt;
    const remainingBudgetMs = totalBudgetMs - elapsedMs;
    if (remainingBudgetMs <= minAttemptWindowMs) {
      break;
    }

    const attemptTimeoutMs = Math.min(perAttemptMs, remainingBudgetMs);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new Error(
              `Gemini extraction timeout (${Math.round(attemptTimeoutMs / 1000)}s)`
            )
          );
        }, attemptTimeoutMs);
      });

      const aiPromise = generateFn({
        model: 'gemini-4-hydrogen',
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: params.mimeType,
                  data: params.base64Data,
                },
              },
              { text: params.prompt },
            ],
          },
        ],
        config: {
          systemInstruction: params.systemInstruction,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
          abortSignal: controller.signal,
          responseMimeType: 'application/json',
          responseSchema: buildWorksheetSchema(),
        },
      });

      const response = (await Promise.race([aiPromise, timeoutPromise])) as {
        text?: string;
      };
      const text = (response?.text ?? '').trim();
      if (!text) {
        throw new Error(`Respons OCR/AI kosong untuk ${params.labelForError}.`);
      }
      return { text, attemptsUsed: attempt };
    } catch (err: any) {
      const errMsg = err?.message || 'Layanan OCR/AI gagal merespons.';
      lastError = new Error(errMsg);
      const retryable = isRetryableOcrError(err?.status, errMsg);
      const backoffMs = Math.min(400 * attempt, 800, Math.floor(perAttemptMs * 0.5));
      const hasBudgetForRetry =
        Date.now() - startedAt + backoffMs + minAttemptWindowMs < totalBudgetMs;
      if (attempt < maxAttempts && retryable && hasBudgetForRetry) {
        await sleepMs(backoffMs);
        continue;
      }
      throw lastError;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  throw (
    lastError ||
    new Error(`Gemini extraction timeout untuk ${params.labelForError}.`)
  );
}

/**
 * Extracts a single rendered page image (scanned PDF page) using Gemini OCR.
 */
export async function extractSinglePageImageOcr(
  params: {
    pageImageBase64: string;
    pageMimeType?: string;
    pageNumber: number;
    totalPages: number;
    fileName: string;
  },
  options?: PdfWorksheetHandlerOptions
): Promise<ExtractWorksheetHttpResult> {
  const { pageImageBase64, pageNumber, totalPages, fileName } = params;
  const pageMimeType =
    params.pageMimeType && /^image\/(jpeg|jpg|png|webp)$/i.test(params.pageMimeType)
      ? params.pageMimeType.toLowerCase() === 'image/jpg'
        ? 'image/jpeg'
        : params.pageMimeType.toLowerCase()
      : 'image/jpeg';

  const cleanBase64 = pageImageBase64
    .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')
    .trim();

  if (!cleanBase64) {
    return {
      status: 400,
      body: {
        success: false,
        retryable: false,
        error: `Gambar halaman ${pageNumber} pada "${fileName}" kosong.`,
      },
    };
  }

  const imageBuffer = Buffer.from(cleanBase64, 'base64');
  if (imageBuffer.length > MAX_PAGE_IMAGE_BYTES) {
    return {
      status: 413,
      body: {
        success: false,
        retryable: false,
        error: `Ukuran gambar halaman ${pageNumber} terlalu besar (>4MB) untuk diproses server.`,
      },
    };
  }

  const { apiKey, isRealKey } = resolveGeminiKey(options?.apiKey);
  if (!isRealKey) {
    return {
      status: 422,
      body: {
        success: false,
        retryable: false,
        error: `Dokumen "${fileName}" tidak memiliki lapisan teks (hasil scan/gambar) sehingga memerlukan layanan OCR/AI (GEMINI_API_KEY) yang aktif.`,
      },
    };
  }

  const systemInstruction = `Anda adalah sistem OCR dokumen Worksheet produksi garmen berpresisi tinggi.
Ekstrak hanya nilai yang benar-benar tercetak pada gambar halaman ini tanpa mengarang atau menebak kolom yang kosong.`;

  const isFirstPage = pageNumber <= 1;
  const prompt = isFirstPage
    ? `Ini adalah HALAMAN ${pageNumber} dari ${totalPages} dokumen PDF Worksheet "${fileName}".
Ekstrak data berikut secara presisi:
1. isNonTablePage: false jika terdapat tabel MATERIAL & KONSUMSI atau header Worksheet; true HANYA jika halaman ini murni halaman gambar/Material Card tanpa identitas maupun tabel.
2. orNumberRaw: teks persis pada label "NO. OR" / "ORDER NO" (contoh: "OR/2026/05/1014"). JANGAN ambil "NO. WORKSHEET". Kosongkan "" jika tidak ada.
3. worksheetNo: teks pada label "NO. WORKSHEET" (contoh: "WH/MO/22512 · Lot - 1"). Kosongkan "" jika tidak ada.
4. style: teks persis pada label "STYLE NO" / "STYLE" (contoh: "[KAIS08-2] KAIS TOPI PRMI 05"). JANGAN ambil BUYER atau ITEM. Kosongkan "" jika tidak ada.
5. totalQtyRaw: angka persis pada label "TOTAL QTY" (contoh: "2.498"). Pertahankan titik/koma aslinya. Kosongkan "" jika tidak ada.
6. materials: baca tabel "MATERIAL & KONSUMSI" pada halaman ini sesuai urutan asli (jangan gabungkan kode duplikat, abaikan baris ringkasan "X ITEM MATERIAL"):
   - materialCode: kolom "CODE ACC"
   - materialName: kolom "DESCRIPTION"
   - unit: kolom "UNIT"
   - totalRaw: kolom "TOTAL" persis seperti tertulis. PENTING: jika sel "TOTAL" kosong, kembalikan "" — JANGAN pernah mengambil angka dari "CONS", "RETURN", atau "BALANCE".`
    : `Ini adalah HALAMAN ${pageNumber} dari ${totalPages} dokumen PDF Worksheet "${fileName}".
Periksa apakah halaman ini merupakan lanjutan tabel "MATERIAL & KONSUMSI" atau hanya halaman "Material Card" / foto / pengesahan:
1. isNonTablePage: isi true jika halaman ini adalah "Material Card", foto material, catatan kosong, atau tanda tangan tanpa baris tabel "MATERIAL & KONSUMSI".
2. orNumberRaw, worksheetNo, style, totalQtyRaw: ekstrak hanya jika tertulis jelas di halaman ini, selain itu kosongkan "".
3. materials: jika isNonTablePage true, kembalikan []. Jika ada lanjutan baris tabel "MATERIAL & KONSUMSI", ekstrak sesuai urutan asli tanpa mengulang header dan TANPA mengisi kolom "TOTAL" yang kosong dari "CONS"/"RETURN"/"BALANCE".`;

  try {
    const { text } = await invokeGeminiOcrWithRetry({
      mimeType: pageMimeType,
      base64Data: cleanBase64,
      prompt,
      systemInstruction,
      apiKey,
      generateContentFn: options?.generateContentFn,
      perAttemptTimeoutMs: options?.perAttemptTimeoutMs,
      maxAttempts: options?.maxAttempts,
      maxTotalBudgetMs: options?.maxTotalBudgetMs,
      labelForError: `"${fileName}" halaman ${pageNumber}/${totalPages}`,
    });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        status: 422,
        body: {
          success: false,
          retryable: true,
          error: `Respons OCR halaman ${pageNumber}/${totalPages} pada "${fileName}" tidak berformat JSON yang valid.`,
        },
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const combinedRawText = [
      parsed.totalQtyRaw || '',
      ...(Array.isArray(parsed.materials)
        ? parsed.materials.map((m: any) => String(m?.totalRaw || ''))
        : []),
    ]
      .filter(Boolean)
      .join('\n');

    const locale = detectDocumentNumberLocale(combinedRawText);
    const rawOr = String(parsed.orNumberRaw || '').trim();
    const wsNo = String(parsed.worksheetNo || '').trim();
    const styleVal = String(parsed.style || '').trim();
    const rawQty = String(parsed.totalQtyRaw || '').trim();
    const qtyParsed = parsePdfNumberWithContext(rawQty, locale, {
      isIntegerQtyContext: true,
    });
    const materials = mapGeminiJsonToMaterials(parsed.materials, locale);
    const isNonTablePage = Boolean(parsed.isNonTablePage) && materials.length === 0;

    const pageExtraction: PageOcrExtraction = {
      pageNumber,
      totalPages,
      isNonTablePage,
      orNumber: extractOrNumberFromIdentifier(rawOr),
      rawOrNumber: rawOr || undefined,
      worksheetNo: wsNo || undefined,
      style: styleVal,
      target:
        qtyParsed.value !== null && qtyParsed.value > 0 ? qtyParsed.value : null,
      rawTarget: rawQty || undefined,
      isTargetAmbiguous: qtyParsed.isAmbiguous,
      materials,
    };

    return {
      status: 200,
      body: {
        success: true,
        pageExtraction,
      },
    };
  } catch (err: any) {
    const errMsg = err?.message || 'Layanan OCR/AI gagal memproses halaman.';
    const isTimeout = /timeout|batas waktu|abort/i.test(errMsg);
    return {
      status: isTimeout ? 504 : 503,
      body: {
        success: false,
        retryable: isRetryableOcrError(isTimeout ? 504 : 503, errMsg),
        error: `Dokumen "${fileName}" tidak memiliki lapisan teks (hasil scan/gambar) dan ekstraksi OCR/AI halaman ${pageNumber}/${totalPages} gagal: ${errMsg}`,
      },
    };
  }
}

export async function extractWorksheetFromBuffer(
  params: {
    buffer: Buffer;
    fileName: string;
    rawBase64?: string;
    preferPageByPageOcr?: boolean;
    apiKey?: string;
  } & PdfWorksheetHandlerOptions
): Promise<ExtractWorksheetHttpResult> {
  const {
    buffer,
    fileName,
    rawBase64,
    preferPageByPageOcr,
    apiKey,
    generateContentFn,
    perAttemptTimeoutMs,
    maxAttempts,
    maxTotalBudgetMs,
  } = params;

  if (buffer.length > MAX_PDF_PAYLOAD_BYTES) {
    return {
      status: 413,
      body: {
        success: false,
        retryable: false,
        error:
          'Ukuran berkas PDF terlalu besar untuk diproses (maksimal 25MB). Silakan kompres PDF terlebih dahulu.',
      },
    };
  }

  if (buffer.length < 8) {
    return {
      status: 400,
      body: {
        success: false,
        retryable: false,
        error: `Berkas "${fileName}" kosong atau bukan PDF yang valid.`,
      },
    };
  }

  const headerProbe = buffer.subarray(0, 1024).toString('latin1');
  if (!headerProbe.includes('%PDF-')) {
    return {
      status: 400,
      body: {
        success: false,
        retryable: false,
        error: `Berkas "${fileName}" tidak memiliki header PDF (%PDF-) yang valid.`,
      },
    };
  }

  let extractedText = '';
  const pages: PdfCoordinatePage[] = [];
  let numPages = 0;
  let pdfParseErrorMessage: string | null = null;

  let parser: any = null;
  try {
    await ensurePdfJsWorkerLoaded();
    const { PDFParse } = await import('pdf-parse');
    parser = new (PDFParse as any)({ data: buffer });

    // Stage 1A: Extract text items with exact coordinates (x, y, width, height) per page
    if (typeof parser.load === 'function') {
      const doc = await parser.load();
      numPages = Number(doc?.numPages || 0);
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await doc.getPage(pageNum);
        const viewport =
          typeof page.getViewport === 'function' ? page.getViewport({ scale: 1 }) : undefined;
        const textContent = await page.getTextContent();
        const items = Array.isArray(textContent?.items)
          ? textContent.items.map((it: any) => {
              const tr = Array.isArray(it?.transform) ? it.transform : [1, 0, 0, 1, 0, 0];
              return {
                str: String(it?.str || ''),
                x: Number(tr[4] ?? 0),
                y: Number(tr[5] ?? 0),
                width: Number(it?.width ?? 0),
                height: Number(it?.height ?? Math.abs(Number(tr[3] ?? 10))),
              };
            })
          : [];
        pages.push({
          pageNum,
          width: viewport?.width,
          height: viewport?.height,
          items,
        });
      }
    }

    // Stage 1B: Also obtain plain text representation as supplementary text
    if (typeof parser.getText === 'function') {
      const textResult = await parser.getText();
      extractedText = typeof textResult?.text === 'string' ? textResult.text : '';
    }
  } catch (pdfErr: any) {
    pdfParseErrorMessage = pdfErr?.message || 'PDFParse failed';
    console.warn('PDFParse failed, checking fallback:', pdfParseErrorMessage);
  } finally {
    if (parser && typeof parser.destroy === 'function') {
      try {
        await parser.destroy();
      } catch {
        // ignore cleanup error
      }
    }
  }

  // Run coordinate-based parser first, fallback to partial text parser if needed
  let detData: ExtractedPdfWorksheet | null = null;
  if (pages.length > 0) {
    const coordResult = extractWorksheetFromPdfCoordinates(pages, fileName);
    if (coordResult.success && coordResult.data) {
      detData = coordResult.data;
    }
  }

  if ((!detData || detData.materials.length === 0) && extractedText.trim()) {
    const textFallback = parseWorksheetText(extractedText, fileName, { allowPartial: true });
    if (textFallback.success && textFallback.data) {
      if (!detData) {
        detData = textFallback.data;
      } else if (detData.materials.length === 0 && textFallback.data.materials.length > 0) {
        detData = reconcileWorksheetExtractions(detData, textFallback.data, fileName);
      }
    }
  }

  const hasTextLayer =
    extractedText.trim().length > 0 ||
    pages.some((p) => p.items.some((it) => it.str.trim().length > 0));

  const hasUsableDet = Boolean(
    hasTextLayer &&
      detData &&
      detData.orNumber &&
      detData.style &&
      detData.target !== null &&
      detData.target > 0 &&
      detData.materials.length > 0
  );

  const hasCompleteDet = Boolean(hasUsableDet && !detData?.needsReview);

  const { apiKey: resolvedApiKey, isRealKey } = resolveGeminiKey(apiKey);

  // When browser supports page-by-page OCR and the PDF is scanned/unreadable by Stage 1,
  // instruct the client to render and send one lightweight page image at a time.
  if (preferPageByPageOcr && !hasUsableDet) {
    if (!isRealKey && !generateContentFn) {
      return {
        status: 422,
        body: {
          success: false,
          retryable: false,
          error: !hasTextLayer
            ? `Dokumen "${fileName}" tidak memiliki lapisan teks (kemungkinan PDF hasil scan/gambar) sehingga memerlukan layanan OCR/AI yang aktif.`
            : `Gagal mengekstrak data Worksheet dari "${fileName}" dan layanan OCR/AI belum aktif.`,
        },
      };
    }

    return {
      status: 200,
      body: {
        success: false,
        requiresPageOcr: true,
        numPages: numPages || pages.length || 1,
      },
    };
  }

  // Stage 2: Gemini Visual / OCR Fallback for direct raw-PDF API calls when text is missing/incomplete
  let aiData: ExtractedPdfWorksheet | null = null;
  let aiErrorMessage: string | null = null;
  let aiWasTimeout = false;

  if (!hasCompleteDet && !(preferPageByPageOcr && hasUsableDet) && (isRealKey || generateContentFn)) {
    try {
      const base64ForAi = rawBase64 || buffer.toString('base64');

      const systemInstruction = `Anda adalah sistem ekstraksi dokumen PDF Worksheet produksi garmen berpresisi tinggi.
Tugas Anda hanya mengekstrak data yang benar-benar tertulis pada dokumen PDF tanpa mengarang atau menebak nilai yang kosong.`;

      const prompt = `Ekstrak informasi dari dokumen PDF Worksheet ini dengan aturan ketat berikut:
1. orNumberRaw: Ambil teks persis pada label "NO. OR" / "ORDER NO" (contoh: "OR/2026/05/1014"). JANGAN gunakan "NO. WORKSHEET" (contoh "WH/MO/22512"). Kosongkan "" jika tidak ada.
2. worksheetNo: Ambil teks pada label "NO. WORKSHEET" (contoh: "WH/MO/22512 · Lot - 1"). Kosongkan "" jika tidak ada.
3. style: Ambil teks persis pada label "STYLE NO" / "STYLE" (contoh: "[KAIS08-2] KAIS TOPI PRMI 05"). JANGAN gunakan nilai BUYER atau ITEM. Kosongkan "" jika tidak ada.
4. totalQtyRaw: Ambil teks angka persis pada label "TOTAL QTY" (contoh: "2.498"). Jangan hapus titik/koma aslinya. Kosongkan "" jika tidak ada.
5. materials: Baca HANYA tabel "MATERIAL & KONSUMSI" (biasanya di Halaman 1). Abaikan "Material Card" / halaman gambar di Halaman 2, serta abaikan baris ringkasan seperti "4 ITEM MATERIAL".
   Untuk setiap baris material sesuai urutan di PDF (jangan gabungkan kode yang duplikat):
   - materialCode: nilai kolom "CODE ACC"
   - materialName: nilai kolom "DESCRIPTION"
   - unit: nilai kolom "UNIT"
   - totalRaw: nilai kolom "TOTAL" persis seperti tertulis (contoh "104,9160"). PENTING: jika kolom "TOTAL" kosong, kembalikan string kosong "" — JANGAN pernah mengambil angka dari kolom "CONS", "RETURN", atau "BALANCE".`;

      const { text: replyText } = await invokeGeminiOcrWithRetry({
        mimeType: 'application/pdf',
        base64Data: base64ForAi,
        prompt,
        systemInstruction,
        apiKey: resolvedApiKey,
        generateContentFn,
        perAttemptTimeoutMs,
        maxAttempts,
        maxTotalBudgetMs,
        labelForError: `"${fileName}"`,
      });

      const jsonMatch = replyText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const combinedRawText = [
          extractedText,
          parsed.totalQtyRaw || '',
          ...(Array.isArray(parsed.materials)
            ? parsed.materials.map((m: any) => String(m?.totalRaw || ''))
            : []),
        ]
          .filter(Boolean)
          .join('\n');
        const locale = detectDocumentNumberLocale(combinedRawText);

        const rawOr = String(parsed.orNumberRaw || '').trim();
        const wsNo = String(parsed.worksheetNo || '').trim();
        const styleVal = String(parsed.style || '').trim();
        const rawQty = String(parsed.totalQtyRaw || '').trim();
        const qtyParsed = parsePdfNumberWithContext(rawQty, locale, {
          isIntegerQtyContext: true,
        });

        const aiMaterials = mapGeminiJsonToMaterials(parsed.materials, locale);

        aiData = {
          id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          fileName,
          orNumber: extractOrNumberFromIdentifier(rawOr),
          rawOrNumber: rawOr || undefined,
          worksheetNo: wsNo || undefined,
          style: styleVal,
          target: qtyParsed.value !== null && qtyParsed.value > 0 ? qtyParsed.value : null,
          rawTarget: rawQty || undefined,
          isTargetAmbiguous: qtyParsed.isAmbiguous,
          materials: aiMaterials,
          extractionMethod: 'gemini',
          rawText: extractedText || undefined,
        };
      }
    } catch (aiErr: any) {
      const msg = String(aiErr?.message || 'Layanan AI gagal mengekstrak PDF.');
      aiErrorMessage = msg;
      aiWasTimeout = /timeout|batas waktu|abort/i.test(msg);
      console.warn('Gemini AI fallback parsing failed:', msg);
    }
  }

  // Stage 3: Reconcile deterministic vs AI results
  if (!detData && !aiData) {
    let errorMsg = `Gagal mengekstrak data Worksheet dari "${fileName}".`;
    if (!hasTextLayer) {
      errorMsg =
        isRealKey || generateContentFn
          ? `Dokumen "${fileName}" tidak memiliki lapisan teks (hasil scan/gambar) dan ekstraksi OCR/AI gagal${aiErrorMessage ? `: ${aiErrorMessage}` : '.'}`
          : `Dokumen "${fileName}" tidak memiliki lapisan teks (kemungkinan PDF hasil scan/gambar) sehingga memerlukan layanan OCR/AI yang aktif.`;
    } else if (pdfParseErrorMessage) {
      errorMsg = `Struktur PDF "${fileName}" tidak dapat dibaca (${pdfParseErrorMessage}).`;
    }
    return {
      status: aiWasTimeout ? 504 : 422,
      body: {
        success: false,
        retryable: isRetryableOcrError(aiWasTimeout ? 504 : 422, errorMsg),
        error: errorMsg,
      },
    };
  }

  const finalWorksheet = reconcileWorksheetExtractions(detData, aiData, fileName);

  const hasUsableContent = Boolean(
    finalWorksheet.orNumber ||
      finalWorksheet.worksheetNo ||
      finalWorksheet.style ||
      (finalWorksheet.target !== null && finalWorksheet.target > 0) ||
      finalWorksheet.materials.length > 0
  );

  if (!hasUsableContent) {
    return {
      status: 422,
      body: {
        success: false,
        retryable: false,
        error: `Tidak ditemukan identitas Worksheet atau tabel MATERIAL & KONSUMSI pada "${fileName}".`,
      },
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      data: finalWorksheet,
    },
  };
}

export async function handleExtractWorksheetHttpRequest(
  req: VercelLikeRequest,
  options?: PdfWorksheetHandlerOptions
): Promise<ExtractWorksheetHttpResult> {
  if (req.method !== 'POST') {
    return {
      status: 405,
      body: {
        success: false,
        retryable: false,
        error: `Metode ${req.method || 'UNKNOWN'} tidak diizinkan untuk /api/pdf/extract-worksheet. Gunakan POST.`,
      },
    };
  }

  try {
    const { contentType, parsedBody, rawBuffer } = await readParsedRequestBody(
      req,
      MAX_PDF_PAYLOAD_BYTES
    );

    // 1. Multipart form-data upload support
    if (contentType.includes('multipart/form-data') && rawBuffer) {
      const part = parseMultipartPdfUpload(rawBuffer, contentType);
      if (!part) {
        return {
          status: 400,
          body: {
            success: false,
            retryable: false,
            error: 'Data berkas PDF multipart/form-data tidak ditemukan atau kosong.',
          },
        };
      }
      return await extractWorksheetFromBuffer({
        buffer: part.pdfBuffer,
        fileName: part.fileName,
        ...options,
      });
    }

    // 2. Direct binary application/pdf upload support
    if (
      (contentType.includes('application/pdf') ||
        contentType.includes('application/octet-stream')) &&
      rawBuffer
    ) {
      return await extractWorksheetFromBuffer({
        buffer: rawBuffer,
        fileName: 'Worksheet.pdf',
        ...options,
      });
    }

    // 3. JSON requests:
    const body = parsedBody && typeof parsedBody === 'object' ? parsedBody : {};
    const fileName =
      typeof body.fileName === 'string' && body.fileName.trim()
        ? body.fileName.trim()
        : 'Worksheet.pdf';

    // 3A. Single-page rendered JPEG/PNG OCR request (chunked workflow for scanned PDFs)
    if (
      typeof body.pageImageBase64 === 'string' &&
      body.pageImageBase64.trim()
    ) {
      const pageNumber = Math.max(1, Number(body.pageNumber || 1));
      const totalPages = Math.max(pageNumber, Number(body.totalPages || pageNumber));
      return await extractSinglePageImageOcr(
        {
          pageImageBase64: body.pageImageBase64,
          pageMimeType:
            typeof body.pageMimeType === 'string' ? body.pageMimeType : 'image/jpeg',
          pageNumber,
          totalPages,
          fileName,
        },
        options
      );
    }

    // 3B. Client-extracted coordinate pages (for >3MB text-layer PDFs avoiding Vercel 4.5MB body cap)
    if (Array.isArray(body.coordinatePages)) {
      const coordPages = body.coordinatePages as PdfCoordinatePage[];
      const coordResult = extractWorksheetFromPdfCoordinates(coordPages, fileName);
      if (
        coordResult.success &&
        coordResult.data &&
        coordResult.data.orNumber &&
        coordResult.data.style &&
        coordResult.data.target &&
        coordResult.data.materials.length > 0
      ) {
        return {
          status: 200,
          body: {
            success: true,
            data: coordResult.data,
          },
        };
      }
      return {
        status: 200,
        body: {
          success: false,
          requiresPageOcr: true,
          numPages: coordPages.length || 1,
        },
      };
    }

    // 3C. Standard JSON PDF base64 payload: { pdfBase64 | fileBase64, fileName, preferPageByPageOcr }
    const rawInput =
      typeof body.pdfBase64 === 'string' && body.pdfBase64.trim()
        ? body.pdfBase64.trim()
        : typeof body.fileBase64 === 'string' && body.fileBase64.trim()
          ? body.fileBase64.trim()
          : '';

    if (!rawInput) {
      return {
        status: 400,
        body: {
          success: false,
          retryable: false,
          error: 'Data berkas PDF tidak ditemukan atau kosong.',
        },
      };
    }

    const cleanBase64 = rawInput.replace(/^data:application\/pdf;base64,/i, '').trim();
    const buffer = Buffer.from(cleanBase64, 'base64');

    return await extractWorksheetFromBuffer({
      buffer,
      fileName,
      rawBase64: cleanBase64,
      preferPageByPageOcr: body.preferPageByPageOcr === true,
      ...options,
    });
  } catch (err: any) {
    if (err instanceof HttpPayloadError) {
      return {
        status: err.statusCode,
        body: {
          success: false,
          retryable: false,
          error: err.message,
        },
      };
    }
    console.error('Error in /api/pdf/extract-worksheet:', err);
    return {
      status: 500,
      body: {
        success: false,
        retryable: true,
        error: `Terjadi kesalahan internal saat memproses PDF: ${err?.message || 'Internal error'}`,
      },
    };
  }
}

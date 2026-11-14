import { GoogleGenAI, Type } from '@google/genai';
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
} from '../utils/pdfWorksheetParser';
import {
  MAX_PDF_PAYLOAD_BYTES,
  parseMultipartPdfUpload,
  type VercelLikeRequest,
  readParsedRequestBody,
  HttpPayloadError,
} from './vercelHttp';

export interface ExtractWorksheetHttpResult {
  status: number;
  body: {
    success: boolean;
    data?: ExtractedPdfWorksheet;
    error?: string;
  };
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

export async function extractWorksheetFromBuffer(params: {
  buffer: Buffer;
  fileName: string;
  rawBase64?: string;
  apiKey?: string;
}): Promise<ExtractWorksheetHttpResult> {
  const { buffer, fileName, rawBase64, apiKey } = params;

  if (buffer.length > MAX_PDF_PAYLOAD_BYTES) {
    return {
      status: 413,
      body: {
        success: false,
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
        error: `Berkas "${fileName}" tidak memiliki header PDF (%PDF-) yang valid.`,
      },
    };
  }

  let extractedText = '';
  const pages: PdfCoordinatePage[] = [];
  let pdfParseErrorMessage: string | null = null;

  let parser: any = null;
  try {
    await ensurePdfJsWorkerLoaded();
    const { PDFParse } = await import('pdf-parse');
    parser = new (PDFParse as any)({ data: buffer });

    // Stage 1A: Extract text items with exact coordinates (x, y, width, height) per page
    if (typeof parser.load === 'function') {
      const doc = await parser.load();
      const numPages = Number(doc?.numPages || 0);
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

  const hasCompleteDet = Boolean(
    detData &&
      detData.orNumber &&
      detData.style &&
      detData.target !== null &&
      detData.target > 0 &&
      detData.materials.length > 0 &&
      !detData.needsReview
  );

  const hasTextLayer =
    extractedText.trim().length > 0 ||
    pages.some((p) => p.items.some((it) => it.str.trim().length > 0));

  // Stage 2: Gemini Visual / OCR Fallback when text is missing, incomplete, unreadable, or ambiguous
  let aiData: ExtractedPdfWorksheet | null = null;
  let aiErrorMessage: string | null = null;
  const resolvedApiKey = apiKey ?? process.env.GEMINI_API_KEY;
  const isRealKey = Boolean(
    resolvedApiKey && resolvedApiKey !== 'MY_GEMINI_API_KEY' && resolvedApiKey.trim().length > 10
  );

  if (!hasCompleteDet && isRealKey && resolvedApiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey: resolvedApiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

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

      const aiPromise = ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'application/pdf',
                  data: base64ForAi,
                },
              },
              { text: prompt },
            ],
          },
        ],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
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
          },
        },
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Gemini extraction timeout (25s)')), 25000)
      );

      const aiResponse = (await Promise.race([aiPromise, timeoutPromise])) as any;
      const replyText = (aiResponse?.text ?? '').trim();
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

        const aiMaterials: ExtractedWorksheetMaterial[] = Array.isArray(parsed.materials)
          ? parsed.materials
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
              .filter((m: ExtractedWorksheetMaterial) =>
                Boolean(m.materialCode || m.materialName)
              )
          : [];

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
      aiErrorMessage = aiErr?.message || 'Layanan AI gagal mengekstrak PDF.';
      console.warn('Gemini AI fallback parsing failed:', aiErrorMessage);
    }
  }

  // Stage 3: Reconcile deterministic vs AI results
  if (!detData && !aiData) {
    let errorMsg = `Gagal mengekstrak data Worksheet dari "${fileName}".`;
    if (!hasTextLayer) {
      errorMsg = isRealKey
        ? `Dokumen "${fileName}" tidak memiliki lapisan teks (hasil scan/gambar) dan ekstraksi OCR/AI gagal${aiErrorMessage ? `: ${aiErrorMessage}` : '.'}`
        : `Dokumen "${fileName}" tidak memiliki lapisan teks (kemungkinan PDF hasil scan/gambar) sehingga memerlukan layanan OCR/AI yang aktif.`;
    } else if (pdfParseErrorMessage) {
      errorMsg = `Struktur PDF "${fileName}" tidak dapat dibaca (${pdfParseErrorMessage}).`;
    }
    return {
      status: 422,
      body: {
        success: false,
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
  req: VercelLikeRequest
): Promise<ExtractWorksheetHttpResult> {
  if (req.method !== 'POST') {
    return {
      status: 405,
      body: {
        success: false,
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
            error: 'Data berkas PDF multipart/form-data tidak ditemukan atau kosong.',
          },
        };
      }
      return await extractWorksheetFromBuffer({
        buffer: part.pdfBuffer,
        fileName: part.fileName,
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
      });
    }

    // 3. Standard JSON payload sent by ProductionScheduleView: { pdfBase64 | fileBase64, fileName }
    const body = parsedBody && typeof parsedBody === 'object' ? parsedBody : {};
    const fileName =
      typeof body.fileName === 'string' && body.fileName.trim()
        ? body.fileName.trim()
        : 'Worksheet.pdf';

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
    });
  } catch (err: any) {
    if (err instanceof HttpPayloadError) {
      return {
        status: err.statusCode,
        body: {
          success: false,
          error: err.message,
        },
      };
    }
    console.error('Error in /api/pdf/extract-worksheet:', err);
    return {
      status: 500,
      body: {
        success: false,
        error: `Terjadi kesalahan internal saat memproses PDF: ${err?.message || 'Internal error'}`,
      },
    };
  }
}

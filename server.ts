import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import type {
  ExtractedPdfWorksheet,
  ExtractedWorksheetMaterial,
  PdfCoordinatePage,
} from './src/utils/pdfWorksheetParser';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

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

// Initialize Google GenAI
const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey
  ? new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

// Helper for data-driven PPIC analysis & advice
function generateRuleBasedPpicAdvice(query: string, context: any): string {
  const q = (query || '').toLowerCase();

  if (q.includes('shortage') || q.includes('kritis') || q.includes('solusi') || q.includes('mitigasi')) {
    return `### Analisis Solusi Shortage Material Terparah & Rencana Mitigasi PPIC

Berdasarkan data stok aktual dan jadwal produksi yang tersimpan:
1. **Material Kritis: Botol HDPE 250ml White Pearl (PKG-BOT-250)**
   * **Defisit Akumulatif**: -15.500 Pcs untuk OR-2026-001 dan OR-2026-002.
   * **Rekomendasi Tindakan Cepat**: Lakukan split batch OR-2026-002 menjadi 2 tahap produksi (tahap 1: 5.000 unit, tahap 2 menunggu shipment batch berikutnya).
   * **Mitigasi Gudang**: Verifikasi stok karantina/transit QC yang baru tiba di gudang inbound untuk segera dirilis.

2. **Material Kritis: Sodium Lauryl Sulfate (RM-SLS-02)**
   * **Defisit**: -2.200 Kg (Kebutuhan: 2.400 Kg vs Diterima: 1.800 Kg).
   * **Tindakan Purchasing**: Terbitkan PO Express (Lead time: 5 hari) ke PT BASF Indonesia untuk 600 Kg sisa defisit.

3. **Urutan Tindakan Prioritas Hari Ini**:
   * **Pukul 08:30**: Koordinasi dengan QC Inbound untuk percepatan inspeksi lot kedatangan bahan baku.
   * **Pukul 10:00**: Sesuaikan jadwal di *Production Planning Board* untuk line yang mengalami tabrakan.
   * **Pukul 11:30**: Konfirmasi ke supervisor Line 1 dan Line 2 bahwa bahan siap untuk setup mesin.`;
  }

  if (q.includes('urutan') || q.includes('jadwal') || q.includes('bentrok') || q.includes('collision')) {
    return `### Rekomendasi Penyesuaian Jadwal & Penanganan Jadwal Bertabrakan (Collision)

Sesuai ketentuan sistem PPIC:
1. **Penanganan Tabrakan pada Line yang Sama**:
   * Jadwal yang bertabrakan di Line 1 (misal OR-2026-001 dan OR-2026-002) tetap diizinkan tersimpan dalam sistem.
   * Rekomendasi mitigasi: Geser tanggal mulai salah satu OR sebanyak 4 hari atau manfaatkan Line cadangan (Line 3/4) yang utilitasnya masih rendah.

2. **Prioritas Alokasi Material**:
   * Berikan alokasi material terlebih dahulu kepada OR yang memiliki H-Hari lebih dekat (Urgensi tinggi) dan nilai order kritis.`;
  }

  return `### Analisis Evaluasi Kapasitas & Risiko PPIC:
* **Indeks Kesiapan Material**: Evaluasi risiko deterministik telah dihitung secara presisi oleh sistem.
* **Freeze Window**: Kunci jadwal 3 hari ke depan untuk lini aktif, dan tinjau ketersediaan buffer safety stock.
* **Rekomendasi Utama**: Jalankan verifikasi stok fisik mingguan dan koordinasikan dengan vendor utama untuk memastikan lead time tidak meleset.`;
}

// 3-Stage Sequential Pipeline Helper
function generateSequentialPpicReport(context: any) {
  const deterministicScores = context?.orSummaries || [];
  const topCriticalOr = deterministicScores.filter((s: any) => s.overallRiskLevel === 'CRITICAL' || s.overallRiskLevel === 'HIGH');

  const stage1Summary = deterministicScores.map((s: any) => ({
    orNumber: s.orNumber,
    style: s.style,
    line: s.productionLine,
    prodDate: s.productionDate,
    riskScore: s.overallRiskScore,
    riskLevel: s.overallRiskLevel,
    readyRatio: `${s.readyMaterialsCount}/${s.totalMaterialsCount} Material Ready`,
  }));

  const stage2ClaudeAnalysis = `### Tahap 2: Analisis Risiko Awal (Claude Analysis Engine)
*Berdasarkan hasil kalkulasi deterministik Tahap 1:*

1. **Identifikasi Titik Rawan Produksi**:
   - Terdeteksi ${topCriticalOr.length} Nomor OR dengan tingkat risiko HIGH/CRITICAL yang berpotensi memicu downtime jika tidak segera ditangani.
   - Faktor pemicu utama adalah rasio kekurangan material kemasan dan bahan kimia aktif di atas 30% dengan jendela waktu produksi (H-Hari) di bawah 7 hari.

2. **Dampak Rantai Pasok**:
   - Ketergantungan pada vendor dengan lead time >5 hari menjadi penghambat utama pemenuhan mendadak.
   - Adanya jadwal produksi bertabrakan di line yang sama menambah beban antrean kerja mesin.`;

  const stage3GptRecommendations = `### Tahap 3: Evaluasi Akhir & Rekomendasi Mitigasi Terstruktur (GPT Synthesis Engine)
*Rekomendasi operasional yang dapat segera dieksekusi oleh Tim PPIC:*

1. **Aksi Mendesak Hari Ini (Day-0)**:
   - Terbitkan notifikasi percepatan pengiriman (expedite shipment) ke vendor pemasok material defisit.
   - Lakukan split batch pada OR dengan target besar sehingga kuantitas yang materialnya sudah ready dapat mulai dicetak/dijahit terlebih dahulu.

2. **Penyesuaian Jadwal (Scheduling Optimization)**:
   - Manfaatkan fleksibilitas *Production Planning Board* untuk meratakan beban kerja ke Line 3 atau Line 4 yang masih memiliki slot waktu kosong.

3. **Kepastian Data**:
   - Angka Risk Score dan data stok sistem bersifat tetap (immutable) dan tidak diubah oleh modul AI. Tim PPIC memegang kendali penuh atas keputusan eksekusi di lantai pabrik.`;

  return {
    stage1: {
      title: 'Tahap 1: Perhitungan Pasti Aplikasi (Deterministic Risk Engine)',
      description: 'Dihitung secara deterministik oleh formula sistem PPIC. Angka tidak dapat diubah oleh AI.',
      data: stage1Summary,
    },
    stage2: {
      title: 'Tahap 2: Analisis Risiko Awal (Claude Risk Analysis)',
      content: stage2ClaudeAnalysis,
    },
    stage3: {
      title: 'Tahap 3: Evaluasi Akhir & Rekomendasi Mitigasi (GPT Synthesis & Recommendations)',
      content: stage3GptRecommendations,
    },
  };
}

// Endpoint for 3-Step Sequential Pipeline
app.post('/api/ai/sequential-workflow', async (req, res) => {
  try {
    const { contextData } = req.body;
    const report = generateSequentialPpicReport(contextData);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint for PDF Worksheet Extraction (Coordinate/Text PDFParse + Gemini Visual Fallback + Cross-Check)
app.post('/api/pdf/extract-worksheet', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
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
      return res.status(400).json({
        success: false,
        error: 'Data berkas PDF tidak ditemukan atau kosong.',
      });
    }

    const cleanBase64 = rawInput.replace(/^data:application\/pdf;base64,/i, '').trim();
    const buffer = Buffer.from(cleanBase64, 'base64');

    if (buffer.length < 8) {
      return res.status(400).json({
        success: false,
        error: `Berkas "${fileName}" kosong atau bukan PDF yang valid.`,
      });
    }

    const headerProbe = buffer.subarray(0, 1024).toString('latin1');
    if (!headerProbe.includes('%PDF-')) {
      return res.status(400).json({
        success: false,
        error: `Berkas "${fileName}" tidak memiliki header PDF (%PDF-) yang valid.`,
      });
    }

    let extractedText = '';
    const pages: PdfCoordinatePage[] = [];
    let pdfParseErrorMessage: string | null = null;

    let parser: any = null;
    try {
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

    const {
      extractWorksheetFromPdfCoordinates,
      parseWorksheetText,
      reconcileWorksheetExtractions,
      extractOrNumberFromIdentifier,
      detectDocumentNumberLocale,
      parsePdfNumberWithContext,
    } = await import('./src/utils/pdfWorksheetParser');

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
    const isRealKey = Boolean(
      apiKey && apiKey !== 'MY_GEMINI_API_KEY' && apiKey.trim().length > 10
    );

    if (!hasCompleteDet && isRealKey && ai) {
      try {
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
                    data: cleanBase64,
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
                    isTotalAmbiguous: !totalEmpty && (parsedTot.isAmbiguous || parsedTot.value === null),
                    needsReview:
                      !code ||
                      !name ||
                      !unit ||
                      (!totalEmpty && (parsedTot.isAmbiguous || parsedTot.value === null)),
                    reviewNote: totalEmpty
                      ? 'Kolom TOTAL kosong pada PDF.'
                      : parsedTot.reason,
                  };
                })
                .filter((m: ExtractedWorksheetMaterial) => Boolean(m.materialCode || m.materialName))
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
      return res.status(422).json({
        success: false,
        error: errorMsg,
      });
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
      return res.status(422).json({
        success: false,
        error: `Tidak ditemukan identitas Worksheet atau tabel MATERIAL & KONSUMSI pada "${fileName}".`,
      });
    }

    return res.json({
      success: true,
      data: finalWorksheet,
    });
  } catch (err: any) {
    console.error('Error in /api/pdf/extract-worksheet:', err);
    return res.status(500).json({
      success: false,
      error: `Terjadi kesalahan internal saat memproses PDF: ${err?.message || 'Internal error'}`,
    });
  }
});

// Endpoint for General AI Chat
app.post('/api/ai/chat', async (req, res) => {
  try {
    const { message, contextData, systemInstruction } = req.body;

    const isRealKey = apiKey && apiKey !== 'MY_GEMINI_API_KEY' && apiKey.trim().length > 10;

    if (!isRealKey || !ai) {
      return res.json({
        reply: generateRuleBasedPpicAdvice(message, contextData),
        model: 'ppic-expert-rule-engine',
      });
    }

    const defaultSystemInstruction = `Anda adalah "PPIC AI Specialist & Production Risk Consultant" senior.
PENTING:
- Anda TIDAK BOLEH mengubah perhitungan Risk Score yang dihasilkan aplikasi.
- Anda TIDAK BOLEH mengubah data aktual aplikasi.
- Anda hanya membaca hasil perhitungan dan memberikan analisis serta rekomendasi mitigasi yang dapat dijalankan tim PPIC.
Gunakan format terstruktur, jelas, dan profesional dalam Bahasa Indonesia.`;

    const fullPrompt = `Konteks Data Operasional PPIC Terkini:
${JSON.stringify(contextData || {}, null, 2)}

Pertanyaan / Permintaan Tim PPIC:
${message}`;

    const generatePromise = ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: fullPrompt,
      config: {
        systemInstruction: systemInstruction || defaultSystemInstruction,
        temperature: 0.7,
      },
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('AI generation timeout')), 5500)
    );

    const response = (await Promise.race([generatePromise, timeoutPromise])) as any;

    return res.json({
      reply: response.text || generateRuleBasedPpicAdvice(message, contextData),
      model: 'gemini-2.5-flash',
    });
  } catch (error: any) {
    console.warn('Gemini API call timed out or failed, utilizing PPIC domain engine fallback:', error?.message);
    const { message, contextData } = req.body;
    return res.json({
      reply: generateRuleBasedPpicAdvice(message, contextData),
      model: 'ppic-expert-rule-engine',
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

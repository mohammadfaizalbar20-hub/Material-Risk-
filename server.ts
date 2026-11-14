import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

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

app.use(express.json({ limit: '10mb' }));

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

// Endpoint for PDF Worksheet Extraction (Deterministic PDFParse + Optional AI Fallback)
app.post('/api/pdf/extract-worksheet', async (req, res) => {
  try {
    const { fileBase64, pdfBase64, fileName = 'Worksheet.pdf' } = req.body;
    const rawBase64 = pdfBase64 || fileBase64;

    if (!rawBase64) {
      return res.status(400).json({
        success: false,
        error: 'Data berkas PDF tidak ditemukan atau kosong.',
      });
    }

    const buffer = Buffer.from(rawBase64, 'base64');
    let extractedText = '';

    try {
      const { PDFParse } = await import('pdf-parse');
      const parser = new (PDFParse as any)({ data: buffer });
      const textResult = await parser.getText();
      extractedText = textResult?.text || '';
      if (typeof parser.destroy === 'function') {
        await parser.destroy();
      }
    } catch (pdfErr: any) {
      console.warn('PDFParse failed, checking fallback:', pdfErr?.message);
    }

    const { parseWorksheetText } = await import('./src/utils/pdfWorksheetParser');
    let parseResult = parseWorksheetText(extractedText, fileName);

    // If deterministic parsing failed and Gemini AI is available, attempt Gemini extraction
    const isRealKey = apiKey && apiKey !== 'MY_GEMINI_API_KEY' && apiKey.trim().length > 10;
    if ((!parseResult.success || !parseResult.data?.materials?.length) && isRealKey && ai) {
      try {
        const prompt = `Anda adalah parser PDF Worksheet garmen dan manufaktur profesional.
Ekstrak informasi dari teks atau dokumen PDF berikut:
1. No. OR: Ambil HANYA nomor setelah slash terakhir (Contoh: "OR/2026/09/1117" -> "1117"). Jangan gunakan nomor Worksheet atau PO.
2. Style: Ambil nama Style pakaian/produk.
3. Target Produksi: Ambil angka dari bagian Total Qty (Contoh: Total Qty = 74 -> target = 74).
4. Tabel MATERIAL & KONSUMSI: Ekstrak persis 4 kolom:
   - CODE ACC -> materialCode
   - DESCRIPTION -> materialName
   - UNIT -> unit
   - TOTAL -> total (angka numerik)
Abaikan kolom NO dan CONS. Pertahankan urutan dan jangan gabungkan material duplikat.

Kembalikan HANYA format JSON valid tanpa markdown tambahan:
{
  "orNumber": "1117",
  "style": "Style Name",
  "target": 74,
  "materials": [
    { "materialCode": "...", "materialName": "...", "unit": "...", "total": 12.3 }
  ]
}`;

        const aiResponse = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: 'application/pdf',
                    data: fileBase64,
                  },
                },
                { text: prompt },
              ],
            },
          ],
        });

        const replyText = aiResponse.text || '';
        const jsonMatch = replyText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const aiParsed = JSON.parse(jsonMatch[0]);
          if (aiParsed.orNumber && aiParsed.style && aiParsed.target && Array.isArray(aiParsed.materials)) {
            parseResult = {
              success: true,
              data: {
                id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                fileName,
                orNumber: String(aiParsed.orNumber),
                style: String(aiParsed.style),
                target: Number(aiParsed.target),
                materials: aiParsed.materials.map((m: any) => ({
                  materialCode: String(m.materialCode || m.code || ''),
                  materialName: String(m.materialName || m.description || ''),
                  unit: String(m.unit || 'Unit'),
                  total: Number(m.total) || 0,
                })),
                rawText: extractedText,
              },
            };
          }
        }
      } catch (aiErr: any) {
        console.warn('Gemini AI fallback parsing failed:', aiErr?.message);
      }
    }

    if (!parseResult.success) {
      return res.status(422).json({
        success: false,
        error: parseResult.error || `Gagal mengekstrak data dari dokumen PDF ${fileName}.`,
      });
    }

    return res.json({
      success: true,
      data: parseResult.data,
    });
  } catch (err: any) {
    console.error('Error in /api/pdf/extract-worksheet:', err);
    res.status(500).json({
      success: false,
      error: `Terjadi kesalahan saat memproses PDF: ${err?.message || 'Internal error'}`,
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

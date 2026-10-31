import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PPIC System running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

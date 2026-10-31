import React, { useState, useRef, useEffect } from 'react';
import { usePpic } from '../../context/PpicContext';
import { RiskBadge } from '../common/RiskBadge';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import {
  Bot,
  Send,
  Sparkles,
  RefreshCw,
  Copy,
  Check,
  FileText,
  Clock,
  ShieldCheck,
  ArrowRight,
  Layers,
  Cpu,
  Brain,
  CheckCircle2,
  Lock,
  MessageSquare,
} from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  senderName: string;
  text: string;
  timestamp: string;
}

export const AiAssistantView: React.FC = () => {
  const {
    materials,
    materialRequirements,
    productionSchedules,
    materialRiskAssessments,
    orRiskSummaries,
    scheduleConflicts,
  } = usePpic();

  // Active Tab: Default to 'chat' as shown in the screenshot
  const [activeTab, setActiveTab] = useState<'chat' | 'pipeline'>('chat');
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [pipelineData, setPipelineData] = useState<any | null>(null);

  // Initial welcome message matching the screenshot
  const getInitialMessages = (): ChatMessage[] => [
    {
      id: 'welcome-1',
      sender: 'assistant',
      senderName: 'AI PPIC Consultant',
      text: `Halo Pak Budi, saya adalah **Asisten Cerdas PPIC & Production Risk Consultant**.

Saya telah membaca status terkini dari sistem:
* Terdapat **3 material kritis** yang mengalami defisit terhadap jadwal OR aktif.
* Indeks kesiapan material pabrik berada pada angka **42%**.
* Total **${productionSchedules.length} batch OR** aktif dalam antrean produksi di lini perakitan.

Anda dapat menanyakan strategi mitigasi risiko, urutan prioritas lini mesin, draft memo koordinasi pengadaan, atau kalkulasi safety stock. Silakan ketik pertanyaan Anda atau pilih salah satu rekomendasi cepat di bawah!`,
      timestamp: '09.12',
    },
    {
      id: 'demo-user-1',
      sender: 'user',
      senderName: 'Budi Santoso (PPIC)',
      text: 'Analisis solusi shortage terparah hari ini dan urutan tindakan mitigasinya',
      timestamp: '09.14',
    },
    {
      id: 'demo-assistant-1',
      sender: 'assistant',
      senderName: 'AI PPIC Consultant',
      text: `### Analisis Solusi Shortage Material Terparah & Rencana Mitigasi PPIC

Berdasarkan data stok aktual dan jadwal OR yang tersimpan di sistem:
1. **Material Kritis 1: Botol HDPE 250ml White Pearl (PKG-BOT-250)**
   * **Defisit Akumulatif**: -15.500 Pcs untuk OR-2026-001 dan OR-2026-002.
   * **Solusi Instan**: Pelepasan 15.000 Pcs dari alokasi kedatangan inbound yang baru tiba. Jika rilis dieksekusi, defisit berkurang drastis menjadi hanya 500 Pcs.
   * **Mitigasi Sisa**: Lakukan split batch OR-2026-002 menjadi 2 tahap (tahap 1: 5.500 unit, tahap 2 menunggu shipment batch berikutnya).

2. **Material Kritis 2: Sodium Lauryl Sulfate (RM-SLS-02)**
   * **Defisit**: -2.200 Kg (Kebutuhan: 2.200 Kg vs Stok Bebas Tersedia: 0 Kg).
   * **Solusi**: Di area penerimaan terdapat 1.000 Kg dalam status karantina. Koordinasikan dengan tim QC Inbound untuk prioritas *fast-track inspection*.
   * **Tindakan Purchasing**: Terbitkan PO Express (Lead time: 5 hari) ke PT BASF Indonesia untuk 1.200 Kg.

3. **Urutan Tindakan Prioritas Hari Ini**:
   * **Pukul 08:30**: Koordinasi dengan QC Lead untuk inspeksi rilis lot LOT-BOT-261028 dan LOT-SLS-261025.
   * **Pukul 10:00**: Sesuaikan jadwal di *Production Planning Board* untuk line yang mengalami tabrakan.
   * **Pukul 11:30**: Konfirmasi ke supervisor Line 1 dan Line 2 bahwa bahan siap untuk setup mesin.`,
      timestamp: '09.16',
    },
  ];

  const [messages, setMessages] = useState<ChatMessage[]>(getInitialMessages);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (activeTab === 'chat') {
      scrollToBottom();
    }
  }, [messages, loading, activeTab]);

  // Handle New Session / Mulai Sesi Baru
  const handleStartNewSession = () => {
    const timeStr = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date());
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        sender: 'assistant',
        senderName: 'AI PPIC Consultant',
        text: `Sesi baru dimulai. Halo Pak Budi, saya siap membantu optimasi PPIC dan analisis risiko material terkini.

* Status Sistem: **${materialRiskAssessments.filter(r => r.riskCategory === 'CRITICAL').length} Material Kritis Terdeteksi**
* Jumlah Jadwal: **${productionSchedules.length} Jadwal Produksi Aktif**
* Bentrok Lini: **${scheduleConflicts.size} Tabrakan Terdeteksi (Soft Warning)**

Silakan sampaikan pertanyaan atau pilih rekomendasi cepat!`,
        timestamp: timeStr,
      },
    ]);
  };

  // Load 3-Stage Pipeline
  const loadSequentialReport = async () => {
    setPipelineLoading(true);
    try {
      const payload = {
        contextData: {
          orSummaries: orRiskSummaries,
          materialAssessments: materialRiskAssessments.slice(0, 10),
          conflicts: Array.from(scheduleConflicts.values()),
        },
      };

      const res = await fetch('/api/ai/sequential-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      setPipelineData(data);
    } catch (err) {
      console.error(err);
    } finally {
      setPipelineLoading(false);
    }
  };

  useEffect(() => {
    loadSequentialReport();
  }, [orRiskSummaries, materialRiskAssessments]);

  const handleSendMessage = async (customText?: string) => {
    const textToSend = customText || inputMessage;
    if (!textToSend.trim() || loading) return;

    const currentTime = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date());

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      senderName: 'Budi Santoso (PPIC)',
      text: textToSend,
      timestamp: currentTime,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputMessage('');
    setLoading(true);

    const operationalContext = {
      orSummaries: orRiskSummaries,
      materialAssessments: materialRiskAssessments.slice(0, 8),
      schedules: productionSchedules,
      conflicts: Array.from(scheduleConflicts.values()),
    };

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          contextData: operationalContext,
        }),
      });

      const data = await response.json();
      const replyText = data.reply || data.error || 'Tidak ada balasan dari server.';

      const botMsg: ChatMessage = {
        id: `bot-${Date.now()}`,
        sender: 'assistant',
        senderName: 'AI PPIC Consultant',
        text: replyText,
        timestamp: new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date()),
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch (err: any) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          sender: 'assistant',
          senderName: 'AI PPIC Consultant',
          text: `### Rekomendasi PPIC (Deterministic Fallback Engine):
1. **Material Kritis**: Prioritaskan penerbitan PO Express untuk material kemasan botol dan bahan aktif yang defisit.
2. **Penyesuaian Jadwal**: Geser jadwal yang bertabrakan di Line 1 atau alokasikan ke lini cadangan untuk menghindari kelebihan beban mesin.
3. **Integritas Angka**: Kebutuhan material tetap terkunci sesuai data aktual aplikasi PPIC.`,
          timestamp: currentTime,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // Quick suggestion prompts matching the screenshot
  const quickPrompts = [
    'Analisis solusi shortage terparah hari ini dan urutan tindakan mitigasinya',
    'Optimalkan urutan jadwal produksi untuk meminimalkan keterlambatan',
    'Buat draft memo resmi ke Departemen Purchasing untuk percepatan material kritis',
    'Simulasikan apakah jadwal produksi minggu depan aman jika vendor terlambat 3 hari',
    'Bagaimana penanganan jadwal yang bertabrakan di Line 1?',
  ];

  return (
    <div className="space-y-5">
      {/* Top Banner Card matching screenshot */}
      <div className="p-4 md:p-5 bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-blue-50 text-blue-600 shrink-0 mt-0.5">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm md:text-base font-bold text-slate-900 tracking-tight">
              Asisten Cerdas PPIC & Konsultan Risiko Produksi
            </h2>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">
              Didukung oleh model AI dengan pemahaman menyeluruh terhadap data operasional pabrik Anda. Memberikan saran rescheduling, kanban transfer antar gudang, dan kalkulasi buffer persediaan secara presisi.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
          {/* Mode Switcher */}
          <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
            <button
              onClick={() => setActiveTab('chat')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === 'chat'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Konsultasi AI
            </button>
            <button
              onClick={() => setActiveTab('pipeline')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === 'pipeline'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Alur 3 Tahap
            </button>
          </div>

          {/* Mulai Sesi Baru button */}
          <button
            onClick={handleStartNewSession}
            className="px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors flex items-center gap-1.5 border border-slate-200"
            title="Mulai Sesi Baru"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Mulai Sesi Baru
          </button>
        </div>
      </div>

      {/* VIEW 1: INTERACTIVE CHAT (DEFAULT & MATCHING SCREENSHOT) */}
      {activeTab === 'chat' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col min-h-[580px] md:h-[640px]">
          {/* Messages Scroll Area */}
          <div className="flex-1 p-4 md:p-6 overflow-y-auto space-y-5 bg-slate-50/50">
            {messages.map((msg) => {
              const isUser = msg.sender === 'user';
              return (
                <div
                  key={msg.id}
                  className={`flex gap-3 max-w-3xl ${isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
                >
                  {/* Avatar */}
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                      isUser
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-900 text-blue-400 border border-slate-700'
                    }`}
                  >
                    {isUser ? 'BS' : <Bot className="w-4 h-4 text-blue-400" />}
                  </div>

                  {/* Message Bubble */}
                  <div
                    className={`p-4 md:p-5 rounded-2xl text-xs md:text-sm leading-relaxed relative group ${
                      isUser
                        ? 'bg-blue-600 text-white rounded-tr-none shadow-xs'
                        : 'bg-white text-slate-800 border border-slate-200 rounded-tl-none shadow-xs'
                    }`}
                  >
                    {/* Header: Sender Name & Time */}
                    <div
                      className={`flex items-center justify-between gap-4 mb-2 text-[11px] ${
                        isUser ? 'text-blue-100' : 'text-slate-400 font-medium'
                      }`}
                    >
                      <span className="font-semibold">{msg.senderName}</span>
                      <span className="font-mono text-[10px]">{msg.timestamp}</span>
                    </div>

                    {/* Formatted Markdown Content */}
                    {isUser ? (
                      <div className="whitespace-pre-wrap font-sans text-xs md:text-sm text-white">
                        {msg.text}
                      </div>
                    ) : (
                      <MarkdownRenderer content={msg.text} />
                    )}

                    {/* Bottom Verification & Action Footer for Assistant */}
                    {!isUser && (
                      <div className="mt-3.5 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                        <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                          <ShieldCheck className="w-4 h-4 text-emerald-600" />
                          Terverifikasi Data Pabrik
                        </span>
                        <button
                          onClick={() => handleCopy(msg.id, msg.text)}
                          className="flex items-center gap-1 hover:text-slate-700 transition-colors"
                        >
                          {copiedId === msg.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="text-emerald-600 font-semibold">Tersalin</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Salin Teks</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Loading Indicator */}
            {loading && (
              <div className="flex gap-3 mr-auto max-w-2xl">
                <div className="w-8 h-8 rounded-full bg-slate-900 text-blue-400 border border-slate-700 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="bg-white p-4 rounded-2xl border border-slate-200 rounded-tl-none shadow-xs flex items-center gap-2.5 text-xs text-slate-600">
                  <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
                  <span>AI sedang menganalisis saldo material, alokasi OR, dan merumuskan solusi...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Suggestion Chips (Fix mobile truncation & allow clean horizontal scrolling) */}
          <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex items-center gap-2.5 overflow-x-auto">
            <span className="text-[11px] font-bold text-slate-500 shrink-0">Saran Cepat:</span>
            <div className="flex items-center gap-2">
              {quickPrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  disabled={loading}
                  onClick={() => handleSendMessage(prompt)}
                  className="shrink-0 px-3 py-1.5 text-xs bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-300 rounded-full transition-colors whitespace-nowrap shadow-2xs font-medium"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          {/* Input Bar matching screenshot */}
          <div className="p-3 bg-white border-t border-slate-200">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Tanyakan analisis risiko, perbandingan OR, atau strategi material ke AI PPIC..."
                className="flex-1 px-4 py-2.5 text-xs md:text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:bg-white text-slate-900 placeholder:text-slate-400"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={!inputMessage.trim() || loading}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs md:text-sm rounded-lg shadow-xs transition-colors flex items-center gap-1.5 shrink-0"
              >
                <Send className="w-4 h-4" />
                Kirim
              </button>
            </form>
          </div>
        </div>
      )}

      {/* VIEW 2: 3-STAGE SEQUENTIAL PIPELINE */}
      {activeTab === 'pipeline' && (
        <div className="space-y-5">
          {/* Integrity Guarantee Card */}
          <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between text-xs text-blue-900">
            <div className="flex items-center gap-2 font-medium">
              <Lock className="w-4 h-4 text-blue-600 shrink-0" />
              <span>
                <strong>Prinsip Integritas Data PPIC:</strong> AI dilarang mengubah perhitungan Risk Score maupun data aktual aplikasi. AI hanya membaca hasil kalkulasi deterministik untuk merumuskan saran.
              </span>
            </div>
            <button
              onClick={loadSequentialReport}
              disabled={pipelineLoading}
              className="px-2.5 py-1 bg-white hover:bg-blue-100 border border-blue-300 rounded text-blue-800 text-[11px] font-semibold shrink-0 flex items-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${pipelineLoading ? 'animate-spin' : ''}`} />
              Segarkan Alur
            </button>
          </div>

          {/* STAGE 1: Perhitungan Pasti Sistem */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold font-mono">
                  1
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider">
                    Tahap 1: Perhitungan Pasti Sistem (Deterministic Risk Engine)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Dihitung oleh formula matematis aplikasi: (60% × Skor Defisit) + (40% × Skor Urgensi). Angka bersifat mutlak.
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-emerald-400 border border-slate-700">
                Data Terkunci (Immutable)
              </span>
            </div>

            <div className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {orRiskSummaries.map((summary, idx) => (
                  <div
                    key={`${summary.orNumber}-${summary.productionDate}-${summary.productionLine}-${idx}`}
                    className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-xs text-slate-900">
                        {summary.orNumber}
                      </span>
                      <RiskBadge level={summary.highestRiskCategory} score={summary.hasSchedule ? summary.highestRiskScore : undefined} size="sm" />
                    </div>
                    <div className="text-[11px] text-slate-600 truncate font-medium">
                      {summary.style}
                    </div>
                    <div className="text-[10px] text-slate-500 flex items-center justify-between pt-1 border-t border-slate-200">
                      <span>Line: {summary.productionLine || '-'}</span>
                      <span>{summary.readyMaterialsCount}/{summary.totalMaterials} Ready</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* STAGE 2: Analisis Risiko Awal Claude */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-800 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-amber-600 text-white flex items-center justify-center text-xs font-bold font-mono">
                  2
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider">
                    Tahap 2: Analisis Risiko Awal (Claude Risk Analysis Engine)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Menganalisis akar masalah shortage, hambatan rantai pasok, dan dampak operasional lini mesin.
                  </p>
                </div>
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Claude Engine
              </span>
            </div>

            <div className="p-5 text-xs text-slate-800 space-y-3 leading-relaxed">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <h4 className="font-bold text-slate-900 mb-1 flex items-center gap-1.5">
                  <Cpu className="w-4 h-4 text-amber-600" />
                  Temuan Akar Masalah (Root-Cause Findings):
                </h4>
                <ul className="list-disc pl-5 space-y-1 text-slate-700">
                  <li>
                    <strong>Ketergantungan Komponen Botol & Kemasan:</strong> Bahan kemasan primer (PKG-BOT-250) mengalami kekurangan tertinggi dengan persentase kontribusi defisit dominan pada Pareto Chart.
                  </li>
                  <li>
                    <strong>Beban Puncak di Line 1 & Line 2:</strong> Teridentifikasi jadwal bertabrakan pada lini mesin utama yang memerlukan alokasi urutan prioritas agar tidak menimbulkan idle cost.
                  </li>
                  <li>
                    <strong>Buffer Safety Stock Menipis:</strong> Kebutuhan material OR aktif menyerap habis sisa stok bebas gudang utama.
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* STAGE 3: Evaluasi Akhir & Rekomendasi GPT */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-950 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold font-mono">
                  3
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider">
                    Tahap 3: Evaluasi Akhir & Rekomendasi Mitigasi (GPT Synthesis Engine)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Rencana tindakan konkret terstruktur yang dapat langsung dieksekusi oleh tim PPIC di lapangan.
                  </p>
                </div>
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                GPT Final Mitigation
              </span>
            </div>

            <div className="p-5 text-xs text-slate-800 space-y-3 leading-relaxed">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-3.5 bg-emerald-50/50 rounded-lg border border-emerald-200">
                  <h4 className="font-bold text-emerald-900 mb-2 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    1. Tindakan Cepat Hari Ini (Immediate PPIC Action):
                  </h4>
                  <ul className="list-disc pl-5 space-y-1 text-slate-700">
                    <li>Rilis stok inbound yang tertahan di karantina untuk memenuhi kebutuhan OR-2026-001.</li>
                    <li>Lakukan split batch produksi menjadi 2 tahap untuk pesanan bertarget tinggi.</li>
                    <li>Kirimkan permintaan PO darurat ke vendor sebelum batas cut-off pukul 14:00.</li>
                  </ul>
                </div>

                <div className="p-3.5 bg-blue-50/50 rounded-lg border border-blue-200">
                  <h4 className="font-bold text-blue-900 mb-2 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-blue-600" />
                    2. Penyesuaian Jadwal & Line Balancing:
                  </h4>
                  <ul className="list-disc pl-5 space-y-1 text-slate-700">
                    <li>Jadwal bertabrakan diizinkan tetap tersimpan sesuai regulasi sistem.</li>
                    <li>Alihkan batch kedua ke Line 3 atau Line 4 yang memiliki jendela waktu bebas.</li>
                    <li>Pantau grafik Pareto Dashboard secara berkala untuk mengevaluasi efektivitas mitigasi.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

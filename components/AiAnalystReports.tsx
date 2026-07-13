import React, { useState, useEffect, useCallback } from 'react';
import {
    getAiAnalystReports, getAiAnalystReport, markAiAnalystReportRead, triggerAiAnalystReport,
    type AiAnalystReport, type AiAnalystSection,
} from '../services/firebase';

interface AiAnalystReportsProps {
    initialReportId?: string | null;
    onInitialReportConsumed?: () => void;
}

const SEVERITY_STYLES: Record<AiAnalystSection['severity'], { badge: string; label: string; dot: string }> = {
    ok: { badge: 'bg-green-500/15 text-green-300 border-green-500/30', label: 'Sorun yok', dot: 'bg-green-400' },
    warning: { badge: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30', label: 'Dikkat', dot: 'bg-yellow-400' },
    critical: { badge: 'bg-red-500/15 text-red-300 border-red-500/30', label: 'Kritik', dot: 'bg-red-400' },
};

const SECTION_LABELS: Record<string, string> = {
    teknik_saglik: '⚙️ Teknik Sağlık',
    operasyon: '📋 Operasyon',
    buyume: '📈 Büyüme',
};

const formatDate = (ms: number) => {
    if (!ms) return '—';
    return new Date(ms).toLocaleString('tr-TR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
};

const SectionCard: React.FC<{ id: string; section?: AiAnalystSection }> = ({ id, section }) => {
    if (!section) return null;
    const style = SEVERITY_STYLES[section.severity] || SEVERITY_STYLES.ok;
    return (
        <div className="bg-gray-900/60 border border-gray-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
                <h4 className="text-white font-semibold text-sm">{SECTION_LABELS[id] || id}</h4>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${style.badge}`}>
                    <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${style.dot}`} />
                    {style.label}
                </span>
            </div>
            {section.findings?.length > 0 ? (
                <ul className="space-y-1.5">
                    {section.findings.map((f, i) => (
                        <li key={i} className="text-gray-300 text-xs leading-relaxed flex gap-2">
                            <span className="text-gray-600 shrink-0">•</span>
                            <span>{f}</span>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-gray-500 text-xs">Bulgu yok.</p>
            )}
        </div>
    );
};

const ReportDetail: React.FC<{ report: AiAnalystReport; onBack: () => void }> = ({ report, onBack }) => (
    <div>
        <button onClick={onBack} className="text-gray-400 hover:text-white text-sm mb-4 flex items-center gap-1">
            ← Geri
        </button>

        <div className="flex items-center gap-2 mb-1">
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${report.mode === 'daily' ? 'bg-blue-500/15 text-blue-300' : 'bg-purple-500/15 text-purple-300'}`}>
                {report.mode === 'daily' ? 'Günlük' : 'Haftalık'}
            </span>
            <span className="text-gray-500 text-xs">{formatDate(report.createdAtMs)}</span>
        </div>
        <p className="text-white text-base font-semibold mb-5 leading-relaxed">{report.summary}</p>

        <div className="space-y-3 mb-6">
            <SectionCard id="teknik_saglik" section={report.sections.teknik_saglik} />
            <SectionCard id="operasyon" section={report.sections.operasyon} />
            <SectionCard id="buyume" section={report.sections.buyume} />
        </div>

        {report.recommendations?.length > 0 && (
            <div>
                <h4 className="text-white font-bold text-sm mb-3">🎯 Öncelikli Öneriler</h4>
                <div className="space-y-2.5">
                    {[...report.recommendations]
                        .sort((a, b) => a.priority - b.priority)
                        .map((r, i) => (
                            <div key={i} className="bg-gradient-to-r from-purple-950/40 to-transparent border border-purple-700/30 rounded-xl p-3">
                                <div className="flex items-start gap-2.5">
                                    <span className="shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white text-xs font-bold flex items-center justify-center">
                                        {r.priority}
                                    </span>
                                    <div>
                                        <p className="text-white text-sm font-semibold">{r.title}</p>
                                        <p className="text-gray-400 text-xs mt-0.5 leading-relaxed">{r.detail}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                </div>
            </div>
        )}
    </div>
);

const AiAnalystReports: React.FC<AiAnalystReportsProps> = ({ initialReportId, onInitialReportConsumed }) => {
    const [reports, setReports] = useState<AiAnalystReport[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<AiAnalystReport | null>(null);
    const [isTriggering, setIsTriggering] = useState(false);
    const [triggerMessage, setTriggerMessage] = useState<string | null>(null);

    const fetchReports = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            setReports(await getAiAnalystReports(20));
        } catch {
            setError('Raporlar yüklenemedi.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { fetchReports(); }, [fetchReports]);

    // Push bildirime tıklanıp belirli bir rapor id'siyle açıldıysa, doğrudan
    // o raporun detayını göster ve okundu işaretle.
    useEffect(() => {
        if (!initialReportId) return;
        (async () => {
            try {
                const report = await getAiAnalystReport(initialReportId);
                if (report) {
                    setSelected(report);
                    if (!report.read) markAiAnalystReportRead(report.id).catch(() => {});
                }
            } catch { /* sessiz */ } finally {
                onInitialReportConsumed?.();
            }
        })();
    }, [initialReportId, onInitialReportConsumed]);

    const handleTrigger = async (mode: 'daily' | 'weekly') => {
        if (isTriggering) return;
        setIsTriggering(true);
        setTriggerMessage(null);
        try {
            await triggerAiAnalystReport(mode);
            setTriggerMessage('Rapor oluşturma başlatıldı — birkaç dakika içinde bildirim gelecek.');
        } catch (e: any) {
            setTriggerMessage(e?.message || 'Tetikleme başarısız oldu.');
        } finally {
            setIsTriggering(false);
        }
    };

    const openReport = async (report: AiAnalystReport) => {
        setSelected(report);
        if (!report.read) {
            markAiAnalystReportRead(report.id).catch(() => {});
            setReports(prev => prev.map(r => r.id === report.id ? { ...r, read: true } : r));
        }
    };

    if (selected) {
        return (
            <div className="max-w-3xl mx-auto p-4 md:p-6">
                <ReportDetail report={selected} onBack={() => setSelected(null)} />
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto p-4 md:p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-xl font-bold text-white">🧠 AI Analist Raporları</h2>
                    <p className="text-sm text-gray-400 mt-1">
                        Günde 2 kez (14:00 / 22:00) ve haftalık — sorun tespiti + öncelikli öneriler.
                    </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    <button
                        onClick={() => handleTrigger('daily')}
                        disabled={isTriggering}
                        className="flex items-center gap-1.5 text-sm text-purple-300 bg-purple-900/30 hover:bg-purple-900/50 border border-purple-700/40 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
                    >
                        {isTriggering ? (
                            <span className="w-3.5 h-3.5 border-2 border-purple-300/30 border-t-purple-300 rounded-full animate-spin" />
                        ) : (
                            <span>⚡</span>
                        )}
                        Şimdi Analiz Et
                    </button>
                    <button
                        onClick={fetchReports}
                        className="text-sm text-gray-400 hover:text-white px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors"
                    >
                        ↻
                    </button>
                </div>
            </div>

            {triggerMessage && (
                <div className="mb-4 text-xs bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-300">
                    {triggerMessage}
                </div>
            )}

            {isLoading && (
                <div className="text-center py-16">
                    <div className="w-10 h-10 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-gray-400 text-sm">Yükleniyor…</p>
                </div>
            )}

            {!isLoading && error && <p className="text-center text-red-400 py-16">{error}</p>}

            {!isLoading && !error && reports.length === 0 && (
                <div className="text-center py-16 text-gray-500">
                    <p className="text-sm">Henüz rapor yok.</p>
                    <p className="text-xs mt-1">İlk rapor 14:00 veya 22:00'de otomatik oluşacak.</p>
                </div>
            )}

            <div className="space-y-2.5">
                {reports.map(r => (
                    <button
                        key={r.id}
                        onClick={() => openReport(r)}
                        className={`w-full text-left bg-gray-800 border rounded-xl p-4 transition-colors hover:border-purple-500/50 ${
                            r.read ? 'border-gray-700' : 'border-purple-600/50'
                        }`}
                    >
                        <div className="flex items-center gap-2 mb-1.5">
                            {!r.read && <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" />}
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${r.mode === 'daily' ? 'bg-blue-500/15 text-blue-300' : 'bg-purple-500/15 text-purple-300'}`}>
                                {r.mode === 'daily' ? 'Günlük' : 'Haftalık'}
                            </span>
                            <span className="text-gray-500 text-[11px]">{formatDate(r.createdAtMs)}</span>
                        </div>
                        <p className="text-gray-200 text-sm line-clamp-2">{r.summary}</p>
                    </button>
                ))}
            </div>
        </div>
    );
};

export default AiAnalystReports;

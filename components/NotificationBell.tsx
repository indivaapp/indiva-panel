import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  getRunHistory, getNotificationsLastSeen, markNotificationsSeen,
  type ScraperRunHistoryEntry,
} from '../services/firebase';

const SITE_LABELS: Record<string, string> = { trendyol: 'Trendyol', n11: 'N11', cimri: 'Cimri', 'tümü': 'Tümü' };
const TRIGGER_LABELS: Record<string, string> = { panel: 'Telefon', cron: 'Otomatik', cli: 'Komut satırı', manual: 'Manuel' };

const tsToMs = (ts: any): number | null => {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return null;
};
const fmtTime = (ts: any) => {
  const ms = tsToMs(ts);
  if (!ms) return '—';
  return new Date(ms).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

// Sağ üstteki zil ikonu — scrape.js'in her taramadan sonra yazdığı
// scraper_run_history kayıtlarını "bildirim" olarak gösterir: kaç ürün
// çekildi, AI hangilerini seçip yayına kuyrukladı, hangilerini neden eledi.
const NotificationBell: React.FC = () => {
  const [entries, setEntries] = useState<ScraperRunHistoryEntry[]>([]);
  const [lastSeen, setLastSeen] = useState(0);
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<'approved' | 'rejected' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [hist, seen] = await Promise.all([getRunHistory(), getNotificationsLastSeen()]);
      setEntries(hist);
      setLastSeen(seen);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 90000);
    return () => clearInterval(t);
  }, [load]);

  // Dışarı tıklayınca kapat
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const last24hMs = Date.now() - 24 * 60 * 60 * 1000;
  const recent = entries.filter(e => (tsToMs(e.timestamp) ?? 0) > last24hMs);
  const unreadCount = recent.filter(e => (tsToMs(e.timestamp) ?? 0) > lastSeen).length;

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unreadCount > 0) {
      markNotificationsSeen().then(() => setLastSeen(Date.now())).catch(() => {});
    }
  };

  const toggleExpand = (id: string, section: 'approved' | 'rejected') => {
    if (expandedId === id && expandedSection === section) {
      setExpandedId(null);
      setExpandedSection(null);
    } else {
      setExpandedId(id);
      setExpandedSection(section);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={handleToggle}
        className="relative p-2 rounded-full hover:bg-gray-800 transition-colors"
        aria-label="Bildirimler"
      >
        <span className="text-xl">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[22rem] max-w-[90vw] max-h-[70vh] overflow-y-auto bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-50">
          <div className="px-4 py-3 border-b border-gray-700 sticky top-0 bg-gray-800">
            <p className="font-semibold text-white text-sm">Scraper Bildirimleri</p>
            <p className="text-xs text-gray-500">Son 24 saat</p>
          </div>

          {recent.length === 0 ? (
            <div className="text-center py-10 text-gray-500 text-sm">
              <p className="text-3xl mb-2">📭</p>
              <p>Henüz bildirim yok.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-700/70">
              {recent.map(e => {
                const isUnread = (tsToMs(e.timestamp) ?? 0) > lastSeen;
                return (
                  <div key={e.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white flex items-center gap-1.5">
                          {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block shrink-0" />}
                          {SITE_LABELS[e.site] || e.site}
                          <span className="text-gray-500 font-normal">· {TRIGGER_LABELS[e.trigger] || e.trigger}</span>
                        </p>
                        <p className="text-[11px] text-gray-500">{fmtTime(e.timestamp)}</p>
                      </div>
                    </div>

                    <p className="text-xs text-gray-300 mt-1.5">
                      {e.totalScraped} çekildi · {e.alreadyPublished} zaten yayında · {e.newlyStaged} yeni
                    </p>

                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => toggleExpand(e.id, 'approved')}
                        disabled={!e.approvedItems?.length}
                        className={`text-[11px] font-semibold px-2 py-1 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                          expandedId === e.id && expandedSection === 'approved'
                            ? 'bg-green-600 border-green-500 text-white'
                            : 'bg-green-900/30 border-green-700/40 text-green-300 hover:bg-green-900/50'
                        }`}
                      >
                        ✅ Seçilen ({e.qualityApproved})
                      </button>
                      <button
                        onClick={() => toggleExpand(e.id, 'rejected')}
                        disabled={!e.rejectedItems?.length}
                        className={`text-[11px] font-semibold px-2 py-1 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                          expandedId === e.id && expandedSection === 'rejected'
                            ? 'bg-red-600 border-red-500 text-white'
                            : 'bg-red-900/30 border-red-700/40 text-red-300 hover:bg-red-900/50'
                        }`}
                      >
                        🚫 Elenen ({e.qualityRejected})
                      </button>
                    </div>

                    {expandedId === e.id && expandedSection === 'approved' && (
                      <div className="mt-2 space-y-1.5 bg-gray-900/50 rounded-lg p-2">
                        {(e.approvedItems || []).map(it => (
                          <div key={it.id} className="text-[11px] flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-gray-200 line-clamp-1">
                                {it.title || it.id}
                                {typeof it.score === 'number' && <span className="text-green-400 font-semibold ml-1">⭐{it.score}/10</span>}
                              </p>
                              {it.reason && <p className="text-gray-500 italic line-clamp-1">"{it.reason}"</p>}
                            </div>
                            {it.link && (
                              <a
                                href={it.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={ev => ev.stopPropagation()}
                                className="shrink-0 text-[10px] font-semibold px-2 py-1 rounded-lg bg-blue-900/40 border border-blue-700/40 text-blue-300 hover:bg-blue-900/60 whitespace-nowrap"
                              >
                                🔗 Ürüne Git
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {expandedId === e.id && expandedSection === 'rejected' && (
                      <div className="mt-2 space-y-1.5 bg-gray-900/50 rounded-lg p-2">
                        {(e.rejectedItems || []).map(it => (
                          <div key={it.id} className="text-[11px] flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-gray-200 line-clamp-1">{it.title || it.id}</p>
                              {it.reason && <p className="text-gray-500 italic line-clamp-1">"{it.reason}"</p>}
                            </div>
                            {it.link && (
                              <a
                                href={it.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={ev => ev.stopPropagation()}
                                className="shrink-0 text-[10px] font-semibold px-2 py-1 rounded-lg bg-blue-900/40 border border-blue-700/40 text-blue-300 hover:bg-blue-900/60 whitespace-nowrap"
                              >
                                🔗 Ürüne Git
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;

import React, { useState, useEffect, useCallback } from 'react';
import type { StagingProduct } from '../types';
import {
  getStagingProducts,
  getScraperStatus, getScraperConfig, toggleScraperSource, triggerScrape,
  getAutoPublishQueue,
  type ScraperStatusDoc, type ScraperConfigDoc, type AutoPublishQueueStatus,
} from '../services/firebase';

const TrendyolScraper: React.FC = () => {
  const [status, setStatus] = useState<ScraperStatusDoc | null>(null);
  const [config, setConfig] = useState<ScraperConfigDoc | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [togglingSource, setTogglingSource] = useState<string | null>(null);
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null);
  const [selectedSite, setSelectedSite] = useState<string>('trendyol');

  const [stagingProducts, setStagingProducts] = useState<StagingProduct[]>([]);
  const [queue, setQueue] = useState<AutoPublishQueueStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [loadingStaging, setLoadingStaging] = useState(false);
  const [queueExpanded, setQueueExpanded] = useState(false);

  // ── Durum + config (Firestore) ────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const [st, cfg] = await Promise.all([getScraperStatus(), getScraperConfig()]);
      setStatus(st);
      setConfig(cfg);
    } catch {}
    finally { setLoadingStatus(false); }
  }, []);

  useEffect(() => {
    fetchStatus();
    // Tarama sürerken daha sık (kullanıcı ilerlemeyi görmek ister), boştayken
    // seyrek — 4sn yerine sabit bir aralık günlük yüzlerce gereksiz okumaya
    // yol açıyordu (bu ekran açık bırakılırsa özellikle).
    const t = setInterval(fetchStatus, status?.isRunning ? 5000 : 20000);
    return () => clearInterval(t);
  }, [fetchStatus, status?.isRunning]);

  // ── Staging ürünleri (yalnızca kuyruk detayı açıldığında çekilir — pahalı
  // bir okuma olduğu için varsayılan olarak istenmiyor) ─────────────────────
  const loadStaging = useCallback(async () => {
    setLoadingStaging(true);
    try {
      const products = await getStagingProducts();
      setStagingProducts(products);
    } catch {}
    finally { setLoadingStaging(false); }
  }, []);

  useEffect(() => {
    if (queueExpanded) loadStaging();
  }, [queueExpanded, loadStaging]);

  // ── Yayın kuyruğu (AI'nın seçtiği, henüz yayınlanmamış ürünler) — tek
  // doküman, ucuz — sayaç için sürekli açık kalır. ─────────────────────────
  const loadQueue = useCallback(async () => {
    try { setQueue(await getAutoPublishQueue()); } catch {}
  }, []);

  useEffect(() => {
    loadQueue();
    const t = setInterval(loadQueue, queue?.ids?.length ? 15000 : 30000);
    return () => clearInterval(t);
  }, [loadQueue, queue?.ids?.length]);

  // Sayaçların her saniye ilerlemesi için — Firestore okuması YOK, sadece
  // ekrandaki "kaç saniye kaldı" hesabını tazeler.
  useEffect(() => {
    if (!queueExpanded || !queue?.ids?.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [queueExpanded, queue?.ids?.length]);

  // Kuyruktaki ID'lere karşılık gelen ürün bilgisini (zaten yüklü olan)
  // stagingProducts içinden bulur — ekstra Firestore okuması gerekmez.
  const queuedProducts = (queue?.ids || [])
    .map((id, index) => {
      const product = stagingProducts.find(p => p.id === id);
      if (!product) return null;
      const publishAt = (queue!.nextAt || Date.now()) + index * (queue!.intervalMs || 0);
      return { product, publishAt, index };
    })
    .filter((x): x is { product: StagingProduct; publishAt: number; index: number } => x !== null);

  // Tarama bitince kuyruğu otomatik yenile (AI değerlendirmesi taramadan
  // hemen sonra çalışıp kuyruğu güncellediği için birkaç saniye payla).
  const [prevRunning, setPrevRunning] = useState(false);
  useEffect(() => {
    if (prevRunning && !status?.isRunning) {
      loadQueue();
      if (queueExpanded) loadStaging();
      setTimeout(loadQueue, 8000);
    }
    setPrevRunning(status?.isRunning ?? false);
  }, [status?.isRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tetikle (seçili site) ─────────────────────────────────────────────────
  const handleScrape = async () => {
    setTriggerMessage('İstek gönderiliyor...');
    try {
      await triggerScrape(selectedSite);
      setTriggerMessage('✅ İstek gönderildi — PC açıksa tarama birazdan başlar.');
      setTimeout(fetchStatus, 1500);
    } catch {
      setTriggerMessage('Hata: istek gönderilemedi.');
    }
    setTimeout(() => setTriggerMessage(null), 5000);
  };

  const handleSelectSite = (site: string) => setSelectedSite(site);

  // ── Kaynak toggle ─────────────────────────────────────────────────────────
  const handleToggleSource = async (id: string) => {
    setTogglingSource(id);
    try { await toggleScraperSource(id); await fetchStatus(); }
    finally { setTogglingSource(null); }
  };

  // ── Yardımcılar ───────────────────────────────────────────────────────────
  const tsToMs = (ts: any): number | null => {
    if (!ts) return null;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    return null;
  };
  const fmt = (ts: any) => {
    const ms = tsToMs(ts);
    if (!ms) return '—';
    return new Date(ms).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const ago = (ts: any) => {
    const ms = tsToMs(ts);
    if (!ms) return null;
    const m = Math.floor((Date.now() - ms) / 60000);
    if (m < 1) return 'az önce';
    if (m < 60) return `${m} dakika önce`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h} saat önce` : `${Math.floor(h / 24)} gün önce`;
  };

  // PC dinleyicisi son ~12 dk içinde haber verdiyse çevrimiçi say
  const listenerMs = tsToMs(status?.listenerStartedAt) ?? (typeof status?.listenerStartedAt === 'number' ? status?.listenerStartedAt : null);
  const lastRunMs = tsToMs(status?.lastRunTime);
  const recentActivity = Math.max(listenerMs || 0, lastRunMs || 0);
  const listenerOnline = recentActivity > 0 && (Date.now() - recentActivity) < 6 * 60 * 60 * 1000;

  // Site listesi — config.sites varsa kullan; yoksa sources'tan türet; ikisi de yoksa her iki site göster
  const FALLBACK_SITES = [{ id: 'trendyol', label: 'Trendyol' }, { id: 'cimri', label: 'Cimri' }];
  const sites: { id: string; label: string }[] = config?.sites?.length
    ? config.sites
    : config?.sources?.length
      ? [...new Map(config.sources.map(s => {
          const id = s.site || 'trendyol';
          const label = id === 'cimri' ? 'Cimri' : id.charAt(0).toUpperCase() + id.slice(1);
          return [id, { id, label }] as [string, { id: string; label: string }];
        })).values()]
      : FALLBACK_SITES;
  const siteSources = (config?.sources || []).filter(s => (s.site || 'trendyol') === selectedSite);
  const siteLabel = sites.find(s => s.id === selectedSite)?.label || 'Trendyol';

  const queueDone = queue?.done ?? 0;
  const queueTotal = queue?.total ?? 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-24">

      {/* Başlık */}
      <div className="flex items-center gap-3">
        <span className="text-3xl">🛒</span>
        <div>
          <h1 className="text-2xl font-bold">Veri Çekici</h1>
          <p className="text-gray-400 text-sm">Site seç, çek — AI kalite kapısını geçen ürünleri otomatik yayınlar</p>
        </div>
      </div>

      {/* Site seçici (Trendyol / Cimri) */}
      <div className="flex gap-2 bg-gray-800 rounded-xl p-1">
        {sites.map(s => (
          <button
            key={s.id}
            onClick={() => handleSelectSite(s.id)}
            disabled={!!status?.isRunning}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all disabled:opacity-50 ${
              selectedSite === s.id ? 'bg-orange-500 text-white shadow' : 'text-gray-400 hover:text-white'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Durum kartı */}
      {loadingStatus ? (
        <div className="bg-gray-800 rounded-xl p-5 flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-gray-600 border-t-blue-400 rounded-full animate-spin" />
          <span className="text-gray-400">Durum kontrol ediliyor...</span>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              {status?.isRunning ? (
                <><span className="w-3 h-3 rounded-full bg-yellow-400 animate-pulse inline-block" /><span className="text-yellow-300 font-medium">Tarıyor...</span></>
              ) : (
                <><span className="w-3 h-3 rounded-full bg-green-400 inline-block" /><span className="text-green-300 font-medium">Hazır</span></>
              )}
            </div>
            <span className="text-xs text-gray-500">Her saat otomatik · anlık için "Veri Çek"</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-700/50 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-1">Son Çekim</p>
              <p className="font-semibold text-white text-sm">{fmt(status?.lastRunTime)}</p>
              {status?.lastRunTime && <p className="text-xs text-gray-500 mt-0.5">{ago(status?.lastRunTime)}</p>}
            </div>
            <div className="bg-gray-700/50 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-1">Son Çekilen</p>
              <p className="font-semibold text-white text-2xl">{status?.lastRunCount ?? 0}</p>
              <p className="text-xs text-gray-400">ürün</p>
            </div>
          </div>

          {/* PC dinleyici durumu */}
          <div className={`rounded-lg p-3 text-sm flex items-center gap-2 ${listenerOnline ? 'bg-green-900/30 text-green-300' : 'bg-orange-900/30 text-orange-300'}`}>
            <span className={`w-2 h-2 rounded-full ${listenerOnline ? 'bg-green-400' : 'bg-orange-400'} inline-block`} />
            {listenerOnline
              ? 'Bilgisayar bağlantısı aktif — veri çekilebilir.'
              : 'Bilgisayar uzun süredir veri çekmedi. Anlık çekim için PC açık olmalı (istek yine de kuyruğa alınır).'}
          </div>

          {status?.lastError && (
            <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 text-sm text-red-300">
              <span className="font-semibold">Son hata: </span>{status.lastError}
            </div>
          )}
        </div>
      )}

      {/* Kaynak seçimi (seçili siteye ait) */}
      {siteSources.length ? (
        <div className="space-y-2">
          <p className="text-sm text-gray-400 font-medium">{siteLabel} Kaynakları</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {siteSources.map(src => (
              <div key={src.id}
                className={`rounded-xl p-3 border transition-all ${src.enabled ? 'bg-blue-900/30 border-blue-600/50' : 'bg-gray-800/60 border-gray-700'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${src.enabled ? 'text-blue-200' : 'text-gray-400'}`}>{src.label}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5 leading-tight">{src.description}</p>
                    <p className="text-[11px] text-gray-600 mt-1">{src.pages} sayfa</p>
                  </div>
                  <button onClick={() => handleToggleSource(src.id)}
                    disabled={togglingSource === src.id || !!status?.isRunning}
                    className={`shrink-0 relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${src.enabled ? 'bg-blue-500' : 'bg-gray-600'}`}>
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${src.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {siteSources.filter(s => s.enabled).length === 0 && (
            <p className="text-xs text-orange-400">⚠️ {siteLabel} için hiçbir kaynak aktif değil.</p>
          )}
        </div>
      ) : null}

      {/* Veri Çek butonu (seçili site) */}
      <button onClick={handleScrape}
        disabled={!!status?.isRunning}
        className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${status?.isRunning ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-orange-500 hover:bg-orange-600 text-white shadow-lg hover:shadow-orange-500/25'}`}>
        {status?.isRunning
          ? <span className="flex items-center justify-center gap-3"><span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />Veri çekiliyor...</span>
          : `🛒 ${siteLabel}'dan Veri Çek`}
      </button>
      {triggerMessage && <p className="text-center text-sm text-blue-400">{triggerMessage}</p>}

      {/* ── Yayın Kuyruğu (AI seçti — açılır/kapanır, sayaçlı) ──────────────── */}
      <div className="border-t border-gray-700 pt-6">
        <button
          onClick={() => setQueueExpanded(v => !v)}
          className="w-full flex items-center justify-between gap-2 flex-wrap text-left"
        >
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span>⏳</span> Sırada (Yayınlanacak)
              {queueTotal > 0 && (
                <span className="bg-blue-600 text-white text-sm font-bold px-2 py-0.5 rounded-full">
                  {queueDone}/{queueTotal} Yayınlandı
                </span>
              )}
            </h2>
            <p className="text-sm text-gray-400">AI'nın son taramada seçtiği, teker teker yayınlanan ürünler</p>
          </div>
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform duration-200 shrink-0 ${queueExpanded ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {queueExpanded && (
          <div className="mt-4">
            {loadingStaging && queuedProducts.length === 0 ? (
              <div className="flex items-center gap-3 py-8 justify-center">
                <div className="w-5 h-5 border-2 border-gray-600 border-t-blue-400 rounded-full animate-spin" />
                <span className="text-gray-400">Yükleniyor...</span>
              </div>
            ) : queuedProducts.length === 0 ? (
              <div className="text-center py-10 text-gray-500">
                <p className="text-4xl mb-3">📭</p>
                <p>Sırada bekleyen ürün yok.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {queuedProducts.map(({ product: p, publishAt }) => {
                  const discount = p.oldPrice > p.newPrice ? Math.round((1 - p.newPrice / p.oldPrice) * 100) : 0;
                  const remainingMs = Math.max(0, publishAt - now);
                  const remainingSec = Math.round(remainingMs / 1000);
                  const mm = Math.floor(remainingSec / 60);
                  const ss = remainingSec % 60;
                  const published = remainingSec <= 0;
                  const countdownLabel = published
                    ? '✅ Yayınlandı'
                    : `⏱ ${mm > 0 ? `${mm} dk ${ss} sn` : `${ss} sn`} sonra yayınlanacak`;
                  return (
                    <div key={p.id}
                      className={`relative bg-gray-800 rounded-xl overflow-hidden border-2 ${published ? 'border-green-600/40' : 'border-blue-600/30'}`}>

                      {typeof p.qualityScore === 'number' && (
                        <div className="absolute top-2 left-2 bg-green-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded z-10">
                          ⭐ {p.qualityScore}/10
                        </div>
                      )}
                      {discount > 0 && (
                        <div className="absolute top-2 right-2 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded z-10">-%{discount}</div>
                      )}

                      <div className="bg-white aspect-square">
                        <img src={p.imageUrl} alt={p.title} className="w-full h-full object-contain"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      </div>

                      <div className="p-2">
                        <p className="text-[11px] text-gray-400 truncate">{p.brand}</p>
                        <p className="text-xs text-white line-clamp-2 leading-tight mt-0.5 min-h-[2rem]">{p.title}</p>
                        <div className="mt-1.5">
                          <span className="text-green-400 font-bold text-sm">{p.newPrice.toLocaleString('tr-TR')} TL</span>
                          {p.oldPrice > p.newPrice && (
                            <span className="text-gray-500 line-through text-[11px] ml-1.5">{p.oldPrice.toLocaleString('tr-TR')} TL</span>
                          )}
                        </div>
                        <div className={`mt-1.5 flex items-center gap-1 rounded-lg px-2 py-1 border ${published ? 'bg-green-900/40 border-green-700/40' : 'bg-blue-900/40 border-blue-700/40'}`}>
                          <span className={`text-[11px] font-semibold ${published ? 'text-green-300' : 'text-blue-200'}`}>{countdownLabel}</span>
                        </div>
                        {p.qualityReason && (
                          <p className="text-[10px] text-gray-500 mt-1.5 line-clamp-2 italic">"{p.qualityReason}"</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TrendyolScraper;

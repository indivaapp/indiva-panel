import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { StagingProduct } from '../types';
import {
  getStagingProducts, publishStagingProducts, clearStagingProducts,
  getScraperStatus, getScraperConfig, toggleScraperSource, triggerScrape,
  requestResolvePublish, getPublishStatus, getAutoPublishedProducts,
  type ScraperStatusDoc, type ScraperConfigDoc, type AutoPublishedProduct,
} from '../services/firebase';

const TrendyolScraper: React.FC = () => {
  const [status, setStatus] = useState<ScraperStatusDoc | null>(null);
  const [config, setConfig] = useState<ScraperConfigDoc | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [togglingSource, setTogglingSource] = useState<string | null>(null);
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null);
  const [selectedSite, setSelectedSite] = useState<string>('trendyol');
  const [publishInterval, setPublishInterval] = useState<number>(0); // 0=hemen, >0=dakika

  const [stagingProducts, setStagingProducts] = useState<StagingProduct[]>([]);
  const [autoPublished, setAutoPublished] = useState<AutoPublishedProduct[]>([]);
  const [loadingAutoPublished, setLoadingAutoPublished] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadingStaging, setLoadingStaging] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [showIntervalPicker, setShowIntervalPicker] = useState(false);

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

  // ── Staging ürünleri ──────────────────────────────────────────────────────
  const loadStaging = useCallback(async () => {
    setLoadingStaging(true);
    try {
      const products = await getStagingProducts();
      setStagingProducts(products);
      setSelectedIds(new Set());
    } catch {}
    finally { setLoadingStaging(false); }
  }, []);

  useEffect(() => { loadStaging(); }, [loadStaging]);

  // ── AI tarafından otomatik yayınlanan ürünler ────────────────────────────
  const loadAutoPublished = useCallback(async () => {
    setLoadingAutoPublished(true);
    try {
      const products = await getAutoPublishedProducts(30);
      setAutoPublished(products);
    } catch {}
    finally { setLoadingAutoPublished(false); }
  }, []);

  useEffect(() => {
    loadAutoPublished();
    const t = setInterval(loadAutoPublished, 30000);
    return () => clearInterval(t);
  }, [loadAutoPublished]);

  // Tarama bitince staging'i otomatik yenile
  const prevRunning = useRef(false);
  useEffect(() => {
    if (prevRunning.current && !status?.isRunning) loadStaging();
    prevRunning.current = status?.isRunning ?? false;
  }, [status?.isRunning, loadStaging]);

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

  // Site değişince seçimi temizle
  const handleSelectSite = (site: string) => {
    setSelectedSite(site);
    setSelectedIds(new Set());
  };

  // ── Kaynak toggle ─────────────────────────────────────────────────────────
  const handleToggleSource = async (id: string) => {
    setTogglingSource(id);
    try { await toggleScraperSource(id); await fetchStatus(); }
    finally { setTogglingSource(null); }
  };

  // ── Seçim / yayın ─────────────────────────────────────────────────────────
  const toggleSelect = (id: string) =>
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setSelectedIds(new Set(
    stagingProducts.filter(p => (p.site || 'trendyol') === selectedSite).map(p => p.id)
  ));
  const clearAll = () => setSelectedIds(new Set());

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const handlePublish = async () => {
    const ids: string[] = Array.from(selectedIds);
    if (!ids.length) return;
    setPublishing(true);
    try {
      // ARALIKLI yayın (her site): PC kuyruğu işler, tek tek yayınlar
      if (publishInterval > 0) {
        await requestResolvePublish(ids, publishInterval);
        setPublishMessage({ text: `✅ Aralıklı yayın başladı — her ${publishInterval} dakikada bir ürün yayınlanacak (PC açık kaldıkça). ${ids.length} ürün sırada.`, ok: true });
        setSelectedIds(new Set());
        setPublishing(false);
        setTimeout(() => loadStaging(), 2500);
        setTimeout(() => setPublishMessage(null), 8000);
        return;
      }

      // HEMEN + Cimri: PC çözüp yayınlasın (ilerleme izlenir)
      if (selectedSite === 'cimri') {
        await requestResolvePublish(ids, 0);
        setPublishMessage({ text: `Bilgisayar ${ids.length} ürünün gerçek mağaza linkini çözüyor...`, ok: true });
        if (pollRef.current) clearInterval(pollRef.current);
        let tries = 0;
        pollRef.current = setInterval(async () => {
          tries++;
          try {
            const st = await getPublishStatus();
            if (st?.status === 'done') {
              clearInterval(pollRef.current!); pollRef.current = null;
              setPublishMessage({ text: `✅ ${st.done ?? 0} ürün yayınlandı${st.failed ? `, ${st.failed} çözülemedi` : ''}.`, ok: true });
              setPublishing(false);
              await loadStaging();
              setTimeout(() => setPublishMessage(null), 6000);
            } else if (st?.status === 'processing') {
              setPublishMessage({ text: `Çözülüyor... ${st.done ?? 0}/${st.total ?? ids.length}`, ok: true });
            }
          } catch {}
          if (tries > 120) {
            clearInterval(pollRef.current!); pollRef.current = null;
            setPublishMessage({ text: 'PC yanıt vermedi — bilgisayar açık mı? İstek kuyruğa alındı.', ok: false });
            setPublishing(false);
          }
        }, 3000);
        return;
      }

      // HEMEN + Trendyol: panel doğrudan yayınlar (PC gerekmez)
      const toPublish = stagingProducts.filter(p => selectedIds.has(p.id));
      const n = await publishStagingProducts(toPublish);
      setPublishMessage({ text: `${n} ürün başarıyla yayınlandı!`, ok: true });
      await loadStaging();
      setPublishing(false);
      setTimeout(() => setPublishMessage(null), 4000);
    } catch (e: any) {
      setPublishMessage({ text: `Hata: ${e.message}`, ok: false });
      setPublishing(false);
    }
  };

  const handleClearStaging = async () => {
    const count = stagingProducts.filter(p => (p.site || 'trendyol') === selectedSite).length;
    if (!confirm(`${count} ürünü silmek istediğine emin misin?`)) return;
    try { await clearStagingProducts(selectedSite); await loadStaging(); } catch {}
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
  const pct = (p: StagingProduct) => p.oldPrice > p.newPrice ? Math.round((1 - p.newPrice / p.oldPrice) * 100) : 0;

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
  const siteProducts = stagingProducts.filter(p => (p.site || 'trendyol') === selectedSite);
  const siteLabel = sites.find(s => s.id === selectedSite)?.label || 'Trendyol';

  return (
    <>
    <div className={`max-w-5xl mx-auto space-y-6 ${selectedIds.size > 0 ? 'pb-56' : 'pb-36'}`}>

      {/* Başlık */}
      <div className="flex items-center gap-3">
        <span className="text-3xl">🛒</span>
        <div>
          <h1 className="text-2xl font-bold">Veri Çekici</h1>
          <p className="text-gray-400 text-sm">Site seç, çek, uygun ürünleri seç, yayınla</p>
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
            <span className="text-xs text-gray-500">Her 4 saatte otomatik · anlık için "Veri Çek"</span>
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

      {/* ── AI Tarafından Otomatik Yayınlananlar ────────────────────────────── */}
      <div className="border-t border-gray-700 pt-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span>🤖</span> AI Tarafından Yayınlanan
              {autoPublished.length > 0 && (
                <span className="bg-green-600 text-white text-sm font-bold px-2 py-0.5 rounded-full">{autoPublished.length}</span>
              )}
            </h2>
            <p className="text-sm text-gray-400">Kalite kapısını geçip otomatik yayınlanan son ürünler (satış potansiyeli / ilgi çekicilik puanı)</p>
          </div>
          <button onClick={loadAutoPublished} disabled={loadingAutoPublished} className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">↻ Yenile</button>
        </div>

        {loadingAutoPublished && autoPublished.length === 0 ? (
          <div className="flex items-center gap-3 py-8 justify-center">
            <div className="w-5 h-5 border-2 border-gray-600 border-t-blue-400 rounded-full animate-spin" />
            <span className="text-gray-400">Yükleniyor...</span>
          </div>
        ) : autoPublished.length === 0 ? (
          <div className="text-center py-10 text-gray-500">
            <p className="text-4xl mb-3">🤷</p>
            <p>Henüz AI tarafından otomatik yayınlanan ürün yok.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {autoPublished.map(p => {
              const discount = p.oldPrice > p.newPrice ? Math.round((1 - p.newPrice / p.oldPrice) * 100) : 0;
              return (
                <a key={p.id} href={p.link} target="_blank" rel="noopener noreferrer"
                  className="relative bg-gray-800 rounded-xl overflow-hidden border-2 border-transparent hover:border-green-600/60 transition-all">

                  <div className="absolute top-2 left-2 bg-green-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded z-10">
                    ⭐ {p.qualityScore}/10
                  </div>
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
                    {(p.satisPotansiyeli != null || p.ilgiCekicilik != null) && (
                      <div className="mt-1.5 flex gap-1 flex-wrap">
                        {p.satisPotansiyeli != null && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-300">Satış {p.satisPotansiyeli}/10</span>
                        )}
                        {p.ilgiCekicilik != null && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-300">İlgi {p.ilgiCekicilik}/10</span>
                        )}
                      </div>
                    )}
                    {p.qualityReason && (
                      <p className="text-[10px] text-gray-500 mt-1.5 line-clamp-2 italic">"{p.qualityReason}"</p>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Onay Bölümü ─────────────────────────────────────────────────────── */}
      <div className="border-t border-gray-700 pt-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-semibold">
              {siteLabel} — Onay Bekleyen
              {siteProducts.length > 0 && (
                <span className="ml-2 bg-orange-500 text-white text-sm font-bold px-2 py-0.5 rounded-full">{siteProducts.length}</span>
              )}
            </h2>
            <p className="text-sm text-gray-400">İstediğin ürünleri seç, ardından yayınla</p>
          </div>
          {siteProducts.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={selectAll} className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">Tümünü Seç</button>
              <button onClick={clearAll} className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">Seçimi Kaldır</button>
              <button onClick={handleClearStaging} className="text-xs px-3 py-1.5 rounded-lg bg-red-900/60 hover:bg-red-800 text-red-300 transition-colors">Tümünü Sil</button>
              <button onClick={loadStaging} disabled={loadingStaging} className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">↻ Yenile</button>
            </div>
          )}
        </div>


        {loadingStaging ? (
          <div className="flex items-center gap-3 py-8 justify-center">
            <div className="w-5 h-5 border-2 border-gray-600 border-t-blue-400 rounded-full animate-spin" />
            <span className="text-gray-400">Ürünler yükleniyor...</span>
          </div>
        ) : siteProducts.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p className="text-4xl mb-3">📭</p>
            <p>{siteLabel} için onay bekleyen ürün yok.</p>
            <p className="text-sm mt-1">Yukarıdaki "Veri Çek" butonuna bas.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {siteProducts.map(p => {
              const selected = selectedIds.has(p.id);
              const discount = pct(p);
              return (
                <div key={p.id} onClick={() => toggleSelect(p.id)}
                  className={`relative bg-gray-800 rounded-xl overflow-hidden cursor-pointer transition-all border-2 ${selected ? 'border-blue-500 ring-1 ring-blue-500/40' : 'border-transparent hover:border-gray-600'}`}>

                  <div className={`absolute top-2 right-2 w-5 h-5 rounded border-2 flex items-center justify-center z-10 transition-all ${selected ? 'bg-blue-500 border-blue-500' : 'border-gray-400 bg-gray-900/70'}`}>
                    {selected && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                  </div>

                  {discount > 0 && (
                    <div className="absolute top-2 left-2 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded z-10">-%{discount}</div>
                  )}

                  {p.sourceName && (
                    <div className="absolute bottom-[4.5rem] left-2 bg-gray-900/80 text-gray-300 text-[9px] px-1.5 py-0.5 rounded z-10">{p.sourceName}</div>
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

                    {/* Ürüne Git — Trendyol ürün sayfasını açar (seçimi tetiklemez) */}
                    <a
                      href={p.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="mt-2 flex items-center justify-center gap-1 w-full py-1.5 rounded-lg bg-orange-600/90 hover:bg-orange-600 active:bg-orange-700 text-white text-[11px] font-semibold transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      Ürüne Git
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>

      {/* ── Sabit alt yayın çubuğu (seçim varsa görünür) ──────────────────── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-[calc(62px+env(safe-area-inset-bottom,0px))] left-0 right-0 z-50 px-3 pointer-events-none">

          {/* Süre seçici — yukarı doğru açılır */}
          {showIntervalPicker && (
            <div className="pointer-events-auto bg-gray-900 border border-gray-700 rounded-2xl mb-2 overflow-hidden shadow-2xl">
              {[0, 1, 2, 3, 4, 5].map(m => (
                <button
                  key={m}
                  onClick={() => { setPublishInterval(m); setShowIntervalPicker(false); }}
                  className={`w-full px-5 py-3.5 text-left text-sm font-semibold flex items-center justify-between border-b border-gray-700/50 last:border-0 transition-colors ${
                    publishInterval === m
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-200 hover:bg-gray-800'
                  }`}
                >
                  <span>{m === 0 ? '⚡ Hemen yayınla' : `⏱ Her ${m} dakikada bir`}</span>
                  {publishInterval === m && (
                    <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Yayın mesajı */}
          {publishMessage && (
            <div className={`pointer-events-auto mb-2 px-4 py-2.5 rounded-xl text-sm font-medium border ${
              publishMessage.ok
                ? 'bg-green-900/95 text-green-200 border-green-700'
                : 'bg-red-900/95 text-red-200 border-red-700'
            }`}>
              {publishMessage.text}
            </div>
          )}

          {/* Ana çubuk */}
          <div className="pointer-events-auto flex gap-2 items-stretch bg-gray-900/95 backdrop-blur border border-gray-700 rounded-2xl p-2 shadow-2xl">

            {/* Süre butonu */}
            <button
              onClick={() => setShowIntervalPicker(p => !p)}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl font-semibold text-sm transition-all shrink-0 ${
                showIntervalPicker
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
              }`}
            >
              <span>{publishInterval === 0 ? '⚡' : '⏱'}</span>
              <span>{publishInterval === 0 ? 'Hemen' : `${publishInterval} dk`}</span>
              <svg
                className={`w-3.5 h-3.5 transition-transform duration-200 ${showIntervalPicker ? '' : 'rotate-180'}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
              </svg>
            </button>

            {/* Yayınla butonu */}
            <button
              onClick={() => { setShowIntervalPicker(false); handlePublish(); }}
              disabled={publishing}
              className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-green-600 hover:bg-green-500 active:bg-green-700 text-white transition-all disabled:opacity-50 shadow-lg"
            >
              {publishing
                ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                    {selectedSite === 'cimri' ? 'Çözülüyor...' : 'Yayınlanıyor...'}
                  </span>
                )
                : publishInterval > 0
                  ? `⏱ ${selectedIds.size} Ürünü Yayınla`
                  : selectedSite === 'cimri'
                    ? `🔗 ${selectedIds.size} Ürünü Çöz & Yayınla`
                    : `✅ ${selectedIds.size} Ürünü Yayınla`}
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default TrendyolScraper;

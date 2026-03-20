import React, { useState, useEffect } from 'react';
import { fetchFromTelegram, resolveOnuAlLink, type ScrapedDeal, TELEGRAM_CHANNELS } from '../services/dealFinder';
import { analyzeProductLink } from '../services/linkAnalyzer';
import { addDiscount } from '../services/firebase';
import type { ViewType } from '../types';

interface AutoDiscoveryPanelProps {
    isAdmin: boolean;
    setActiveView?: (view: ViewType) => void;
}

const AutoDiscoveryPanel: React.FC<AutoDiscoveryPanelProps> = ({ isAdmin }) => {
    const [dealQueue, setDealQueue] = useState<ScrapedDeal[]>([]);
    const [currentDeal, setCurrentDeal] = useState<ScrapedDeal | null>(null);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [stats, setStats] = useState({ viewed: 0, approved: 0, rejected: 0 });
    const [resolvedLink, setResolvedLink] = useState<string>('');

    // Fırsatları yükle
    useEffect(() => {
        loadDeals();
    }, []);

    // Mevcut deal değiştiğinde linki çözümle
    useEffect(() => {
        if (currentDeal) {
            resolveDealLink(currentDeal);
        }
    }, [currentDeal]);

    const loadDeals = async () => {
        setLoading(true);
        try {
            // Telegram'dan fırsatları çek (mevcut sistem)
            const deals = await fetchFromTelegram(TELEGRAM_CHANNELS[0], true);

            if (deals.length === 0) {
                alert('Fırsat bulunamadı. Lütfen daha sonra tekrar deneyin.');
                return;
            }

            setDealQueue(deals);
            setCurrentDeal(deals[0]);
            setCurrentIndex(0);
        } catch (error: any) {
            alert('Fırsatlar yüklenirken hata oluştu: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const resolveDealLink = async (deal: ScrapedDeal) => {
        setResolvedLink(''); // Reset

        console.log('\n🔗 ═══════════════════════════════════════');
        console.log('🔗 LİNK ÇÖZÜMLEME BAŞLADI');
        console.log('🔗 ═══════════════════════════════════════');

        try {
            const link = deal.onualLink || deal.productLink || '';

            if (!link) {
                console.error('❌ Link bulunamadı!');
                setResolvedLink('');
                return;
            }

            console.log('📌 Orijinal Link:', link);

            if (link.includes('onu.al')) {
                console.log('🔄 OnuAl kısa linki tespit edildi, çözümleniyor...');
                const resolved = await resolveOnuAlLink(link);
                console.log('✅ Link başarıyla çözümlendi!');
                console.log('🎯 Gerçek Link:', resolved);
                console.log('🔗 ═══════════════════════════════════════\n');
                setResolvedLink(resolved);
            } else {
                console.log('✅ Direkt ürün linki, çözümleme gerekmiyor');
                console.log('🔗 ═══════════════════════════════════════\n');
                setResolvedLink(link);
            }
        } catch (error: any) {
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.error('❌ LİNK ÇÖZÜMLEME HATASI!');
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.error('Hata:', error.message);
            console.error('Stack:', error.stack);
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

            // Hata durumunda orijinal linki kullan
            const fallbackLink = deal.onualLink || deal.productLink || '';
            console.warn('⚠️ Fallback: Orijinal link kullanılıyor:', fallbackLink);
            setResolvedLink(fallbackLink);
        }
    };

    const handleApprove = async () => {
        if (!currentDeal) {
            alert('⚠️ Fırsat bilgisi bulunamadı.');
            return;
        }

        if (!resolvedLink) {
            alert('⚠️ Link henüz çözümlenmedi. Lütfen birkaç saniye bekleyin ve tekrar deneyin.');
            return;
        }

        setProcessing(true);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🚀 ONAYLA İŞLEMİ BAŞLADI');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📦 Deal:', currentDeal.title);
        console.log('🔗 Çözümlenmiş Link:', resolvedLink);

        try {
            // ADIM 1: AI ile ürün bilgilerini çek
            console.log('\n📊 ADIM 1: AI Analizi Başlıyor...');
            console.log('Link:', resolvedLink);

            const analyzed = await analyzeProductLink(resolvedLink);

            console.log('✅ AI Analizi Tamamlandı:');
            console.log('  - Başlık:', analyzed.title);
            console.log('  - Marka:', analyzed.brand);
            console.log('  - Kategori:', analyzed.category);
            console.log('  - Eski Fiyat:', analyzed.oldPrice);
            console.log('  - Yeni Fiyat:', analyzed.newPrice);
            console.log('  - Görsel:', analyzed.imageUrl?.substring(0, 60) + '...');

            // ADIM 2: Veri doğrulama
            console.log('\n🔍 ADIM 2: Veri Doğrulama...');
            if (!analyzed.title || analyzed.title.length < 3) {
                throw new Error('❌ Ürün başlığı alınamadı. AI analizi başarısız.');
            }
            if (!analyzed.imageUrl) {
                console.warn('⚠️ Görsel URL bulunamadı, varsayılan kullanılacak');
            }
            console.log('✅ Veri doğrulama başarılı');

            // ADIM 3: Firebase'e kaydet
            console.log('\n💾 ADIM 3: Firebase\'e Kaydediliyor...');
            await addDiscount({
                title: analyzed.title,
                brand: analyzed.brand || 'Bilinmiyor',
                category: analyzed.category || 'Genel',
                oldPrice: analyzed.oldPrice || 0,
                newPrice: analyzed.newPrice || currentDeal.price || 0,
                imageUrl: analyzed.imageUrl || currentDeal.imageUrl || '',
                deleteUrl: '',
                link: resolvedLink,
                submittedBy: 'auto-discovery',
                originalSource: 'telegram-onual',
                importedAt: new Date() as any
            });

            console.log('✅ Firebase\'e kaydedildi!');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('🎉 BAŞARILI! Ürün yayınlandı.');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

            setStats(s => ({ ...s, approved: s.approved + 1 }));
            nextDeal();

            // Başarı bildirimi
            const notification = document.createElement('div');
            notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-50';
            notification.innerHTML = `
                <div class="flex items-center gap-2">
                    <span class="text-2xl">✅</span>
                    <div>
                        <div class="font-bold">Yayınlandı!</div>
                        <div class="text-sm opacity-90">${analyzed.title.substring(0, 40)}...</div>
                    </div>
                </div>
            `;
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), 3000);

        } catch (error: any) {
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.error('❌ HATA OLUŞTU!');
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.error('Hata:', error);
            console.error('Mesaj:', error.message);
            console.error('Stack:', error.stack);
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

            // Kullanıcıya detaylı hata göster
            let errorMessage = '❌ Hata Oluştu:\n\n';

            if (error.message?.includes('Failed to fetch')) {
                errorMessage += '🌐 Ağ Hatası\nSunucuya bağlanılamadı. İnternet bağlantınızı kontrol edin.';
            } else if (error.message?.includes('500')) {
                errorMessage += '🔧 Sunucu Hatası\nVercel API çalışmıyor. Lütfen daha sonra tekrar deneyin.';
            } else if (error.message?.includes('timeout')) {
                errorMessage += '⏱️ Zaman Aşımı\nİstek çok uzun sürdü. Tekrar deneyin.';
            } else if (error.message?.includes('başlığı alınamadı')) {
                errorMessage += '📝 Analiz Hatası\nÜrün bilgileri çekilemedi.\n\nMuhtemel Sebepler:\n- Link geçersiz\n- Mağaza sitesi erişilemiyor\n- AI servisi yanıt vermiyor';
            } else {
                errorMessage += '❓ Bilinmeyen Hata\n' + error.message;
            }

            errorMessage += '\n\n🔗 Link:\n' + resolvedLink.substring(0, 100);
            errorMessage += '\n\n💡 İpucu: F12 tuşuna basıp Console sekmesinde detaylı hata loglarını görebilirsiniz.';

            alert(errorMessage);
        } finally {
            setProcessing(false);
        }
    };

    const handleReject = () => {
        setStats(s => ({ ...s, rejected: s.rejected + 1 }));
        nextDeal();
    };

    const handleSkip = () => {
        // Kuyruğun sonuna ekle
        setDealQueue(q => [...q.slice(1), currentDeal!]);
        nextDeal();
    };

    const nextDeal = () => {
        const nextIndex = currentIndex + 1;
        if (nextIndex < dealQueue.length) {
            setCurrentDeal(dealQueue[nextIndex]);
            setCurrentIndex(nextIndex);
            setStats(s => ({ ...s, viewed: s.viewed + 1 }));
        } else {
            setCurrentDeal(null);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className="w-16 h-16 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-4"></div>
                <p className="text-gray-400">Fırsatlar yükleniyor...</p>
            </div>
        );
    }

    if (!currentDeal) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className="text-6xl mb-4">🎉</div>
                <h2 className="text-2xl font-bold mb-2">Tüm fırsatlar incelendi!</h2>
                <p className="text-gray-400 mb-6">Harika iş çıkardınız!</p>
                <button
                    onClick={loadDeals}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold"
                >
                    🔄 Yeniden Yükle
                </button>
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto">
            <h1 className="text-3xl font-bold mb-6">🤖 Otomatik Keşif</h1>

            {/* İstatistikler */}
            <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-gray-800 p-4 rounded-lg text-center">
                    <div className="text-2xl font-bold text-blue-400">{stats.viewed}</div>
                    <div className="text-sm text-gray-400">Görüldü</div>
                </div>
                <div className="bg-gray-800 p-4 rounded-lg text-center">
                    <div className="text-2xl font-bold text-green-400">{stats.approved}</div>
                    <div className="text-sm text-gray-400">Onaylandı</div>
                </div>
                <div className="bg-gray-800 p-4 rounded-lg text-center">
                    <div className="text-2xl font-bold text-red-400">{stats.rejected}</div>
                    <div className="text-sm text-gray-400">Reddedildi</div>
                </div>
            </div>

            {/* Ürün Kartı */}
            <div className="bg-gray-800 rounded-xl overflow-hidden shadow-2xl mb-6">
                {/* Görsel */}
                {currentDeal.imageUrl && (
                    <div className="relative h-96 bg-gray-900">
                        <img
                            src={currentDeal.imageUrl}
                            alt={currentDeal.title}
                            className="w-full h-full object-contain"
                            onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                            }}
                        />
                        {/* Kaynak Badge */}
                        <div className="absolute top-4 left-4 bg-purple-600 px-3 py-1 rounded-full text-sm font-semibold">
                            📱 Telegram
                        </div>
                        {/* Sıra Numarası */}
                        <div className="absolute top-4 right-4 bg-black/70 px-3 py-1 rounded-full text-sm">
                            {currentIndex + 1} / {dealQueue.length}
                        </div>
                    </div>
                )}

                {/* Bilgiler */}
                <div className="p-6">
                    <h2 className="text-xl font-bold mb-3 line-clamp-2">{currentDeal.title}</h2>

                    <div className="flex items-center gap-4 mb-4">
                        <span className="text-2xl font-bold text-green-400">
                            {currentDeal.price ? `${currentDeal.price.toLocaleString('tr-TR')}₺` : 'Fiyat bilgisi yok'}
                        </span>
                        <span className="bg-blue-600 px-3 py-1 rounded-full text-sm font-bold">
                            🏪 {currentDeal.source}
                        </span>
                    </div>

                    {/* Link Durumu */}
                    <div className="bg-gray-900 p-3 rounded-lg mb-3">
                        <div className="text-xs text-gray-400 mb-1">Ürün Linki:</div>
                        <div className="text-sm break-all">
                            {resolvedLink ? (
                                <a
                                    href={resolvedLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-400 hover:text-blue-300"
                                >
                                    {resolvedLink.substring(0, 60)}...
                                </a>
                            ) : (
                                <span className="text-gray-500">Link çözümleniyor...</span>
                            )}
                        </div>
                    </div>

                    {currentDeal.couponCode && (
                        <div className="bg-yellow-900/30 border border-yellow-600 p-3 rounded-lg">
                            <div className="text-xs text-yellow-400 mb-1">Kupon Kodu:</div>
                            <div className="text-lg font-mono font-bold text-yellow-300">
                                {currentDeal.couponCode}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Aksiyon Butonları */}
            <div className="flex gap-4">
                <button
                    onClick={handleReject}
                    disabled={processing}
                    className="flex-1 py-4 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-semibold text-lg transition-colors"
                >
                    ❌ Reddet
                </button>
                <button
                    onClick={handleSkip}
                    disabled={processing}
                    className="flex-1 py-4 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-semibold text-lg transition-colors"
                >
                    ⏭ Sonraki
                </button>
                <button
                    onClick={handleApprove}
                    disabled={processing || !resolvedLink}
                    className="flex-1 py-4 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-semibold text-lg transition-colors"
                >
                    {processing ? '⏳ İşleniyor...' : '✅ Onayla'}
                </button>
            </div>

            {/* Kalan Fırsat Sayısı */}
            <p className="text-center mt-4 text-gray-400">
                Kalan: {dealQueue.length - currentIndex - 1} fırsat
            </p>

            {/* Yardım Metni */}
            <div className="mt-6 p-4 bg-blue-900/30 border border-blue-600 rounded-lg">
                <p className="text-sm text-blue-300">
                    💡 <strong>İpucu:</strong> Onayladığınızda AI otomatik olarak ürün bilgilerini doldurup yayınlayacak!
                </p>
            </div>
        </div>
    );
};

export default AutoDiscoveryPanel;

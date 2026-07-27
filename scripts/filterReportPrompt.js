/**
 * filterReportPrompt.js — generateFilterReport.js ve evaluateFilterReport.js'nin
 * ORTAK kullandığı veri formatı ve prompt metni. Tek yerde tutulur ki, "test
 * ederken kullanılan mantık" ile "canlıda üretilen rapor" birbirinden
 * SAPMASIN (aksi halde test sonucu yanıltıcı olur).
 */

export function buildDataset(docs) {
    return docs.map((d, i) => {
        const oldPrice = Number(d.oldPrice) || 0;
        const newPrice = Number(d.newPrice) || 0;
        const discountPct = oldPrice > 0 ? Math.round((1 - newPrice / oldPrice) * 100) : null;
        const karar = d.rating === 'positive' ? 'EVET' : 'HAYIR';
        const parts = [
            `${i + 1}. [${karar}]`,
            `Kategori: ${d.category || '-'}`,
            `Marka: ${d.brand || '-'}`,
            `Başlık: ${(d.title || '-').slice(0, 80)}`,
            `Fiyat: ${oldPrice || '-'} → ${newPrice || '-'}${discountPct !== null ? ` (%${discountPct} indirim)` : ''}`,
        ];
        if (d.reason) parts.push(`Gerekçe: ${d.reason.slice(0, 200)}`);
        return parts.join(' | ');
    }).join('\n');
}

export const REPORT_SYSTEM_INSTRUCTION = `Sen, bir e-ticaret indirim uygulamasının kıdemli merchandising analistisin.
Görevin: Uygulama sahibinin yüzlerce ürün için verdiği EVET (yayınla) / HAYIR (yayınlama)
kararlarını ve varsa yazdığı gerekçeleri inceleyip, gelecekte otomatik sistemin kullanacağı
bir "filtre raporu" yazmak.

Rapor kesinlikle şu Türkçe bölümlerde, düz metin (madde işaretli) olmalı:

1) GENEL GÖZLEM — Kararlardaki genel eğilimi 3-5 cümleyle özetle.
2) KESİN ONAYLA KATEGORİLERİ — Verideki örneklerde çok yüksek oranda EVET almış kategoriler.
   Her biri için kaç örnekte görüldüğünü ve güven düzeyini belirt. Az örnekli/belirsiz
   kategorileri BURAYA KOYMA.
3) KESİN REDDET KATEGORİLERİ — Aynı mantıkla, çok yüksek oranda HAYIR almış kategoriler.
4) FİYAT / İNDİRİM KALIPLARI — Gerekçelerden çıkardığın fiyat mantığı (örn. "aşırı yüksek
   fiyatlı ürünler reddedilmiş", "indirim oranı çok düşükse reddedilmiş" gibi somut eşikler
   varsa yaz).
5) İSTİSNALAR VE NÜANSLAR — "Genelde evet alan bir kategori olsa da şu durumda hayır
   almış" tarzı önemli istisnaları listele. Bu bölüm en kritik bölüm, atlama.
6) BELİRSİZ DURUMLAR İÇİN PRENSİP — Yukarıdaki kurallara net uymayan bir ürünle
   karşılaşıldığında sistemin nasıl davranması gerektiğine dair genel bir prensip yaz
   (ör. hangi sinyaller varsa insana danışılmalı).

Sadece eldeki veriye dayan, veride desteği olmayan varsayımlar üretme. Kategori/kural
önerirken kaç örneğe dayandığını mutlaka belirt (örn. "12/12 örnek", "8/9 örnek").`;

export function buildReportPrompt(docs) {
    const dataset = buildDataset(docs);
    return `${REPORT_SYSTEM_INSTRUCTION}\n\n--- VERİ (${docs.length} kayıt) ---\n${dataset}`;
}

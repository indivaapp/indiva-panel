import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * Ana sayfa ilk sayfası için edge-cache proxy.
 *
 * Neden: İNDİVA (React Native) uygulaması, her kullanıcı ana sayfayı açtığında
 * ayrı bir Firestore okuması yapıyordu — kullanıcı sayısı arttıkça maliyet de
 * doğrusal artıyordu (O(kullanıcı)). Bu uç nokta Firestore'dan TEK sorgu yapıp
 * yanıtı Vercel'in CDN'inde (s-maxage) önbelleğe alır — binlerce kullanıcı aynı
 * anda istese de Firestore'a sadece önbellek süresi dolduğunda bir kez gidilir
 * (O(1)). Sadece sayfalamasız (ilk 12 ürün) istek için kullanılır; "daha fazla
 * yükle" hâlâ doğrudan Firestore SDK üzerinden, cursor ile devam eder.
 *
 * GET → { success: true, discounts: [...] }
 * (Firestore Timestamp alanları client'ta ekstra ayrıştırma gerekmesin diye
 * milisaniye sayısına çevrilmiş olarak döner.)
 */

if (getApps().length === 0) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const ITEMS_PER_PAGE = 12;

function tsToMillis(v: any): number | null {
    if (!v) return null;
    if (typeof v.toMillis === 'function') return v.toMillis();
    return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const snap = await db.collection('discounts')
            .orderBy('createdAt', 'desc')
            .limit(ITEMS_PER_PAGE)
            .get();

        const discounts = snap.docs.map(d => {
            const data = d.data();
            return {
                id: d.id,
                ...data,
                createdAt: tsToMillis(data.createdAt),
                expiresAt: tsToMillis(data.expiresAt) ?? data.expiresAt ?? null,
                deleteAt: tsToMillis(data.deleteAt) ?? data.deleteAt ?? null,
                expiredAt: tsToMillis(data.expiredAt) ?? data.expiredAt ?? null,
            };
        });

        // CDN önbelleği: 90 sn taze, sonraki 30 sn'de arka planda tazelenirken
        // eski yanıt servis edilmeye devam eder (stale-while-revalidate).
        res.setHeader('Cache-Control', 'public, s-maxage=90, stale-while-revalidate=30');
        return res.status(200).json({ success: true, discounts });
    } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

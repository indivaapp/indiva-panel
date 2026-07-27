/**
 * purgeUnexplainedFeedback.js — Gerekçesi olmayan product_feedback kayıtlarını
 * kalıcı olarak siler.
 *
 * Amaç: filtre raporu testinde (bkz. evaluateFilterReport.js) ortaya çıkan
 * bulgu — gerekçesiz kayıtlar yapay zekaya sadece kategori/fiyat gösteriyor,
 * "neden" bilgisini hiç göstermiyor ve yanlış genellemelere yol açıyordu.
 * Kullanıcı isteğiyle: sadece gerekçeli kayıtlar kalsın, geri kalanı silinsin.
 *
 * GÜVENLİK: Varsayılan olarak DRY RUN çalışır — sadece kaç kayıt silineceğini
 * raporlar, hiçbir şey silmez. Gerçekten silmek için CONFIRM_DELETE=DELETE
 * env değişkeni geçilmeli.
 *
 * Kullanım: node scripts/purgeUnexplainedFeedback.js
 * Env: FIREBASE_SERVICE_ACCOUNT, CONFIRM_DELETE (opsiyonel, 'DELETE' olmalı)
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function initFirebase() {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (!serviceAccount.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT yok/geçersiz.');
    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

async function main() {
    const db = initFirebase();
    const confirmed = process.env.CONFIRM_DELETE === 'DELETE';

    const snap = await db.collection('product_feedback').get();
    const withReason = [];
    const withoutReason = [];
    snap.docs.forEach(d => {
        const reason = (d.data().reason || '').trim();
        if (reason) withReason.push(d); else withoutReason.push(d);
    });

    console.log(`📊 Toplam ${snap.size} kayıt.`);
    console.log(`   Gerekçeli (kalacak): ${withReason.length}`);
    console.log(`   Gerekçesiz (silinecek): ${withoutReason.length}\n`);

    if (!confirmed) {
        console.log('🔍 DRY RUN — hiçbir şey silinmedi. Gerçekten silmek için CONFIRM_DELETE=DELETE ile tekrar çalıştırın.');
        return;
    }

    // NOT: db.batch() (tek transaction içinde toplu silme) "Transaction too
    // big" hatası veriyordu — hem 400 hem 100'lük gruplarda aynı hata
    // tekrarlandı, yani sorun grup boyutu değil, bu ortamın transaction
    // kısıtıyla ilgili. Bunun yerine her belgeyi ayrı, bağımsız bir istek
    // olarak (sınırlı eşzamanlılıkla) siliyoruz — bu kısıta hiç takılmıyor.
    console.log('🗑️  Siliniyor...');
    let deleted = 0;
    const CONCURRENCY = 20;
    for (let i = 0; i < withoutReason.length; i += CONCURRENCY) {
        const chunk = withoutReason.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(d => d.ref.delete()));
        deleted += chunk.length;
        console.log(`   ... ${deleted}/${withoutReason.length} silindi`);
    }

    console.log(`\n✅ Tamamlandı: ${deleted} kayıt silindi, ${withReason.length} kayıt (gerekçeli) kaldı.`);
}

main().catch(err => {
    console.error('❌ Hata:', err.message);
    process.exit(1);
});

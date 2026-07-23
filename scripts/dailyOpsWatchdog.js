/**
 * dailyOpsWatchdog.js — Günlük "dijital nöbetçi"
 *
 * Panel/Firestore/GitHub Actions'ı her gün bir kez tarar, sadece gerçekten
 * anormal bir şey varsa admin'e push bildirimi gönderir (her gün susarsa
 * kimse okumaz — bu yüzden bilgilendirme değil, İSTİSNA bildirir).
 *
 * Kontroller:
 *  1. Son 24 saatte başarısız olan GitHub Actions run'ları (kilit workflow'lar)
 *  2. discounts koleksiyonu anormal büyümüş mü (2026-07-17'deki temizlik
 *     script'i bozukluğunun bir daha sessizce tekrarlanmasına karşı kalıcı
 *     bir muhafız — bkz. git geçmişi)
 *  3. Günlük AI bütçesi ne kadar tüketilmiş (bilgi amaçlı + tavana yakınsa uyarı)
 *  4. pipeline_runs'ta son 24h'de "failed" sayısı yüksek mi
 *
 * Kullanım: node scripts/dailyOpsWatchdog.js
 * Env: FIREBASE_SERVICE_ACCOUNT, GITHUB_TOKEN, GITHUB_REPOSITORY (Actions'ta otomatik)
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { sendAdminAlert, sendAdminNotification } from './alertService.js';

const WATCHED_WORKFLOWS = [
    'auto-indirimradar.yml',
    'cleanup-onual.yml',
    'auto-brochures.yml',
    'auto-ai-analyst-daily.yml',
    'auto-social-ai-suggest.yml',
];

// discounts koleksiyonu sağlıklı durumda birkaç bin belge civarında kalır
// (24h TTL + düzenli temizlik). Bunun belirgin şekilde üzerine çıkması,
// temizliğin yine sessizce bozulduğunun erken sinyalidir.
const DISCOUNTS_COUNT_WARN_THRESHOLD = 8000;
const DAILY_AI_BUDGET_TRY = Number(process.env.DAILY_AI_BUDGET_TRY) || 10;
const USD_TRY_RATE = Number(process.env.USD_TRY_RATE) || 40;

function initFirebase() {
    if (getApps().length > 0) return getFirestore();
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (!serviceAccount.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT eksik/geçersiz');
    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

async function checkFailedWorkflows() {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPOSITORY;
    if (!token || !repo) return { checked: false, failures: [] };

    const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' };
    const failures = [];

    for (const wf of WATCHED_WORKFLOWS) {
        try {
            const res = await fetch(
                `https://api.github.com/repos/${repo}/actions/workflows/${wf}/runs?status=completed&per_page=1`,
                { headers },
            );
            if (!res.ok) continue;
            const data = await res.json();
            const last = data.workflow_runs?.[0];
            if (last && last.conclusion === 'failure') {
                const ageHours = (Date.now() - new Date(last.created_at)) / 3_600_000;
                if (ageHours <= 24) failures.push({ workflow: wf, url: last.html_url, ageHours: Math.round(ageHours) });
            }
        } catch { /* tek bir workflow kontrolü başarısız olursa diğerlerini engellemesin */ }
    }
    return { checked: true, failures };
}

async function checkDiscountsCount(db) {
    const snap = await db.collection('discounts').count().get();
    const count = snap.data().count;
    return { count, abnormal: count > DISCOUNTS_COUNT_WARN_THRESHOLD };
}

async function checkAiBudget(db) {
    const dayId = new Date().toISOString().slice(0, 10);
    const snap = await db.collection('aiUsage').doc(`daily_${dayId}`).get();
    const costUsd = snap.exists ? (snap.data().costUsd || 0) : 0;
    const costTry = costUsd * USD_TRY_RATE;
    return { costTry, nearLimit: costTry >= DAILY_AI_BUDGET_TRY * 0.8 };
}

async function checkPipelineFailures(db) {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const snap = await db.collection('pipeline_runs')
        .where('createdAt', '>=', since)
        .get();
    const failed = snap.docs.filter(d => (d.data().failed || 0) > 0);
    return { totalRuns: snap.size, failedRuns: failed.length };
}

async function main() {
    console.log(`\n🐕 Günlük Ops Nöbetçisi: ${new Date().toLocaleString('tr-TR')}`);
    const db = initFirebase();

    const [workflows, discounts, aiBudget, pipelines] = await Promise.all([
        checkFailedWorkflows(),
        checkDiscountsCount(db),
        checkAiBudget(db),
        checkPipelineFailures(db).catch(() => ({ totalRuns: 0, failedRuns: 0 })),
    ]);

    console.log('GitHub Actions:', JSON.stringify(workflows));
    console.log('discounts sayısı:', discounts.count);
    console.log('Bugünkü AI maliyeti (TL):', aiBudget.costTry.toFixed(2));
    console.log('Pipeline runs (24h):', JSON.stringify(pipelines));

    const issues = [];
    if (workflows.failures.length > 0) {
        issues.push(
            `⚙️ ${workflows.failures.length} workflow son 24h'de başarısız: ` +
            workflows.failures.map(f => f.workflow.replace('.yml', '')).join(', '),
        );
    }
    if (discounts.abnormal) {
        issues.push(`📦 discounts koleksiyonu anormal büyük: ${discounts.count} belge (temizlik bozulmuş olabilir)`);
    }
    if (aiBudget.nearLimit) {
        issues.push(`💰 Günlük AI bütçesinin %80'i tüketildi: ${aiBudget.costTry.toFixed(2)}₺ / ${DAILY_AI_BUDGET_TRY}₺`);
    }
    if (pipelines.totalRuns > 0 && pipelines.failedRuns / pipelines.totalRuns > 0.3) {
        issues.push(`🔧 Son 24h'de pipeline run'larının %${Math.round(100 * pipelines.failedRuns / pipelines.totalRuns)}'i hata içeriyor`);
    }

    // Hafif bir geçmiş kaydı — panelde ileride bir "nöbetçi geçmişi" ekranı
    // gerekirse diye (şu an okunmuyor, sadece yazılıyor).
    await db.collection('ops_watchdog_runs').add({
        createdAt: new Date(),
        discountsCount: discounts.count,
        aiCostTry: aiBudget.costTry,
        failedWorkflows: workflows.failures.map(f => f.workflow),
        pipelineFailRate: pipelines.totalRuns > 0 ? pipelines.failedRuns / pipelines.totalRuns : 0,
        issuesFound: issues.length,
    }).catch(() => {});

    if (issues.length === 0) {
        console.log('✅ Her şey normal görünüyor, bildirim gönderilmedi.');
        return;
    }

    const body = issues.join('\n');
    console.log('🚨 Anomali bulundu, admin bildirimi gönderiliyor:\n' + body);
    await sendAdminAlert('Günlük Ops Nöbetçisi — Dikkat', body, { type: 'OPS_WATCHDOG' });
}

main().catch(async (err) => {
    console.error('💥 Nöbetçi kendi içinde hata verdi:', err.message);
    try { await sendAdminAlert('Ops Nöbetçisi Hatası', `Nöbetçi script'i çalışamadı: ${err.message}`); } catch {}
    process.exit(1);
});

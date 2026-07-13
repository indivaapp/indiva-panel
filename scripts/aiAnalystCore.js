/**
 * aiAnalystCore.js — İNDİVA AI Analist'in ortak mantığı (veri toplama, prompt,
 * OpenRouter çağrısı, Firestore'a kaydetme + push bildirimi).
 *
 * scripts/auto-ai-analyst.js tarafından günlük ve haftalık modlarda çağrılır.
 * Amaç: HAM veriyi değil, ÖNCEDEN ÖZETLENMİŞ sayısal metrikleri modele
 * göndermek — hem token maliyetini düşük tutar hem de modelin işini
 * "yorumlama/önceliklendirme"ye indirger (ham veri taramaktan çok daha
 * güvenilir sonuç verir).
 */

import { FieldValue } from 'firebase-admin/firestore';
import { trackOpenRouterUsage } from './aiUsageTracker.js';
import { sendAdminNotification, sendAdminAlert } from './alertService.js';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = 'deepseek/deepseek-v4-flash';
const GITHUB_REPO = 'indivaapp/indiva-panel';

// İş açısından anlamlı workflow'lar — build-apk.yml gibi geliştirme
// araçları hariç, gerçek otomasyon pipeline'ları.
const MONITORED_WORKFLOWS = [
    'auto-indirimradar.yml',
    'price-checker.yml',
    'auto-social-ai-suggest.yml',
    'auto-brochures.yml',
    'auto-akakce.yml',
    'auto-onual.yml',
    'cleanup-onual.yml',
];

function dateStr(d) { return d.toISOString().slice(0, 10); } // YYYY-MM-DD
function monthStr(d) { return d.toISOString().slice(0, 7); } // YYYY-MM

// ─── Metrik Toplama ────────────────────────────────────────────────────────

async function gatherPipelineRunStats(db, periodStart) {
    const snap = await db.collection('pipeline_runs')
        .where('createdAt', '>=', periodStart)
        .get();

    const bySource = {};
    const warnings = [];
    snap.docs.forEach(d => {
        const r = d.data();
        const key = r.script || 'bilinmeyen';
        if (!bySource[key]) {
            bySource[key] = { runs: 0, fetched: 0, approved: 0, rejected: 0, skipped: 0, failed: 0 };
        }
        bySource[key].runs++;
        bySource[key].fetched += r.fetched || 0;
        bySource[key].approved += r.approved || 0;
        bySource[key].rejected += r.rejected || 0;
        bySource[key].skipped += r.skipped || 0;
        bySource[key].failed += r.failed || 0;
        if (r.note && (r.fetched === 0 || r.failed > 0)) {
            warnings.push(`${key}: ${r.note}`);
        }
    });

    return { bySource, warnings: warnings.slice(0, 10), totalRuns: snap.size };
}

async function gatherDiscountStats(db, periodStart) {
    const snap = await db.collection('discounts')
        .where('createdAt', '>=', periodStart)
        .get();

    const bySource = {};
    const byCategory = {};
    let suspiciousVotes = 0; // expiredVotes belirgin şekilde activeVotes'u geçmiş ama hâlâ aktif
    let totalVotes = 0;

    snap.docs.forEach(d => {
        const x = d.data();
        const src = x.originalSource || x.submittedBy || 'manuel';
        bySource[src] = (bySource[src] || 0) + 1;
        const cat = x.category || 'Diğer';
        byCategory[cat] = (byCategory[cat] || 0) + 1;

        const av = x.activeVotes || 0;
        const ev = x.expiredVotes || 0;
        totalVotes += av + ev;
        if (x.status === 'aktif' && ev >= 3 && ev > av) suspiciousVotes++;
    });

    const [activeCountSnap, pendingCountSnap, adReqCountSnap] = await Promise.all([
        db.collection('discounts').where('status', '==', 'aktif').count().get(),
        db.collection('pendingDiscounts').count().get(),
        db.collection('adRequests').where('status', '==', 'pending').count().get(),
    ]);

    return {
        newInPeriod: snap.size,
        bySource,
        byCategory,
        suspiciousVotes,
        totalVotes,
        currentActiveTotal: activeCountSnap.data().count,
        pendingSubmissions: pendingCountSnap.data().count,
        pendingAdRequests: adReqCountSnap.data().count,
    };
}

async function gatherSocialContentStats(db) {
    const [pendingSnap, allSnap] = await Promise.all([
        db.collection('social_content_queue').where('status', '==', 'pending').count().get(),
        db.collection('social_content_queue').count().get(),
    ]);
    return { pending: pendingSnap.data().count, total: allSnap.data().count };
}

async function gatherAiCostTrend(db, mode) {
    const today = new Date();
    if (mode === 'daily') {
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        const [todayDoc, yestDoc] = await Promise.all([
            db.collection('aiUsage').doc(`daily_${dateStr(today)}`).get(),
            db.collection('aiUsage').doc(`daily_${dateStr(yesterday)}`).get(),
        ]);
        return {
            todayUsd: todayDoc.exists ? (todayDoc.data().costUsd || 0) : 0,
            yesterdayUsd: yestDoc.exists ? (yestDoc.data().costUsd || 0) : 0,
            todayCalls: todayDoc.exists ? (todayDoc.data().calls || 0) : 0,
        };
    }
    // haftalık: bu ay ve geçen ay karşılaştırması (basit ama yeterli sinyal)
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const [thisMonthDoc, lastMonthDoc] = await Promise.all([
        db.collection('aiUsage').doc(`monthly_${monthStr(today)}`).get(),
        db.collection('aiUsage').doc(`monthly_${monthStr(lastMonth)}`).get(),
    ]);
    return {
        thisMonthUsd: thisMonthDoc.exists ? (thisMonthDoc.data().costUsd || 0) : 0,
        lastMonthUsd: lastMonthDoc.exists ? (lastMonthDoc.data().costUsd || 0) : 0,
        thisMonthCalls: thisMonthDoc.exists ? (thisMonthDoc.data().calls || 0) : 0,
    };
}

async function gatherWorkflowHealth(periodStart) {
    const results = {};
    for (const wf of MONITORED_WORKFLOWS) {
        try {
            const res = await fetch(
                `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${wf}/runs?per_page=30`,
                { headers: { Accept: 'application/vnd.github.v3+json' }, signal: AbortSignal.timeout(10000) }
            );
            if (!res.ok) continue;
            const data = await res.json();
            const runsInPeriod = (data.workflow_runs || []).filter(r => new Date(r.created_at) >= periodStart);
            const failed = runsInPeriod.filter(r => r.conclusion === 'failure').length;
            results[wf] = { total: runsInPeriod.length, failed };
        } catch { /* bir workflow başarısız olursa diğerlerini engellemesin */ }
    }
    return results;
}

export async function gatherMetrics(db, mode, periodStart) {
    const [pipelineStats, discountStats, socialStats, aiCost, workflowHealth] = await Promise.all([
        gatherPipelineRunStats(db, periodStart),
        gatherDiscountStats(db, periodStart),
        gatherSocialContentStats(db),
        gatherAiCostTrend(db, mode),
        gatherWorkflowHealth(periodStart),
    ]);
    return { mode, periodStart: periodStart.toISOString(), pipelineStats, discountStats, socialStats, aiCost, workflowHealth };
}

// ─── AI Çağrısı ─────────────────────────────────────────────────────────────

function buildPrompt(metrics) {
    const periodLabel = metrics.mode === 'daily' ? 'son ~12 saat' : 'son 7 gün';
    return `Sen İNDİVA (Türkiye'de indirim/fırsat toplama uygulaması) için çalışan kıdemli bir ürün/teknik analistsin.
Aşağıda ${periodLabel}'e ait, koddan otomatik toplanmış ÖZETLENMİŞ metrikler var (ham veri değil, zaten hesaplanmış sayılar).

METRİKLER (JSON):
${JSON.stringify(metrics, null, 1)}

METRİKLERİ YORUMLARKEN ŞUNLARA DİKKAT ET:
- pipelineStats.warnings içindeki her uyarı ciddiye alınmalı (bir kaynağın 0 ürün getirmesi, o kaynağın API'sinin/scraping mantığının kırılmış olabileceği anlamına gelir)
- discountStats.suspiciousVotes > 0 ise, kullanıcılar "bitti" diyor ama sistem hâlâ aktif gösteriyor — otomatik "bitti" tespiti kaçırıyor olabilir
- workflowHealth'te failed/total oranı yüksek olan pipeline'lar teknik sorun işaretidir
- aiCost'ta ani bir sıçrama varsa (örn. bugünkü, dünkünün 3+ katı) bunu vurgula
- discountStats.bySource'taki dağılımsızlık (tek kaynağa aşırı bağımlılık) bir büyüme riski olabilir
- Veri yoksa/az ise ("henüz veri toplanmaya yeni başladı" gibi) abartılı sonuç çıkarma, dürüstçe "yetersiz veri" de

GÖREV: Aşağıdaki 3 kategoride analiz yap, HER kategoride bulduğun somut noktaları listele (veri yoksa "gözlemlenen bir sorun yok" yaz, uydurma):
1. teknik_saglik: kaynak/pipeline sağlığı, hatalar, API kırılmaları
2. operasyon: kalite kapısı, kullanıcı gönderimleri, reklam talepleri, sosyal medya kuyruğu, oy sinyalleri
3. buyume: kategori/kaynak dengesi, fırsatlar, dikkat çeken trendler

Sonunda en kritik 3-5 maddeyi ÖNCELİK SIRASINA göre "recommendations" olarak özetle.

SADECE aşağıdaki JSON formatında cevap ver, başka hiçbir şey yazma:
{
  "summary": "1-2 cümlelik en üst özet (Türkçe)",
  "sections": {
    "teknik_saglik": { "severity": "ok" | "warning" | "critical", "findings": ["...", "..."] },
    "operasyon": { "severity": "ok" | "warning" | "critical", "findings": ["...", "..."] },
    "buyume": { "severity": "ok" | "warning" | "critical", "findings": ["...", "..."] }
  },
  "recommendations": [
    { "priority": 1, "title": "kısa başlık", "detail": "1-2 cümle somut aksiyon önerisi" }
  ]
}`;
}

async function callDeepSeek(db, prompt) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://indiva-proxy.vercel.app',
            'X-Title': 'INDIVA AI Analyst',
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.4,
            usage: { include: true },
        }),
        signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter ${response.status}: ${errText.substring(0, 200)}`);
    }

    const data = await response.json();
    await trackOpenRouterUsage(db, data);
    const text = data?.choices?.[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI JSON döndürmedi');
    return JSON.parse(jsonMatch[0]);
}

// ─── Ana Akış ───────────────────────────────────────────────────────────────

export async function runAnalyst(db, mode) {
    if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY tanımlı değil.');

    const now = new Date();
    const periodMs = mode === 'daily' ? 12 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const periodStart = new Date(now.getTime() - periodMs);

    console.log(`🔍 Metrikler toplanıyor (${mode}, ${periodStart.toLocaleString('tr-TR')} sonrası)...`);
    const metrics = await gatherMetrics(db, mode, periodStart);

    console.log('🤖 AI analiz yapıyor...');
    const prompt = buildPrompt(metrics);
    const analysis = await callDeepSeek(db, prompt);

    console.log(`✅ Analiz tamamlandı: ${analysis.summary}`);

    const reportRef = db.collection('ai_analyst_reports').doc();
    await reportRef.set({
        mode,
        periodStart: periodStart.toISOString(),
        metrics,
        summary: analysis.summary || '',
        sections: analysis.sections || {},
        recommendations: analysis.recommendations || [],
        createdAt: FieldValue.serverTimestamp(),
        read: false,
    });

    const topRec = (analysis.recommendations || [])[0];
    const notifBody = topRec
        ? `${analysis.summary} En öncelikli: ${topRec.title}`
        : (analysis.summary || 'Yeni analiz raporu hazır.');
    const modeLabel = mode === 'daily' ? 'Günlük' : 'Haftalık';

    await sendAdminNotification(
        `🧠 ${modeLabel} AI Analiz Raporu Hazır`,
        notifBody.slice(0, 180),
        { type: 'AI_ANALYST_REPORT', reportId: reportRef.id }
    );

    return { reportId: reportRef.id, analysis };
}

export async function reportAnalystFailure(db, mode, err) {
    console.error(`💥 AI Analist hatası (${mode}): ${err.message}`);
    try {
        await sendAdminAlert(`AI Analist Hatası (${mode})`, err.message);
    } catch { /* ignore */ }
}

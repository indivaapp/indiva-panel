/**
 * checkChainHealth.js — Kendi kendini zincirleyen pipeline workflow'ları
 * (auto-onual.yml, auto-indirimradar.yml) için art arda başarısızlık kesicisi.
 *
 * Son N tamamlanmış run'ın conclusion'ına bakar; hepsi "failure" ise
 * (sistemik bir hata var demektir — örn. geçersiz API key, kırık bir kaynak)
 * bir admin uyarısı gönderir ve exit code 1 ile çıkar. Çağıran workflow
 * adımı bu exit code'a bakıp bir sonraki run'ı DİSPATCH ETMEMELİ — böylece
 * bozuk bir pipeline sonsuza kadar arka planda (her denemede olası AI
 * maliyetiyle) kendini tekrar tetiklemeye devam etmez. 30 dk'lık yedek
 * `schedule` cron'u (varsa) devam eder, kullanıcı manuel de tetikleyebilir.
 *
 * Kullanım: node scripts/checkChainHealth.js <workflow-file.yml> [threshold]
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY (Actions runner'da otomatik gelir),
 *      FIREBASE_SERVICE_ACCOUNT (admin alert için)
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { sendAdminAlert } from './alertService.js';

const [, , workflowFile, thresholdArg] = process.argv;
const FAIL_THRESHOLD = Number(thresholdArg) || 3;

if (!workflowFile) {
    console.error('Kullanım: node checkChainHealth.js <workflow-file.yml> [threshold]');
    process.exit(1);
}

function initFirebase() {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
        if (!serviceAccount.project_id) return false;
        initializeApp({ credential: cert(serviceAccount) });
        return true;
    } catch {
        return false;
    }
}

async function main() {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPOSITORY;
    if (!token || !repo) {
        console.warn('⚠️  GITHUB_TOKEN/GITHUB_REPOSITORY yok — zincir sağlığı kontrol edilemedi, güvenli tarafta kalıp devam ediliyor.');
        process.exit(0);
    }

    const res = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/runs?status=completed&per_page=${FAIL_THRESHOLD}`,
        { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' } }
    );
    if (!res.ok) {
        console.warn(`⚠️  GitHub API ${res.status} — zincir sağlığı kontrol edilemedi, güvenli tarafta kalıp devam ediliyor.`);
        process.exit(0);
    }

    const data = await res.json();
    const runs = (data.workflow_runs || []).slice(0, FAIL_THRESHOLD);

    if (runs.length < FAIL_THRESHOLD) {
        console.log(`ℹ️  Henüz ${FAIL_THRESHOLD} tamamlanmış run yok (${runs.length} var) — devam ediliyor.`);
        process.exit(0);
    }

    const allFailed = runs.every(r => r.conclusion === 'failure');
    if (!allFailed) {
        console.log('✅ Zincir sağlıklı — bir sonraki run tetiklenebilir.');
        process.exit(0);
    }

    console.error(`⛔ Son ${FAIL_THRESHOLD} run da başarısız (${workflowFile}) — zincir durduruluyor.`);
    try {
        if (initFirebase()) {
            await sendAdminAlert(
                'Otomatik Pipeline Zinciri Durduruldu',
                `${workflowFile}: art arda ${FAIL_THRESHOLD} başarısız çalıştırma sonrası kendi kendini tetikleme durduruldu. GitHub Actions'tan kontrol edip manuel tetikleyin.`,
                { workflowFile }
            );
        }
    } catch { /* ignore */ }
    process.exit(1);
}

main().catch(err => {
    console.error('checkChainHealth hatası:', err.message);
    process.exit(0); // takip hatası zinciri kırmasın
});

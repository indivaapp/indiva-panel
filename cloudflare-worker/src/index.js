/**
 * INDIVA Auto-Onual Scheduler — Cloudflare Worker
 * 
 * Her 5 dakikada bir GitHub Actions workflow_dispatch tetikleyerek
 * auto-onual pipeline'ını çalıştırır.
 * 
 * Neden bu mimari?
 * - onual.com, Cloudflare ve Vercel datacenter IP'lerini engelliyor (403)
 * - GitHub Actions runner IP'leri onual.com'a erişebiliyor
 * - Cloudflare cron trigger, GitHub Actions cron'dan çok daha güvenilir
 * - Böylece: Cloudflare (güvenilir zamanlayıcı) → GitHub Actions (scraping) 
 */

// ─── Config ──────────────────────────────────────────────────────────────────

const GITHUB_REPO = 'indivaapp/indiva-panel';
const WORKFLOW_FILE = 'auto-onual.yml';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;

// ─── GitHub Actions Trigger ──────────────────────────────────────────────────

async function triggerWorkflow(githubToken) {
    console.log(`\n🚀 GitHub Actions workflow tetikleniyor...`);
    console.log(`   Repository: ${GITHUB_REPO}`);
    console.log(`   Workflow: ${WORKFLOW_FILE}`);
    console.log(`   Zaman: ${new Date().toISOString()}\n`);

    const response = await fetch(GITHUB_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'INDIVA-Cloudflare-Worker',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            ref: 'main',
        }),
    });

    if (response.status === 204) {
        console.log('✅ Workflow başarıyla tetiklendi!');
        return { success: true, message: 'Workflow dispatched successfully' };
    }

    const errorText = await response.text();
    console.error(`❌ Workflow tetikleme hatası: ${response.status} ${errorText}`);
    throw new Error(`GitHub API ${response.status}: ${errorText}`);
}

// ─── Worker Export ───────────────────────────────────────────────────────────

export default {
    // Cron trigger handler (5 dakikada bir)
    async scheduled(event, env, ctx) {
        const token = env.GITHUB_TOKEN;
        if (!token) {
            console.error('❌ GITHUB_TOKEN secret eksik!');
            return;
        }

        try {
            await triggerWorkflow(token);
        } catch (err) {
            console.error(`❌ Scheduled trigger hatası: ${err.message}`);
        }
    },

    // HTTP handler (manuel test ve sağlık kontrolü)
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === '/trigger') {
            const token = env.GITHUB_TOKEN;
            if (!token) {
                return new Response('❌ GITHUB_TOKEN secret eksik', { status: 500 });
            }

            try {
                const result = await triggerWorkflow(token);
                return new Response(`✅ ${result.message}`, {
                    status: 200,
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                });
            } catch (err) {
                return new Response(`❌ Hata: ${err.message}`, { status: 500 });
            }
        }

        return new Response('INDIVA Auto-Onual Scheduler 🟢 (Cloudflare → GitHub Actions)', {
            status: 200,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    },
};

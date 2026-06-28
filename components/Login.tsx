import React, { useState } from 'react';
import { signInWithEmail } from '../services/auth';

const ADMIN_EMAIL = 'indivaapp@gmail.com';

const Login: React.FC = () => {
    const [email, setEmail] = useState(ADMIN_EMAIL);
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!password) { setError('Şifre girin.'); return; }
        setLoading(true);
        setError(null);
        try {
            await signInWithEmail(email, password);
            // Başarılıysa App'teki auth dinleyicisi otomatik içeri alır.
        } catch (err: any) {
            const code = err?.code || '';
            if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/invalid-email') {
                setError('E-posta veya şifre hatalı.');
            } else if (code === 'auth/too-many-requests') {
                setError('Çok fazla deneme. Biraz bekleyip tekrar deneyin.');
            } else if (code === 'auth/network-request-failed') {
                setError('İnternet bağlantısı yok.');
            } else {
                setError(err?.message || 'Giriş başarısız.');
            }
            setLoading(false);
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white p-6">
            <div className="w-full max-w-sm">
                {/* Logo / başlık */}
                <div className="flex flex-col items-center mb-8">
                    <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-orange-500 to-pink-600 flex items-center justify-center shadow-lg shadow-orange-900/30 text-3xl mb-3">
                        🛍️
                    </div>
                    <h1 className="text-xl font-bold tracking-tight">İNDİVA Panel</h1>
                    <p className="text-gray-500 text-xs mt-1">Yönetici girişi</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3 bg-gray-800/80 border border-gray-700 rounded-2xl p-5">
                    <div>
                        <label className="block text-xs text-gray-400 mb-1.5">E-posta</label>
                        <input
                            type="email"
                            value={email}
                            onChange={e => { setEmail(e.target.value); setError(null); }}
                            autoCapitalize="none"
                            autoCorrect="off"
                            className="w-full bg-gray-900 border border-gray-700 focus:border-blue-500 rounded-xl px-3 py-2.5 text-sm text-white outline-none transition-colors"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-400 mb-1.5">Şifre</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => { setPassword(e.target.value); setError(null); }}
                            placeholder="••••••••"
                            className="w-full bg-gray-900 border border-gray-700 focus:border-blue-500 rounded-xl px-3 py-2.5 text-sm text-white outline-none placeholder:text-gray-600 transition-colors"
                        />
                    </div>

                    {error && (
                        <div className="flex items-start gap-2 bg-red-950/50 border border-red-500/20 rounded-xl px-3 py-2.5">
                            <span className="text-red-400 text-sm shrink-0">⚠️</span>
                            <p className="text-red-300 text-xs leading-relaxed">{error}</p>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading || !password}
                        className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <>
                                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                Giriş yapılıyor...
                            </>
                        ) : 'Giriş Yap'}
                    </button>
                </form>

                <p className="text-center text-gray-600 text-[11px] mt-4">
                    Bir kez giriş yaparsın, oturum açık kalır.
                </p>
            </div>
        </div>
    );
};

export default Login;

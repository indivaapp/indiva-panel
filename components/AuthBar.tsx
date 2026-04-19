
import React, { useState, useEffect } from 'react';
import { getRedirectResult } from 'firebase/auth';
import type { AuthError } from 'firebase/auth';
import { watchAuth, signInWithGoogle, logout } from '../services/auth';
import { auth } from '../firebaseConfig';

const AuthBar: React.FC = () => {
    const [userEmail, setUserEmail] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [authError, setAuthError] = useState<string | null>(null);

    useEffect(() => {
        const unsubscribe = watchAuth((email, isAdmin) => {
            setUserEmail(email);
            setIsAdmin(isAdmin);
            setIsLoading(false);
            if (email) {
                setAuthError(null);
            }
        });

        // Handle redirect result
        getRedirectResult(auth)
            .then((result) => {
                if (result) {
                    // This is the UserCredential object.
                    // You can get the Google Access Token from the result.
                }
            })
            .catch((error) => {
                const authError = error as AuthError;
                setAuthError(`Redirect ile giriş başarısız oldu: ${authError.message}`);
            });

        return () => unsubscribe();
    }, []);

    // Fix: Correctly handles errors from `signInWithGoogle` which can throw an exception
    // on failure. Also resolves the type error by not accessing the non-existent 'message' property.
    const handleLogin = async () => {
        setAuthError(null);
        try {
            const result = await signInWithGoogle();
            if (!result.ok) {
                setAuthError('Bilinmeyen bir giriş hatası oluştu.');
            }
        } catch (error: any) {
            setAuthError(error.message || 'Bilinmeyen bir giriş hatası oluştu.');
        }
    };

    const handleLogout = async () => {
        try {
            await logout();
        } catch {
            setAuthError('Çıkış yapılamadı.');
        }
    };

    if (isLoading) {
        return <div className="bg-gray-800 p-3 text-center text-sm">Kimlik doğrulanıyor...</div>;
    }

    return (
        <>
            <div className="bg-gray-800 p-3 flex justify-between items-center border-b border-gray-700">
                <div>
                    {userEmail ? (
                        <div className="flex items-center space-x-3">
                            <span className="text-white">{userEmail}</span>
                            {isAdmin ? (
                                <span className="px-2 py-1 text-xs font-semibold text-green-800 bg-green-200 rounded-full">Admin</span>
                            ) : (
                                <span className="px-2 py-1 text-xs font-semibold text-gray-800 bg-gray-300 rounded-full">Kullanıcı</span>
                            )}
                        </div>
                    ) : (
                        <span className="text-gray-400">Giriş yapılmadı</span>
                    )}
                </div>
                <div>
                    {userEmail ? (
                        <button onClick={handleLogout} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors">
                            Çıkış Yap
                        </button>
                    ) : (
                        <button onClick={handleLogin} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors">
                            Giriş Yap
                        </button>
                    )}
                </div>
            </div>
            {authError && <div className="bg-red-900 text-red-200 p-2 text-center text-sm">{authError}</div>}
        </>
    );
};

export default AuthBar;
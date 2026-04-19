
import { auth } from "../firebaseConfig";
// Fix: Import `signOut` to implement the required `logout` function.
import { signInAnonymously, onAuthStateChanged, User, signOut } from "firebase/auth";

/** UI göstermeden anonim oturum açar. */
export const ensureAnonymousAuth = async (): Promise<User | null> => {
  if (!auth.currentUser) {
    try {
        const userCredential = await signInAnonymously(auth);
        return userCredential.user;
    } catch (error: any) {
        if (error.code === 'auth/admin-restricted-operation') {
            throw new Error(
              "Anonim giriş başarısız oldu. Lütfen Firebase projenizde 'Authentication > Sign-in method' bölümünden 'Anonymous' (Anonim) sağlayıcısını etkinleştirdiğinizden emin olun."
            );
        }
        // Re-throw other errors to be caught by the caller
        throw error;
    }
  }
  return auth.currentUser;
};

/** Auth durumu ilk kez stabil olduğunda (giriş yapılmış veya yapılmamış) callback'i çağırır. */
export const onAuthReady = (cb: (ready: boolean) => void) => {
  const unsubscribe = onAuthStateChanged(auth, (user) => {
    // We consider auth "ready" as soon as the check is complete,
    // regardless of whether there's a user or not.
    cb(true);
    // Unsubscribe after the first fire to avoid multiple calls.
    unsubscribe();
  });
  return unsubscribe;
};

// Fix: Add `watchAuth` function to fix import error. It uses onAuthStateChanged
// to monitor the user's sign-in state and aligns with the app's logic that
// all signed-in users are admins.
export const watchAuth = (cb: (email: string | null, isAdmin: boolean) => void) => {
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      const email = user.isAnonymous ? `anonymous:${user.uid.substring(0, 6)}` : user.email;
      cb(email, true);
    } else {
      cb(null, false);
    }
  });
};

// Fix: Add `signInWithGoogle` function to fix import error. It now ensures
// an anonymous user is signed in, as Google Sign-In is no longer used.
export const signInWithGoogle = async () => {
    const user = await ensureAnonymousAuth();
    return { ok: !!user };
};

// Fix: Add `logout` function to fix import error.
export const logout = () => {
    return signOut(auth);
};
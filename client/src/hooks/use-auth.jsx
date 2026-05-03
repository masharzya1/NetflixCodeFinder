import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { getFirebaseAuth, getGoogleProvider, initFirebaseClient } from "@/lib/firebase";

const AuthContext = createContext(null);

function mapFirebaseAuthError(error) {
  const code = error?.code || "";
  const message = error?.message || "";

  if (code.includes("popup-blocked")) {
    return "Popup blocked. Please allow popups for this site and try again.";
  }
  if (code.includes("popup-closed-by-user")) {
    return "Login popup was closed before sign in completed.";
  }
  if (code.includes("unauthorized-domain")) {
    return "Sign-in is not enabled for this website yet. Please contact support.";
  }
  if (code.includes("operation-not-allowed")) {
    return "Google sign-in is not enabled in Firebase Authentication.";
  }
  if (message) return message;
  return "Google sign-in failed. Please try again.";
}

export function AuthProvider({ children }) {
  const [bootstrapped, setBootstrapped] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [adminData, setAdminData] = useState(null);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    let unsubscribe = () => {};

    async function bootstrap() {
      try {
        await initFirebaseClient();
        const auth = getFirebaseAuth();

        unsubscribe = onAuthStateChanged(auth, async (user) => {
          setFirebaseUser(user);

          if (!user) {
            setAdminData(null);
            setAuthError("");
            setBootstrapped(true);
            return;
          }

          try {
            const token = await user.getIdToken();
            const response = await fetch("/api/admin/bootstrap", {
              headers: { Authorization: `Bearer ${token}` },
            });
            const payload = await response.json();

            if (!response.ok) {
              throw new Error(payload.error || "We could not open the admin panel for this account.");
            }

            setAdminData(payload);
            setAuthError("");
          } catch (error) {
            setAdminData(null);
            setAuthError(error.message || "We could not open the admin panel for this account.");
          } finally {
            setBootstrapped(true);
          }
        });
      } catch (error) {
        setAuthError(error.message || "Sign-in is temporarily unavailable. Please try again later.");
        setBootstrapped(true);
      }
    }

    bootstrap();

    return () => {
      unsubscribe();
    };
  }, []);

  async function signInAdmin() {
    try {
      const auth = getFirebaseAuth();
      await signInWithPopup(auth, getGoogleProvider());
      setAuthError("");
    } catch (error) {
      setAuthError(mapFirebaseAuthError(error));
      throw error;
    }
  }

  async function signOutAdmin() {
    const auth = getFirebaseAuth();
    await signOut(auth);
    setAdminData(null);
  }

  async function getAdminToken() {
    if (!firebaseUser) throw new Error("Please sign in again to continue.");
    return firebaseUser.getIdToken();
  }

  const value = useMemo(
    () => ({
      bootstrapped,
      firebaseUser,
      adminData,
      authError,
      isAdmin: Boolean(adminData?.adminUser),
      signInAdmin,
      signOutAdmin,
      getAdminToken,
      setAdminData,
    }),
    [bootstrapped, firebaseUser, adminData, authError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}

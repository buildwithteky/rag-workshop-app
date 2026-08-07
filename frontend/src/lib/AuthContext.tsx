"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  type CognitoUserSession,
} from "amazon-cognito-identity-js";
import { getUserPool } from "./cognito";

interface AuthContextValue {
  isLoading: boolean;
  isAuthenticated: boolean;
  email: string | null;
  idToken: string | null;
  signUp: (email: string, password: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendCode: (email: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  getFreshToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : "Something went wrong. Please try again.");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);

  const refreshFromCurrentUser = useCallback(() => {
    const pool = getUserPool();
    const currentUser = pool.getCurrentUser();
    if (!currentUser) {
      setEmail(null);
      setIdToken(null);
      setIsLoading(false);
      return;
    }
    currentUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        setEmail(null);
        setIdToken(null);
        setIsLoading(false);
        return;
      }
      setEmail(currentUser.getUsername());
      setIdToken(session.getIdToken().getJwtToken());
      setIsLoading(false);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (!cancelled) refreshFromCurrentUser();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshFromCurrentUser]);

  const signUp = useCallback((emailAddr: string, password: string) => {
    return new Promise<void>((resolve, reject) => {
      const pool = getUserPool();
      const attributes = [new CognitoUserAttribute({ Name: "email", Value: emailAddr })];
      pool.signUp(emailAddr, password, attributes, [], (err) => {
        if (err) reject(toError(err));
        else resolve();
      });
    });
  }, []);

  const confirmSignUp = useCallback((emailAddr: string, code: string) => {
    return new Promise<void>((resolve, reject) => {
      const pool = getUserPool();
      const user = new CognitoUser({ Username: emailAddr, Pool: pool });
      user.confirmRegistration(code, true, (err) => {
        if (err) reject(toError(err));
        else resolve();
      });
    });
  }, []);

  const resendCode = useCallback((emailAddr: string) => {
    return new Promise<void>((resolve, reject) => {
      const pool = getUserPool();
      const user = new CognitoUser({ Username: emailAddr, Pool: pool });
      user.resendConfirmationCode((err) => {
        if (err) reject(toError(err));
        else resolve();
      });
    });
  }, []);

  const signIn = useCallback((emailAddr: string, password: string) => {
    return new Promise<void>((resolve, reject) => {
      const pool = getUserPool();
      const user = new CognitoUser({ Username: emailAddr, Pool: pool });
      const details = new AuthenticationDetails({ Username: emailAddr, Password: password });
      user.authenticateUser(details, {
        onSuccess: (session) => {
          setEmail(emailAddr);
          setIdToken(session.getIdToken().getJwtToken());
          resolve();
        },
        onFailure: (err) => reject(toError(err)),
      });
    });
  }, []);

  const signOut = useCallback(() => {
    const pool = getUserPool();
    const currentUser = pool.getCurrentUser();
    currentUser?.signOut();
    setEmail(null);
    setIdToken(null);
  }, []);

  const getFreshToken = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      const pool = getUserPool();
      const currentUser = pool.getCurrentUser();
      if (!currentUser) {
        resolve(null);
        return;
      }
      currentUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session || !session.isValid()) {
          resolve(null);
          return;
        }
        const token = session.getIdToken().getJwtToken();
        setIdToken(token);
        resolve(token);
      });
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoading,
      isAuthenticated: Boolean(idToken),
      email,
      idToken,
      signUp,
      confirmSignUp,
      resendCode,
      signIn,
      signOut,
      getFreshToken,
    }),
    [isLoading, idToken, email, signUp, confirmSignUp, resendCode, signIn, signOut, getFreshToken]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { setLang } from './i18n';
import type { Department, Me, Persona } from './types';

interface AuthState {
  me: Me | null;
  loading: boolean;
  departments: Department[];
  personas: Record<string, Persona>;
  refresh(): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [personas, setPersonas] = useState<Record<string, Persona>>({});

  const refresh = useCallback(async () => {
    try {
      const m = await api<Me>('/api/auth/me');
      if (m.user.locale === 'en' || m.user.locale === 'ms') setLang(m.user.locale);
      setMe(m);
      // Everything outside /api/auth is closed until a temporary password is changed.
      if (m.mustChangePassword) return;
      const [d, p] = await Promise.all([api<Department[]>('/api/departments'), api<Persona[]>('/api/personas')]);
      setDepartments(d);
      setPersonas(Object.fromEntries(p.map((x) => [x.key, x])));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setMe(null);
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => setMe(null);
    window.addEventListener('xc:unauthorized', onUnauthorized);
    return () => window.removeEventListener('xc:unauthorized', onUnauthorized);
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ me, loading, departments, personas, refresh, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

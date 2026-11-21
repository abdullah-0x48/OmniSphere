import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  AuthMeResponse,
  AuthSessionResponse,
  Tenant,
  UserPublic,
} from '../../shared/types.ts';
import {
  apiRequest,
  getStoredActiveTenantId,
  getStoredToken,
  registerUnauthorizedHandler,
  setStoredActiveTenantId,
  setStoredToken,
} from '../api/client.ts';

interface AuthContextValue {
  user: UserPublic | null;
  tenants: Tenant[];
  demoMode: boolean;
  isLoading: boolean;
  activeTenantId: string | null;
  activeTenant: Tenant | null;
  setActiveTenantId: (tenantId: string | null) => void;
  login: (email: string, password: string) => Promise<AuthSessionResponse>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [demoMode, setDemoMode] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(() =>
    getStoredActiveTenantId(),
  );

  const syncSeActiveTenant = useCallback((nextUser: UserPublic, nextTenants: Tenant[]) => {
    if (nextUser.role === 'SUPPORT_ENGINEER') {
      const current = getStoredActiveTenantId();
      if (current && nextTenants.some((t) => t.id === current)) {
        setActiveTenantIdState(current);
      } else {
        const first = nextTenants[0]?.id ?? null;
        setStoredActiveTenantId(first);
        setActiveTenantIdState(first);
      }
    } else {
      setStoredActiveTenantId(null);
      setActiveTenantIdState(nextUser.tenantId);
    }
  }, []);

  const clearSession = useCallback(() => {
    setStoredToken(null);
    setStoredActiveTenantId(null);
    setUser(null);
    setTenants([]);
    setActiveTenantIdState(null);
  }, []);

  useEffect(() => {
    registerUnauthorizedHandler(() => {
      clearSession();
    });
  }, [clearSession]);

  const refreshMe = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setIsLoading(false);
      return;
    }
    try {
      const data = await apiRequest<AuthMeResponse>('/auth/me');
      setUser(data.user);
      setTenants(data.tenants);
      setDemoMode(data.demoMode);
      syncSeActiveTenant(data.user, data.tenants);
    } catch {
      clearSession();
    } finally {
      setIsLoading(false);
    }
  }, [clearSession, syncSeActiveTenant]);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  const login = useCallback(
    async (email: string, password: string): Promise<AuthSessionResponse> => {
      const session = await apiRequest<AuthSessionResponse>('/auth/login', {
        method: 'POST',
        body: { email, password },
        skipAuthHeader: true,
      });
      setStoredToken(session.token);
      setUser(session.user);
      setTenants(session.tenants);
      setDemoMode(session.demoMode);
      syncSeActiveTenant(session.user, session.tenants);
      return session;
    },
    [syncSeActiveTenant],
  );

  const logout = useCallback(async () => {
    try {
      if (getStoredToken()) {
        await apiRequest('/auth/logout', { method: 'POST' });
      }
    } catch {
      // Proceed with local sign-out even if server logout fails
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const setActiveTenantId = useCallback(
    (tenantId: string | null) => {
      if (user?.role !== 'SUPPORT_ENGINEER') return;
      setStoredActiveTenantId(tenantId);
      setActiveTenantIdState(tenantId);
    },
    [user?.role],
  );

  const activeTenant = useMemo(() => {
    if (!activeTenantId) return null;
    return tenants.find((t) => t.id === activeTenantId) ?? null;
  }, [activeTenantId, tenants]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      tenants,
      demoMode,
      isLoading,
      activeTenantId,
      activeTenant,
      setActiveTenantId,
      login,
      logout,
      refreshMe,
    }),
    [
      user,
      tenants,
      demoMode,
      isLoading,
      activeTenantId,
      activeTenant,
      setActiveTenantId,
      login,
      logout,
      refreshMe,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

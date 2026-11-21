import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ROLE_HOME_PATHS,
  ROLE_SHORT_LABELS,
  type DemoAccount,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import { Button, Card, Input } from '../components/ui/index.ts';

const DEMO_PASSWORD_CLIENT = 'Demo@12345';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const demoQuery = useQuery({
    queryKey: ['demo-accounts'],
    queryFn: () => apiRequest<{ items: DemoAccount[] }>('/auth/demo-accounts', { skipAuthHeader: true }),
    retry: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter both email and password.');
      return;
    }
    setSubmitting(true);
    try {
      const session = await login(email.trim(), password);
      navigate(ROLE_HOME_PATHS[session.user.role], { replace: true });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Unable to sign in. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDemoSignIn = async (demoEmail: string) => {
    setError(null);
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD_CLIENT);
    setSubmitting(true);
    try {
      const session = await login(demoEmail, DEMO_PASSWORD_CLIENT);
      navigate(ROLE_HOME_PATHS[session.user.role], { replace: true });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Unable to sign in with demo account.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const [demoTenantTab, setDemoTenantTab] = useState<string>('KTL');
  const demoAccounts = demoQuery.data?.items ?? [];
  const providerDemos = demoAccounts.filter((a) => !a.tenantCode);
  const clientDemos = demoAccounts.filter((a) => Boolean(a.tenantCode));
  const tenantCodes = Array.from(
    new Set(clientDemos.map((a) => a.tenantCode).filter((c): c is string => Boolean(c))),
  );
  const selectedTenantCode = tenantCodes.includes(demoTenantTab)
    ? demoTenantTab
    : (tenantCodes[0] ?? 'KTL');
  const visibleClientDemos = clientDemos.filter((a) => a.tenantCode === selectedTenantCode);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4 sm:px-6">
      <div className="w-full max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Login Form Column */}
        <div className="lg:col-span-5">
          <div className="flex items-center gap-2.5 mb-6">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-900 leading-tight">OmniSphere</h1>
              <p className="text-xs text-slate-500">Industrial IoT Lifecycle Management</p>
            </div>
          </div>

          <Card className="p-6">
            <h2 className="text-base font-semibold text-slate-900">Sign in to your account</h2>
            <p className="text-xs text-slate-500 mt-1">
              Use your provider or client organization credentials.
            </p>

            {error && (
              <div
                role="alert"
                className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
              <Input
                label="Email address"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@organization.com"
                required
              />
              <Input
                label="Password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
              />
              <div className="flex items-center justify-end">
                <Link
                  to="/forgot-password"
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                >
                  Forgot password?
                </Link>
              </div>
              <Button type="submit" loading={submitting} className="w-full">
                Sign in
              </Button>
            </form>
          </Card>
        </div>

        {/* Demo Accounts Panel (DEMO_MODE only, Section 10.1) */}
        {demoAccounts.length > 0 && (
          <div className="lg:col-span-7">
            <Card className="p-6">
              <div className="flex items-baseline justify-between gap-2 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Demo accounts</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Select any seeded role to sign in immediately. Default password:{' '}
                    <span className="font-mono text-slate-700">{DEMO_PASSWORD_CLIENT}</span>
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-5">
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 mb-2">
                    Service Provider Staff
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {providerDemos.map((acc) => (
                      <button
                        key={acc.email}
                        type="button"
                        disabled={submitting}
                        onClick={() => void handleDemoSignIn(acc.email)}
                        className="text-left rounded-lg border border-slate-200 px-3 py-2.5 hover:border-indigo-400 hover:bg-indigo-50/40 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-slate-900 truncate">
                            {acc.roleLabel}
                          </span>
                          <span className="text-xs font-mono text-indigo-600 shrink-0">
                            {ROLE_SHORT_LABELS[acc.role]}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 font-mono mt-0.5 break-all">
                          {acc.email}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <h3 className="text-xs font-semibold text-slate-500">
                      Client Organization Accounts
                    </h3>
                    <div
                      role="tablist"
                      aria-label="Filter demo accounts by organization"
                      className="inline-flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg"
                    >
                      {tenantCodes.map((code) => (
                        <button
                          key={code}
                          type="button"
                          role="tab"
                          aria-selected={selectedTenantCode === code}
                          onClick={() => setDemoTenantTab(code)}
                          className={`px-2.5 py-1 text-xs font-mono font-medium rounded-md transition-colors cursor-pointer ${
                            selectedTenantCode === code
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {code}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {visibleClientDemos.map((acc) => (
                      <button
                        key={acc.email}
                        type="button"
                        disabled={submitting}
                        onClick={() => void handleDemoSignIn(acc.email)}
                        className="text-left rounded-lg border border-slate-200 px-3 py-2.5 hover:border-indigo-400 hover:bg-indigo-50/40 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900 truncate">
                            {acc.roleLabel}
                          </span>
                          <span className="text-xs font-mono text-slate-600 shrink-0">
                            {acc.tenantCode}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 font-mono mt-0.5 break-all">
                          {acc.email}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { Button, Card, Input } from '../components/ui/index.ts';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentMessage, setSentMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError('Enter your account email address.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: { email: email.trim() },
        skipAuthHeader: true,
      });
      setSentMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to process request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-8 sm:py-12 px-4">
      <div className="w-full max-w-md mx-auto">
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-white" aria-hidden="true" />
          </div>
          <span className="text-lg font-semibold text-slate-900">OmniSphere</span>
        </div>

        <Card className="p-5 sm:p-6">
          <h1 className="text-base font-semibold text-slate-900">Reset your password</h1>
          <p className="text-xs text-slate-600 mt-1">
            Enter your email address and we will send a single-use reset link valid for 60 minutes.
          </p>

          {error && (
            <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
              {error}
            </div>
          )}

          {sentMessage ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">
                {sentMessage}
              </div>
              <p className="text-xs text-slate-600">
                In outbox-only environments without SMTP, an administrator can retrieve the link from the Email Outbox page.
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 min-h-[40px] text-sm font-medium text-indigo-700 hover:text-indigo-800"
              >
                <ArrowLeft className="w-4 h-4" />
                Return to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
              <Input
                label="Email address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@organization.com"
                className="min-h-[44px] sm:min-h-[38px]"
                required
              />
              <Button type="submit" size="lg" loading={submitting} className="w-full min-h-[44px]">
                Send reset link
              </Button>
              <div className="pt-1">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1.5 min-h-[36px] text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}

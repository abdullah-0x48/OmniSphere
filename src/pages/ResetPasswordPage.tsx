import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { Button, Card, Input } from '../components/ui/index.ts';

export function ResetPasswordPage() {
  const { token = '' } = useParams();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError('Password must be at least 8 characters and include a letter and a digit.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/auth/reset-password', {
        method: 'POST',
        body: { token, newPassword },
        skipAuthHeader: true,
      });
      setCompleted(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to reset password.');
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
          <h1 className="text-base font-semibold text-slate-900">Set a new password</h1>
          <p className="text-xs text-slate-600 mt-1">
            Must be at least 8 characters and contain at least one letter and one digit.
          </p>

          {error && (
            <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
              {error}
            </div>
          )}

          {completed ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">
                Your password has been updated.
              </div>
              <Link
                to="/login"
                className="inline-flex items-center justify-center w-full min-h-[44px] px-4 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
              >
                Continue to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
              <Input
                label="New password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="min-h-[44px] sm:min-h-[38px]"
                required
              />
              <Input
                label="Confirm new password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="min-h-[44px] sm:min-h-[38px]"
                required
              />
              <Button type="submit" size="lg" loading={submitting} className="w-full min-h-[44px]">
                Update password
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}

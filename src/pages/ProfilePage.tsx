import React, { useState } from 'react';
import { ROLE_LABELS } from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import {
  Button,
  Card,
  Input,
  PageHeader,
  StatusChip,
  useToast,
} from '../components/ui/index.ts';
import { formatLocalDateTime } from '../utils/format.ts';

export function ProfilePage() {
  const { user, tenants } = useAuth();
  const { toast } = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!currentPassword) {
      setError('Enter your current password.');
      return;
    }
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError('New password must be at least 8 characters with at least one letter and one digit.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast({ kind: 'success', title: 'Password updated' });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to change password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        description="Manage your account details and sign-in credentials."
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Card className="p-5 sm:p-6 lg:col-span-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Account details</h2>
            <StatusChip status={user.status} />
          </div>

          <dl className="divide-y divide-slate-100 text-sm">
            <div className="py-3 flex justify-between gap-4">
              <dt className="text-slate-600">Name</dt>
              <dd className="font-medium text-slate-900">{user.name}</dd>
            </div>
            <div className="py-3 flex justify-between gap-4">
              <dt className="text-slate-600">Email</dt>
              <dd className="font-mono text-xs text-slate-800 break-all text-right">{user.email}</dd>
            </div>
            <div className="py-3 flex justify-between gap-4">
              <dt className="text-slate-600">Role</dt>
              <dd className="font-medium text-slate-900 text-right">
                {ROLE_LABELS[user.role]}
                {user.isSupervisor ? ' · Supervisor' : ''}
              </dd>
            </div>
            <div className="py-3 flex justify-between gap-4">
              <dt className="text-slate-600">Organization</dt>
              <dd className="text-slate-900 text-right">
                {user.tenantName ? `${user.tenantName} (${user.tenantCode})` : 'Service Provider'}
              </dd>
            </div>
            {(user.role === 'SUPPORT_ENGINEER' || user.role === 'FIELD_TECHNICIAN') && (
              <div className="py-3 flex justify-between gap-4">
                <dt className="text-slate-600">Assigned tenants</dt>
                <dd className="text-right text-slate-800">
                  {tenants.length === 0
                    ? 'None'
                    : tenants.map((t) => `${t.code} (${t.name})`).join(', ')}
                </dd>
              </div>
            )}
            <div className="py-3 flex justify-between gap-4">
              <dt className="text-slate-600">Last sign-in</dt>
              <dd className="font-mono text-xs tabular-nums text-slate-700 text-right">
                {formatLocalDateTime(user.lastLoginAt)}
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="p-5 sm:p-6 lg:col-span-6">
          <h2 className="text-base font-semibold text-slate-900">Change password</h2>
          <p className="text-xs text-slate-600 mt-1">
            Minimum 8 characters with at least one letter and one digit.
          </p>

          {error && (
            <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
              {error}
            </div>
          )}

          <form onSubmit={handlePasswordChange} className="mt-4 space-y-4" noValidate>
            <Input
              label="Current password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
            <Input
              label="New password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <Input
              label="Confirm new password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            <div className="pt-1">
              <Button type="submit" loading={saving}>
                Update password
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}

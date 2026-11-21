import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { ROLE_HOME_PATHS, type RoleCode } from '../shared/types.ts';
import { AuthProvider, useAuth } from './auth/AuthContext.tsx';
import { ToastProvider, useToast } from './components/ui/index.ts';
import { AppShell } from './layouts/AppShell.tsx';
import { AuditPage } from './pages/AuditPage.tsx';
import { DeviceDetailPage } from './pages/DeviceDetailPage.tsx';
import { DeviceModelsPage } from './pages/DeviceModelsPage.tsx';
import { DevicesPage } from './pages/DevicesPage.tsx';
import { EmailOutboxPage } from './pages/EmailOutboxPage.tsx';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { PlatformPage } from './pages/PlatformPage.tsx';
import { ProfilePage } from './pages/ProfilePage.tsx';
import { ResetPasswordPage } from './pages/ResetPasswordPage.tsx';
import {
  ClientDashboardPage,
  LiveStatusPage,
  MyWorkOrdersPage,
  NocHomePage,
  NotFoundPage,
} from './pages/RoleHomePages.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { SitesPage } from './pages/SitesPage.tsx';
import { StaffPage } from './pages/StaffPage.tsx';
import { TenantDetailPage } from './pages/TenantDetailPage.tsx';
import { TenantsPage } from './pages/TenantsPage.tsx';
import { UsersPage } from './pages/UsersPage.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function FullPageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <p className="text-sm text-slate-500">Loading OmniSphere...</p>
    </div>
  );
}

function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <FullPageLoader />;
  if (user) return <Navigate to={ROLE_HOME_PATHS[user.role]} replace />;
  return <>{children}</>;
}

function RequireAuthLayout() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <AppShell />;
}

/**
 * Enforces role-based route authorization (Section 10.1):
 * Unauthorized routes redirect to the user's role home with an explanatory toast.
 */
function RoleGuard({
  allowedRoles,
  children,
}: {
  allowedRoles: readonly RoleCode[];
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const notifiedRef = React.useRef(false);

  const isAllowed = user ? allowedRoles.includes(user.role) : false;

  useEffect(() => {
    if (user && !isAllowed && !notifiedRef.current) {
      notifiedRef.current = true;
      toast({
        kind: 'error',
        title: 'Access restricted',
        description: 'You do not have permission to view that page.',
      });
      navigate(ROLE_HOME_PATHS[user.role], { replace: true });
    }
  }, [user, isAllowed, toast, navigate]);

  if (!user || !isAllowed) return null;
  return <>{children}</>;
}

function HomeRedirect() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={ROLE_HOME_PATHS[user.role]} replace />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<HomeRedirect />} />
              <Route
                path="/login"
                element={
                  <PublicOnlyRoute>
                    <LoginPage />
                  </PublicOnlyRoute>
                }
              />
              <Route
                path="/forgot-password"
                element={
                  <PublicOnlyRoute>
                    <ForgotPasswordPage />
                  </PublicOnlyRoute>
                }
              />
              <Route
                path="/reset-password/:token"
                element={
                  <PublicOnlyRoute>
                    <ResetPasswordPage />
                  </PublicOnlyRoute>
                }
              />

              <Route element={<RequireAuthLayout />}>
                <Route path="/profile" element={<ProfilePage />} />

                <Route
                  path="/platform"
                  element={
                    <RoleGuard allowedRoles={['PLATFORM_ADMIN']}>
                      <PlatformPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/tenants"
                  element={
                    <RoleGuard allowedRoles={['PLATFORM_ADMIN']}>
                      <TenantsPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/tenants/:id"
                  element={
                    <RoleGuard allowedRoles={['PLATFORM_ADMIN']}>
                      <TenantDetailPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/staff"
                  element={
                    <RoleGuard allowedRoles={['PLATFORM_ADMIN']}>
                      <StaffPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/users"
                  element={
                    <RoleGuard allowedRoles={['CLIENT_ADMIN']}>
                      <UsersPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <RoleGuard allowedRoles={['CLIENT_ADMIN']}>
                      <SettingsPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/audit"
                  element={
                    <RoleGuard allowedRoles={['PLATFORM_ADMIN', 'CLIENT_ADMIN']}>
                      <AuditPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/email-outbox"
                  element={
                    <RoleGuard allowedRoles={['PLATFORM_ADMIN', 'SUPPORT_ENGINEER', 'CLIENT_ADMIN']}>
                      <EmailOutboxPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/noc"
                  element={
                    <RoleGuard allowedRoles={['SUPPORT_ENGINEER']}>
                      <NocHomePage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/dashboard"
                  element={
                    <RoleGuard allowedRoles={['CLIENT_ADMIN', 'CLIENT_MANAGER', 'SUPPORT_ENGINEER']}>
                      <ClientDashboardPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/my-work-orders"
                  element={
                    <RoleGuard allowedRoles={['FIELD_TECHNICIAN']}>
                      <MyWorkOrdersPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/live-status"
                  element={
                    <RoleGuard allowedRoles={['CLIENT_OPERATOR']}>
                      <LiveStatusPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/sites"
                  element={
                    <RoleGuard
                      allowedRoles={[
                        'SUPPORT_ENGINEER',
                        'FIELD_TECHNICIAN',
                        'CLIENT_ADMIN',
                        'CLIENT_MANAGER',
                        'CLIENT_OPERATOR',
                      ]}
                    >
                      <SitesPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/device-models"
                  element={
                    <RoleGuard allowedRoles={['PLATFORM_ADMIN', 'SUPPORT_ENGINEER']}>
                      <DeviceModelsPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/devices"
                  element={
                    <RoleGuard
                      allowedRoles={[
                        'SUPPORT_ENGINEER',
                        'FIELD_TECHNICIAN',
                        'CLIENT_ADMIN',
                        'CLIENT_MANAGER',
                        'CLIENT_OPERATOR',
                      ]}
                    >
                      <DevicesPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/devices/:id"
                  element={
                    <RoleGuard
                      allowedRoles={[
                        'SUPPORT_ENGINEER',
                        'FIELD_TECHNICIAN',
                        'CLIENT_ADMIN',
                        'CLIENT_MANAGER',
                        'CLIENT_OPERATOR',
                      ]}
                    >
                      <DeviceDetailPage />
                    </RoleGuard>
                  }
                />
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

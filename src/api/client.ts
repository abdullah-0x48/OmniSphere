import type { ApiErrorCode, ApiErrorResponse } from '../../shared/types.ts';

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: ApiErrorCode;
  public readonly details?: unknown;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let inMemoryToken: string | null = null;
let inMemoryTenantId: string | null = null;
let onUnauthorizedCallback: ((message: string) => void) | null = null;

const TOKEN_STORAGE_KEY = 'omnisphere.session.token';
const TENANT_STORAGE_KEY = 'omnisphere.se.activeTenantId';

export function getStoredToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  try {
    const saved = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (saved) {
      inMemoryToken = saved;
      return saved;
    }
  } catch {
    // sessionStorage may be blocked in restricted iframes; memory token remains primary
  }
  return null;
}

export function setStoredToken(token: string | null): void {
  inMemoryToken = token;
  try {
    if (token) {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage access failures inside sandboxed iframes
  }
}

export function getStoredActiveTenantId(): string | null {
  if (inMemoryTenantId !== null) return inMemoryTenantId;
  try {
    const saved = window.sessionStorage.getItem(TENANT_STORAGE_KEY);
    inMemoryTenantId = saved || null;
    return inMemoryTenantId;
  } catch {
    return null;
  }
}

export function setStoredActiveTenantId(tenantId: string | null): void {
  inMemoryTenantId = tenantId;
  try {
    if (tenantId) {
      window.sessionStorage.setItem(TENANT_STORAGE_KEY, tenantId);
    } else {
      window.sessionStorage.removeItem(TENANT_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function registerUnauthorizedHandler(cb: (message: string) => void): void {
  onUnauthorizedCallback = cb;
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined | null>;
    skipAuthHeader?: boolean;
  } = {},
): Promise<T> {
  const url = new URL(`/api/v1${path}`, window.location.origin);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (options.body !== undefined && !isFormData) {
    headers['Content-Type'] = 'application/json';
  }
  if (!options.skipAuthHeader) {
    const token = getStoredToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const activeTenantId = getStoredActiveTenantId();
    if (activeTenantId) {
      headers['X-Tenant-Id'] = activeTenantId;
    }
  }

  const res = await fetch(url.toString(), {
    method: options.method ?? 'GET',
    headers,
    body:
      options.body === undefined
        ? undefined
        : isFormData
          ? (options.body as FormData)
          : JSON.stringify(options.body),
  });

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const errPayload = parsed as ApiErrorResponse | null;
    const code = errPayload?.error?.code ?? 'INTERNAL';
    const message = errPayload?.error?.message ?? `Request failed with status ${res.status}`;
    const details = errPayload?.error?.details;

    // If an active session becomes unauthenticated or suspended, notify AuthContext
    if (
      !options.skipAuthHeader &&
      (res.status === 401 || (res.status === 403 && message === 'Organization suspended'))
    ) {
      onUnauthorizedCallback?.(message);
    }

    throw new ApiClientError(res.status, code, message, details);
  }

  return parsed as T;
}

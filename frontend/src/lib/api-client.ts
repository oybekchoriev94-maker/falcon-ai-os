const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

function readAuthStorage(): { token: string | null; tenant_id: string | null } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("auth-storage");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { token: parsed?.state?.token || null, tenant_id: parsed?.state?.tenant_id || null };
  } catch {
    return null;
  }
}

class ApiClient {
  private refreshing: Promise<string | null> | null = null;

  private getToken(): string | null {
    return readAuthStorage()?.token || null;
  }

  private getTenantId(): string | null {
    return readAuthStorage()?.tenant_id || null;
  }

  /**
   * Token muddati tugagan (2h) bo'lsa /auth/refresh orqali yangilaydi.
   * Bir vaqtda bir nechta so'rov 401 qaytsa bir marta refresh qilinadi
   * (double-refresh oldini oladi), qolganlari natijani kutadi.
   */
  private refreshToken(oldToken: string): Promise<string | null> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: oldToken }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data?.token) return null;
        if (typeof window !== "undefined") {
          const raw = localStorage.getItem("auth-storage");
          const parsed = raw ? JSON.parse(raw) : { state: {} };
          parsed.state.token = data.token;
          localStorage.setItem("auth-storage", JSON.stringify(parsed));
        }
        return data.token as string;
      } catch {
        return null;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    opts?: { formData?: boolean; signal?: AbortSignal }
  ): Promise<Record<string, unknown>> {
    const doFetch = (token: string | null): Promise<Response> => {
      const url = `${API_BASE}${path}`;
      const headers: Record<string, string> = {};
      const tenantId = this.getTenantId();

      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (tenantId) headers["x-tenant-id"] = tenantId;

      const fetchOpts: RequestInit = { method, signal: opts?.signal };

      if (body) {
        if (opts?.formData) {
          fetchOpts.body = body as FormData;
        } else {
          headers["Content-Type"] = "application/json";
          fetchOpts.body = JSON.stringify(body);
        }
      }
      fetchOpts.headers = headers;
      return fetch(url, fetchOpts);
    };

    const token = this.getToken();
    try {
      const res = await doFetch(token);

      // Token muddati tugagan — refresh + 1 marta qayta urinish
      if (res.status === 401 && token && !path.includes("/auth/")) {
        const fresh = await this.refreshToken(token);
        if (fresh) {
          const retry = await doFetch(fresh);
          const data = await retry.json();
          if (!retry.ok) return { success: false, error: data.error || `HTTP ${retry.status}` };
          return data;
        }
        // Refresh ham muvaffaqiyatsiz — login talab qilinadi
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("auth:expired"));
        }
        return { success: false, error: "Muddati tugagan, qayta kiring" };
      }

      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || `HTTP ${res.status}` };
      }
      return data;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return { success: false, error: "So'rov bekor qilindi" };
      }
      return { success: false, error: "Server bilan bog'lanib bo'lmadi" };
    }
  }

  async get<T = Record<string, any>>(path: string, signal?: AbortSignal): Promise<T & { success?: boolean; error?: string }> {
    return this.request("GET", path, undefined, { signal }) as any;
  }

  async post<T = Record<string, any>>(path: string, body?: unknown): Promise<T & { success?: boolean; error?: string }> {
    return this.request("POST", path, body) as any;
  }

  async put<T = Record<string, any>>(path: string, body?: unknown): Promise<T & { success?: boolean; error?: string }> {
    return this.request("PUT", path, body) as any;
  }

  async delete<T = Record<string, any>>(path: string): Promise<T & { success?: boolean; error?: string }> {
    return this.request("DELETE", path) as any;
  }

  async upload<T = Record<string, any>>(path: string, formData: FormData): Promise<T & { success?: boolean; error?: string }> {
    return this.request("POST", path, formData, { formData: true }) as any;
  }
}

export const api = new ApiClient();
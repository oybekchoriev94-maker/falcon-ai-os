const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

class ApiClient {
  private getToken(): string | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem("auth-storage");
      if (!raw) return null;
      return JSON.parse(raw)?.state?.token || null;
    } catch {
      return null;
    }
  }

  private getTenantId(): string | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem("auth-storage");
      if (!raw) return null;
      return JSON.parse(raw)?.state?.tenant_id || null;
    } catch {
      return null;
    }
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    opts?: { formData?: boolean; signal?: AbortSignal }
  ): Promise<Record<string, unknown>> {
    const url = `${API_BASE}${path}`;
    const headers: Record<string, string> = {};
    const token = this.getToken();
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

    try {
      const res = await fetch(url, fetchOpts);
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

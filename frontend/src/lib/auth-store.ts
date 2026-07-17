import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface User {
  id: number;
  username: string;
  role: string;
  specialization?: string;
  full_name?: string;
  email?: string;
}

interface AuthState {
  token: string | null;
  user: User | null;
  tenant_id: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: User, tenant_id?: string) => void;
  logout: () => void;
  setUser: (user: User) => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      tenant_id: null,
      isAuthenticated: false,
      login: (token, user, tenant_id) =>
        set({ token, user, tenant_id: tenant_id || null, isAuthenticated: true }),
      logout: () =>
        set({ token: null, user: null, tenant_id: null, isAuthenticated: false }),
      setUser: (user) => set({ user }),
    }),
    {
      name: "auth-storage",
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        tenant_id: state.tenant_id,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

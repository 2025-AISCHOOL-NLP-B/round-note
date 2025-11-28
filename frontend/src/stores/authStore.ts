import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { devtools } from 'zustand/middleware';

interface User {
    id: string;
    email: string;
    name: string;
}

interface AuthStore {
    user: User | null;
    isAuthenticated: boolean;
    setUser: (user: User | null) => void;
    logout: () => void;
    clearAuth: () => void;
}

export const useAuthStore = create<AuthStore>()(
    devtools(
        persist(
            (set) => ({
                user: null,
                isAuthenticated: false,

                setUser: (user) => set({
                    user,
                    isAuthenticated: !!user
                }, false, 'auth/setUser'),

                logout: () => set({
                    user: null,
                    isAuthenticated: false
                }, false, 'auth/logout'),

                clearAuth: () => set({
                    user: null,
                    isAuthenticated: false
                }, false, 'auth/clear'),
            }),
            {
                name: 'auth-storage', // LocalStorage key
                storage: createJSONStorage(() => localStorage),
                partialize: (state) => ({
                    user: state.user,
                    isAuthenticated: state.isAuthenticated
                }),
            }
        ),
        { name: 'AuthStore' } // DevTools name
    )
);

// Authentication context for Omni Chat application.
// Provides user authentication state and functions.

import {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    type ReactNode,
} from "react";

interface User {
    id: number;
    username: string;
    created_at: string;
}

interface AuthContextType {
    currentUser: User | null;
    isLoggedIn: boolean;
    login: (username: string) => Promise<User>;
    logout: () => void;
    isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STORAGE_KEY = "omni_current_user";

export function AuthProvider({ children }: { children: ReactNode }) {
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Load user from localStorage on mount
    useEffect(() => {
        const storedUser = localStorage.getItem(STORAGE_KEY);
        if (storedUser) {
            try {
                const user = JSON.parse(storedUser) as User;
                setCurrentUser(user);
            } catch {
                localStorage.removeItem(STORAGE_KEY);
            }
        }
        setIsLoading(false);
    }, []);

    // Login function
    const login = useCallback(async (username: string): Promise<User> => {
        setIsLoading(true);
        try {
            const response = await fetch(`${import.meta.env.VITE_API_BASE ?? ""}/api/users/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username }),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.detail || "Login failed");
            }

            const user = await response.json();
            setCurrentUser(user);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
            return user;
        } catch (error) {
            console.error("Login error:", error);
            throw error;
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Logout function
    const logout = useCallback(() => {
        setCurrentUser(null);
        localStorage.removeItem(STORAGE_KEY);
    }, []);

    const value: AuthContextType = {
        currentUser,
        isLoggedIn: currentUser !== null,
        login,
        logout,
        isLoading,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Custom hook to use auth context
export function useAuth(): AuthContextType {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}

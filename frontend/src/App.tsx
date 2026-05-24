import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { CallScreen } from "./components/CallScreen";
import { ChatPage } from "./pages/ChatPage";
import { LoginPage } from "./pages/LoginPage";
import { WordbookPage } from "./pages/WordbookPage";
import { AuthProvider, useAuth } from "./context/AuthContext";

/** Protected Route component - redirects to login if not authenticated */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f5]">
        <div className="text-[#999] text-[14px]">加载中...</div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <ChatPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/wordbook"
            element={
              <ProtectedRoute>
                <WordbookPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/call/:sessionId"
            element={
              <ProtectedRoute>
                <CallScreen />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

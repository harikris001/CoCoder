import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/Toast";
import { LandingPage } from "./pages/LandingPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ReposPage } from "./pages/ReposPage";
import { RepoPage } from "./pages/RepoPage";
import { IssuesPage } from "./pages/IssuesPage";
import { IssuePage } from "./pages/IssuePage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignInPage, SignUpPage } from "./pages/AuthPage";
import { AuthProvider } from "./auth/AuthProvider";
import { ProtectedRoute, PublicOnlyRoute } from "./components/RouteGuard";
import { ThemeProvider } from "./theme/ThemeProvider";

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <ToastProvider>
              <Routes>
                <Route
                  path="/signin"
                  element={<PublicOnlyRoute><SignInPage /></PublicOnlyRoute>}
                />
                <Route
                  path="/signup"
                  element={<PublicOnlyRoute><SignUpPage /></PublicOnlyRoute>}
                />
                <Route path="/" element={<LandingPage />} />
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute>
                      <Layout><DashboardPage /></Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/repos"
                  element={
                    <ProtectedRoute>
                      <Layout><ReposPage /></Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/repos/:id"
                  element={
                    <ProtectedRoute>
                      <Layout><RepoPage /></Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/issue"
                  element={
                    <ProtectedRoute>
                      <Layout><IssuesPage /></Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/runs/:id"
                  element={
                    <ProtectedRoute>
                      <Layout><IssuePage /></Layout>
                    </ProtectedRoute>
                  }
                />
                <Route path="/logs" element={<Navigate to="/dashboard" replace />} />
                <Route
                  path="/settings"
                  element={
                    <ProtectedRoute>
                      <Layout><SettingsPage /></Layout>
                    </ProtectedRoute>
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ToastProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

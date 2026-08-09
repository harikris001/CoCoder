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

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route
            path="/dashboard"
            element={
              <Layout>
                <DashboardPage />
              </Layout>
            }
          />
          <Route
            path="/repos"
            element={
              <Layout>
                <ReposPage />
              </Layout>
            }
          />
          <Route
            path="/repos/:id"
            element={
              <Layout>
                <RepoPage />
              </Layout>
            }
          />
          <Route
            path="/issue"
            element={
              <Layout>
                <IssuesPage />
              </Layout>
            }
          />
          <Route
            path="/runs/:id"
            element={
              <Layout>
                <IssuePage />
              </Layout>
            }
          />
          <Route path="/logs" element={<Navigate to="/dashboard" replace />} />
          <Route
            path="/settings"
            element={
              <Layout>
                <SettingsPage />
              </Layout>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  </ErrorBoundary>
  );
}
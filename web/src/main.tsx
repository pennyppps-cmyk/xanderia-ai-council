import { Fragment, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { useLang } from './i18n';
import { Spinner } from './components/ui';
import './index.css';
import Admin from './pages/Admin';
import Chat from './pages/Chat';
import Login from './pages/Login';
import PlanPage from './pages/Plan';
import SetPassword from './pages/SetPassword';
import SharedPage from './pages/Shared';
import DecisionsPage from './pages/Decisions';
import ToolsPage from './pages/Tools';
import NotisPage from './pages/Notis';
import TemplatesPage from './pages/Templates';
import GuidePage from './pages/Guide';
import TasksPage from './pages/Tasks';
import DocumentsPage from './pages/Documents';
import RoutinesPage from './pages/Routines';
import MeetingsPage from './pages/Meetings';
import TeamPage from './pages/Team';
import GoalsPage from './pages/Goals';
import { Toaster } from './toast';

function Root() {
  const { me, loading } = useAuth();
  const lang = useLang();
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-ink-400">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  // Invite / reset links work whether or not someone is signed in on this browser.
  if (window.location.pathname === '/set-password') return <SetPassword key={lang} />;
  if (!me) return <Login key={lang} />;
  return (
    <Fragment key={lang}>
      <Routes>
        <Route path="/" element={<Chat />} />
        <Route path="/c/:id" element={<Chat />} />
        <Route path="/plans/:id" element={<PlanPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/shared/:token" element={<SharedPage />} />
        <Route path="/decisions" element={<DecisionsPage />} />
        <Route path="/decisions/:id" element={<DecisionsPage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/templates/:id" element={<TemplatesPage />} />
        <Route path="/notis" element={<NotisPage />} />
        <Route path="/notis/:id" element={<NotisPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/documents/:id" element={<DocumentsPage />} />
        <Route path="/routines" element={<RoutinesPage />} />
        <Route path="/routines/:id" element={<RoutinesPage />} />
        <Route path="/meetings" element={<MeetingsPage />} />
        <Route path="/meetings/:id" element={<MeetingsPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/goals" element={<GoalsPage />} />
        <Route path="/admin/*" element={me.user.role === 'employee' ? <Navigate to="/" /> : <Admin />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      <Toaster />
    </Fragment>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Spinner } from './components/ui';
import './index.css';
import Admin from './pages/Admin';
import Chat from './pages/Chat';
import Login from './pages/Login';
import PlanPage from './pages/Plan';
import SharedPage from './pages/Shared';
import TasksPage from './pages/Tasks';
import { Toaster } from './toast';

function Root() {
  const { me, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-ink-400">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (!me) return <Login />;
  return (
    <>
      <Routes>
        <Route path="/" element={<Chat />} />
        <Route path="/c/:id" element={<Chat />} />
        <Route path="/plans/:id" element={<PlanPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/shared/:token" element={<SharedPage />} />
        <Route path="/admin/*" element={me.user.role === 'employee' ? <Navigate to="/" /> : <Admin />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      <Toaster />
    </>
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

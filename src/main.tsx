import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import './design/tokens.css';
import './app/shell.css';
import './design/themes.css';
import { ThemeProvider } from './app/theme';
import Shell from './app/Shell';
import DesignPage from './routes/DesignPage';
import Transactions from './routes/Transactions';
import Accounts from './routes/Accounts';
import Import from './routes/Import';
import TasaCero from './routes/TasaCero';
import { QuickAddProvider } from './app/QuickAdd';
import Settings from './routes/Settings';
import Tracker from './routes/Tracker';
import Debts from './routes/Debts';
import Pots from './routes/Pots';
import CheckIn from './routes/CheckIn';
import Categories from './routes/Categories';
import NetWorth from './routes/NetWorth';
import Goals from './routes/Goals';
import Calculators from './routes/Calculators';
import Dashboard from './routes/Dashboard';
import Reports from './routes/Reports';
import Bills from './routes/Bills';
import Coach from './routes/Coach';
import { CoachProvider } from './app/coach';
import { bootSync } from './sync';
import { LockGate } from './app/LockGate';

const router = createBrowserRouter([
  {
    element: <CoachProvider><QuickAddProvider><Shell /></QuickAddProvider></CoachProvider>,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/reports', element: <Reports /> },
      { path: '/bills', element: <Bills /> },
      { path: '/coach', element: <Coach /> },
      { path: '/coach/:page', element: <Coach /> },
      { path: '/design', element: <DesignPage /> },
      { path: '/transactions', element: <Transactions /> },
      { path: '/accounts', element: <Accounts /> },
      { path: '/import', element: <Import /> },
      { path: '/tasa-cero', element: <TasaCero /> },
      { path: '/settings', element: <Settings /> },
      { path: '/tracker', element: <Tracker /> },
      { path: '/debts', element: <Debts /> },
      { path: '/funds', element: <Pots /> },
      { path: '/check-in', element: <CheckIn /> },
      { path: '/categories', element: <Categories /> },
      { path: '/pots', element: <Navigate to="/funds" replace /> },
      { path: '/net-worth', element: <NetWorth /> },
      { path: '/goals', element: <Goals /> },
      { path: '/calculators', element: <Calculators /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
], { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' });

void bootSync();

// Installed web app (iPhone "Add to Home Screen", Android, desktop Chrome/Edge): work offline.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !('__TAURI_INTERNALS__' in window)) {
  window.addEventListener('load', () => void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <LockGate>
        <RouterProvider router={router} />
      </LockGate>
    </ThemeProvider>
  </StrictMode>,
);

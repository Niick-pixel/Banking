import { StrictMode, Suspense, lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import './design/tokens.css';
import './app/shell.css';
import './design/themes.css';
import { ThemeProvider } from './app/theme';
import Shell from './app/Shell';
import { QuickAddProvider } from './app/QuickAdd';
import Dashboard from './routes/Dashboard';
import { CoachProvider } from './app/coach';
import { bootSync } from './sync';
import { LockGate } from './app/LockGate';

// Pages load the first time you open them, so the app starts faster.
const DesignPage = lazy(() => import('./routes/DesignPage'));
const Transactions = lazy(() => import('./routes/Transactions'));
const Accounts = lazy(() => import('./routes/Accounts'));
const Import = lazy(() => import('./routes/Import'));
const TasaCero = lazy(() => import('./routes/TasaCero'));
const Settings = lazy(() => import('./routes/Settings'));
const Tracker = lazy(() => import('./routes/Tracker'));
const Debts = lazy(() => import('./routes/Debts'));
const Pots = lazy(() => import('./routes/Pots'));
const CheckIn = lazy(() => import('./routes/CheckIn'));
const Categories = lazy(() => import('./routes/Categories'));
const NetWorth = lazy(() => import('./routes/NetWorth'));
const Goals = lazy(() => import('./routes/Goals'));
const Wealth = lazy(() => import('./routes/Wealth'));
const Calculators = lazy(() => import('./routes/Calculators'));
const Reports = lazy(() => import('./routes/Reports'));
const Bills = lazy(() => import('./routes/Bills'));
const Coach = lazy(() => import('./routes/Coach'));
const Review = lazy(() => import('./routes/Review'));
const page = (C: LazyExoticComponent<ComponentType>) => <Suspense fallback={<div className="page-loading" aria-busy="true" />}><C /></Suspense>;

const router = createBrowserRouter([
  {
    element: <CoachProvider><QuickAddProvider><Shell /></QuickAddProvider></CoachProvider>,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/reports', element: page(Reports) },
      { path: '/review', element: page(Review) },
      { path: '/bills', element: page(Bills) },
      { path: '/coach', element: page(Coach) },
      { path: '/coach/:page', element: page(Coach) },
      { path: '/design', element: page(DesignPage) },
      { path: '/transactions', element: page(Transactions) },
      { path: '/accounts', element: page(Accounts) },
      { path: '/import', element: page(Import) },
      { path: '/tasa-cero', element: page(TasaCero) },
      { path: '/settings', element: page(Settings) },
      { path: '/tracker', element: page(Tracker) },
      { path: '/debts', element: page(Debts) },
      { path: '/funds', element: page(Pots) },
      { path: '/check-in', element: page(CheckIn) },
      { path: '/categories', element: page(Categories) },
      { path: '/pots', element: <Navigate to="/funds" replace /> },
      { path: '/net-worth', element: page(Wealth) },
      { path: '/net-worth/months', element: page(NetWorth) },
      { path: '/goals', element: page(Goals) },
      { path: '/calculators', element: page(Calculators) },
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

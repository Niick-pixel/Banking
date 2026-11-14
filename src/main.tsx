import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import './design/tokens.css';
import './app/shell.css';
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
import { bootSync } from './sync';

const router = createBrowserRouter([
  {
    element: <QuickAddProvider><Shell /></QuickAddProvider>,
    children: [
      { path: '/design', element: <DesignPage /> },
      { path: '/transactions', element: <Transactions /> },
      { path: '/accounts', element: <Accounts /> },
      { path: '/import', element: <Import /> },
      { path: '/tasa-cero', element: <TasaCero /> },
      { path: '/settings', element: <Settings /> },
      { path: '/tracker', element: <Tracker /> },
      { path: '/debts', element: <Debts /> },
      { path: '/pots', element: <Pots /> },
      { path: '*', element: <Navigate to="/transactions" replace /> },
    ],
  },
]);

void bootSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>,
);

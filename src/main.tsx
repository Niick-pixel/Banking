import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import './design/tokens.css';
import './app/shell.css';
import { ThemeProvider } from './app/theme';
import Shell from './app/Shell';
import DesignPage from './routes/DesignPage';

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/design', element: <DesignPage /> },
      { path: '*', element: <Navigate to="/design" replace /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>,
);

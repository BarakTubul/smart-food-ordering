import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { CartProvider } from '@/context/CartContext';
import { Header } from '@/components/Header';
import { FloatingChatWidget } from '@/components/FloatingChatWidget';
import { IndexPage } from '@/pages/IndexPage';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { GuestAccessPage } from '@/pages/GuestPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { OrdersPage } from '@/pages/OrdersPage';
import { OrderDetailPage } from '@/pages/OrderDetailPage';
import { OrderTimelinePage } from '@/pages/OrderTimelinePage';
import { OrderPlacementPage } from '@/pages/OrderPlacementPage';
import { RefundsTabPage } from '@/pages/RefundsTabPage';
import { AdminRefundReviewPage } from '@/pages/AdminRefundReviewPage';
import { AdminSupportInboxPage } from '@/pages/AdminSupportInboxPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }
  if (!user?.is_admin) {
    return <Navigate to="/dashboard" />;
  }
  return <>{children}</>;
}

function HomeRoute() {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <IndexPage />;
  }

  if (user?.is_admin) {
    return <Navigate to="/manager/refunds" replace />;
  }

  return <Navigate to="/order" replace />;
}

function AppRoutes() {
  const { isAuthenticated } = useAuth();

  return (
    <>
      {isAuthenticated && <Header />}
      {isAuthenticated && <FloatingChatWidget />}
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/guest" element={<GuestAccessPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/orders"
          element={
            <ProtectedRoute>
              <OrdersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/orders/:orderId"
          element={
            <ProtectedRoute>
              <OrderDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/orders/:orderId/timeline"
          element={
            <ProtectedRoute>
              <OrderTimelinePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/order"
          element={
            <ProtectedRoute>
              <OrderPlacementPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/refunds"
          element={
            <ProtectedRoute>
              <RefundsTabPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/refund"
          element={<Navigate to="/refunds" replace />}
        />
        <Route
          path="/support"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/manager/refunds"
          element={
            <AdminRoute>
              <AdminRefundReviewPage />
            </AdminRoute>
          }
        />
        <Route
          path="/manager/support"
          element={
            <AdminRoute>
              <AdminSupportInboxPage />
            </AdminRoute>
          }
        />
        <Route path="/admin/refunds" element={<Navigate to="/manager/refunds" replace />} />
        <Route path="/admin/support" element={<Navigate to="/manager/support" replace />} />
      </Routes>
    </>
  );
}

export function App() {
  return (
    <Router>
      <AuthProvider>
        <CartProvider>
          <AppRoutes />
        </CartProvider>
      </AuthProvider>
    </Router>
  );
}

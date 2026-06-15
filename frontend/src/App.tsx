import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { api } from './lib/api';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import PrivacyPolicy from './pages/PrivacyPolicy';
import Customers from './pages/Customers';
import Suppliers from './pages/Suppliers';
import Products from './pages/Products';
import Invoices from './pages/Invoices';
import Quotations from './pages/Quotations';
import PurchaseOrders from './pages/PurchaseOrders';
import ServiceOrders from './pages/ServiceOrders';
import Bookkeeping from './pages/Bookkeeping';
import FixedAssets from './pages/FixedAssets';
import ImportData from './pages/ImportData';
import CalendarPage from './pages/CalendarPage';
import ServicesPage from './pages/Services';
import Messages from './pages/Messages';
import Documents from './pages/Documents';
import Todos from './pages/Todos';
import MailInbox from './pages/MailInbox';
import BankStatements from './pages/BankStatements';
import ExpenseReceipts from './pages/ExpenseReceipts';
import Modules from './pages/Modules';
import Integrations from './pages/Integrations';
import PaymentPage from './pages/PaymentPage';
import CommunicationPage from './pages/CommunicationPage';
import WebsiteGenerator from './pages/WebsiteGenerator';
import CardGenerator from './pages/CardGenerator';
import Settings from './pages/Settings';
import FileStorage from './pages/FileStorage';
import FirmManagement from './pages/FirmManagement';
import Compliance from './pages/Compliance';
import AiMemory from './pages/AiMemory';
import PricingPage from './pages/PricingPage';
import SubscriptionPage from './pages/SubscriptionPage';

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" />;
  return <Layout>{children}</Layout>;
}

const FEATURE_ROUTES: Record<string, string> = {
  '/customers': 'customers',
  '/suppliers': 'suppliers',
  '/products': 'products',
  '/services': 'services',
  '/invoices': 'invoices',
  '/quotations': 'quotations',
  '/bookkeeping': 'bookkeeping',
  '/bank-statements': 'bankStatements',
  '/expense-receipts': 'expenseReceipts',
  '/calendar': 'calendar',
  '/messages': 'messages',
  '/documents': 'documents',
  '/file-storage': 'fileStorage',
  '/purchase-orders': 'purchaseOrders',
  '/service-orders': 'serviceOrders',
  '/compliance': 'compliance',
  '/fixed-assets': 'fixedAssets',
};

function FeatureGuard({ children }: { children: React.ReactNode }) {
  const location = window.location.pathname;
  const featKey = FEATURE_ROUTES[location];
  if (!featKey) return <>{children}</>;

  // Subscribe to React Query — refetches when Modules page invalidates ['company']
  const { data: company } = useQuery({
    queryKey: ['company'],
    queryFn: () => api('/company'),
  });

  try {
    const features = company?.features ? (typeof company.features === 'string' ? JSON.parse(company.features) : company.features) : {};
    if (features[featKey] === false) return <Navigate to="/" />;
  } catch {}
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/compliance" element={<ProtectedRoute><FeatureGuard><Compliance /></FeatureGuard></ProtectedRoute>} />
      <Route path="/ai-memory" element={<ProtectedRoute><AiMemory /></ProtectedRoute>} />
      <Route path="/pricing" element={<ProtectedRoute><PricingPage /></ProtectedRoute>} />
      <Route path="/subscription" element={<ProtectedRoute><SubscriptionPage /></ProtectedRoute>} />
      <Route path="/customers" element={<ProtectedRoute><FeatureGuard><Customers /></FeatureGuard></ProtectedRoute>} />
      <Route path="/suppliers" element={<ProtectedRoute><FeatureGuard><Suppliers /></FeatureGuard></ProtectedRoute>} />
      <Route path="/products" element={<ProtectedRoute><FeatureGuard><Products /></FeatureGuard></ProtectedRoute>} />
      <Route path="/invoices" element={<ProtectedRoute><FeatureGuard><Invoices /></FeatureGuard></ProtectedRoute>} />
      <Route path="/quotations" element={<ProtectedRoute><FeatureGuard><Quotations /></FeatureGuard></ProtectedRoute>} />
      <Route path="/purchase-orders" element={<ProtectedRoute><FeatureGuard><PurchaseOrders /></FeatureGuard></ProtectedRoute>} />
      <Route path="/service-orders" element={<ProtectedRoute><FeatureGuard><ServiceOrders /></FeatureGuard></ProtectedRoute>} />
      <Route path="/bookkeeping" element={<ProtectedRoute><FeatureGuard><Bookkeeping /></FeatureGuard></ProtectedRoute>} />
              <Route path="/fixed-assets" element={<ProtectedRoute><FeatureGuard><FixedAssets /></FeatureGuard></ProtectedRoute>} />
      <Route path="/bank-statements" element={<ProtectedRoute><FeatureGuard><BankStatements /></FeatureGuard></ProtectedRoute>} />
      <Route path="/todos" element={<ProtectedRoute><Todos /></ProtectedRoute>} />
      <Route path="/expense-receipts" element={<ProtectedRoute><FeatureGuard><ExpenseReceipts /></FeatureGuard></ProtectedRoute>} />
      <Route path="/import" element={<ProtectedRoute><ImportData /></ProtectedRoute>} />
      <Route path="/calendar" element={<ProtectedRoute><FeatureGuard><CalendarPage /></FeatureGuard></ProtectedRoute>} />
      <Route path="/services" element={<ProtectedRoute><FeatureGuard><ServicesPage /></FeatureGuard></ProtectedRoute>} />
      <Route path="/mail" element={<ProtectedRoute><MailInbox /></ProtectedRoute>} />
      <Route path="/messages" element={<ProtectedRoute><FeatureGuard><Messages /></FeatureGuard></ProtectedRoute>} />
      <Route path="/documents" element={<ProtectedRoute><FeatureGuard><Documents /></FeatureGuard></ProtectedRoute>} />
      <Route path="/file-storage" element={<ProtectedRoute><FeatureGuard><FileStorage /></FeatureGuard></ProtectedRoute>} />
      <Route path="/modules" element={<ProtectedRoute><Modules /></ProtectedRoute>} />
      <Route path="/payment" element={<ProtectedRoute><PaymentPage /></ProtectedRoute>} />
      <Route path="/communication" element={<ProtectedRoute><CommunicationPage /></ProtectedRoute>} />
      <Route path="/integrations" element={<ProtectedRoute><Integrations /></ProtectedRoute>} />
      <Route path="/website-generator" element={<ProtectedRoute><WebsiteGenerator /></ProtectedRoute>} />
      <Route path="/card-generator" element={<ProtectedRoute><CardGenerator /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/firm/manage" element={<ProtectedRoute><FirmManagement /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

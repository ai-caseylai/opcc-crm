import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { prettyJSON } from 'hono/pretty-json';
import { Bindings, Variables } from './types';
import { authRoutes } from './routes/auth';
import { customerRoutes } from './routes/customers';
import { supplierRoutes } from './routes/suppliers';
import { productRoutes } from './routes/products';
import { invoiceRoutes } from './routes/invoices';
import { quotationRoutes } from './routes/quotations';
import { bookkeepingRoutes } from './routes/bookkeeping';
import { importRoutes } from './routes/import';
import { auditRoutes } from './routes/audit';
import { workbuddyRoutes } from './routes/workbuddy';
import { pdfRoutes } from './routes/pdf';
import { companyRoutes } from './routes/company';
import { messagingRoutes } from './routes/messaging';
import { calendarRoutes } from './routes/calendar';
import { workbuddyV1Routes, workbuddyMgmtRoutes } from './routes/workbuddy-v1';
import { documentRoutes } from './routes/documents';
import { adminRoutes } from './routes/admin';
import { bankStatementRoutes } from './routes/bank-statements';
import { todoRoutes } from './routes/todos';
import { wsRoutes } from './routes/ws';
import { mailRoutes } from './routes/mail';
import { paymentRoutes } from './routes/payment';
import { websiteRoutes } from './routes/website';
import { expenseReceiptRoutes } from './routes/expense-receipts';
import { chatRoutes } from './routes/chat';
import { serviceRoutes } from './routes/services';
import { fileStorageRoutes } from './routes/file-storage';
import { purchaseOrderRoutes } from './routes/purchase-orders';
import { serviceOrderRoutes } from './routes/service-orders';
<<<<<<< HEAD
import { firmRoutes } from './routes/firms';
import { firmContextMiddleware } from './middleware/auth';
=======
import { complianceRoutes } from './routes/compliance';
import { plansRoutes } from './routes/plans';
import { emailDashRoutes } from './routes/email-dash';
import { waitlistRoutes } from './routes/waitlist';
>>>>>>> 837a43aed898df18aa69f778036747b0e0231d16

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Middleware
app.use('*', cors({
  origin: ['http://localhost:5173', 'https://opcc-crm.techforliving.net', 'https://oppc-crm.techforliving.net', 'https://secondact.hk', 'https://www.secondact.hk', 'https://secondact.techforliving.net', 'https://secondact-landing.pages.dev'],
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Active-Client'],
}));
app.use('*', prettyJSON());

// Firm context middleware — sets client_user_id for firm staff acting on behalf of clients
app.use('/api/*', firmContextMiddleware);

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Routes
app.route('/api/auth', authRoutes);
app.route('/api/customers', customerRoutes);
app.route('/api/suppliers', supplierRoutes);
app.route('/api/products', productRoutes);
app.route('/api/invoices', invoiceRoutes);
app.route('/api/quotations', quotationRoutes);
app.route('/api/bookkeeping', bookkeepingRoutes);
app.route('/api/import', importRoutes);
app.route('/api/audit', auditRoutes);
app.route('/api/workbuddy', workbuddyRoutes);
app.route('/api/pdf', pdfRoutes);
app.route('/api/company', companyRoutes);
app.route('/api/messaging', messagingRoutes);
app.route('/api/bank-statements', bankStatementRoutes);
app.route('/api/expense-receipts', expenseReceiptRoutes);
app.route('/api/todos', todoRoutes);
app.route('/api/ws', wsRoutes);
app.route('/api/mail', mailRoutes);
app.route('/api/payment', paymentRoutes);
app.route('/api/company/website', websiteRoutes);
app.route('/api/chat', chatRoutes);
app.route('/api/calendar', calendarRoutes);
app.route('/api/services', serviceRoutes);
app.route('/api/wb/v1', workbuddyV1Routes);
app.route('/api/admin', adminRoutes);
app.route('/api/documents', documentRoutes);
app.route('/api/wb', workbuddyMgmtRoutes);
app.route('/api/file-storage', fileStorageRoutes);
app.route('/api/purchase-orders', purchaseOrderRoutes);
app.route('/api/service-orders', serviceOrderRoutes);
<<<<<<< HEAD
app.route('/api/firms', firmRoutes);
=======
app.route('/api/compliance', complianceRoutes);
app.route('/api/plans', plansRoutes);
app.route('/api/email-dash', emailDashRoutes);
app.route('/api/waitlist', waitlistRoutes);
>>>>>>> 837a43aed898df18aa69f778036747b0e0231d16

// 404
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Error handler
app.onError((err, c) => {
  console.error('Error:', err);
  return c.json({ error: err.message || 'Internal server error' }, 500);
});

export default app;

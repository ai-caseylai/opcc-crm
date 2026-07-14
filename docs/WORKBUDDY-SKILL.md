# OPCC CRM — WorkBuddy Skill

## Overview
OPCC CRM is a multi-tenant CRM deployed on Cloudflare (Workers + D1 + KV + Workers AI).
Features: customers, suppliers, products, services, invoices, quotations, bookkeeping, calendar,
messaging, todos, bank statements, expense receipts, BR/CI documents, AI chatbot, mail,
payment, website generator, data import, audit logs, admin onboarding.

- **Base URL**: `https://opcc-crm.techforliving.net`
- **Manifest**: `GET /api/workbuddy/manifest` (44 skills)
- **API v1 (API Key)**: `/api/wb/v1` — Header: `X-API-Key: wb_xxx`
- **API v2 (Bearer Token)**: `/api/workbuddy` — Header: `Authorization: Bearer <token>`

## Authentication

### Method 1: X-API-Key (Recommended)
```
Header: X-API-Key: wb_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
Generate: Settings → WorkBuddy API Key → Generate. All `/api/wb/v1/*` endpoints.

### Method 2: Bearer Token (JWT)
```
Header: Authorization: Bearer eyJhbG...
```
Get via `POST /api/auth/login`. Used by `/api/*` and `/api/workbuddy/*`.

---

## API Reference

### Customers & Suppliers
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/wb/v1/customers` | GET | List/search `?q=` |
| `/api/wb/v1/customers` | POST | Create `{name, email, phone, address, company_name}` |
| `/api/wb/v1/suppliers` | GET | List suppliers `?q=` |

### Products & Services
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/wb/v1/products` | GET/POST | List/create products |
| `/api/services` | GET/POST | List/create services `{name, price, description, category, duration_minutes, currency}` |
| `/api/services/bookings` | GET | List bookings `?date=` |
| `/api/services/bookings` | POST | Create booking `{service_id, customer_id, booking_date, start_time}` |
| `/api/services/bookings/:id` | PATCH | Update booking status |

### Invoices & Quotations
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/invoices` | GET | List `?status=draft/sent/paid/overdue&q=` |
| `/api/wb/v1/invoices` | POST | Create with line items |
| `/api/invoices/:id` | GET | Detail with items |
| `/api/invoices/:id/status` | PATCH | Update status |
| `/api/quotations` | GET/POST | List/create quotations |
| `/api/quotations/:id` | GET | Detail with items |
| `/api/quotations/:id/convert` | POST | Convert to invoice |

### Todo List
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/todos` | GET | List `?status=pending/completed` |
| `/api/todos` | POST | Create `{title, description?, priority?, due_date?, customer_id?}` |
| `/api/todos/:id` | PATCH | Update (status, title, description, priority, due_date, sort_order) |
| `/api/todos/:id` | DELETE | Delete |

### Documents (BR/CI with OCR)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/documents` | GET | List `?type=br/ci` |
| `/api/documents/:id` | GET | Get document detail |
| `/api/documents/upload` | POST | Upload `{doc_type, doc_year, file_name, file_type, file_data(base64)}` — OCR via Workers AI |
| `/api/documents/:id` | PATCH | Update metadata |
| `/api/documents/:id` | DELETE | Delete |
| `/api/documents/:id/file` | GET | Download file |

### Bank Statements (with OCR)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/bank-statements` | GET | List `?year=` |
| `/api/bank-statements/upload` | POST | Upload `{file_data(base64), bank_name, account_number, statement_year, statement_month}` |
| `/api/bank-statements/:id/file` | GET | Download file |
| `/api/bank-statements/:id` | DELETE | Delete |

### Expense Receipts (with OCR)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/expense-receipts` | GET | List `?year=&category=` |
| `/api/expense-receipts/upload` | POST | Upload `{file_data(base64), vendor_name, amount, expense_date, category, payment_method}` |
| `/api/expense-receipts/:id/file` | GET | Download file |
| `/api/expense-receipts/:id` | DELETE | Delete |

### Bookkeeping
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/bookkeeping/entries` | GET/POST | Journal entries |
| `/api/bookkeeping/accounts` | GET | Chart of accounts |
| `/api/bookkeeping/trial-balance` | GET | `?as_of=` |
| `/api/bookkeeping/income-statement` | GET | `?start_date=&end_date=` |
| `/api/bookkeeping/export` | GET | CSV export `?format=csv` |

### Calendar & Messages
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/calendar/events` | GET/POST | Events `?start=&end=` / Create `{title, start_time, customer_id?}` |
| `/api/messaging/conversations` | GET | List `?channel=whatsapp/telegram` |
| `/api/messaging/send` | POST | Send `{conversation_id, content}` |

### AI Chat
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat` | POST | `{message, history}` — Llama 3.1 8B + D1 tools (get_counts, list_invoices, list_quotations, list_customers, list_todos, get_summary) |

### Company & Modules
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/company` | GET | Company profile (DB + c.json defaults) |
| `/api/company` | PUT | Update profile `{name, bank_name, features}` |
| `/api/company/by-domain` | GET | Resolve tenant by domain `?host=` |
| `/api/company/logo` | POST | Upload logo (base64 PNG) |

### Mail Inbox
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mail/config` | GET/PUT/DELETE | Mail configuration (base_url, jwt, site_password) |
| `/api/mail/inbox` | GET | List inbox `?limit=&offset=` |
| `/api/mail/inbox/:id` | GET | Get single email |
| `/api/mail/send` | POST | Send email |
| `/api/mail/settings` | GET | Fetch mail address/settings |

### Payment
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/payment/config` | GET/PUT | Payment config (methods, QR codes, Stripe) |
| `/api/payment/pay/:invoiceId` | GET | Public: invoice + payment methods + QR codes |
| `/api/payment/pay/:invoiceId/page` | GET | Public: full HTML payment page |
| `/api/payment/stripe-webhook` | POST | Public: Stripe webhook → auto-mark invoice paid |

### Website Generator
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/company/website` | POST | Generate company website via AI (Llama 3.1 8B) |
| `/api/company/website/preview` | POST | Preview HTML `{html}` |

### Data Import
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/import/customers` | POST | `{data: [{name,...}]}` |
| `/api/import/suppliers` | POST | `{data: [{name,...}]}` |
| `/api/import/products` | POST | `{data: [{name,unit_price,...}]}` |
| `/api/import/invoices` | POST | `{data: [{invoice_number,...}]}` — auto-matches customer names |
| `/api/import/quotations` | POST | `{data: [{quotation_number,...}]}` |
| `/api/import/parse-csv` | POST | `{csv, type}` → parsed JSON |

### PDF
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pdf/invoice/:id` | GET | Invoice PDF (public) |
| `/api/pdf/quotation/:id` | GET | Quotation PDF (public) |

### Admin (JWT + admin role)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/users` | GET | List tenants with stats |
| `/api/admin/onboard` | POST | One-click tenant creation `{domain, company_name, email, password, name?}` |
| `/api/admin/domains` | GET/POST | Domain management |
| `/api/admin/domains/:id` | DELETE | Delete domain |
| `/api/admin/tenants/:id/summary` | GET | Data counts per tenant |
| `/api/admin/tenants/:id/export` | GET | Full data export `?format=json/csv&table=` |
| `/api/audit` | GET | Audit logs |

### WebSocket
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ws` | GET | WebSocket upgrade (JWT via `?token=` query param) |
| `/api/ws/push` | POST | Push message to connected clients `{user_id, type, data}` |
| `/api/ws/status` | GET | Check active connections |

---

## Quick Reference

```
Login:       POST /api/auth/login  {email, password}
Customers:   GET  /api/wb/v1/customers?q=  (X-API-Key)
Invoice:     POST /api/wb/v1/invoices  {invoice_number, customer_id, items}
Quotation:   POST /api/wb/v1/quotations  {quotation_number, customer_id, items}
Todo:        POST /api/todos  {title, priority}
Chat:        POST /api/chat  {message}
PDF:         GET  /api/pdf/invoice/:id  (public)
Health:      GET  /api/wb/v1/health
Onboard:     POST /api/admin/onboard  {domain, company_name, email, password}
Payment:     GET  /api/payment/pay/:invoiceId/page  (public)
Mail:        GET  /api/mail/inbox
Bank OCR:    POST /api/bank-statements/upload  {file_data, bank_name, ...}
Website:     POST /api/company/website
```

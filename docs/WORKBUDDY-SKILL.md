# OPCC CRM — WorkBuddy Skill

## Overview
OPCC CRM is a multi-tenant CRM deployed on Cloudflare (Pages + Worker + D1 + Workers AI). 
Features: customers, suppliers, products, services, invoices, quotations, bookkeeping, calendar, 
messaging, todos, bank statements, expense receipts, BR/CI documents, AI chatbot.

- **Base URL**: `https://opcc-crm.techforliving.net`
- **Manifest**: `GET /api/workbuddy/manifest` (44 skills)
- **API v1 (API Key)**: `/api/wb/v1`
- **API v2 (Bearer Token)**: `/api/workbuddy`

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

## Core Workflows

### 1. Customer → Invoice → PDF
```bash
GET  /api/wb/v1/customers?q=ACME
POST /api/wb/v1/customers {"name":"ACME Corp","email":"acme@example.com"}
POST /api/wb/v1/invoices {"invoice_number":"INV-001","customer_id":"c-xxx","items":[{"description":"Consulting","quantity":1,"unit_price":5000,"amount":5000}],"due_date":"2026-06-07"}
GET  /api/pdf/invoice/i-xxx  # Public PDF download
```

### 2. Quotation → Convert to Invoice
```bash
POST /api/wb/v1/quotations {"quotation_number":"QUO-001","customer_id":"c-xxx","items":[...],"valid_until":"2026-12-31"}
POST /api/quotations/q-xxx/convert  # → returns new invoice_id
```

### 3. AI Chatbot (Function Calling)
```bash
POST /api/chat {"message":"我有幾多張發票？"}
→ "您目前有 2 張發票。"
```
Llama 3.1 8B with D1 tool calling: `get_counts`, `list_invoices`, `list_quotations`, `list_customers`, `list_todos`, `get_summary`.

### 4. One-Click Tenant Onboarding
```bash
POST /api/admin/onboard {"domain":"008.techforliving.net","company_name":"ACME Corp","email":"admin@008.techforliving.net","password":"demo123"}
→ Creates user + company_settings + domain mapping + DNS CNAME + Pages domain (5 steps auto)
```

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
| `/api/services` | GET/POST | List/create services |
| `/api/services/bookings` | GET/POST | List/create bookings |

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
| `/api/todos` | POST | Create `{title, priority, due_date}` |
| `/api/todos/:id` | PATCH | Update (complete/edit) |
| `/api/todos/:id` | DELETE | Delete |

### Documents (BR/CI with OCR)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/documents` | GET | List `?type=br` |
| `/api/documents/upload` | POST | Upload `{doc_type, doc_year, file_data}` |
| `/api/documents/:id/file` | GET | Download file |

### Bank Statements (with OCR)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/bank-statements` | GET | List `?year=` |
| `/api/bank-statements/upload` | POST | Upload `{file_data, bank_name, account_number, statement_year, statement_month}` |
| `/api/bank-statements/:id/file` | GET | Download file |

### Expense Receipts (with OCR)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/expense-receipts` | GET | List `?year=&category=` |
| `/api/expense-receipts/upload` | POST | Upload `{file_data, vendor_name, amount, expense_date, category}` |
| `/api/expense-receipts/:id/file` | GET | Download file |

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
| `/api/calendar/events` | GET/POST | Events `?start=&end=` |
| `/api/messaging/conversations` | GET | List `?channel=` |
| `/api/messaging/send` | POST | Send message |

### Company & Modules
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/company` | GET | Company profile (DB + c.json defaults) |
| `/api/company` | PUT | Update profile `{name, bank_name, features}` |
| `/api/company/by-domain` | GET | Resolve tenant by domain `?host=` |
| `/api/company/logo` | POST | Upload logo (base64 PNG) |

### Admin (JWT only)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/users` | GET | List tenants with stats |
| `/api/admin/onboard` | POST | One-click tenant creation |
| `/api/admin/domains` | GET/POST/DELETE | Domain management |
| `/api/admin/tenants/:id/summary` | GET | Data counts per tenant |
| `/api/admin/tenants/:id/export` | GET | Full data export `?format=json/csv&table=` |

### AI Chat
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat` | POST | `{message, history}` — Llama 3.1 + D1 tools |

### PDF
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pdf/invoice/:id` | GET | Invoice PDF (public) |
| `/api/pdf/quotation/:id` | GET | Quotation PDF (public) |

### Data Import
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/import/customers` | POST | `{data: [{name,...}]}` |
| `/api/import/suppliers` | POST | `{data: [{name,...}]}` |
| `/api/import/products` | POST | `{data: [{name,unit_price,...}]}` |
| `/api/import/invoices` | POST | `{data: [{invoice_number,...}]}` |
| `/api/import/quotations` | POST | `{data: [{quotation_number,...}]}` |
| `/api/import/parse-csv` | POST | `{csv, type}` → parsed JSON |

---

## Quick Reference

```
Login:     POST /api/auth/login  {email, password}
Customers: GET  /api/wb/v1/customers?q=  (X-API-Key)
Invoice:   POST /api/wb/v1/invoices  {invoice_number, customer_id, items}
Quotation: POST /api/wb/v1/quotations  {quotation_number, customer_id, items}
Todo:      POST /api/todos  {title, priority}
Chat:      POST /api/chat  {message}
PDF:       GET  /api/pdf/invoice/:id  (public)
Health:    GET  /api/wb/v1/health
Onboard:   POST /api/admin/onboard  {domain, company_name, email, password}
```

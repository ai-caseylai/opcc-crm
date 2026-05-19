-- Seed data for oppc-crm
-- Default admin user (password: admin123 — CHANGE IN PRODUCTION)

INSERT OR IGNORE INTO users (id, email, password_hash, name, company_name, role)
VALUES (
  'u-admin-001',
  'admin@opcc-crm.techforliving.net',
  '$2a$10$XQxBj0gYK5VGhHzVzqJ8OO1F6G7FLhLM3QKGqPONCqLNH0dJqFOce',
  'Admin',
  'OPPC',
  'admin'
);

-- Default Chart of Accounts
INSERT OR IGNORE INTO accounts (id, user_id, account_code, account_name, account_type, parent_code) VALUES
('acc-001', 'u-admin-001', '1000', 'Assets', 'asset', NULL),
('acc-002', 'u-admin-001', '1100', 'Current Assets', 'asset', '1000'),
('acc-003', 'u-admin-001', '1101', 'Cash', 'asset', '1100'),
('acc-004', 'u-admin-001', '1102', 'Accounts Receivable', 'asset', '1100'),
('acc-005', 'u-admin-001', '1103', 'Inventory', 'asset', '1100'),
('acc-006', 'u-admin-001', '1200', 'Fixed Assets', 'asset', '1000'),
('acc-007', 'u-admin-001', '2000', 'Liabilities', 'liability', NULL),
('acc-008', 'u-admin-001', '2100', 'Current Liabilities', 'liability', '2000'),
('acc-009', 'u-admin-001', '2101', 'Accounts Payable', 'liability', '2100'),
('acc-009b', 'u-admin-001', '2102', 'Director Loan', 'liability', '2100'),
('acc-010', 'u-admin-001', '3000', 'Equity', 'equity', NULL),
('acc-011', 'u-admin-001', '3100', 'Retained Earnings', 'equity', '3000'),
('acc-012', 'u-admin-001', '4000', 'Revenue', 'revenue', NULL),
('acc-013', 'u-admin-001', '4100', 'Sales Revenue', 'revenue', '4000'),
('acc-014', 'u-admin-001', '4200', 'Service Revenue', 'revenue', '4000'),
('acc-015', 'u-admin-001', '5000', 'Expenses', 'expense', NULL),
('acc-016', 'u-admin-001', '5100', 'Cost of Goods Sold', 'expense', '5000'),
('acc-017', 'u-admin-001', '5200', 'Operating Expenses', 'expense', '5000'),
('acc-018', 'u-admin-001', '5201', 'Rent', 'expense', '5200'),
('acc-019', 'u-admin-001', '5202', 'Utilities', 'expense', '5200'),
('acc-020', 'u-admin-001', '5203', 'Salaries', 'expense', '5200');

-- Compliance templates — General (all OPCs)
INSERT OR IGNORE INTO compliance_templates (id, category, industry, title_zh, title_en, description_zh, is_required, has_deadline, deadline_field, action_url, action_label_zh, sort_order) VALUES
('tpl-br', 'company', 'general', '商業登記證', 'Business Registration Certificate', '所有在香港經營業務的人士都必須持有有效的商業登記證。開業後1個月內申請，每年續期一次。', 1, 1, 'br_expiry', 'https://www.ird.gov.hk/chi/tax/bre.htm', '前往 IRD 網站', 1),
('tpl-ci', 'company', 'general', '公司註冊證書', 'Certificate of Incorporation', '有限公司必須持有公司註冊處發出的公司註冊證書 (CI)。', 1, 0, NULL, 'https://www.cr.gov.hk/', '前往公司註冊處', 2),
('tpl-annual-return', 'company', 'general', '周年申報表 (NAR1)', 'Annual Return', '有限公司須每年於成立周年日後42日內向公司註冊處提交周年申報表。', 1, 1, 'annual_return', 'https://www.cr.gov.hk/', '前往公司註冊處', 3),
('tpl-scr', 'company', 'general', '重要控制人登記冊 (SCR)', 'Significant Controllers Register', '所有在香港註冊的公司必須備存重要控制人登記冊，並在公司註冊辦事處供查閱。', 1, 0, NULL, 'https://www.cr.gov.hk/chi/scr/', '前往 SCR 網站', 4),
('tpl-profits-tax', 'tax', 'general', '利得稅報稅表 (BIR51)', 'Profits Tax Return', '所有公司須按時提交利得稅報稅表。通常IRD於年結日後1-3個月內發出，須於發出後1-3個月內交回。', 1, 1, 'tax_filing_deadline', 'https://www.ird.gov.hk/chi/tax/bus_pft.htm', '下載報稅表', 10),
('tpl-br-renewal', 'tax', 'general', '商業登記續期', 'BR Renewal', '商業登記證須每年續期。IRD會在到期前寄出繳款通知書。', 1, 1, 'br_expiry', 'https://www.ird.gov.hk/chi/tax/bre.htm', '網上續期', 11),
('tpl-audit', 'tax', 'general', '審計報告', 'Audit Report', '有限公司每年必須由執業會計師進行審計，並連同報稅表提交審計報告。', 1, 0, NULL, NULL, '轉介會計師', 12),
('tpl-secretary', 'company', 'general', '公司秘書', 'Company Secretary', '有限公司必須持續委任一名公司秘書。如秘書離任，須於14日內填補空缺。', 1, 0, NULL, NULL, '轉介秘書公司', 5),
('tpl-mpf', 'employment', 'general', '強積金登記 (MPF)', 'MPF Registration', '如有僱員，必須為僱員登記MPF並按時供款。OPC東主本人無需為自己供MPF。', 0, 0, NULL, 'https://www.mpfa.org.hk/', 'MPFA 網站', 20),
('tpl-labour-insurance', 'employment', 'general', '勞工保險', 'Employees Compensation Insurance', '如有僱員（包括兼職），必須購買勞工保險。', 0, 0, NULL, NULL, '聯絡保險公司', 21),
('tpl-privacy-policy', 'privacy', 'general', '私隱政策聲明', 'Privacy Policy', '如收集、持有或處理客戶個人資料，應備有私隱政策聲明以符合《個人資料（私隱）條例》(PDPO)。', 0, 0, NULL, NULL, '使用第二幕範本', 30),
('tpl-data-retention', 'privacy', 'general', '客戶資料保存政策', 'Data Retention Policy', '應制定清晰的客戶資料保存期限及刪除政策。', 0, 0, NULL, NULL, '使用 AI 生成', 31),
('tpl-service-contract', 'industry', 'general', '服務合約範本', 'Service Contract Template', '提供服務前應有清晰的書面合約，列明服務範圍、收費、責任限制等條款。', 0, 0, NULL, NULL, '使用第二幕合約模板', 40),
('tpl-trademark', 'privacy', 'general', '商標註冊', 'Trademark Registration', '保護你的品牌名稱和Logo。可在香港知識產權署註冊。', 0, 0, NULL, 'https://www.ipd.gov.hk/chi/trademarks.htm', '前往知識產權署', 32);

-- Compliance templates — IT / Design / Consulting
INSERT OR IGNORE INTO compliance_templates (id, category, industry, title_zh, title_en, description_zh, is_required, has_deadline, sort_order) VALUES
('tpl-it-tos', 'industry', 'it', '網站使用條款', 'Terms of Service', '如提供網站或應用程式服務，建議備有使用條款。', 0, 0, 41),
('tpl-it-ip', 'industry', 'it', '知識產權條款', 'IP Clause', '服務合約中應明確規定程式碼/設計的知識產權歸屬。', 1, 0, 42);

-- Compliance templates — F&B
INSERT OR IGNORE INTO compliance_templates (id, category, industry, title_zh, title_en, description_zh, is_required, has_deadline, sort_order) VALUES
('tpl-fb-licence', 'industry', 'f_b', '食物業牌照', 'Food Business Licence', '經營食物業必須向食環署申領相關牌照。', 1, 1, 41),
('tpl-fb-fire', 'industry', 'f_b', '消防裝置證書', 'Fire Safety Certificate', '餐飲場所須符合消防條例，定期檢查。', 1, 1, 42),
('tpl-fb-hygiene', 'industry', 'f_b', '衛生經理/衛生督導員', 'Hygiene Manager', '食肆須委任衛生經理及衛生督導員。', 1, 0, 43);

-- Compliance templates — Trading
INSERT OR IGNORE INTO compliance_templates (id, category, industry, title_zh, title_en, description_zh, is_required, has_deadline, sort_order) VALUES
('tpl-trade-customs', 'industry', 'trading', '進出口報關', 'Import/Export Declaration', '所有進出口貨物須向海關提交報關單。', 1, 0, 41),
('tpl-trade-co', 'industry', 'trading', '產地來源證', 'Certificate of Origin', '部分出口貨物須申請產地來源證。', 0, 0, 42);

-- Compliance templates — Finance
INSERT OR IGNORE INTO compliance_templates (id, category, industry, title_zh, title_en, description_zh, is_required, has_deadline, sort_order) VALUES
('tpl-fin-sfc', 'industry', 'finance', 'SFC 牌照', 'SFC Licence', '⚠️ 極重要：提供投資顧問、資產管理等服務須向證監會(SFC)申領牌照。無牌經營屬刑事罪行。', 1, 1, 41);

-- ═══════════════════════════════════════════
-- Plans — OPCC 定價方案
-- ═══════════════════════════════════════════

-- $120/mo Starter
INSERT OR IGNORE INTO plans (id, plan_key, name_zh, name_en, monthly_price, skill_allowlist, limits, features, sort_order) VALUES (
  'plan-starter',
  'starter',
  'OPCC Starter 一人起步',
  'OPCC Starter',
  12000,
  '["list_customers","create_customer","update_customer","search_customers","list_suppliers","create_supplier","search_suppliers","list_products","create_product","search_products","list_invoices","create_invoice","update_invoice_status","get_invoice","search_invoices","generate_pdf","company_profile","list_todos","create_todo","update_todo","counts"]',
  '{"invoices_per_month":30,"quotations_per_month":10,"storage_gb":1,"api_tokens":1,"users":1}',
  '["基本 CRM (客戶/供應商管理)","銷售發票開立與管理","PDF 發票下載","產品目錄管理","待辦事項追蹤","Cloudflare Email Dash 基本路由","1GB 檔案儲存","1 個 API Token"]',
  1
);

-- $240/mo Growth
INSERT OR IGNORE INTO plans (id, plan_key, name_zh, name_en, monthly_price, skill_allowlist, limits, features, sort_order) VALUES (
  'plan-growth',
  'growth',
  'OPCC Growth 成長加速',
  'OPCC Growth',
  24000,
  '["list_customers","create_customer","update_customer","delete_customer","search_customers","list_suppliers","create_supplier","update_supplier","delete_supplier","search_suppliers","list_products","create_product","update_product","delete_product","search_products","list_invoices","create_invoice","update_invoice_status","delete_invoice","get_invoice","search_invoices","list_quotations","create_quotation","convert_quotation","delete_quotation","get_quotation","list_purchase_orders","create_purchase_order","delete_purchase_order","get_purchase_order","update_purchase_order_status","list_service_orders","create_service_order","delete_service_order","get_service_order","update_service_order_status","generate_pdf","company_profile","list_todos","create_todo","update_todo","list_bank_statements","upload_bank_statement","list_expense_receipts","upload_expense_receipt","import_customers_csv","import_products_csv","import_invoices_csv","counts","summary"]',
  '{"invoices_per_month":100,"quotations_per_month":30,"storage_gb":5,"api_tokens":3,"users":1}',
  '["包含 Starter 所有功能","報價單管理 (含轉換發票)","採購訂單管理","服務訂單管理","銀行月結單 OCR 導入","消費單據 OCR 辨識","CSV 批量導入 (客戶/產品/發票)","Cloudflare Email Dash + Email Worker","5GB 檔案儲存","3 個 API Token"]',
  2
);

-- $399/mo Business
INSERT OR IGNORE INTO plans (id, plan_key, name_zh, name_en, monthly_price, skill_allowlist, limits, features, sort_order) VALUES (
  'plan-business',
  'business',
  'OPCC Business 正式營運',
  'OPCC Business',
  39900,
  '["list_customers","create_customer","update_customer","delete_customer","search_customers","list_suppliers","create_supplier","update_supplier","delete_supplier","search_suppliers","list_products","create_product","update_product","delete_product","search_products","list_invoices","create_invoice","update_invoice_status","delete_invoice","get_invoice","search_invoices","list_quotations","create_quotation","convert_quotation","delete_quotation","get_quotation","list_purchase_orders","create_purchase_order","delete_purchase_order","get_purchase_order","update_purchase_order_status","list_service_orders","create_service_order","delete_service_order","get_service_order","update_service_order_status","generate_pdf","company_profile","list_todos","create_todo","update_todo","list_bank_statements","upload_bank_statement","list_expense_receipts","upload_expense_receipt","import_customers_csv","import_products_csv","import_invoices_csv","import_quotations_csv","trial_balance","income_statement","export_bookkeeping","bookkeeping","list_calendar","create_event","update_calendar_event","delete_calendar_event","list_services","create_service","update_service","delete_service","list_bookings","create_booking","list_conversations","send_message","list_documents","upload_document","counts","summary","activity"]',
  '{"invoices_per_month":-1,"quotations_per_month":-1,"storage_gb":20,"api_tokens":10,"users":2}',
  '["包含 Growth 所有功能","完整雙式記帳 (試算表/損益表/總賬)","財務報告 API (審計導出)","日曆排程與預約管理","Telegram / WhatsApp 多管道訊息","BR/CI 文件 OCR 管理","付款整合 (Stripe / FPS / Alipay)","合規儀表板 (香港 OPC 清單)","Cloudflare Email Dash + Routing + R2","20GB 檔案儲存","10 個 API Token","2 個用戶"]',
  3
);

-- $599/mo Enterprise
INSERT OR IGNORE INTO plans (id, plan_key, name_zh, name_en, monthly_price, skill_allowlist, limits, features, sort_order) VALUES (
  'plan-enterprise',
  'enterprise',
  'OPCC Enterprise 前海企業',
  'OPCC Enterprise',
  59900,
  '["list_customers","create_customer","update_customer","delete_customer","search_customers","list_suppliers","create_supplier","update_supplier","delete_supplier","search_suppliers","list_products","create_product","update_product","delete_product","search_products","list_invoices","create_invoice","update_invoice_status","delete_invoice","get_invoice","search_invoices","list_quotations","create_quotation","convert_quotation","delete_quotation","get_quotation","list_purchase_orders","create_purchase_order","delete_purchase_order","get_purchase_order","update_purchase_order_status","list_service_orders","create_service_order","delete_service_order","get_service_order","update_service_order_status","generate_pdf","company_profile","list_todos","create_todo","update_todo","list_bank_statements","upload_bank_statement","list_expense_receipts","upload_expense_receipt","import_customers_csv","import_products_csv","import_invoices_csv","import_quotations_csv","trial_balance","income_statement","export_bookkeeping","bookkeeping","list_calendar","create_event","update_calendar_event","delete_calendar_event","list_services","create_service","update_service","delete_service","list_bookings","create_booking","list_conversations","send_message","list_documents","upload_document","ai_chat","admin_onboard","admin_list_tenants","tenant_export","tenant_summary","compliance_checklist","counts","summary","activity"]',
  '{"invoices_per_month":-1,"quotations_per_month":-1,"storage_gb":50,"api_tokens":-1,"users":5}',
  '["包含 Business 所有功能","DeepSeek AI 助手 (CRM 感知)","前海跨境合規模板","多租戶管理 (admin_onboard)","網站生成器 (AI 生成)","名片生成器","租戶資料導出 (JSON/CSV)","審計導出 (CSV for auditor)","合規清單 API","Cloudflare Email Dash 全功能","50GB 檔案儲存","無限 API Token","5 個用戶","優先技術支援"]',
  4
);

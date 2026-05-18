#!/usr/bin/env python3
"""Parse HSBC Business Direct eStatement text extracted by pdftotext -layout."""

import json
import re
import sys

MONTH_MAP = {
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
}

AMOUNT_RE = re.compile(r'([\d,]+\.\d{2})(?:DR)?')


def parse_amount(s):
    if not s:
        return 0.0
    return float(s.replace(',', '').replace('DR', '').strip())


def to_iso_date(day, month_str, year):
    m = MONTH_MAP.get(month_str.lower()[:3])
    if not m:
        return None
    yr = int(year)
    if yr < 100:
        yr += 2000
    return f"{yr}-{m:02d}-{int(day):02d}"


def parse_statement_date(text):
    for m in re.finditer(
        r'(\d{1,2})\s+(January|February|March|April|May|June|'
        r'July|August|September|October|November|December)\s+(\d{4})', text):
        return m.group(0)
    return None


def classify_amounts(line, deposit_ref, withdrawal_ref, balance_ref):
    """Find all amounts on a line and classify by nearest column.
    Returns (deposit, withdrawal, balance, has_explicit_balance, all_positions).
    """
    deposit = 0.0
    withdrawal = 0.0
    balance = 0.0
    has_explicit_balance = False
    positions = []

    for m in re.finditer(r'([\d,]+\.\d{2})(?:DR)?', line):
        val = parse_amount(m.group(1))
        is_dr = m.group(0).endswith('DR')
        pos = m.start()
        positions.append((pos, val, m.group(), is_dr))

        # Find nearest column reference
        dist_bal = abs(pos - balance_ref)
        dist_wit = abs(pos - withdrawal_ref)
        dist_dep = abs(pos - deposit_ref)
        min_dist = min(dist_bal, dist_wit, dist_dep)

        if min_dist == dist_bal and dist_bal < 30:
            balance = -val if is_dr else val
            has_explicit_balance = True
        elif min_dist == dist_wit and dist_wit < 30:
            withdrawal = val
        elif min_dist == dist_dep and dist_dep < 30:
            deposit = val
        # else: amount in description area → ignore

    return deposit, withdrawal, balance, has_explicit_balance, positions


def extract_description(line, date_start, first_amount_pos):
    """Extract description from line[date_start:first_amount_pos], cleaning amounts."""
    if first_amount_pos is None:
        desc = line[date_start:].strip()
    else:
        desc = line[date_start:first_amount_pos].strip()
    # Clean any leftover number fragments
    desc = re.sub(r'[\d,]+\.?\s*$', '', desc).strip()
    desc = re.sub(r'\s+', ' ', desc)
    return desc


def parse_account_section(section_text, account_type, year):
    """Parse one account section's transaction table."""
    lines = section_text.split('\n')

    # Find header to get column reference positions
    header_idx = -1
    deposit_ref = -1
    withdrawal_ref = -1
    balance_ref = -1

    for idx, line in enumerate(lines):
        dm = re.search(r'\bDeposit\b', line, re.IGNORECASE)
        wm = re.search(r'\bWithdrawal\b', line, re.IGNORECASE)
        bm = re.search(r'\bBalance\b', line, re.IGNORECASE)
        if dm and wm and bm:
            header_idx = idx
            deposit_ref = dm.start()
            withdrawal_ref = wm.start()
            balance_ref = bm.start()
            break

    if header_idx < 0:
        return []

    transactions = []
    current_date = None
    pending_desc = []  # description lines accumulated before an amount line
    sort_order = 0

    for line in lines[header_idx + 1:]:
        stripped = line.strip()
        if not stripped:
            continue

        # Stop conditions
        if re.match(r'Total No\. of', stripped):
            break
        if re.match(r'Total (Withdrawal|Deposit) Amount', stripped):
            break
        if any(stripped.startswith(kw) for kw in
               ['Special Privileges', 'Others', 'Thank you', 'The Hongkong']):
            break

        # Skip mid-page headers and metadata lines (page continuations)
        if re.match(r'(?:HKD|USD|CNY|GBP|EUR)\s+(?:STATEMENT\s+)?(?:Savings|Current|SAVINGS)', stripped):
            continue
        if re.match(r'BANK REFERENCE\s+\d+', stripped):
            continue
        if re.match(r'銀行參考編號', stripped):
            continue
        if re.match(r'PAGE\s+\d', stripped):
            continue
        if re.match(r'頁數', stripped):
            continue
        if re.match(r'STATEMENT DATE\s+\d+', stripped):
            continue
        if re.match(r'結單日期', stripped):
            continue
        if re.match(r'ACCOUNT TYPE\s+', stripped):
            continue
        if re.match(r'賬戶種類', stripped):
            continue
        if re.match(r'BRANCH\s+', stripped):
            continue
        if re.match(r'分行', stripped):
            continue
        if re.match(r'ACCOUNT NO\.\s*賬戶號碼', stripped):
            continue
        if re.match(r'\[ INTEGRATED ACCOUNT', stripped):
            continue
        if re.match(r'DATE\s+PARTICULARS', stripped) or re.match(r'日期\s+交易詳情', stripped):
            continue
        if re.match(r'\(DR=DEBIT\)', stripped) or re.match(r'DR=結欠', stripped):
            continue

        # Check for date at line start (supports "27 JAN 26", "27JAN26", "27 Jan 2026")
        date_match = re.match(r'^(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(\d{2,4})?\b', stripped, re.IGNORECASE)
        if date_match:
            yr = int(date_match.group(3)) if date_match.group(3) else year
            if yr < 100:
                yr += 2000
            current_date = to_iso_date(date_match.group(1), date_match.group(2), yr)
            # date_start relative to original line (stripped offset + leading whitespace)
            date_start = len(date_match.group(0)) + (len(line) - len(stripped))
        else:
            date_start = 0

        # Find and classify amounts on this line
        deposit, withdrawal, balance, has_bal, amt_positions = classify_amounts(
            line, deposit_ref, withdrawal_ref, balance_ref
        )

        has_amounts = bool(amt_positions)

        if has_amounts:
            # Determine the first amount position for description extraction
            first_amt_pos = amt_positions[0][0] if amt_positions else None

            # Build description
            line_desc = extract_description(
                line, date_start, first_amt_pos
            )

            if pending_desc:
                full_desc = ' '.join(pending_desc)
                if line_desc:
                    full_desc += ' ' + line_desc
                pending_desc = []
            else:
                full_desc = line_desc

            transactions.append({
                'transaction_date': current_date,
                'description': full_desc,
                'deposit_amount': deposit,
                'withdrawal_amount': withdrawal,
                'balance': balance,
                'has_balance': has_bal,
                'account_type': account_type,
                'reference': None,
                'sort_order': sort_order,
            })
            sort_order += 1
        else:
            # Pure description line (no amounts)
            line_desc = line[date_start:].strip() if date_start > 0 else stripped
            line_desc = re.sub(r'\s+', ' ', line_desc).strip()
            if line_desc:
                pending_desc.append(line_desc)

    # Compute running balances for entries that didn't capture balance
    if transactions:
        running = None
        for tx in transactions:
            if tx['has_balance']:
                running = tx['balance']
            elif running is None:
                running = (tx['deposit_amount'] or 0) - (tx['withdrawal_amount'] or 0)
                tx['balance'] = round(running, 2)
            else:
                running = running + (tx['deposit_amount'] or 0) - (tx['withdrawal_amount'] or 0)
                tx['balance'] = round(running, 2)
            # Clean up internal key
            del tx['has_balance']

    return transactions


def parse_statement(text):
    result = {
        'bank_name': 'HSBC',
        'account_number': None,
        'branch': None,
        'currency': 'HKD',
        'statement_date': None,
        'statement_year': None,
        'statement_month': None,
        'period_start': None,
        'period_end': None,
        'opening_balance': None,
        'closing_balance': None,
        'page_count': 1,
        'ocr_text': text,
        'accounts': [],
    }

    m = re.search(r'(\d{3,4}-\d{5,6}-\d{1,3})', text)
    if m:
        result['account_number'] = m.group(1)
    if not result['account_number']:
        m = re.search(r'ACCOUNT\s+NO\.?\s*賬戶號碼\s*(\d{3,4}-\d{3,4})', text)
        if m:
            result['account_number'] = m.group(1)
    if not result['account_number']:
        m = re.search(r'(\d{3,4}-\d{3,4})', text)
        if m:
            result['account_number'] = m.group(1)

    m = re.search(r'Branch\s*:?\s*([A-Za-z\s]{3,25}?)(?:\s{3,}|Page|\d{1,2}\s+\w+)', text)
    if m:
        val = m.group(1).strip().strip(':').strip()
        if val and val != ':':
            result['branch'] = val
    if not result['branch']:
        m = re.search(r'BRANCH\s+分行\s*\n?\s*([A-Za-z\s]{3,25}?)(?:\s{3,}|總行|\n)', text)
        if m:
            val = m.group(1).strip()
            if val and val != 'HEAD OFFICE':
                result['branch'] = val
            else:
                result['branch'] = val

    pages = re.findall(r'Page\s+\d+\s+of\s+(\d+)', text)
    if pages:
        result['page_count'] = max(int(p) for p in pages)

    stmt_date = parse_statement_date(text)
    if stmt_date:
        result['statement_date'] = stmt_date
        dm = re.match(r'(\d{1,2})\s+(\w+)\s+(\d{4})', stmt_date)
        if dm:
            result['statement_year'] = int(dm.group(3))
            result['statement_month'] = MONTH_MAP.get(dm.group(2).lower()[:3])

    year = result['statement_year'] or 2025

    activities_match = re.search(r'Account Activities', text, re.IGNORECASE)
    if not activities_match:
        return result

    activities_text = text[activities_match.end():]

    # Try both section patterns
    section_splits = re.split(
        r'\n\s*HSBC Business Direct ((?:HKD|USD|CNY|GBP|EUR) (?:Savings|Current))\s*\n',
        activities_text
    )

    if len(section_splits) <= 1:
        # Fallback: parse as single-section (HSBC HK format with Chinese)
        atype_match = re.search(r'(?:HKD|USD|CNY|GBP|EUR)\s+(?:STATEMENT\s+)?(?:Savings|Current|SAVINGS)', activities_text, re.IGNORECASE)
        account_type = atype_match.group(0) if atype_match else 'HKD Savings'
        transactions = parse_account_section(activities_text, account_type, year)
        if transactions:
            opening = None
            closing = transactions[-1].get('balance', 0)
            for tx in transactions:
                if 'B/F' in tx['description'].upper():
                    opening = tx['balance']
                    break
            if opening is None and transactions:
                first = transactions[0]
                opening = round(first['balance'] - first['deposit_amount'] +
                                first['withdrawal_amount'], 2)
            result['accounts'] = [{
                'account_type': account_type,
                'opening_balance': opening,
                'closing_balance': closing,
                'transactions': transactions,
            }]
        result['opening_balance'] = opening
        result['closing_balance'] = closing
        if transactions:
            result['period_start'] = transactions[0].get('transaction_date')
            result['period_end'] = transactions[-1].get('transaction_date')
    else:
        for i in range(1, len(section_splits) - 1, 2):
            account_type = section_splits[i].strip()
            section_text = section_splits[i + 1]
            transactions = parse_account_section(section_text, account_type, year)

            opening = None
            closing = None
            if transactions:
                closing = transactions[-1].get('balance', 0)
                for tx in transactions:
                    if 'B/F' in tx['description'].upper():
                        opening = tx['balance']
                        break
                if opening is None and transactions:
                    first = transactions[0]
                    opening = round(first['balance'] - first['deposit_amount'] +
                                    first['withdrawal_amount'], 2)

            result['accounts'].append({
                'account_type': account_type,
                'opening_balance': opening,
                'closing_balance': closing,
                'transactions': transactions,
            })

    if result['accounts']:
        # Prefer Savings account for summary balances (primary deposit account)
        main = result['accounts'][0]
        for acct in result['accounts']:
            if 'savings' in acct['account_type'].lower():
                if acct['closing_balance'] and acct['closing_balance'] != 0:
                    main = acct
                    break
        result['opening_balance'] = main['opening_balance']
        result['closing_balance'] = main['closing_balance']
        all_txs = main.get('transactions', [])
        if all_txs:
            result['period_start'] = all_txs[0].get('transaction_date')
            result['period_end'] = all_txs[-1].get('transaction_date')

    return result


def flatten_for_import(parsed, r2_key):
    all_transactions = []
    sort_order = 0
    for acct in parsed.get('accounts', []):
        for tx in acct.get('transactions', []):
            all_transactions.append({
                'transaction_date': tx['transaction_date'],
                'description': tx['description'],
                'deposit_amount': tx.get('deposit_amount', 0),
                'withdrawal_amount': tx.get('withdrawal_amount', 0),
                'balance': tx.get('balance', 0),
                'account_type': tx.get('account_type') or acct.get('account_type'),
                'reference': tx.get('reference'),
                'sort_order': sort_order,
            })
            sort_order += 1

    # Prefer Savings account for the main statement metadata
    main_acct = parsed['accounts'][0] if parsed['accounts'] else None
    for acct in parsed.get('accounts', []):
        if 'savings' in acct.get('account_type', '').lower():
            if acct.get('closing_balance') and acct['closing_balance'] != 0:
                main_acct = acct
                break

    return {
        'r2_key': r2_key,
        'file_name': r2_key.split('/')[-1] if '/' in r2_key else r2_key,
        'bank_name': parsed['bank_name'],
        'account_number': parsed['account_number'],
        'branch': parsed['branch'],
        'currency': parsed['currency'],
        'account_type': main_acct['account_type'] if main_acct else None,
        'statement_year': parsed['statement_year'],
        'statement_month': parsed['statement_month'],
        'period_start': parsed['period_start'],
        'period_end': parsed['period_end'],
        'opening_balance': parsed['opening_balance'],
        'closing_balance': parsed['closing_balance'],
        'page_count': parsed['page_count'],
        'ocr_text': parsed['ocr_text'],
        'transactions': all_transactions,
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 parse_hsbc.py <text_file> [r2_key]")
        sys.exit(1)

    with open(sys.argv[1], 'r') as f:
        text = f.read()

    parsed = parse_statement(text)
    r2_key = sys.argv[2] if len(sys.argv) > 2 else ''
    result = flatten_for_import(parsed, r2_key)
    print(json.dumps(result, indent=2, ensure_ascii=False))

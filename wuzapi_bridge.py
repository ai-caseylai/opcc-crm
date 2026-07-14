#!/usr/bin/env python3
"""
WUZAPI-CLI → OPCC CRM Bridge
----------------------------
Listens to WUZAPI-CLI for incoming WhatsApp messages and forwards them
to the OPCC CRM WebSocket endpoint for real-time display.

Usage:
  python3 wuzapi_bridge.py

Environment variables (optional):
  WUZAPI_URL     – WUZAPI-CLI server URL (default: http://localhost:8080)
  WUZAPI_TOKEN   – WUZAPI API token (if required)
  CRM_WS_URL     – OPCC CRM push endpoint (default: https://opcc-crm.techforliving.net/api/ws/push)
  CRM_JWT        – OPCC CRM admin JWT (for push authentication)
  CRM_USER_ID    – OPCC CRM user ID to receive messages (default: u-admin-001)
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error

# ── Config ──────────────────────────────────────────────
WUZAPI_URL   = os.environ.get('WUZAPI_URL',   'http://localhost:8080')
WUZAPI_TOKEN = os.environ.get('WUZAPI_TOKEN', '')
CRM_PUSH_URL = os.environ.get('CRM_WS_URL',   'https://opcc-crm.techforliving.net/api/ws/push')
CRM_JWT      = os.environ.get('CRM_JWT',      '')
CRM_USER_ID  = os.environ.get('CRM_USER_ID',  'u-admin-001')
POLL_INTERVAL = int(os.environ.get('POLL_INTERVAL', '5'))  # seconds
UA = {'User-Agent': 'WUZAPI-CRM-Bridge/1.0', 'Content-Type': 'application/json'}

# ── Helpers ─────────────────────────────────────────────
def wuzapi_req(method: str, path: str, body: dict | None = None) -> dict | None:
    """Call WUZAPI-CLI API."""
    headers = dict(UA)
    if WUZAPI_TOKEN:
        headers['Authorization'] = f'Bearer {WUZAPI_TOKEN}'

    data = json.dumps(body).encode() if body else None
    try:
        req = urllib.request.Request(f'{WUZAPI_URL}{path}', data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode('utf-8', errors='replace')[:300]
        print(f'  ⚠️  WUZAPI {method} {path} → {e.code}: {body_text}')
        return None
    except Exception as e:
        print(f'  ❌ WUZAPI {method} {path} → {e}')
        return None


def push_to_crm(msg_type: str, data: dict):
    """Push a message to OPCC CRM WebSocket."""
    payload = {
        'user_id': CRM_USER_ID,
        'type': msg_type,
        'data': data,
    }
    headers = dict(UA)
    if CRM_JWT:
        headers['Authorization'] = f'Bearer {CRM_JWT}'

    try:
        req = urllib.request.Request(
            CRM_PUSH_URL,
            data=json.dumps(payload).encode(),
            headers=headers,
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            result = json.loads(r.read())
            sent = result.get('sent', False)
            if sent:
                print(f'  📤 Pushed to CRM → {msg_type}')
            else:
                print(f'  ⚠️  CRM push: no clients connected (user offline)')
            return result
    except urllib.error.HTTPError as e:
        print(f'  ❌ CRM push → {e.code}: {e.read().decode("utf-8", errors="replace")[:200]}')
        return None
    except Exception as e:
        print(f'  ❌ CRM push → {e}')
        return None


# ── WUZAPI message fetchers ─────────────────────────────
def get_status() -> dict | None:
    """Get WUZAPI server status."""
    for path in ['/v1/status', '/api/v1/status', '/api/status', '/status', '/health']:
        result = wuzapi_req('GET', path)
        if result and 'error' not in str(result).lower():
            return result
    return None


def get_messages(last_id: str = '', limit: int = 20) -> list[dict]:
    """Fetch recent WhatsApp messages from WUZAPI."""
    for path in ['/v1/messages', '/api/v1/messages', '/api/messages']:
        params = f'?limit={limit}'
        if last_id:
            params += f'&after={last_id}'
        result = wuzapi_req('GET', f'{path}{params}')
        if result:
            if isinstance(result, list):
                return result
            if isinstance(result, dict):
                return result.get('messages') or result.get('data') or result.get('results') or []
    return []


def get_chats() -> list[dict]:
    """Fetch WhatsApp chats from WUZAPI."""
    for path in ['/v1/chats', '/api/v1/chats', '/api/chats']:
        result = wuzapi_req('GET', path)
        if result:
            if isinstance(result, list):
                return result
            if isinstance(result, dict):
                return result.get('chats') or result.get('data') or result.get('results') or []
    return []


def get_webhook_url() -> str | None:
    """Try to get the current webhook URL from WUZAPI."""
    for path in ['/v1/webhook', '/api/v1/webhook', '/api/webhook']:
        result = wuzapi_req('GET', path)
        if result:
            print(f'  📡 Current webhook: {json.dumps(result, indent=2)[:200]}')
            return json.dumps(result)
    return None


# ── Main loop ───────────────────────────────────────────
def main():
    print('═' * 50)
    print('WUZAPI-CLI → OPCC CRM Bridge')
    print('═' * 50)
    print(f'  WUZAPI:  {WUZAPI_URL}')
    print(f'  CRM:     {CRM_PUSH_URL}')
    print(f'  User ID: {CRM_USER_ID}')
    print(f'  Poll:    every {POLL_INTERVAL}s')
    print()

    # Check WUZAPI status
    print('🔍 Checking WUZAPI status...')
    status = get_status()
    if status:
        print(f'  ✅ WUZAPI connected: {json.dumps(status, indent=2)[:300]}')
    else:
        print('  ⚠️  Could not reach WUZAPI. Will keep trying...')

    # Check webhook
    print('🔍 Checking WUZAPI webhook...')
    get_webhook_url()

    # Fetch existing chats
    print('🔍 Fetching existing chats...')
    chats = get_chats()
    if chats:
        print(f'  📋 {len(chats)} chats found')
        for ch in chats[:5]:
            jid = ch.get('jid') or ch.get('id') or ch.get('phone') or '?'
            name = ch.get('name') or ch.get('contact_name') or jid
            print(f'    - {name}')
        if len(chats) > 5:
            print(f'    ... and {len(chats) - 5} more')

    # Push chats to CRM
    if chats:
        print('📤 Pushing chats to CRM...')
        push_to_crm('chats', {'chats': chats[:50]})

    # Polling loop
    print(f'\n🔄 Starting polling loop (interval: {POLL_INTERVAL}s)...')
    print('   Press Ctrl+C to stop\n')
    last_message_id = ''

    while True:
        try:
            messages = get_messages(last_message_id, limit=20)
            if messages:
                for msg in messages:
                    msg_id = msg.get('id') or msg.get('message_id') or ''
                    if msg_id and msg_id > last_message_id:
                        last_message_id = msg_id

                    # Push to CRM
                    push_to_crm('new_whatsapp_message', {
                        'id': msg_id,
                        'from': msg.get('from') or msg.get('sender') or msg.get('jid') or '',
                        'text': msg.get('text') or msg.get('body') or msg.get('content') or '',
                        'timestamp': msg.get('timestamp') or msg.get('time') or '',
                        'chat_id': msg.get('chat_id') or msg.get('jid') or '',
                        'type': msg.get('type') or 'message',
                    })

                    # Print locally
                    sender = msg.get('from') or msg.get('sender') or msg.get('jid') or '?'
                    text = (msg.get('text') or msg.get('body') or msg.get('content') or '')[:80]
                    print(f'  💬 {sender}: {text}')

            time.sleep(POLL_INTERVAL)

        except KeyboardInterrupt:
            print('\n👋 Bridge stopped.')
            sys.exit(0)
        except Exception as e:
            print(f'  ❌ Loop error: {e}')
            time.sleep(POLL_INTERVAL)


if __name__ == '__main__':
    main()

// Cloudflare Pages Function — API proxy
export async function onRequest(context: any) {
  const { request } = context;
  const url = new URL(request.url);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Active-Client',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  try {
    // Proxy to API Worker
    const apiUrl = `https://oppc-crm-api.ai-caseylai.workers.dev${url.pathname}${url.search}`;

    const response = await fetch(apiUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.text() : undefined,
    });

    // Return the response with CORS headers
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Access-Control-Allow-Origin', request.headers.get('Origin') || '*');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'API proxy error', message: e.message }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
      },
    });
  }
}


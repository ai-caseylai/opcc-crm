// Cloudflare Pages Function — API proxy
export async function onRequest(context: any) {
  const { request } = context;
  const url = new URL(request.url);
  
  // Proxy to API Worker
  const apiUrl = `https://oppc-crm-api.ai-caseylai.workers.dev${url.pathname}${url.search}`;
  
  const response = await fetch(apiUrl, {
    method: request.method,
    headers: request.headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.text() : undefined,
  });

  // Return the response with CORS headers
  const newHeaders = new Headers(response.headers);
  newHeaders.set('Access-Control-Allow-Origin', '*');
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

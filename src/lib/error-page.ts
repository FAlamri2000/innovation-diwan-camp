/** The last-resort page when rendering itself failed. Bilingual, no assets. */
export function renderErrorPage(): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>خطأ</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7faf9;color:#00362e;font-family:system-ui,sans-serif;text-align:center}a{color:#00665c}</style></head>
<body><main><h1>حدث خطأ غير متوقع</h1><p>Something went wrong.</p><p><a href="/">العودة إلى الرئيسية · Home</a></p></main></body></html>`;
}

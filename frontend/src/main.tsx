import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './i18n';
import i18n from './i18n';

// ── Auto-translator for bilingual strings ────────────────────────────────────
// Many pages have hardcoded bilingual text like "固定資產 Fixed Assets" or
// "分錄 Entries". When EN is selected, strip the Chinese part automatically.
// Pattern: Chinese chars followed by space(s) and English → keep only English
// Pattern: English followed by space(s) and Chinese → keep only English
function stripChineseFromNode(node: Node) {
  if (node.nodeType !== Node.TEXT_NODE) return;
  const text = node.textContent || '';
  if (!/[一-鿿]/.test(text)) return; // no Chinese, skip
  
  // Bilingual pattern 1: "中文 English" → "English"
  let result = text.replace(/[一-鿿　-〿＀-￯（）【】「」『』《》〈〉、。！？：；""'']+\s*/g, '');
  // Bilingual pattern 2: "English 中文" → "English"
  result = result.replace(/\s*[一-鿿　-〿＀-￯（）【】「」『』《》〈〉、。！？：；""'']+/g, '');
  result = result.trim();
  if (result !== text && result.length > 0) {
    node.textContent = result;
  }
}

function walkAndStrip(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Node[] = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  nodes.forEach(stripChineseFromNode);
}

// Apply on language change
i18n.on('languageChanged', (lang) => {
  if (lang === 'en') {
    setTimeout(() => walkAndStrip(document.body), 100);
    // Set up observer for dynamic content
    const observer = new MutationObserver((mutations) => {
      // Language-independent font observer
      mutations.forEach(m => {
        m.addedNodes.forEach(n => walkAndStrip(n));
        if (m.type === 'characterData') stripChineseFromNode(m.target);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    (window as any).__langObserver = observer;
  } else {
    if ((window as any).__langObserver) {
      (window as any).__langObserver.disconnect();
      delete (window as any).__langObserver;
    }
    // Reload page to restore Chinese (easier than reversing the DOM changes)
    window.location.reload();
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

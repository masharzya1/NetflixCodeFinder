import { useEffect, useRef, useState } from "react";

const uiTranslationCache = new Map();

async function translateText(text, targetLanguage) {
  if (!text || targetLanguage === "en") return text;

  const cacheKey = `${targetLanguage}:${text}`;
  if (uiTranslationCache.has(cacheKey)) return uiTranslationCache.get(cacheKey);

  try {
    const response = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLanguage}&dt=t&q=${encodeURIComponent(text)}`
    );
    const data = await response.json();
    const translated = data?.[0]?.map((item) => item[0]).join("") || text;
    uiTranslationCache.set(cacheKey, translated);
    return translated;
  } catch (_error) {
    return text;
  }
}

function shouldSkipElement(element) {
  if (!element) return true;
  const tagName = element.tagName.toLowerCase();
  if (["script", "style", "textarea", "input", "select", "option"].includes(tagName)) return true;
  if (element.closest(".email-content-wrapper")) return true;
  if (element.closest("[data-no-auto-translate='true']")) return true;
  return false;
}

function getTextNodes(root) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (shouldSkipElement(parent)) return NodeFilter.FILTER_REJECT;

      const text = node.nodeValue.replace(/\s+/g, " ").trim();
      if (!text) return NodeFilter.FILTER_REJECT;
      if (/^[\d\s:.,/+-]+$/.test(text)) return NodeFilter.FILTER_REJECT;
      if (/^[A-Z0-9]{6}$/.test(text)) return NodeFilter.FILTER_REJECT;
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) return NodeFilter.FILTER_REJECT;

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node;
  while ((node = walker.nextNode())) {
    if (!node.__originalText) node.__originalText = node.nodeValue;
    nodes.push(node);
  }

  return nodes;
}

export function useAutoTranslate(targetLanguage, dependencies = []) {
  const ref = useRef(null);
  const [isTranslating, setIsTranslating] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const root = ref.current;
      if (!root || typeof document === "undefined") return;

      const nodes = getTextNodes(root);
      if (!nodes.length) return;

      setIsTranslating(targetLanguage !== "en");

      for (const node of nodes) {
        if (cancelled) return;
        const original = node.__originalText || node.nodeValue;
        node.nodeValue = original;

        if (targetLanguage !== "en") {
          const translated = await translateText(original.trim(), targetLanguage);
          if (!cancelled && translated) {
            node.nodeValue = node.nodeValue.replace(original.trim(), translated);
          }
        }
      }

      if (!cancelled) setIsTranslating(false);
    }

    const timer = window.setTimeout(run, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [targetLanguage, ...dependencies]);

  return { ref, isTranslating };
}

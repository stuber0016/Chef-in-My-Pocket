"use client";

import { useEffect, useRef } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({
  breaks: true,
  gfm: true,
});

export default function MarkdownRenderer({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      const rawHtml = marked.parse(String(content));
      ref.current.innerHTML = DOMPurify.sanitize(rawHtml as string);
    }
  }, [content]);

  return <div ref={ref} className="markdown-content" />;
}

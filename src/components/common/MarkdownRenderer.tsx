import React from 'react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  // Parse markdown line by line into structured blocks
  const lines = content.split('\n');

  // Helper to render inline formatting: bold (**text**), code (`code`), italic (*text*)
  const renderInline = (text: string): React.ReactNode => {
    // Regex for bold **text**
    const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);

    return parts.map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        const inner = part.slice(2, -2);
        // Special styling for key indicators
        const isDeficit = inner.toLowerCase().includes('defisit') || inner.toLowerCase().includes('shortage');
        const isCritical = inner.toLowerCase().includes('kritis') || inner.toLowerCase().includes('solusi instan');
        return (
          <strong
            key={index}
            className={`font-semibold ${
              isDeficit
                ? 'text-red-700 font-bold'
                : isCritical
                ? 'text-blue-900 font-bold'
                : 'text-slate-900'
            }`}
          >
            {inner}
          </strong>
        );
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code
            key={index}
            className="px-1.5 py-0.5 bg-slate-100 text-blue-700 rounded text-[11px] font-mono border border-slate-200"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
  };

  // Group lines into blocks (headings, lists, paragraphs)
  const blocks: React.ReactNode[] = [];
  let currentList: React.ReactNode[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const flushList = () => {
    if (currentList.length > 0 && listType) {
      if (listType === 'ul') {
        blocks.push(
          <ul key={`ul-${blocks.length}`} className="my-2 space-y-1.5 pl-1">
            {currentList}
          </ul>
        );
      } else {
        blocks.push(
          <ol key={`ol-${blocks.length}`} className="my-2 space-y-2 pl-1">
            {currentList}
          </ol>
        );
      }
      currentList = [];
      listType = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    // Heading 3: ### Title
    if (trimmed.startsWith('### ')) {
      flushList();
      const title = trimmed.slice(4);
      blocks.push(
        <div
          key={`h3-${i}`}
          className="mt-3.5 mb-2 pb-1.5 border-b border-slate-200 flex items-center gap-2"
        >
          <div className="w-1.5 h-4 bg-blue-600 rounded-full shrink-0"></div>
          <h3 className="text-xs md:text-sm font-bold text-slate-900 tracking-tight">
            {renderInline(title)}
          </h3>
        </div>
      );
      continue;
    }

    // Heading 2: ## Title
    if (trimmed.startsWith('## ')) {
      flushList();
      const title = trimmed.slice(3);
      blocks.push(
        <div key={`h2-${i}`} className="mt-4 mb-2 pb-1 border-b border-blue-200">
          <h2 className="text-sm md:text-base font-bold text-blue-950">
            {renderInline(title)}
          </h2>
        </div>
      );
      continue;
    }

    // Numbered list item: 1. Item or 2. Item
    const numberedMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
    if (numberedMatch) {
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
      }
      const num = numberedMatch[1];
      const itemText = numberedMatch[2];
      currentList.push(
        <li key={`ol-item-${i}`} className="flex items-start gap-2.5 text-xs md:text-sm text-slate-800">
          <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-800 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
            {num}
          </span>
          <div className="flex-1 min-w-0 leading-relaxed">{renderInline(itemText)}</div>
        </li>
      );
      continue;
    }

    // Bullet list item: * Item or - Item (or indented bullet: "   * Item")
    const bulletMatch = rawLine.match(/^(\s*)([\*\-])\s+(.*)/);
    if (bulletMatch) {
      const indent = bulletMatch[1].length;
      const bulletContent = bulletMatch[3];

      if (indent >= 2) {
        // Nested bullet point
        if (listType === null) listType = 'ul';
        currentList.push(
          <li key={`nested-li-${i}`} className="ml-6 pl-2 border-l-2 border-slate-200 flex items-start gap-2 text-xs md:text-sm text-slate-700 my-1">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0 mt-1.5" />
            <div className="flex-1 leading-relaxed">{renderInline(bulletContent)}</div>
          </li>
        );
      } else {
        if (listType !== 'ul') {
          flushList();
          listType = 'ul';
        }
        currentList.push(
          <li key={`li-${i}`} className="flex items-start gap-2 text-xs md:text-sm text-slate-800 my-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0 mt-1.5" />
            <div className="flex-1 leading-relaxed">{renderInline(bulletContent)}</div>
          </li>
        );
      }
      continue;
    }

    // Normal paragraph
    flushList();
    blocks.push(
      <p key={`p-${i}`} className="text-xs md:text-sm text-slate-800 leading-relaxed my-1.5">
        {renderInline(trimmed)}
      </p>
    );
  }

  flushList();

  return <div className={`space-y-1 ${className}`}>{blocks}</div>;
};

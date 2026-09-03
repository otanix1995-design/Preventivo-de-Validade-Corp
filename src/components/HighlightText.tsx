import React from 'react';

interface HighlightTextProps {
  text?: string | null;
  query?: string | null;
  className?: string;
  highlightClassName?: string;
}

/**
 * Normalizes string removing accents and converting to uppercase for search index matching.
 */
function normalizeForSearch(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

/**
 * Highlights matching search substrings in ORANGE without modifying original text values.
 * Accurately matches case-insensitively and accent-insensitively while preserving
 * original casing and accents of the source text.
 */
export const HighlightText: React.FC<HighlightTextProps> = ({
  text,
  query,
  className = '',
  highlightClassName = 'bg-amber-100 text-amber-900 font-black px-0.5 rounded shadow-2xs',
}) => {
  if (!text) {
    return null;
  }

  const rawText = String(text);
  const rawQuery = (query || '').trim();

  if (!rawQuery) {
    return <span className={className}>{rawText}</span>;
  }

  const normText = normalizeForSearch(rawText);
  const normQuery = normalizeForSearch(rawQuery);

  if (!normQuery || !normText.includes(normQuery)) {
    return <span className={className}>{rawText}</span>;
  }

  // Find all match occurrences in the normalized string
  const segments: React.ReactNode[] = [];
  let lastIdx = 0;
  let matchIdx = normText.indexOf(normQuery, lastIdx);

  // In standard Latin strings, removing combining marks gives exact 1-to-1 index mapping with NFC text
  while (matchIdx !== -1) {
    // Text before the match
    if (matchIdx > lastIdx) {
      segments.push(
        <span key={`before-${lastIdx}`}>
          {rawText.slice(lastIdx, matchIdx)}
        </span>
      );
    }

    const endIdx = matchIdx + normQuery.length;
    // Matched substring in Orange Highlight
    segments.push(
      <mark
        key={`match-${matchIdx}`}
        className={highlightClassName}
      >
        {rawText.slice(matchIdx, endIdx)}
      </mark>
    );

    lastIdx = endIdx;
    matchIdx = normText.indexOf(normQuery, lastIdx);
  }

  // Remaining text after last match
  if (lastIdx < rawText.length) {
    segments.push(
      <span key={`after-${lastIdx}`}>
        {rawText.slice(lastIdx)}
      </span>
    );
  }

  return <span className={className}>{segments}</span>;
};

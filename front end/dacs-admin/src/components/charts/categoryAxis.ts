"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { ECHARTS_AXIS_LABEL } from "./ChartTheme";

/*
 * Shared category-axis label layout for every DACS chart, so wrapping
 * and overlap handling live in ONE place instead of per component.
 *
 * Preference order (matching the dashboard formatting spec):
 *   1. horizontal labels, word-wrapped onto up to 3 lines
 *   2. extra bottom padding for the wrapped lines
 *   3. gentle truncation with an ellipsis (tooltips keep the full text)
 *   4. angled labels only when a single word no longer fits its slot
 *
 * Labels are wrapped in the axisLabel FORMATTER only — the category
 * data keeps the clean single-line display name, so tooltips and
 * legends always show the full readable value.
 */

const FONT_SIZE = ECHARTS_AXIS_LABEL.fontSize; // 11
/* Average glyph width at 11px proportional sans (uppercase runs wider —
   the fit checks carry tolerance for it). */
const CHAR_W = FONT_SIZE * 0.58;
const LINE_H = FONT_SIZE + 3;
const MAX_LINES = 3;
const ROTATE_DEG = 38;
const SIN_ROTATE = Math.sin((ROTATE_DEG * Math.PI) / 180);
/* Angled labels beyond this length are shortened; tooltips stay full. */
const ROTATED_MAX_CHARS = 18;

/* Greedy word wrap; a word longer than the line is kept whole. */
export function wrapChartLabel(
  label: string,
  maxCharsPerLine: number,
  maxLines: number = MAX_LINES
): string {
  if (label.length <= maxCharsPerLine) return label;
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxCharsPerLine) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] =
      last.length > maxCharsPerLine
        ? `${last.slice(0, Math.max(1, maxCharsPerLine - 1))}…`
        : `${last}…`;
    return kept.join("\n");
  }
  return lines.join("\n");
}

export interface CategoryAxisLayout {
  /* Merge into the category axis' axisLabel. */
  axisLabel: Record<string, unknown>;
  /* Pixels the labels need below (or beside) the plot. */
  labelDepth: number;
}

/*
 * Layout for a HORIZONTAL category axis (column/line charts): wrapped
 * upright labels while every word fits its slot, angled fallback when
 * slots get narrower than the longest word.
 */
export function columnCategoryAxis(
  categories: string[],
  plotWidth: number
): CategoryAxisLayout {
  const count = Math.max(1, categories.length);
  const slot = Math.max(1, plotWidth) / count;
  const longestWord = categories.reduce(
    (length, category) =>
      Math.max(
        length,
        ...category.split(/\s+/).map((word) => word.length),
        1
      ),
    1
  );

  if (longestWord * CHAR_W <= slot * 1.08) {
    const maxChars = Math.max(
      longestWord,
      Math.floor((slot * 1.02) / CHAR_W)
    );
    const lineCount = Math.max(
      1,
      ...categories.map(
        (category) => wrapChartLabel(category, maxChars).split("\n").length
      )
    );
    return {
      axisLabel: {
        ...ECHARTS_AXIS_LABEL,
        interval: 0,
        lineHeight: LINE_H,
        formatter: (value: string) => wrapChartLabel(value, maxChars),
      },
      labelDepth: 8 + lineCount * LINE_H,
    };
  }

  /* Angled fallback: full text up to a cap; tooltips carry the rest. */
  const longestShown = Math.min(
    ROTATED_MAX_CHARS,
    Math.max(1, ...categories.map((category) => category.length))
  );
  return {
    axisLabel: {
      ...ECHARTS_AXIS_LABEL,
      /* Only thin the ticks when even angled labels would collide. */
      interval: slot >= LINE_H ? 0 : ("auto" as const),
      rotate: ROTATE_DEG,
      formatter: (value: string) =>
        value.length > ROTATED_MAX_CHARS
          ? `${value.slice(0, ROTATED_MAX_CHARS - 1)}…`
          : value,
    },
    labelDepth: 12 + Math.ceil(longestShown * CHAR_W * SIN_ROTATE),
  };
}

/*
 * Layout for a VERTICAL category axis (horizontal bar charts and
 * heatmap rows): allocate left width for the longest label up to a
 * cap, truncating with an ellipsis beyond it (tooltips stay full).
 */
export function barCategoryAxis(
  categories: string[],
  plotHeight: number
): CategoryAxisLayout {
  const count = Math.max(1, categories.length);
  const longest = Math.max(1, ...categories.map((category) => category.length));
  const width = Math.min(Math.ceil(longest * CHAR_W) + 6, 150);
  const slot = Math.max(1, plotHeight) / count;
  return {
    axisLabel: {
      ...ECHARTS_AXIS_LABEL,
      interval: slot >= LINE_H ? 0 : ("auto" as const),
      width,
      overflow: "truncate" as const,
    },
    labelDepth: width + 16,
  };
}

/*
 * Measures the chart card's real width so the label layout responds to
 * full-width, half-width and builder-preview cards (and window
 * resizes) instead of assuming one size.
 */
export function useContainerWidth(): [
  RefObject<HTMLDivElement | null>,
  number | null,
] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const next = Math.round(element.clientWidth);
      setWidth(next > 0 ? next : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/* Fallback before the first measurement (a typical half-width card). */
export const DEFAULT_CHART_WIDTH = 560;

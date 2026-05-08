import { useMemo } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";

function sanitizeBoldMarkers(line: string): string {
  let s = line.replace(/\\\*/g, "*").replace(/\\_/g, "_");

  // Collapse accidental triple wrappers from model drift (***bold*** -> **bold**)
  // Keep this conservative since we only emit a single emphasis span anyway.
  s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, "**$1**");

  // Some model outputs accidentally nest bold markers — unwrap until stable.
  for (let i = 0; i < 8; i += 1) {
    const next = s.replace(/\*\*(\*?)([^*\n]+?)(\*?)\*\*/g, "**$2**");
    if (next === s) break;
    s = next;
  }

  return s.trim();
}

type Part = { text: string; bold: boolean };

function splitBoldParts(line: string): Part[] {
  const s = sanitizeBoldMarkers(line);
  const tokens = s.split("**");
  if (tokens.length === 1) return [{ text: tokens[0] ?? "", bold: false }];
  return tokens.map((t, i) => ({ text: t, bold: i % 2 === 1 }));
}

export type StructuredItem = { title: string; body: string };
export type StructuredReply = { intro: string; items: StructuredItem[] };

const STRUCTURED_ITEM_RE =
  /^\s*\d+[.)]\s*\*\*(.+?)\*\*\s*[—–\-:]\s*(.+)$/;

export function splitConvoBubbles(text: string): string[] {
  const parts = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [text.trim()];
  const merged: string[] = [];
  for (const p of parts) {
    if (merged.length > 0 && p.length < 12) {
      merged[merged.length - 1] += " " + p;
    } else {
      merged.push(p);
    }
  }
  return merged.slice(0, 3);
}

export function parseStructuredReply(text: string): StructuredReply | null {
  const lines = text.split(/\n/);
  const matched: { lineIndex: number; title: string; bodyLine: string }[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(STRUCTURED_ITEM_RE);
    if (m) matched.push({ lineIndex: i, title: m[1].trim(), bodyLine: m[2].trim() });
  }

  if (matched.length < 3) return null;

  const items: StructuredItem[] = matched.map((row, j) => {
    const afterLine = row.lineIndex + 1;
    const untilNext =
      j + 1 < matched.length ? matched[j + 1].lineIndex : lines.length;
    const tail = lines.slice(afterLine, untilNext).join("\n").trim();
    const body = tail ? `${row.bodyLine}\n${tail}`.trim() : row.bodyLine;
    return { title: row.title, body };
  });

  const intro = lines.slice(0, matched[0].lineIndex).join("\n").trim();

  return { intro, items };
}

export function MarkdownishBoldLine({
  line,
  className,
  boldClassName,
  style,
}: {
  line: string;
  className?: string;
  boldClassName?: string;
  style?: StyleProp<TextStyle>;
}) {
  const parts = useMemo(() => splitBoldParts(line), [line]);

  return (
    <Text className={className} style={style}>
      {parts.map((p, i) => (
        <Text key={`${i}-${p.text}`} className={p.bold ? boldClassName : undefined}>
          {p.text}
        </Text>
      ))}
    </Text>
  );
}

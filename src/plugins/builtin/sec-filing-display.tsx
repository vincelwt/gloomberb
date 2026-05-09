import { Box, Text } from "../../ui";
import { colors } from "../../theme/colors";
import { formatCompact, formatCurrency } from "../../utils/format";
import { transactionTypeLabel, type InsiderTransaction } from "./insider/insider-data";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function formatFilingShortDate(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return "—";
  return `${MONTH_NAMES[date.getMonth()]} ${String(date.getDate()).padStart(2, " ")} ${date.getFullYear()}`;
}

export function formatFilingMetaDate(value: Date): string {
  return value.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatFilingFormLabel(form: string, fallback = "FORM 4"): string {
  const value = form.trim();
  return value ? `FORM ${value}` : fallback;
}

export function renderFilingNotice(message: string, width: number) {
  const lines = wrapNoticeLines(message, width - 4);
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {lines.map((line, index) => (
        <Box key={index} height={1}>
          <Text fg={colors.textDim}>{line}</Text>
        </Box>
      ))}
    </Box>
  );
}

export function buildInsiderTransactionTitle(transaction: InsiderTransaction): string {
  const type = transactionTypeLabel(transaction.transactionType);
  const price = transaction.pricePerShare != null
    ? ` @ ${formatCurrency(transaction.pricePerShare)}`
    : "";
  const value = transaction.totalValue != null
    ? ` | ${formatCurrency(transaction.totalValue)}`
    : "";
  return `${type} ${formatCompact(transaction.shares)} shares${price}${value}`;
}

export function buildInsiderTransactionDetailBody(transaction: InsiderTransaction): string {
  const lines = [
    `Transaction: ${transactionTypeLabel(transaction.transactionType)}`,
    `Date: ${formatFilingShortDate(transaction.filingDate)}`,
    `Shares: ${formatCompact(transaction.shares)}`,
    `Price/Share: ${transaction.pricePerShare != null ? formatCurrency(transaction.pricePerShare) : "—"}`,
    `Total Value: ${transaction.totalValue != null ? formatCurrency(transaction.totalValue) : "—"}`,
    `Shares Owned After: ${transaction.sharesOwned != null ? formatCompact(transaction.sharesOwned) : "—"}`,
  ];
  return lines.join("\n");
}

function wrapNoticeLines(text: string, width: number): string[] {
  const maxWidth = Math.max(width, 12);
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= maxWidth) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

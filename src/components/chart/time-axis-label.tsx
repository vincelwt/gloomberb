import { useMemo } from "react";
import { Span, Text } from "../../ui";
import { colors } from "../../theme/colors";
import { buildCursorTimeAxisSegments } from "./chart-renderer";

interface TimeAxisLabelProps {
  timeLabels: string;
  width: number;
  cursorColumn: number | null;
  cursorDate: Date | string | number | null;
  dates: Array<Date | string | number>;
  cursorColor: string;
}

export function TimeAxisLabel({
  timeLabels,
  width,
  cursorColumn,
  cursorDate,
  dates,
  cursorColor,
}: TimeAxisLabelProps) {
  const segments = useMemo(() => buildCursorTimeAxisSegments({
    timeLabels,
    width,
    cursorColumn,
    cursorDate,
    dates,
  }), [cursorColumn, cursorDate, dates, timeLabels, width]);

  return (
    <Text style={{ whiteSpace: "pre" }}>
      {segments.map((segment, index) => (
        <Span
          key={index}
          fg={segment.highlighted ? cursorColor : colors.textDim}
        >
          {segment.text}
        </Span>
      ))}
    </Text>
  );
}

import { Box, Text } from "../../../ui";
import { TextAttributes } from "../../../ui";
import { colors } from "../../../theme/colors";
import { formatNumber, padTo } from "../../../utils/format";
import { formatPredictionProbability } from "../metrics";
import type {
  PredictionBookLevel,
  PredictionMarketDetail,
  PredictionOrderPreviewIntent,
} from "../types";

function BookTable({
  title,
  levels,
  onSelect,
}: {
  title: string;
  levels: PredictionBookLevel[];
  onSelect: (level: PredictionBookLevel) => void;
}) {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box height={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
          {title}
        </Text>
      </Box>
      <Box height={1}>
        <Text fg={colors.textDim}>
          {padTo("PRICE", 8)} {padTo("SIZE", 10)}
        </Text>
      </Box>
      {levels.slice(0, 10).map((level) => (
        <Box
          key={`${title}:${level.price}:${level.size}`}
          height={1}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(level);
          }}
        >
          <Text fg={colors.text}>
            {`${padTo(formatPredictionProbability(level.price), 8)} ${padTo(formatNumber(level.size, 0), 10, "right")}`}
          </Text>
        </Box>
      ))}
      {levels.length === 0 && <Text fg={colors.textDim}>No levels.</Text>}
    </Box>
  );
}

export function PredictionMarketBookView({
  detail,
  onPreviewOrder,
}: {
  detail: PredictionMarketDetail;
  onPreviewOrder: (intent: PredictionOrderPreviewIntent) => void;
}) {
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={2}>
        <BookTable
          title="YES Bids"
          levels={detail.book.yesBids}
          onSelect={(level) =>
            onPreviewOrder({
              marketKey: detail.summary.key,
              outcome: "yes",
              side: "buy",
              price: level.price,
              size: level.size,
            })
          }
        />
        <BookTable
          title="YES Asks"
          levels={detail.book.yesAsks}
          onSelect={(level) =>
            onPreviewOrder({
              marketKey: detail.summary.key,
              outcome: "yes",
              side: "sell",
              price: level.price,
              size: level.size,
            })
          }
        />
      </Box>
      <Box flexDirection="row" gap={2}>
        <BookTable
          title="NO Bids"
          levels={detail.book.noBids}
          onSelect={(level) =>
            onPreviewOrder({
              marketKey: detail.summary.key,
              outcome: "no",
              side: "buy",
              price: level.price,
              size: level.size,
            })
          }
        />
        <BookTable
          title="NO Asks"
          levels={detail.book.noAsks}
          onSelect={(level) =>
            onPreviewOrder({
              marketKey: detail.summary.key,
              outcome: "no",
              side: "sell",
              price: level.price,
              size: level.size,
            })
          }
        />
      </Box>
    </Box>
  );
}

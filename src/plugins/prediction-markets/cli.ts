import { Input } from "../../ui";
import type { CliCommandDef } from "../../types/plugin";
import { createPredictionLaunchRequest, parsePredictionCommandArgs } from "./launch";

export const predictionMarketsCliCommand: CliCommandDef = {
  name: "predictions",
  aliases: ["prediction-markets", "pm"],
  description: "Launch the UI with Prediction Markets focused",
  help: {
    usage: ["predictions [...]"],
    sections: [{
      title: "Prediction Launch",
      columns: [
        { header: "Input" },
        { header: "Example" },
      ],
      rows: [
        ["gloomberb predictions [venue] [category] [browse-tab] [search...]", "gloomberb predictions world"],
        ["venue", "all | polymarket | kalshi"],
        ["category", "all | politics | world | macro | crypto | science | sports | entertainment | climate | social"],
        ["browse-tab", "top | ending | new | watchlist"],
      ],
    }],
  },
  execute: async (args) => ({
    kind: "launch-ui",
    request: createPredictionLaunchRequest(parsePredictionCommandArgs(args)),
  }),
};

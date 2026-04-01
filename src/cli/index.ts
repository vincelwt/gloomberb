import { VERSION } from "../version";
import {
  cliStyles,
  renderSection,
  renderTable,
} from "../utils/cli-output";
import { fail } from "./errors";
import { portfolio } from "./commands/portfolio";
import { watchlist } from "./commands/watchlist";
import { search, searchCandidatesForCli, buildSearchReport } from "./commands/search";
import { ticker, buildTickerReport } from "./commands/ticker";
import {
  installPlugin,
  listPlugins,
  removePlugin,
  updatePlugins,
} from "./commands/plugins";

function help() {
  console.log(`${cliStyles.bold(`gloomberb v${VERSION}`)}\n${cliStyles.muted("Bloomberg-style portfolio tracker for the terminal")}`);
  console.log("");
  console.log(renderSection("Usage"));
  console.log("gloomberb [command]");
  console.log("");
  console.log(renderSection("Commands"));
  console.log(renderTable(
    [
      { header: "Command" },
      { header: "Description" },
    ],
    [
      ["(no command)", "Launch the terminal UI"],
      ["help", "Show this help message"],
      ["portfolio [name]", "List collections or show a portfolio/watchlist"],
      ["watchlist [action]", "List, create, delete, add, or remove watchlists"],
      ["search <query>", "Search tickers and company names"],
      ["ticker <symbol>", "Show quote, ownership, and detailed financials"],
      ["install <user/repo>", "Install a plugin from GitHub"],
      ["remove <name>", "Remove an installed plugin"],
      ["update [name]", "Update plugins"],
      ["plugins", "List installed plugins"],
    ],
  ));
  console.log("");
  console.log(renderSection("Watchlist Actions"));
  console.log(renderTable(
    [
      { header: "Action" },
      { header: "Example" },
    ],
    [
      ["list", "gloomberb watchlist list"],
      ["show", "gloomberb watchlist show Growth"],
      ["create", "gloomberb watchlist create Growth"],
      ["delete", "gloomberb watchlist delete Growth"],
      ["add", "gloomberb watchlist add Growth NVDA"],
      ["remove", "gloomberb watchlist remove Growth NVDA"],
    ],
  ));
}

export { buildSearchReport, buildTickerReport, searchCandidatesForCli };

export async function runCli(args: string[]): Promise<boolean> {
  const command = args[0];

  switch (command) {
    case "help":
    case "--help":
    case "-h": {
      help();
      return true;
    }
    case "portfolio": {
      await portfolio(args.slice(1).join(" ") || undefined);
      return true;
    }
    case "watchlist":
    case "watchlists": {
      await watchlist(args.slice(1));
      return true;
    }
    case "search": {
      const query = args.slice(1).join(" ");
      if (!query) {
        fail("Usage: gloomberb search <query>");
      }
      await search(query);
      return true;
    }
    case "ticker": {
      const symbol = args[1];
      if (!symbol) {
        fail("Usage: gloomberb ticker <symbol>");
      }
      await ticker(symbol);
      return true;
    }
    case "install": {
      const ref = args[1];
      if (!ref) {
        fail("Usage: gloomberb install <github-user/repo>");
      }
      await installPlugin(ref);
      return true;
    }
    case "remove":
    case "uninstall": {
      const name = args[1];
      if (!name) {
        fail("Usage: gloomberb remove <plugin-name>");
      }
      await removePlugin(name);
      return true;
    }
    case "update": {
      await updatePlugins(args[1]);
      return true;
    }
    case "plugins":
    case "list": {
      listPlugins();
      return true;
    }
    default:
      return false;
  }
}

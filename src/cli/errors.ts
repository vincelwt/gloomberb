import { cliStyles } from "../utils/cli-output";
import type { AppPersistence } from "../data/app-persistence";

export function fail(message: string, details?: string): never {
  console.error(cliStyles.danger(message));
  if (details) console.error(cliStyles.muted(details));
  process.exit(1);
}

export function closeAndFail(persistence: AppPersistence, message: string, details?: string): never {
  persistence.close();
  fail(message, details);
}

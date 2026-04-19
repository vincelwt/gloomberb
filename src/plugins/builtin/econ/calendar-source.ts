import { apiClient, type CloudEconEventPayload } from "../../../utils/api-client";
import type { EconEvent } from "./types";

function toEconEvent(event: CloudEconEventPayload): EconEvent {
  return {
    ...event,
    date: new Date(event.date),
  };
}

export async function fetchEconCalendar(): Promise<EconEvent[]> {
  const events = await apiClient.getCloudEconomicCalendar();
  return events.map(toEconEvent);
}

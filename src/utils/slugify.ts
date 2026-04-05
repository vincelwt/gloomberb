export function slugifyName(name: string, fallbackPrefix: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `${fallbackPrefix}-${Date.now()}`;
}

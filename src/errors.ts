const STATUS_HINTS: Record<number, string> = {
  400: "Validation error: check the parameters.",
  401: "Authentication failed: credentials, API key or token are invalid or expired.",
  403: "Forbidden: the API app lacks permission for this resource or issuer.",
  404: "Not found: check the issuer, security, distribution or report ID.",
  429: "Rate limited: slow down and retry later.",
  500: "Automic internal error: retry, and contact the Automic API team if it persists.",
};

export class AutomicApiError extends Error {
  constructor(
    readonly status: number,
    readonly operation: string,
    readonly detail?: string,
  ) {
    const hint = STATUS_HINTS[status] ?? "Unexpected response.";
    super(`Automic API ${operation} failed (HTTP ${status}). ${hint}${detail ? ` Detail: ${detail}` : ""}`);
    this.name = "AutomicApiError";
  }
}

export function parseErrorBody(text: string): string | undefined {
  if (!text) return undefined;
  try {
    const json = JSON.parse(text);
    const msg = json.message ?? json.error ?? json.errorMessage ?? json.detail;
    if (typeof msg === "string") return msg.slice(0, 500);
  } catch {
    // not JSON
  }
  return text.slice(0, 200);
}

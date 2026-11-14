// The `error` field of a failed supabase.functions.invoke call, when the function
// answered JSON with one, else the error message or the fallback.
export async function edgeFunctionError(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      if (body && typeof body.error === "string") return body.error;
    } catch {
      // not JSON
    }
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

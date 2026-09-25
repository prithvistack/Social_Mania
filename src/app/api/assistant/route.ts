import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { AssistantNotConfiguredError, askAssistant, type ChatTurn } from "@/lib/assistant";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const question = String(body?.question ?? "").trim().slice(0, 1000);
  if (!question) return NextResponse.json({ error: "Ask something first" }, { status: 400 });

  const history: ChatTurn[] = Array.isArray(body?.history)
    ? body.history
        .slice(-6)
        .filter((t: any) => t?.role === "user" || t?.role === "assistant")
        .map((t: any) => ({ role: t.role, content: String(t.content ?? "").slice(0, 2000) }))
    : [];

  try {
    return NextResponse.json(await askAssistant(ctx, question, history));
  } catch (err) {
    if (err instanceof AssistantNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

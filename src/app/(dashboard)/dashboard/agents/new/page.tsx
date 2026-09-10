import Link from "next/link";
import { AgentForm } from "@/components/agents/agent-form";
import { createAgentAction } from "@/lib/agents/actions";

export default function NewAgentPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/dashboard/agents"
          className="text-sm text-muted hover:text-foreground"
        >
          ← Agents
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Register an agent
        </h1>
      </div>
      <div className="max-w-xl">
        <AgentForm action={createAgentAction} submitLabel="Register agent" />
      </div>
    </div>
  );
}

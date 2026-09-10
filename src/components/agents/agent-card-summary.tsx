import type { AgentCardDocument } from "@/lib/validation/agent-card";

const MODALITY_LABEL: Record<string, string> = {
  text: "Text",
  json: "JSON",
  audio: "Audio",
  image: "Image",
  video: "Video",
  file: "File",
};

const INTERACTION_TYPE_LABEL: Record<string, string> = {
  "request-response": "Request/response",
  streaming: "Streaming",
  async: "Async",
};

/** Shared by the owner's agent detail page and the public agent profile — the Agent Card is the same document either way. */
export function AgentCardSummary({ card }: { card: AgentCardDocument }) {
  const hasExtras =
    card.interfaces.modalities.length > 0 ||
    card.interfaces.interactionType !== null ||
    card.documentationUrl !== null;

  if (!hasExtras) {
    return (
      <p className="text-sm text-muted">
        No additional Agent Card metadata set.
      </p>
    );
  }

  return (
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
      {card.interfaces.modalities.length > 0 && (
        <div>
          <dt className="text-xs text-muted">Modalities</dt>
          <dd className="mt-0.5">
            {card.interfaces.modalities
              .map((m) => MODALITY_LABEL[m] ?? m)
              .join(", ")}
          </dd>
        </div>
      )}
      {card.interfaces.interactionType && (
        <div>
          <dt className="text-xs text-muted">Interaction type</dt>
          <dd className="mt-0.5">
            {INTERACTION_TYPE_LABEL[card.interfaces.interactionType] ??
              card.interfaces.interactionType}
          </dd>
        </div>
      )}
      {card.documentationUrl && (
        <div>
          <dt className="text-xs text-muted">Documentation</dt>
          <dd className="mt-0.5">
            <a
              href={card.documentationUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-accent hover:underline"
            >
              View docs →
            </a>
          </dd>
        </div>
      )}
    </dl>
  );
}

export function CapabilityTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return <span className="text-sm text-muted">No capabilities listed.</span>;
  }

  return (
    <ul className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <li
          key={tag}
          className="rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-xs text-muted"
        >
          {tag}
        </li>
      ))}
    </ul>
  );
}

export function Flash({ message, kind }: { message?: string; kind?: string }) {
  if (!message) return null;
  const error = kind === "error";
  return (
    <p
      role="status"
      className={[
        "rounded-[4px] px-4 py-3 text-[13.5px] leading-snug border",
        error
          ? "border-crimson-line bg-crimson-tint text-crimson-deep"
          : "border-line-soft bg-white text-ink-2",
      ].join(" ")}
    >
      {message}
    </p>
  );
}

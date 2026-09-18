export function Placeholder({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <main className="grow p-7">
      <div className="eyebrow">{eyebrow}</div>
      <h1 className="display text-[34px] mt-1 mb-1">{title}</h1>
      <div className="card mt-5 p-8 max-w-[640px]">
        <p className="text-[14.5px] leading-relaxed text-muted">{body}</p>
      </div>
    </main>
  );
}

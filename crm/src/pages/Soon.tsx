export default function Soon({ title }: { title: string }) {
  return (
    <div>
      <h1>{title}</h1>
      <p className="muted">Раздел появится на одном из следующих этапов.</p>
    </div>
  );
}

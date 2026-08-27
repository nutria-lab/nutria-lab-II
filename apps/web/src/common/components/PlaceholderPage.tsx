type PlaceholderPageProps = {
  title: string;
};

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:px-8">
      <h1 className="font-serif text-2xl font-bold text-neutral-900">{title}</h1>
      <p className="mt-2 text-sm text-neutral-500">Próximamente.</p>
    </main>
  );
}

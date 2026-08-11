export function SiteFooter() {
  return (
    <footer className="border-border/60 border-t">
      <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 py-6 text-xs sm:flex-row sm:justify-between sm:px-6">
        <p>&copy; {new Date().getFullYear()} Savepoint.</p>
        <p>Track, rate and discover the games you play.</p>
      </div>
    </footer>
  );
}

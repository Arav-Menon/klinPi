export default function Footer() {
  return (
    <footer className="border-t border-white/[0.04]">
      <div className="container flex flex-col items-center gap-2 py-6">
        <div className="flex items-center gap-2">
          <img src="./favicon.ico" alt="logo" className="h-16 w-16" />
          <span className="text-sm font-semibold tracking-tight text-white">
            klinpi
          </span>
        </div>
        <p className="text-xs text-white/20">
          &copy; {new Date().getFullYear()} Klinpi
        </p>
      </div>
    </footer>
  );
}

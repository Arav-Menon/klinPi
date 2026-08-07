const links = [
  { label: "GitHub", href: "https://github.com/Arav-Menon/klinPi" },
  { label: "Documentation", href: "#" },
  { label: "X", href: "#" },
  { label: "License", href: "#" },
];

export default function Footer() {
  return (
    <footer className="border-t border-white/[0.04]">
      <div className="container flex flex-col items-center gap-8 py-16">
        <div className="flex items-center gap-8">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target={link.href.startsWith("http") ? "_blank" : undefined}
              rel={
                link.href.startsWith("http") ? "noopener noreferrer" : undefined
              }
              className="text-sm text-[#8b8b8b] transition-colors duration-200 hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </div>
        <p className="text-xs text-white/20">Made for AI Engineers.</p>
      </div>
    </footer>
  );
}

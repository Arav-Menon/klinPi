import { type LucideIcon } from "lucide-react";

interface FeatureCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export default function FeatureCard({
  icon: Icon,
  title,
  description,
}: FeatureCardProps) {
  return (
    <div className="group flex flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 transition-all duration-300 hover:border-white/[0.1] hover:bg-white/[0.04]">
      <Icon
        size={22}
        strokeWidth={1.5}
        className="mb-5 text-[#8b8b8b] transition-colors duration-300 group-hover:text-white"
      />
      <h3 className="mb-2 text-base font-semibold text-white">{title}</h3>
      <p className="text-sm leading-relaxed text-[#8b8b8b]">{description}</p>
    </div>
  );
}

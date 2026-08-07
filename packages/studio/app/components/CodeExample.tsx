"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy } from "lucide-react";

const code = `const klinpi = new Klinpi({
  apiKey: process.env.KLINPI_API_KEY,
})

await klinpi.chat({
  message: "Fix auth.ts line 38",
  model: "auto",
})`;

export default function CodeExample() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.7 }}
      className="mx-auto mt-16 w-full max-w-[960px]"
    >
      <div className="rounded-2xl border border-white/[0.06] bg-[#0a0a0a] p-8 md:p-12">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-white/10" />
            <div className="h-3 w-3 rounded-full bg-white/10" />
            <div className="h-3 w-3 rounded-full bg-white/10" />
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-xs text-[#8b8b8b] transition-colors duration-200 hover:border-white/[0.1] hover:text-white"
          >
            {copied ? (
              <>
                <Check size={12} />
                Copied
              </>
            ) : (
              <>
                <Copy size={12} />
                Copy
              </>
            )}
          </button>
        </div>
        <pre className="overflow-x-auto font-mono text-[15px] leading-[1.7]">
          <code className="text-white/90">
            {code.split("\n").map((line, i) => (
              <div key={i}>
                {line || "\u00A0"}
              </div>
            ))}
          </code>
        </pre>
      </div>
    </motion.div>
  );
}

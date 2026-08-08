"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signin } from "../../lib/api";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await signin(email, password);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signin failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex justify-center items-center min-h-[calc(100vh-4rem)]">
      <div className="w-full max-w-md p-8">
        <h1 className="text-2xl font-bold text-white mb-6 text-center">Sign In</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-[#8b8b8b] mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-[#8b8b8b] focus:outline-none focus:border-purple-500"
              placeholder="Enter your email"
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-[#8b8b8b] mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-[#8b8b8b] focus:outline-none focus:border-purple-500"
              placeholder="Enter your password"
              required
            />
          </div>
          {error && (
            <p className="text-red-500 text-sm">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-purple-700 text-white rounded-lg font-medium py-3 cursor-pointer hover:bg-purple-600 transition-colors disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-[#8b8b8b]">
          Don&apos;t have an account?{" "}
          <a href="/signup" className="text-purple-400 hover:text-purple-300">
            Sign up
          </a>
        </p>
      </div>
    </div>
  );
}

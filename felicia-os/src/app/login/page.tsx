import { LoginForm } from "@/components/admin/LoginForm";

export const metadata = { title: "Sign in — Felicia Command Center", robots: { index: false } };

export default function Page() {
  return (
    <main className="starfield flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-lavender-deep">Private</p>
        <h1 className="mt-1 text-3xl">Felicia Command Center</h1>
        <LoginForm />
      </div>
    </main>
  );
}

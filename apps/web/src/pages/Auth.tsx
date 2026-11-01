import { FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Loader2, Moon, Sun } from "lucide-react";
import { useApplyTheme, useTheme } from "@/lib/theme";
import { toast } from "sonner";
import { api, useMe, type User } from "@/lib/api";
import { startDemo } from "@/lib/demo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Auth({ mode }: { mode: "login" | "signup" }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const signup = mode === "signup";

  useApplyTheme();
  const theme = useTheme();

  if (me.data && !me.data.isGuest) return <Navigate to="/app" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ user: User }>("POST", signup ? "/auth/signup" : "/auth/login", form);
      qc.setQueryData(["me"], r.user);
      qc.invalidateQueries({ queryKey: ["projects"] });
      navigate("/app");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const guest = async () => {
    setBusy(true);
    try {
      navigate(await startDemo(qc));
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="relative grid min-h-screen place-items-center bg-background p-4">
      <Button variant="ghost" size="icon" className="absolute right-4 top-4" onClick={theme.toggle} aria-label={theme.light ? "Switch to dark mode" : "Switch to light mode"}>
        {theme.light ? <Moon className="size-4" /> : <Sun className="size-4" />}
      </Button>
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2 text-sm font-semibold">
          <FileSpreadsheet className="size-4 text-verified" /> WorkbookRescue
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>{signup ? "Create your account" : "Welcome back"}</CardTitle>
            <CardDescription>{signup ? "Your workspace is private to you." : "Sign in to your workspace."}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              {signup && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" required minLength={8} autoComplete={signup ? "new-password" : "current-password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                {signup && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />} {signup ? "Create account" : "Sign in"}
              </Button>
            </form>
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <Link className="underline underline-offset-4" to={signup ? "/login" : "/signup"}>
                {signup ? "I have an account" : "Create an account"}
              </Link>
              <button className="underline underline-offset-4" onClick={guest} disabled={busy}>
                Try the walkthrough
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

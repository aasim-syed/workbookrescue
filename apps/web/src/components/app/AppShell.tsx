import { ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, LogOut, FileSpreadsheet, Moon, Sun } from "lucide-react";
import { api, useMe } from "@/lib/api";
import { useApplyTheme, useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";

export default function AppShell({ crumb, children }: { crumb?: string; children: ReactNode }) {
  useApplyTheme();
  const theme = useTheme();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();

  if (me.isLoading) return <Skeleton className="m-6 h-10 w-64" />;
  if (!me.data) return <Navigate to="/login" replace />;
  const user = me.data;

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2 text-sm">
          <Link to="/app" className="flex items-center gap-2 font-semibold">
            <FileSpreadsheet className="size-4 text-verified" />
            WorkbookRescue
          </Link>
          {crumb && (
            <>
              <ChevronRight className="size-3.5 text-muted-foreground" />
              <span className="max-w-[40vw] truncate text-muted-foreground">{crumb}</span>
            </>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <span className="grid size-6 place-items-center rounded-full bg-secondary text-xs font-medium">{user.name[0]?.toUpperCase()}</span>
              <span className="hidden sm:inline">{user.isGuest ? "Guest" : user.name}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="text-sm font-medium">{user.name}</div>
              <div className="truncate text-xs text-muted-foreground">{user.isGuest ? "Sandbox workspace, no email" : user.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {user.isGuest && (
              <DropdownMenuItem onClick={() => navigate("/signup")}>Create an account</DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={theme.toggle}>
              {theme.light ? <Moon className="size-4" /> : <Sun className="size-4" />} {theme.light ? "Dark mode" : "Light mode"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                await api("POST", "/auth/logout");
                qc.clear();
                navigate("/");
              }}
            >
              <LogOut className="size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

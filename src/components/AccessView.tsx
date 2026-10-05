/**
 * Dashboard access (admin): who can sign in, with which role. Adding a user or
 * resetting a password yields a one-time password, shown once, which the user
 * must replace at first sign-in.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, KeyRound, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryState } from "@/components/ui/query-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useConfirm } from "@/components/ui/use-confirm";
import { errorMessage, useCampFormat } from "@/components/camp/camp-ui";
import { useTranslation } from "@/i18n/use-translation";
import type { MessageKey } from "@/i18n";
import { ROLES, type Role } from "@/lib/auth/guards";
import {
  createAppUser,
  listAppUsers,
  resetAppUserPassword,
  updateAppUser,
  type AppUserRow,
} from "@/lib/users.functions";

const USERS_KEY = ["app-users"] as const;

export function AccessView() {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  const { user: me } = useRouteContext({ from: "/_app" });
  const queryClient = useQueryClient();
  const list = useServerFn(listAppUsers);
  const update = useServerFn(updateAppUser);
  const reset = useServerFn(resetAppUserPassword);
  const { confirm, confirmDialog } = useConfirm();
  const [adding, setAdding] = useState(false);
  const [oneTime, setOneTime] = useState<{ email: string; password: string } | null>(null);

  const users = useQuery({ queryKey: USERS_KEY, queryFn: () => list() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: USERS_KEY });

  const updateMutation = useMutation({
    mutationFn: (v: { id: string; role?: Role; active?: boolean }) => update({ data: v }),
    onSuccess: async () => {
      toast.success(t("users.updated"));
      await refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const resetMutation = useMutation({
    mutationFn: (row: AppUserRow) => reset({ data: { id: row.id } }),
    onSuccess: async (result, row) => {
      setOneTime({ email: row.email, password: result.password });
      await refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const rows = users.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{t("users.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("users.subtitle")}</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <UserPlus className="me-2 h-4 w-4" aria-hidden />
          {t("users.add")}
        </Button>
      </div>

      <ul className="grid gap-2 text-sm sm:grid-cols-3">
        {ROLES.map((role) => (
          <li key={role} className="rounded-lg border bg-card p-3">
            <p className="font-bold">{t(`role.${role}` as MessageKey)}</p>
            <p className="mt-1 text-muted-foreground">
              {t(`users.roleHelp.${role}` as MessageKey)}
            </p>
          </li>
        ))}
      </ul>

      <QueryState
        isPending={users.isPending}
        isError={users.isError}
        error={users.error}
        onRetry={() => void users.refetch()}
        isEmpty={!rows.length}
      >
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("users.name")}</TableHead>
                <TableHead>{t("users.email")}</TableHead>
                <TableHead>{t("users.role")}</TableHead>
                <TableHead>{t("users.status")}</TableHead>
                <TableHead>{t("users.lastLogin")}</TableHead>
                <TableHead className="text-end">{t("users.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const isMe = row.id === me.id;
                return (
                  <TableRow key={row.id} className={row.active ? undefined : "opacity-60"}>
                    <TableCell className="font-medium">
                      {row.name}
                      {isMe ? (
                        <Badge variant="secondary" className="ms-2">
                          {t("users.you")}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell dir="ltr" className="text-start">
                      {row.email}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={row.role}
                        disabled={isMe || updateMutation.isPending}
                        onValueChange={(role) =>
                          updateMutation.mutate({ id: row.id, role: role as Role })
                        }
                      >
                        <SelectTrigger className="h-8 w-32" aria-label={t("users.role")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {t(`role.${role}` as MessageKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span>{row.active ? t("users.active") : t("users.inactive")}</span>
                        {row.active && row.mustChangePassword ? (
                          <span className="text-xs text-muted-foreground">
                            {t("users.pendingPassword")}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {row.lastLoginAt ? fmt.dateTime(row.lastLoginAt) : t("users.never")}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={resetMutation.isPending}
                          onClick={async () => {
                            const ok = await confirm({
                              title: t("users.resetPassword"),
                              description: t("users.confirmReset", { name: row.name || row.email }),
                              confirmLabel: t("users.resetPassword"),
                            });
                            if (ok) resetMutation.mutate(row);
                          }}
                        >
                          <KeyRound className="me-1 h-3.5 w-3.5" aria-hidden />
                          {t("users.resetPassword")}
                        </Button>
                        {!isMe ? (
                          <Button
                            size="sm"
                            variant={row.active ? "outline" : "secondary"}
                            disabled={updateMutation.isPending}
                            onClick={async () => {
                              if (row.active) {
                                const ok = await confirm({
                                  title: t("users.disable"),
                                  description: t("users.confirmDisable", {
                                    name: row.name || row.email,
                                  }),
                                  confirmLabel: t("users.disable"),
                                  destructive: true,
                                });
                                if (!ok) return;
                              }
                              updateMutation.mutate({ id: row.id, active: !row.active });
                            }}
                          >
                            {row.active ? t("users.disable") : t("users.enable")}
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </QueryState>

      {adding ? (
        <AddUserDialog
          onClose={() => setAdding(false)}
          onCreated={async (email, password) => {
            setAdding(false);
            setOneTime({ email, password });
            toast.success(t("users.created"));
            await refresh();
          }}
        />
      ) : null}
      {oneTime ? <OneTimePasswordDialog {...oneTime} onClose={() => setOneTime(null)} /> : null}
      {confirmDialog}
    </div>
  );
}

function AddUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (email: string, password: string) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const create = useServerFn(createAppUser);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await create({ data: { name, email, role } });
      await onCreated(email.trim().toLowerCase(), result.password);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("users.addTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-name">{t("users.name")}</Label>
            <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-email">{t("users.email")}</Label>
            <Input
              id="new-email"
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-role">{t("users.role")}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger id="new-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`role.${r}` as MessageKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t(`users.roleHelp.${role}` as MessageKey)}
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim() || !email.includes("@")}>
            {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            {t("users.addSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OneTimePasswordDialog({
  email,
  password,
  onClose,
}: {
  email: string;
  password: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("users.oneTimeTitle")}</DialogTitle>
          <DialogDescription>{t("users.oneTimeBody", { email })}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <code
            dir="ltr"
            className="flex-1 rounded-md border bg-muted px-3 py-2 text-center font-mono text-lg tracking-wider select-all"
          >
            {password}
          </code>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(password);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? (
              <Check className="me-1 h-4 w-4" aria-hidden />
            ) : (
              <Copy className="me-1 h-4 w-4" aria-hidden />
            )}
            {copied ? t("users.copied") : t("users.copy")}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t("users.done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

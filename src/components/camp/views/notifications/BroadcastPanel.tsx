/**
 * إرسال فوري — an office-wide gong, announcement or channel post, now (admin).
 * Gong and announcement pop up for everyone in the office, so every send is
 * confirmed first. Manual sends do not depend on the automatic-sending switch.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bell, Hash, Loader2, Megaphone, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useConfirm } from "@/components/ui/use-confirm";
import { useTranslation } from "@/i18n/use-translation";
import type { MessageKey } from "@/i18n";
import { broadcastCampNow } from "@/lib/camp-admin.functions";
import { CHANNEL_LIMITS } from "@/lib/camp/cues";
import { errorMessage, useInvalidateCamp } from "../../camp-ui";
import { CharCount, TestSendButton, TextProblems } from "./shared";
import { CHANNEL_KEY, textBlocked, textLength } from "./lib";

type BroadcastChannel = "gong" | "announcement" | "channel";

const CHANNELS: { id: BroadcastChannel; icon: typeof Bell }[] = [
  { id: "gong", icon: Bell },
  { id: "announcement", icon: Megaphone },
  { id: "channel", icon: Hash },
];

/** The server takes at most 4,000 characters; popups take 100 (FR-NOT-02). */
const limitOf = (channel: BroadcastChannel) => Math.min(CHANNEL_LIMITS[channel], 4000);

const CONFIRM_KEY: Record<BroadcastChannel, MessageKey> = {
  gong: "camp.notif.bc.confirm.gong",
  announcement: "camp.notif.bc.confirm.announcement",
  channel: "camp.notif.bc.confirm.channel",
};

export function BroadcastPanel({ myAccount }: { myAccount: string | null }) {
  const { t } = useTranslation();
  const invalidate = useInvalidateCamp();
  const { confirm, confirmDialog } = useConfirm();
  const [channel, setChannel] = useState<BroadcastChannel>("gong");
  const [text, setText] = useState("");
  const fn = useServerFn(broadcastCampNow);
  const send = useMutation({
    mutationFn: () => fn({ data: { channel, text: text.trim() } }),
    onSuccess: async (res) => {
      if (res.status === "sent") {
        toast.success(t("camp.notif.bc.sent"));
        setText("");
      } else {
        toast.error(
          t("camp.notif.bc.failed", {
            error: res.error ?? t(`camp.sendStatus.${res.status}` as MessageKey),
          }),
        );
      }
      await invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const limit = limitOf(channel);
  // Nothing fills fields in a manual send: a {field} would be refused.
  const blocked = textBlocked(text, limit, []);

  return (
    <section className="max-w-2xl space-y-4 rounded-lg border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">{t("camp.notif.bc.title")}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("camp.notif.bc.hint")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("camp.notif.bc.manualNote")}</p>
      </div>

      <div className="space-y-1.5">
        <Label>{t("camp.notif.log.col.channel")}</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          value={channel}
          onValueChange={(v) => (v ? setChannel(v as BroadcastChannel) : null)}
          className="flex-wrap justify-start"
        >
          {CHANNELS.map(({ id, icon: Icon }) => (
            <ToggleGroupItem key={id} value={id} className="gap-1.5 px-3">
              <Icon className="h-4 w-4" aria-hidden />
              {t(CHANNEL_KEY[id])}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="camp-broadcast">{t("camp.notif.text")}</Label>
          <CharCount count={textLength(text)} limit={limit} />
        </div>
        <Textarea
          id="camp-broadcast"
          dir="auto"
          rows={channel === "channel" ? 5 : 2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={!!text && blocked}
        />
        <TextProblems text={text} limit={limit} allowed={[]} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <TestSendButton text={text} myAccount={myAccount} disabled={blocked} />
        <Button
          disabled={blocked || send.isPending}
          onClick={async () => {
            const ok = await confirm({
              title: t("camp.notif.bc.confirmTitle"),
              description: t(CONFIRM_KEY[channel]),
              confirmLabel: t("camp.btn.confirmSend"),
              cancelLabel: t("camp.btn.cancel"),
            });
            if (ok) send.mutate();
          }}
        >
          {send.isPending ? (
            <Loader2 className="me-1 h-4 w-4 animate-spin" />
          ) : (
            <Send className="me-1 h-4 w-4" />
          )}
          {t("camp.btn.confirmSend")}
        </Button>
      </div>
      {confirmDialog}
    </section>
  );
}

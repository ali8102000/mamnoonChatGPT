import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { MobileShell } from "@/components/mobile-shell";
import { MessageCircle } from "lucide-react";

export const Route = createFileRoute("/messages")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "الرسائل | ممنون" },
      { name: "description", content: "تواصل مع الكابتن والفني بشأن طلباتك في ممنون." },
      { property: "og:title", content: "الرسائل | ممنون" },
      { property: "og:description", content: "تواصل مع الكابتن والفني بشأن طلباتك في ممنون." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MessagesPage,
});

function MessagesPage() {
  const { session, loading } = useAuth();
  const [chats, setChats] = useState<any[]>([]);

  const loadChats = useCallback(async () => {
    if (!session) return;
    const userId = session.user.id;
    const { data } = await supabase
      .from("chats")
      .select("id, request_id, customer_id, provider_id, created_at")
      .or(`customer_id.eq.${userId},provider_id.eq.${userId}`)
      .order("created_at", { ascending: false });
    if (!data) return;
    const otherIds = data
      .map((chat) => (chat.customer_id === userId ? chat.provider_id : chat.customer_id))
      .filter((id): id is string => !!id);
    const { data: profiles } =
      otherIds.length > 0
        ? await supabase.from("profiles").select("id, full_name, phone").in("id", otherIds)
        : { data: [] };
    const profilesById = new Map(profiles?.map((profile) => [profile.id, profile]) ?? []);
    setChats(
      data.map((chat) => ({
        ...chat,
        other: profilesById.get(chat.customer_id === userId ? chat.provider_id : chat.customer_id),
      })),
    );
  }, [session?.user.id]);

  useEffect(() => {
    if (!session) return;
    void loadChats();
    const channel = supabase
      .channel(`chats-${session.user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chats" }, () => {
        void loadChats();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [session?.user.id, loadChats]);

  if (loading) return null;
  if (!session) return <Navigate to="/auth" />;

  return (
    <MobileShell>
      <div className="px-5 pt-10">
        <h1 className="text-3xl font-black mb-6">الرسائل</h1>
        {chats.length === 0 && (
          <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">
            <MessageCircle className="h-10 w-10 mx-auto mb-3 opacity-50" />
            لا يوجد محادثات بعد
          </div>
        )}
        <div className="space-y-2">
          {chats.map((c) => (
            <Link
              key={c.id}
              to="/request/$id"
              params={{ id: c.request_id }}
              className="glass rounded-2xl p-4 flex items-center gap-3 btn-press"
            >
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary to-primary-glow grid place-items-center text-primary-foreground font-black">
                {(c.other?.full_name || "?").charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm truncate">{c.other?.full_name || "مستخدم"}</div>
                <div className="text-[11px] text-muted-foreground" dir="ltr">
                  {c.other?.phone}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </MobileShell>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { supabase, usernameToEmail } from "./lib/supabase";
import {
  decryptImageDataUrl,
  decryptText,
  encryptImageDataUrl,
  encryptText,
} from "./lib/crypto";

type AuthMode = "login" | "register";
type Step = "username" | "password" | "profile" | "welcome";

const usernamePattern = /^[a-zA-Z0-9._]{5,32}$/;
const passwordPattern = /^[a-zA-Z0-9!@#$%^&*._-]{6,64}$/;

type Profile = {
  id: string;
  username: string;
  display_name: string;
  last_seen: string;
  is_online: boolean;
  avatar_url?: string | null;
};

type UiMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  fromMe: boolean;
  text: string;
  image?: string;
  createdAt: number;
  status: "sent" | "delivered" | "read";
};

type BubblePos = "single" | "first" | "middle" | "last";

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLastSeen(iso: string, online: boolean) {
  if (online) return "в сети";
  const ts = new Date(iso).getTime();
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "был(а) только что";
  if (mins < 60) return `был(а) ${mins} мин. назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `был(а) ${hours} ч. назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "был(а) вчера";
  if (days < 7) return `был(а) ${days} дн. назад`;
  return `был(а) ${new Date(ts).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  })}`;
}

function formatDateLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Сегодня";
  if (d.toDateString() === yesterday.toDateString()) return "Вчера";
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

function getBubblePos(msgs: UiMessage[], index: number): BubblePos {
  const cur = msgs[index];
  const prev = msgs[index - 1];
  const next = msgs[index + 1];
  const samePrev =
    prev &&
    prev.fromMe === cur.fromMe &&
    cur.createdAt - prev.createdAt < 120000;
  const sameNext =
    next &&
    next.fromMe === cur.fromMe &&
    next.createdAt - cur.createdAt < 120000;
  if (!samePrev && !sameNext) return "single";
  if (!samePrev && sameNext) return "first";
  if (samePrev && sameNext) return "middle";
  return "last";
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckMarks({ status }: { status: UiMessage["status"] }) {
  const double = status === "read";
  return (
    <span className="msg-checks" aria-hidden>
      {double ? (
        <svg width="16" height="10" viewBox="0 0 16 10">
          <path d="M1 5.2l2.8 2.8L10.2 1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 5.2l2.8 2.8L14.2 1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="12" height="10" viewBox="0 0 12 10">
          <path d="M1 5.2l2.8 2.8L10.2 1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

export default function App() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [step, setStep] = useState<Step>("username");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [greetingName, setGreetingName] = useState("");
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(true);

  const [me, setMe] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [lastByPeer, setLastByPeer] = useState<
    Record<string, { text: string; ts: number }>
  >({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const dragStartX = useRef(0);
  const isDragging = useRef(false);

  const validUsername = useMemo(() => usernamePattern.test(username), [username]);
  const validPassword = useMemo(() => passwordPattern.test(password), [password]);

  // session restore
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session && !cancelled) {
        await loadMe(data.session.user.id);
        setStep("welcome");
      }
      if (!cancelled) setLoading(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) {
        setMe(null);
        setStep("username");
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function loadMe(userId: string) {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (data) {
      setMe(data as Profile);
      await supabase.rpc("set_online", { online: true });
      await loadProfiles();
    }
  }

  async function loadProfiles() {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .order("display_name");
    if (data) setProfiles(data as Profile[]);
  }

  // heartbeat + profiles realtime
  useEffect(() => {
    if (!me) return;
    const beat = setInterval(() => {
      supabase.rpc("set_online", { online: true });
    }, 25000);
    const ch = supabase
      .channel("profiles-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => loadProfiles(),
      )
      .subscribe();
    const onUnload = () => {
      supabase.rpc("set_online", { online: false });
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      clearInterval(beat);
      supabase.removeChannel(ch);
      window.removeEventListener("beforeunload", onUnload);
      supabase.rpc("set_online", { online: false });
    };
  }, [me?.id]);

  // messages realtime
  useEffect(() => {
    if (!conversationId || !me) return;
    const ch = supabase
      .channel(`msgs-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          const row = payload.new as {
            id: string;
            conversation_id: string;
            sender_id: string;
            ciphertext: string;
            iv: string;
            content_type: string;
            created_at: string;
          };
          const peer = profiles.find((p) => p.id === selectedPeerId);
          if (!peer || !me) return;
          let text = "";
          let image: string | undefined;
          if (row.content_type === "image") {
            image = await decryptImageDataUrl(
              row.ciphertext,
              row.iv,
              me.username,
              peer.username,
            );
          } else {
            text = await decryptText(
              row.ciphertext,
              row.iv,
              me.username,
              peer.username,
            );
          }
          const ui: UiMessage = {
            id: row.id,
            conversationId: row.conversation_id,
            senderId: row.sender_id,
            fromMe: row.sender_id === me.id,
            text,
            image,
            createdAt: new Date(row.created_at).getTime(),
            status: row.sender_id === me.id ? "sent" : "delivered",
          };
          setMessages((prev) =>
            prev.some((m) => m.id === ui.id) ? prev : [...prev, ui],
          );
          if (row.sender_id !== me.id) {
            await supabase.from("message_reads").upsert({
              message_id: row.id,
              user_id: me.id,
            });
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reads" },
        (payload) => {
          const row = payload.new as { message_id: string; user_id: string };
          if (row.user_id === me.id) return;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === row.message_id && m.fromMe
                ? { ...m, status: "read" as const }
                : m,
            ),
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [conversationId, me?.id, selectedPeerId, profiles]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, conversationId]);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setStep("username");
    setUsername("");
    setPassword("");
    setDisplayName("");
    setGreetingName("");
    setAuthError("");
  };

  const continueFromUsername = async () => {
    if (!validUsername) return;
    setAuthError("");
    // try find profile for greeting
    const { data } = await supabase
      .from("profiles")
      .select("display_name, username")
      .ilike("username", username)
      .maybeSingle();
    setGreetingName(data?.display_name || username);
    setStep("password");
  };

  const continueFromPassword = async () => {
    if (!validPassword) return;
    setAuthError("");
    if (mode === "register") {
      setStep("profile");
      return;
    }
    setLoading(true);
    const email = usernameToEmail(username);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setAuthError(error.message === "Invalid login credentials"
        ? "Неверный пароль или username"
        : error.message);
      setLoading(false);
      return;
    }
    if (data.user) {
      await loadMe(data.user.id);
      setStep("welcome");
    }
    setLoading(false);
  };

  const finishProfile = async () => {
    if (!displayName.trim()) return;
    setLoading(true);
    setAuthError("");
    const email = usernameToEmail(username);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          display_name: displayName.trim(),
        },
      },
    });
    if (error) {
      setAuthError(error.message);
      setLoading(false);
      return;
    }
    if (data.user) {
      // ensure profile row
      await supabase.from("profiles").upsert({
        id: data.user.id,
        username,
        display_name: displayName.trim(),
      });
      await loadMe(data.user.id);
      setStep("welcome");
    }
    setLoading(false);
  };

  const logout = async () => {
    await supabase.rpc("set_online", { online: false });
    await supabase.auth.signOut();
    setMe(null);
    setMessages([]);
    setSelectedPeerId(null);
    setConversationId(null);
    setMobileShowChat(false);
    setStep("username");
  };

  const openChat = async (peer: Profile) => {
    if (!me) return;
    setSelectedPeerId(peer.id);
    setMobileShowChat(true);
    setDraft("");
    setMessages([]);
    const { data: convId, error } = await supabase.rpc("get_or_create_dm", {
      other_user_id: peer.id,
    });
    if (error || !convId) {
      console.error(error);
      return;
    }
    setConversationId(convId as string);
    // load history
    const { data: rows } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (!rows) return;
    const ui: UiMessage[] = [];
    for (const row of rows) {
      let text = "";
      let image: string | undefined;
      if (row.content_type === "image") {
        image = await decryptImageDataUrl(
          row.ciphertext,
          row.iv,
          me.username,
          peer.username,
        );
      } else {
        text = await decryptText(
          row.ciphertext,
          row.iv,
          me.username,
          peer.username,
        );
      }
      // read status
      let status: UiMessage["status"] = "sent";
      if (row.sender_id === me.id) {
        const { data: reads } = await supabase
          .from("message_reads")
          .select("user_id")
          .eq("message_id", row.id)
          .neq("user_id", me.id);
        status = reads && reads.length > 0 ? "read" : "delivered";
      } else {
        status = "read";
        await supabase.from("message_reads").upsert({
          message_id: row.id,
          user_id: me.id,
        });
      }
      ui.push({
        id: row.id,
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        fromMe: row.sender_id === me.id,
        text,
        image,
        createdAt: new Date(row.created_at).getTime(),
        status,
      });
    }
    setMessages(ui);
    const last = ui[ui.length - 1];
    if (last) {
      setLastByPeer((p) => ({
        ...p,
        [peer.id]: {
          text: last.image ? "Фото" : last.text,
          ts: last.createdAt,
        },
      }));
    }
  };

  const closeChat = () => {
    setMobileShowChat(false);
    setSelectedPeerId(null);
    setConversationId(null);
    setMessages([]);
  };

  const sendMessage = useCallback(
    async (text?: string, imageDataUrl?: string) => {
      const body = (text ?? draft).trim();
      if ((!body && !imageDataUrl) || !me || !conversationId || !selectedPeerId)
        return;
      const peer = profiles.find((p) => p.id === selectedPeerId);
      if (!peer) return;

      const contentType = imageDataUrl ? "image" : "text";
      const plain = imageDataUrl || body;
      const enc = imageDataUrl
        ? await encryptImageDataUrl(plain, me.username, peer.username)
        : await encryptText(plain, me.username, peer.username);

      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_id: me.id,
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          content_type: contentType,
        })
        .select("*")
        .single();

      if (error || !data) {
        console.error(error);
        return;
      }

      const ui: UiMessage = {
        id: data.id,
        conversationId: data.conversation_id,
        senderId: me.id,
        fromMe: true,
        text: imageDataUrl ? "" : body,
        image: imageDataUrl,
        createdAt: new Date(data.created_at).getTime(),
        status: "sent",
      };
      setMessages((prev) =>
        prev.some((m) => m.id === ui.id) ? prev : [...prev, ui],
      );
      setLastByPeer((p) => ({
        ...p,
        [peer.id]: {
          text: imageDataUrl ? "Фото" : body,
          ts: ui.createdAt,
        },
      }));
      if (!imageDataUrl) setDraft("");
      setTimeout(() => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === ui.id && m.status === "sent"
              ? { ...m, status: "delivered" as const }
              : m,
          ),
        );
      }, 300);
      inputRef.current?.focus();
    },
    [draft, me, conversationId, selectedPeerId, profiles],
  );

  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 1_500_000) {
      alert("Фото до ~1.5 МБ (шифруется на клиенте)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") sendMessage("", reader.result);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // swipe / drag to open or close
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) < 70 || Math.abs(dy) > 60) return;
    if (dx > 70 && mobileShowChat) closeChat();
  };

  const onPointerDownChat = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    isDragging.current = true;
    dragStartX.current = e.clientX;
  };
  const onPointerUpChat = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const dx = e.clientX - dragStartX.current;
    if (dx > 80 && mobileShowChat) closeChat();
  };

  const peers = useMemo(
    () => profiles.filter((p) => p.id !== me?.id),
    [profiles, me],
  );

  const filteredPeers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase().replace(/^@+/, "");
    if (!q) return peers;
    return peers.filter(
      (p) =>
        p.username.toLowerCase().includes(q) ||
        p.display_name.toLowerCase().includes(q),
    );
  }, [peers, searchQuery]);

  const sortedPeers = useMemo(() => {
    return [...filteredPeers].sort((a, b) => {
      const ta = lastByPeer[a.id]?.ts || 0;
      const tb = lastByPeer[b.id]?.ts || 0;
      return tb - ta;
    });
  }, [filteredPeers, lastByPeer]);

  const selectedPeer = peers.find((p) => p.id === selectedPeerId);
  const isSearching = isSearchFocused || searchQuery.trim().length > 0;
  const hasDraft = draft.trim().length > 0;

  const groupedMessages = useMemo(() => {
    const groups: { label: string; items: UiMessage[] }[] = [];
    let currentLabel = "";
    for (const m of messages) {
      const label = formatDateLabel(m.createdAt);
      if (label !== currentLabel) {
        currentLabel = label;
        groups.push({ label, items: [m] });
      } else {
        groups[groups.length - 1].items.push(m);
      }
    }
    return groups;
  }, [messages]);

  if (loading && step !== "welcome") {
    return (
      <main className="auth-page">
        <div className="brand">Share</div>
        <p style={{ color: "#666" }}>Загрузка…</p>
      </main>
    );
  }

  /* AUTH */
  if (step !== "welcome") {
    return (
      <main className="auth-page">
        <section className="auth-shell">
          <motion.div
            className="brand"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            Share
          </motion.div>
          <AnimatePresence mode="wait" initial={false}>
            {step === "username" && (
              <motion.div
                key="username"
                className="auth-stage"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -35 }}
              >
                <div className="mode-switch" role="tablist">
                  <motion.div
                    className="mode-pill"
                    animate={{ x: mode === "login" ? 0 : "100%" }}
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                  <button
                    className={`mode-button ${mode === "login" ? "active" : ""}`}
                    onClick={() => switchMode("login")}
                  >
                    Вход
                  </button>
                  <button
                    className={`mode-button ${mode === "register" ? "active" : ""}`}
                    onClick={() => switchMode("register")}
                  >
                    Регистрация
                  </button>
                </div>
                <div className="auth-form">
                  <h1>
                    {mode === "login"
                      ? "Введите свой username для входа"
                      : "Введите свой username для регистрации"}
                  </h1>
                  <label className="input-field">
                    <span>@</span>
                    <input
                      value={username}
                      onChange={(e) =>
                        setUsername(
                          e.target.value
                            .replace(/^@+/, "")
                            .replace(/[^a-zA-Z0-9._]/g, "")
                            .slice(0, 32),
                        )
                      }
                      placeholder="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      onKeyDown={(e) => e.key === "Enter" && continueFromUsername()}
                    />
                  </label>
                  <button
                    className={`continue-button ${validUsername ? "enabled" : ""}`}
                    disabled={!validUsername}
                    onClick={continueFromUsername}
                  >
                    Продолжить
                  </button>
                  <p className="hint">От 5 до 32 символов · латиница, цифры, _ .</p>
                </div>
              </motion.div>
            )}
            {step === "password" && (
              <motion.div
                key="password"
                className="auth-stage password-stage"
                initial={{ opacity: 0, x: 35 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -35 }}
              >
                <button className="back-button" onClick={() => setStep("username")}>
                  ‹
                </button>
                <div className="auth-form">
                  <div className="username-preview">@{username}</div>
                  {greetingName && (
                    <p className="hello-preview">Привет, {greetingName}!</p>
                  )}
                  <h1>
                    {mode === "login" ? "Введите свой пароль" : "Придумайте пароль"}
                  </h1>
                  <label className="input-field">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) =>
                        setPassword(
                          e.target.value
                            .replace(/[^a-zA-Z0-9!@#$%^&*._-]/g, "")
                            .slice(0, 64),
                        )
                      }
                      placeholder="Пароль"
                      autoFocus
                      onKeyDown={(e) => e.key === "Enter" && continueFromPassword()}
                    />
                  </label>
                  {authError && <p className="auth-error">{authError}</p>}
                  <button
                    className={`continue-button ${validPassword ? "enabled" : ""}`}
                    disabled={!validPassword}
                    onClick={continueFromPassword}
                  >
                    Продолжить
                  </button>
                  <p className="hint">От 6 до 64 символов</p>
                </div>
              </motion.div>
            )}
            {step === "profile" && (
              <motion.div
                key="profile"
                className="auth-stage profile-stage"
                initial={{ opacity: 0, x: 35 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -35 }}
              >
                <button className="back-button" onClick={() => setStep("password")}>
                  ‹
                </button>
                <div className="auth-form">
                  <div className="avatar-placeholder">+</div>
                  <h1>Как вас зовут?</h1>
                  <label className="input-field">
                    <input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Ваше имя"
                      autoFocus
                      onKeyDown={(e) => e.key === "Enter" && finishProfile()}
                    />
                  </label>
                  {authError && <p className="auth-error">{authError}</p>}
                  <button
                    className={`continue-button ${displayName.trim() ? "enabled" : ""}`}
                    disabled={!displayName.trim()}
                    onClick={finishProfile}
                  >
                    Продолжить
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>
    );
  }

  /* MESSENGER */
  return (
    <main
      className={`messenger ${mobileShowChat ? "show-chat" : ""}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <aside className="chat-sidebar">
        <div className="sidebar-header">
          <h2 className="sidebar-title">Чаты</h2>
          <button type="button" className="logout-btn" onClick={logout} title="Выйти">
            ↗
          </button>
        </div>
        <div className={`search-wrap ${isSearchFocused ? "focused" : ""}`}>
          <div className="search-icon">
            <SearchIcon />
          </div>
          <input
            className="search-input"
            placeholder="Поиск по @username"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setTimeout(() => setIsSearchFocused(false), 150)}
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>
        <div className="chat-list-area">
          <div className="chat-list">
            {sortedPeers.length === 0 && (
              <div className="search-empty">
                {isSearching
                  ? "Никого не найдено"
                  : "Пока нет пользователей — зарегистрируй второй аккаунт"}
              </div>
            )}
            {sortedPeers.map((p) => (
              <button
                type="button"
                key={p.id}
                className={`chat-item ${selectedPeerId === p.id ? "active" : ""}`}
                onClick={() => openChat(p)}
              >
                <div className="chat-avatar-wrap">
                  <div
                    className="chat-avatar"
                    style={{
                      background: `hsl(${(p.username.charCodeAt(0) * 37) % 360} 55% 42%)`,
                    }}
                  >
                    {(p.display_name || p.username)[0]}
                  </div>
                  {p.is_online && <span className="online-dot" />}
                </div>
                <div className="chat-info">
                  <div className="chat-top">
                    <b>{p.display_name || p.username}</b>
                    <span className="chat-time">
                      {lastByPeer[p.id]
                        ? formatTime(lastByPeer[p.id].ts)
                        : ""}
                    </span>
                  </div>
                  <div className="chat-bottom">
                    <span className="chat-preview">
                      <span className="chat-username">@{p.username}</span>
                      {lastByPeer[p.id]
                        ? ` · ${lastByPeer[p.id].text}`
                        : ""}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <section
        className="chat-view"
        onPointerDown={onPointerDownChat}
        onPointerUp={onPointerUpChat}
      >
        {selectedPeer && me ? (
          <div className="chat-view-inner">
            <div className="chat-island-wrap">
              <div className="chat-island">
                <button type="button" className="island-back" onClick={closeChat}>
                  ‹
                </button>
                <div className="island-center">
                  <div className="island-name">
                    {selectedPeer.display_name || selectedPeer.username}
                  </div>
                  <div
                    className={`island-status ${selectedPeer.is_online ? "online" : ""}`}
                  >
                    {formatLastSeen(
                      selectedPeer.last_seen,
                      selectedPeer.is_online,
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="chat-messages">
              {groupedMessages.map((g) => (
                <div key={g.label} className="msg-group">
                  <div className="msg-date-sep">
                    <span>{g.label}</span>
                  </div>
                  {g.items.map((m, i) => {
                    const pos = getBubblePos(g.items, i);
                    return (
                      <div
                        key={m.id}
                        className={`msg-row ${m.fromMe ? "me" : "them"}`}
                      >
                        <div
                          className={`msg-bubble bubble-${pos} ${m.fromMe ? "bubble-me" : "bubble-them"} ${m.image ? "has-image" : ""}`}
                        >
                          {m.image && (
                            <img src={m.image} alt="" className="msg-image" />
                          )}
                          {m.text ? (
                            <span className="msg-text">{m.text}</span>
                          ) : null}
                          <span className="msg-meta">
                            <span className="msg-time">
                              {formatTime(m.createdAt)}
                            </span>
                            {m.fromMe && <CheckMarks status={m.status} />}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="composer">
              <button
                type="button"
                className="attach-island"
                onClick={() => fileRef.current?.click()}
              >
                <AttachIcon />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={onPickPhoto}
              />
              <div className="composer-inner">
                <textarea
                  ref={inputRef}
                  className="composer-input"
                  placeholder="Сообщение"
                  value={draft}
                  rows={1}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height =
                      Math.min(e.target.scrollHeight, 120) + "px";
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                />
                <AnimatePresence>
                  {hasDraft && (
                    <motion.button
                      type="button"
                      className="send-btn"
                      onClick={() => sendMessage()}
                      initial={{ scale: 0.5, opacity: 0, width: 0 }}
                      animate={{ scale: 1, opacity: 1, width: 40 }}
                      exit={{ scale: 0.5, opacity: 0, width: 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    >
                      <SendIcon />
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        ) : (
          <div className="chat-view-empty">
            <h1>Выберите чат</h1>
            <p>Сообщения шифруются на устройстве (AES-256-GCM)</p>
          </div>
        )}
      </section>
    </main>
  );
}

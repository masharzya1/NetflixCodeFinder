import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, AlertCircle, Loader2, KeyRound, LogOut } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { useAutoTranslate } from "@/hooks/use-auto-translate";

const translationCache = new Map();

async function translateTextBatch(texts, targetLang) {
  if (!texts || texts.length === 0) return [];

  const results = [];
  const toTranslate = [];
  const indices = [];

  for (let i = 0; i < texts.length; i += 1) {
    const text = texts[i];
    const cacheKey = `${text}-${targetLang}`;

    if (translationCache.has(cacheKey)) {
      results[i] = translationCache.get(cacheKey);
    } else {
      results[i] = null;
      toTranslate.push(text);
      indices.push(i);
    }
  }

  if (toTranslate.length === 0) return results;

  const batchSize = 10;
  for (let i = 0; i < toTranslate.length; i += batchSize) {
    const batch = toTranslate.slice(i, i + batchSize);
    const batchIndices = indices.slice(i, i + batchSize);

    const promises = batch.map((text) => translateSingle(text, targetLang));
    const translated = await Promise.all(promises);

    for (let j = 0; j < translated.length; j += 1) {
      const originalText = batch[j];
      const translatedText = translated[j];
      const cacheKey = `${originalText}-${targetLang}`;

      translationCache.set(cacheKey, translatedText);
      results[batchIndices[j]] = translatedText;
    }
  }

  return results;
}

async function translateSingle(text, targetLang) {
  if (!text || text.trim() === "") return text;

  try {
    const res = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`
    );
    const data = await res.json();
    return data[0].map((item) => item[0]).join("");
  } catch (_error) {
    return text;
  }
}

function extractTextNodes(element) {
  const textNodes = [];
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tagName = parent.tagName.toLowerCase();
        if (tagName === "script" || tagName === "style") return NodeFilter.FILTER_REJECT;

        const text = node.nodeValue.trim();
        if (text === "") return NodeFilter.FILTER_REJECT;

        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  let node;
  while ((node = walker.nextNode())) {
    textNodes.push({
      node,
      originalText: node.nodeValue.trim(),
      parent: node.parentElement,
    });
  }

  return textNodes;
}

function EmailContent({ email, emailId, targetLanguage }) {
  const containerRef = useRef(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationProgress, setTranslationProgress] = useState(0);
  const originalHtmlRef = useRef(email.rawHtml);
  
  useEffect(() => {
    originalHtmlRef.current = email.rawHtml;
  }, [email.rawHtml]);

  useEffect(() => {
    let mounted = true;

    async function runTranslate() {
      if (!containerRef.current || !originalHtmlRef.current) return;

      containerRef.current.innerHTML = originalHtmlRef.current;
      setIsTranslating(true);
      setTranslationProgress(0);

      await new Promise((resolve) => setTimeout(resolve, 250));
      if (!mounted || !containerRef.current) return;

      const liveNodes = extractTextNodes(containerRef.current);
      if (liveNodes.length === 0) {
        if (mounted) setIsTranslating(false);
        return;
      }

      const allTexts = liveNodes.map((node) => node.originalText);
      const translatedTexts = await translateTextBatch(allTexts, targetLanguage);

      for (let i = 0; i < liveNodes.length; i += 1) {
        if (!mounted) return;
        setTranslationProgress(Math.round(((i + 1) / liveNodes.length) * 100));
        const translatedText = translatedTexts[i];
        if (translatedText && translatedText !== liveNodes[i].originalText) {
          liveNodes[i].node.nodeValue = translatedText;
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
      }

      if (mounted) setIsTranslating(false);
    }

    runTranslate();

    return () => {
      mounted = false;
    };
  }, [emailId, targetLanguage]);

  return (
    <div className="w-full relative" data-testid={`email-content-${emailId}`}>
      {isTranslating ? (
        <div className="absolute top-2 right-2 bg-neutral-800/95 rounded-lg px-3 py-1.5 flex items-center gap-2 z-10 border border-neutral-700">
          <Loader2 className="w-3 h-3 animate-spin text-red-500" />
          <span className="text-xs text-neutral-300 font-medium">{translationProgress}%</span>
        </div>
      ) : null}

      <div ref={containerRef} className="email-content-wrapper rounded-xl overflow-hidden bg-white" />
    </div>
  );
}

function cleanSenderName(from) {
  const value = String(from || "");
  if (!value) return "Netflix";
  if (value.toLowerCase().includes("netflix")) return "Netflix";
  return value.replace(/<[^>]+>/g, "").trim() || "Netflix";
}

function cleanRecipient(to) {
  return String(to || "").replace(/<|>/g, "").trim();
}

function getSubjectPreview(subject) {
  return String(subject || "Netflix email").replace(/\s+/g, " ").trim();
}

export default function Home() {
  const { toast } = useToast();
  const { t, language } = useLanguage();

  const [session, setSession] = useState(() => {
    const raw = localStorage.getItem("user-access-session");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (!parsed.token || !parsed.mailbox || !parsed.mailbox.email) return null;
      return parsed;
    } catch {
      return null;
    }
  });
  const [results, setResults] = useState(null);
  const [selectedEmailId, setSelectedEmailId] = useState(null);
  const [showDetailOnMobile, setShowDetailOnMobile] = useState(false);
  const [pageToken, setPageToken] = useState(null);
  const [translatedSubjects, setTranslatedSubjects] = useState({});
  const authSchema = useMemo(
    () =>
      z.object({
        email: z.string().email({ message: t.validEmailError }),
        code: z.string().min(6, { message: "Activation code must be 6 characters." }),
      }),
    [t]
  );

  const authForm = useForm({
    resolver: zodResolver(authSchema),
    defaultValues: { email: "", code: "" },
  });

  const accessMutation = useMutation({
    mutationFn: async (data) => {
      const res = await fetch("/api/auth/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Access denied");
      return json;
    },
    onSuccess: (payload) => {
      const nextSession = {
        token: payload.token,
        mailbox: payload.mailbox,
      };
      localStorage.setItem("user-access-session", JSON.stringify(nextSession));
      setSession(nextSession);
      setResults(null);
      toast({ title: "Access granted", description: `Mailbox: ${payload.mailbox.email}` });
    },
  });

  const listMutation = useMutation({
    mutationFn: async ({ append = false, token = null } = {}) => {
      const params = new URLSearchParams({ limit: "10" });
      if (token) params.set("pageToken", token);
      const res = await fetch(`/api/user/emails?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${session.token}`,
        },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load messages. Please try again.");
      return { ...json, append };
    },
    onSuccess: (data) => {
      setResults((previous) => {
        if (!data.append) return data;
        const previousEmails = previous?.emails || [];
        const existingIds = new Set(previousEmails.map((email) => email.id));
        const newEmails = (data.emails || []).filter((email) => !existingIds.has(email.id));
        return {
          ...data,
          emails: [...previousEmails, ...newEmails],
          totalCount: previousEmails.length + newEmails.length,
        };
      });
      setPageToken(data.nextPageToken || null);
      setSelectedEmailId((current) => current || data?.emails?.[0]?.id || null);
      setShowDetailOnMobile(false);
      toast({ title: t.emailFound, description: `${data.emails?.length || 0} message(s) ready.` });
    },
    onError: (error) => {
      setResults(null);
      if ((error.message || "").toLowerCase().includes("session")) {
        localStorage.removeItem("user-access-session");
        setSession(null);
      }
    },
  });

  const { ref: translateRef } = useAutoTranslate(language, [
    Boolean(session?.token),
    results?.emails?.length || 0,
    selectedEmailId || "",
    showDetailOnMobile,
    listMutation.isPending,
    accessMutation.isPending,
    accessMutation.isError,
  ]);

  useEffect(() => {
    if (session?.token && !results && !listMutation.isPending) {
      listMutation.mutate({ append: false });
    }
  }, [session?.token]);

  useEffect(() => {
    setTranslatedSubjects({});
  }, [language]);

  useEffect(() => {
    let mounted = true;

    async function translateSubjects() {
      if (!results?.emails?.length) return;
      const missing = results.emails.filter((email) => !translatedSubjects[email.id]);
      if (!missing.length) return;

      const translated = await translateTextBatch(
        missing.map((email) => getSubjectPreview(email.subject)),
        language
      );

      if (!mounted) return;
      setTranslatedSubjects((previous) => {
        const next = { ...previous };
        missing.forEach((email, index) => {
          next[email.id] = translated[index] || getSubjectPreview(email.subject);
        });
        return next;
      });
    }

    translateSubjects();
    return () => {
      mounted = false;
    };
  }, [results?.emails, language]);

  const selectedEmail = useMemo(() => {
    if (!results?.emails?.length) return null;
    return results.emails.find((mail) => mail.id === selectedEmailId) || results.emails[0];
  }, [results, selectedEmailId]);

  function logoutUser() {
    localStorage.removeItem("user-access-session");
    setSession(null);
      setResults(null);
      setPageToken(null);
      setTranslatedSubjects({});
  }

  if (!session?.token || !session?.mailbox?.email) {
    return (
      <div ref={translateRef} className="min-h-screen w-full flex flex-col items-center justify-center p-4 pt-20 sm:pt-4 bg-neutral-950 overflow-x-hidden">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-lg bg-neutral-900 rounded-xl p-6 border border-neutral-800"
        >
          <div className="text-center space-y-2 mb-6">
            <h1 className="text-3xl font-bold text-primary tracking-wider font-display">{t.title}</h1>
            <p className="text-neutral-400 text-sm">Login with your email and activation code</p>
          </div>

          <Form {...authForm}>
            <form onSubmit={authForm.handleSubmit((data) => accessMutation.mutate(data))} className="space-y-4">
              <FormField
                control={authForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">Email</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
                        <Input
                          placeholder="user@example.com"
                          className="pl-10 h-10 bg-neutral-800 border-neutral-700 text-white"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage className="text-red-400 text-xs" />
                  </FormItem>
                )}
              />

              <FormField
                control={authForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">Activation Code</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
                        <Input
                          placeholder="ABC123"
                          className="pl-10 h-10 bg-neutral-800 border-neutral-700 text-white uppercase"
                          {...field}
                          onChange={(e) => field.onChange((e.target.value || "").toUpperCase())}
                        />
                      </div>
                    </FormControl>
                    <FormMessage className="text-red-400 text-xs" />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full h-10" disabled={accessMutation.isPending}>
                {accessMutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking...
                  </span>
                ) : (
                  "Login"
                )}
              </Button>

              {accessMutation.isError ? (
                <p className="text-red-400 text-sm">{accessMutation.error?.message}</p>
              ) : null}
            </form>
          </Form>
        </motion.div>
      </div>
    );
  }

  return (
    <div key={language} ref={translateRef} className="min-h-screen w-full flex flex-col items-center px-3 pb-4 pt-20 sm:p-4 bg-neutral-950 overflow-x-hidden">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-4xl space-y-4 sm:space-y-6 py-4 sm:py-8 min-w-0"
      >
        <div className="text-center space-y-2">
          <h1 className="text-3xl sm:text-4xl font-bold text-primary tracking-wider font-display">{t.title}</h1>
          <p className="text-neutral-500 text-sm break-all">Mailbox: {session.mailbox.email}</p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-neutral-900 rounded-xl p-4 border border-neutral-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        >
          <div>
            <h2 className="text-sm font-medium text-white">Mailbox is ready</h2>
            <p className="text-neutral-500 text-xs mt-1">
              {listMutation.isPending ? "Loading latest emails..." : "Showing matched Netflix emails."}
            </p>
          </div>
          <Button variant="secondary" onClick={logoutUser}>
            <LogOut className="w-4 h-4 mr-2" /> Logout
          </Button>
        </motion.div>

        <AnimatePresence mode="wait">
          {results?.emails?.length > 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="w-full"
            >
              <div className="bg-neutral-900 rounded-2xl border border-neutral-800 overflow-hidden shadow-xl min-w-0">
                <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
                  <p className="text-neutral-300 text-sm font-medium">Inbox ({results.emails.length})</p>
                  {showDetailOnMobile ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="md:hidden"
                      onClick={() => setShowDetailOnMobile(false)}
                    >
                      Back to List
                    </Button>
                  ) : null}
                </div>

                <div className="md:grid md:grid-cols-12 min-h-[540px] min-w-0">
                  <div
                    className={`md:col-span-5 border-r border-neutral-800 overflow-y-auto max-h-[540px] min-w-0 ${
                      showDetailOnMobile ? "hidden md:block" : "block"
                    }`}
                  >
                    {results.emails.map((email) => {
                      const isSelected = selectedEmail?.id === email.id;
                      return (
                        <button
                          key={email.id}
                          type="button"
                          onClick={() => {
                            setSelectedEmailId(email.id);
                            setShowDetailOnMobile(true);
                          }}
                          className={`w-full text-left px-3 sm:px-4 py-3 border-b border-neutral-800/60 transition-colors ${
                            isSelected ? "bg-neutral-800/80" : "bg-neutral-900 hover:bg-neutral-800/50"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 sm:gap-3 min-w-0">
                            <div className="min-w-0">
                              <p className="text-sm text-white font-semibold truncate">
                                {cleanSenderName(email.from)}
                              </p>
                              <p className="text-sm text-neutral-300 truncate mt-0.5">{translatedSubjects[email.id] || getSubjectPreview(email.subject)}</p>
                              <p className="text-xs text-neutral-500 truncate mt-1">To: {cleanRecipient(email.to) || session.mailbox.email}</p>
                            </div>
                            <span className="text-[10px] sm:text-[11px] text-neutral-500 whitespace-nowrap flex-shrink-0">
                              {new Date(email.receivedAt).toLocaleString([], {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                    {pageToken ? (
                      <div className="p-3">
                        <Button
                          variant="secondary"
                          className="w-full"
                          disabled={listMutation.isPending}
                          onClick={() => listMutation.mutate({ append: true, token: pageToken })}
                        >
                          {listMutation.isPending ? "Loading..." : "Load 10 More"}
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  <div
                    className={`md:col-span-7 bg-neutral-900 min-w-0 ${
                      showDetailOnMobile ? "block" : "hidden md:block"
                    }`}
                  >
                    {selectedEmail ? (
                      <>
                        <div className="p-3 sm:p-4 border-b border-neutral-800 bg-neutral-900/90 min-w-0">
                          <p className="text-white text-sm sm:text-base font-semibold break-words">{translatedSubjects[selectedEmail.id] || selectedEmail.subject}</p>
                          <p className="text-xs text-neutral-400 mt-1">
                            From: {cleanSenderName(selectedEmail.from)} • To: {cleanRecipient(selectedEmail.to) || "N/A"}
                          </p>
                          <p className="text-xs text-neutral-500 mt-1">
                            {new Date(selectedEmail.receivedAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="p-2 sm:p-4 max-h-[460px] overflow-y-auto">
                          <EmailContent
                            email={selectedEmail}
                            emailId={selectedEmail.id}
                            targetLanguage={language}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="h-full flex items-center justify-center text-neutral-500 text-sm">
                        Select an email to view details.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ) : null}

          {results && results.emails?.length === 0 && !listMutation.isPending ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="bg-neutral-900 rounded-xl p-5 border border-neutral-800 text-center"
            >
              <h3 className="text-white font-medium text-sm">No messages yet</h3>
              <p className="text-neutral-500 text-xs mt-1">
                Ask Netflix to send the email, then refresh this page in a moment.
              </p>
            </motion.div>
          ) : null}

          {listMutation.isPending && !results ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="bg-neutral-900 rounded-xl p-5 border border-neutral-800 flex items-center justify-center gap-2 text-neutral-300 text-sm"
            >
              <Loader2 className="h-4 w-4 animate-spin text-red-500" /> Loading messages...
            </motion.div>
          ) : null}

          {listMutation.isError ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="bg-neutral-900 rounded-xl p-4 border border-red-900/50 flex items-start gap-3"
            >
              <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                <AlertCircle className="w-4 h-4 text-red-400" />
              </div>
              <div>
                <h3 className="text-red-400 font-medium text-sm">Unable to load messages</h3>
                <p className="text-neutral-500 text-xs mt-0.5">{listMutation.error?.message}</p>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

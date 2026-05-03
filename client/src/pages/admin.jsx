import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Copy, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";
import { useAutoTranslate } from "@/hooks/use-auto-translate";

function formatDate(ms) {
  return new Date(ms).toLocaleString();
}

export default function AdminPage() {
  const { language } = useLanguage();
  const {
    bootstrapped,
    isAdmin,
    adminData,
    authError,
    signInAdmin,
    signOutAdmin,
    getAdminToken,
    setAdminData,
  } = useAuth();

  const [activeTab, setActiveTab] = useState("codes");
  const [adminEmail, setAdminEmail] = useState("");
  const [codeEmail, setCodeEmail] = useState("");
  const [codeDays, setCodeDays] = useState("30");
  const [error, setError] = useState("");

  const mailboxes = adminData?.mailboxes || [];
  const codes = adminData?.codes || [];
  const adminUsers = adminData?.adminUsers || [];
  const envAdmins = (adminData?.adminEmails || []).filter(
    (email) => !adminUsers.some((item) => item.email === email)
  );
  const addAdminUserMutation = useMutation({
    mutationFn: async () => {
      const token = await getAdminToken();
      const response = await fetch("/api/admin/admin-users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: adminEmail }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not add this admin email.");
      return payload;
    },
    onSuccess: (payload) => {
      setError("");
      setAdminEmail("");
      setAdminData((prev) => ({
        ...prev,
        adminUsers: [...(prev?.adminUsers || []), payload.adminUser].sort((a, b) =>
          a.email.localeCompare(b.email)
        ),
        adminEmails: [...(prev?.adminEmails || []), payload.adminUser.email]
          .filter((value, idx, arr) => arr.indexOf(value) === idx)
          .sort(),
      }));
    },
    onError: (e) => setError(e.message),
  });

  const deleteAdminUserMutation = useMutation({
    mutationFn: async (id) => {
      const token = await getAdminToken();
      const response = await fetch(`/api/admin/admin-users/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not remove this admin email.");
      return id;
    },
    onSuccess: (id) => {
      setError("");
      setAdminData((prev) => {
        const nextUsers = (prev?.adminUsers || []).filter((item) => item.id !== id);
        const nextEmails = [
          ...(nextUsers.map((item) => item.email) || []),
          ...((prev?.adminEmails || []).filter((email) => envAdmins.includes(email)) || []),
        ]
          .filter((value, idx, arr) => arr.indexOf(value) === idx)
          .sort();

        return {
          ...prev,
          adminUsers: nextUsers,
          adminEmails: nextEmails,
        };
      });
    },
    onError: (e) => setError(e.message),
  });

  const deleteMailboxMutation = useMutation({
    mutationFn: async (mailboxId) => {
      const token = await getAdminToken();
      const response = await fetch(`/api/admin/mailboxes/${mailboxId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not remove this email.");
      return mailboxId;
    },
    onSuccess: (mailboxId) => {
      setAdminData((prev) => ({
        ...prev,
        mailboxes: (prev?.mailboxes || []).filter((item) => item.id !== mailboxId),
        codes: (prev?.codes || []).filter((code) => code.mailboxId !== mailboxId),
      }));
    },
    onError: (e) => setError(e.message),
  });

  const createCodeMutation = useMutation({
    mutationFn: async () => {
      const normalizedEmail = codeEmail.trim().toLowerCase();
      const existingMailbox = mailboxes.find((mailbox) => mailbox.email === normalizedEmail);
      const hasActiveCode = existingMailbox && codes.some((code) =>
        code.mailboxId === existingMailbox.id && !code.disabled && Number(code.expiresAt) > Date.now()
      );

      if (hasActiveCode) {
        throw new Error("This email already has an active code. Remove it first to create a new one.");
      }

      const token = await getAdminToken();
      const response = await fetch("/api/admin/codes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: normalizedEmail,
          ttlType: "custom",
          customDays: Number(codeDays),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not create a code for this email.");
      return payload;
    },
    onSuccess: (payload) => {
      setError("");
      const mailboxEmailValue = payload.mailbox?.email || codeEmail.toLowerCase();
      setCodeEmail("");
      setAdminData((prev) => ({
        ...prev,
        mailboxes: payload.mailbox && !(prev?.mailboxes || []).some((item) => item.id === payload.mailbox.id)
          ? [...(prev?.mailboxes || []), payload.mailbox].sort((a, b) => a.email.localeCompare(b.email))
          : prev?.mailboxes || [],
        codes: [
          {
            ...payload.code,
            mailboxEmail: mailboxEmailValue,
            expired: Number(payload.code.expiresAt) <= Date.now(),
          },
          ...(prev?.codes || []),
        ],
      }));
    },
    onError: (e) => setError(e.message),
  });

  const regenerateCodeMutation = useMutation({
    mutationFn: async (codeId) => {
      const token = await getAdminToken();
      const response = await fetch(`/api/admin/codes/${codeId}/regenerate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not refresh this code.");
      return payload;
    },
    onSuccess: (payload) => {
      const mailboxEmailValue = mailboxes.find((mailbox) => mailbox.id === payload.code.mailboxId)?.email || "";
      setAdminData((prev) => ({
        ...prev,
        codes: (prev?.codes || []).map((code) =>
          code.id === payload.code.id
            ? {
                ...payload.code,
                mailboxEmail: mailboxEmailValue,
                expired: Number(payload.code.expiresAt) <= Date.now(),
              }
            : code
        ),
      }));
    },
    onError: (e) => setError(e.message),
  });

  const toggleCodeMutation = useMutation({
    mutationFn: async ({ id, disabled }) => {
      const token = await getAdminToken();
      const response = await fetch(`/api/admin/codes/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ disabled }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not update this code.");
      return { id, disabled };
    },
    onSuccess: ({ id, disabled }) => {
      setAdminData((prev) => ({
        ...prev,
        codes: (prev?.codes || []).map((code) =>
          code.id === id ? { ...code, disabled } : code
        ),
      }));
    },
    onError: (e) => setError(e.message),
  });

  const regenerateMissingMutation = useMutation({
    mutationFn: async () => {
      const token = await getAdminToken();
      const response = await fetch("/api/admin/codes/regenerate-missing", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not refresh missing codes.");
      return payload;
    },
    onSuccess: (payload) => {
      if (!payload.updatedCount) return;
      setAdminData((prev) => {
        const byId = new Map((prev?.codes || []).map((code) => [code.id, code]));
        for (const incoming of payload.codes) {
          const mailboxEmailValue = mailboxes.find((mailbox) => mailbox.id === incoming.mailboxId)?.email || "";
          byId.set(incoming.id, {
            ...incoming,
            mailboxEmail: mailboxEmailValue,
            expired: Number(incoming.expiresAt) <= Date.now(),
          });
        }
        return {
          ...prev,
          codes: Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt),
        };
      });
    },
    onError: (e) => setError(e.message),
  });

  const { ref: translateRef } = useAutoTranslate(language, [
    bootstrapped,
    isAdmin,
    activeTab,
    codes.length,
    adminUsers.length,
    envAdmins.length,
    error,
    authError,
    addAdminUserMutation.isPending,
    createCodeMutation.isPending,
    regenerateMissingMutation.isPending,
  ]);

  if (!bootstrapped) {
    return (
      <div ref={translateRef} className="min-h-screen bg-neutral-950 text-white flex items-center justify-center gap-2 p-4 pt-20 sm:pt-4">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading admin panel...
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div ref={translateRef} className="min-h-screen bg-neutral-950 text-white flex items-center justify-center p-4 pt-20 sm:pt-4">
        <Card className="w-full max-w-xl bg-neutral-900 border-neutral-800 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-red-500" />
            <div>
              <h1 className="text-xl font-semibold text-white">Admin Login</h1>
              <p className="text-sm text-neutral-400">Use Google to access admin controls.</p>
            </div>
          </div>
          {authError ? <p className="text-red-400 text-sm">{authError}</p> : null}
          <Button
            onClick={async () => {
              try {
                await signInAdmin();
              } catch (error) {
                setError(error?.message || "Sign-in failed.");
              }
            }}
            className="w-full"
          >
            Sign in with Google
          </Button>
          {error ? <p className="text-red-400 text-sm">{error}</p> : null}
        </Card>
      </div>
    );
  }

  return (
    <div key={language} ref={translateRef} className="min-h-screen bg-neutral-950 text-white px-3 pb-4 pt-20 sm:p-6 overflow-x-hidden">
      <div className="w-full max-w-5xl mx-auto space-y-4">
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">Admin Panel</h1>
            <p className="text-sm text-neutral-400 leading-snug">Manage admins and activation codes</p>
          </div>
          <Button variant="secondary" className="w-full sm:w-auto" onClick={signOutAdmin}>Sign out</Button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Button
            variant={activeTab === "admins" ? "default" : "secondary"}
            onClick={() => setActiveTab("admins")}
          >
            Admin Access
          </Button>
          <Button
            variant={activeTab === "codes" ? "default" : "secondary"}
            onClick={() => setActiveTab("codes")}
          >
            Activation Codes
          </Button>
        </div>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        {activeTab === "admins" ? (
          <Card className="bg-neutral-900 border-neutral-800 p-3 sm:p-4 space-y-4 overflow-hidden">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                placeholder="admin email"
                value={adminEmail}
                onChange={(event) => setAdminEmail(event.target.value)}
                className="bg-neutral-800 border-neutral-700"
              />
              <Button
                onClick={() => addAdminUserMutation.mutate()}
                disabled={addAdminUserMutation.isPending || !adminEmail.trim()}
              >
                {addAdminUserMutation.isPending ? "Adding..." : "Add Admin"}
              </Button>
            </div>

            {envAdmins.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-neutral-400">Primary admins:</p>
                {envAdmins.map((email) => (
                  <div
                    key={email}
                    className="bg-neutral-800 border border-neutral-700 rounded-lg p-3 flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center"
                  >
                    <p className="text-sm font-medium break-all">{email}</p>
                    <span className="text-xs text-neutral-500">ENV</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="space-y-2">
              <p className="text-xs text-neutral-400">Database admins:</p>
              {adminUsers.map((admin) => (
                <div
                  key={admin.id}
                  className="bg-neutral-800 border border-neutral-700 rounded-lg p-3 flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-all">{admin.email}</p>
                    <p className="text-xs text-neutral-400">Added: {formatDate(admin.createdAt)}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => deleteAdminUserMutation.mutate(admin.id)}
                    disabled={deleteAdminUserMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              {adminUsers.length === 0 ? (
                <p className="text-sm text-neutral-400">No database admin emails added yet.</p>
              ) : null}
            </div>
          </Card>
        ) : (
          <Card className="bg-neutral-900 border-neutral-800 p-3 sm:p-4 space-y-4 overflow-hidden">
            <div className="flex justify-end">
              <Button
                variant="secondary"
                size="sm"
                className="w-full sm:w-auto text-xs sm:text-sm"
                onClick={() => regenerateMissingMutation.mutate()}
                disabled={regenerateMissingMutation.isPending}
              >
                <RefreshCw className="w-4 h-4 mr-1" />
                Refresh Missing Codes
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Input
                type="email"
                value={codeEmail}
                onChange={(event) => setCodeEmail(event.target.value)}
                placeholder="customer@example.com"
                className="bg-neutral-800 border-neutral-700"
              />

              <Input
                type="number"
                min="1"
                max="3650"
                value={codeDays}
                onChange={(event) => setCodeDays(event.target.value)}
                placeholder="Days"
                className="bg-neutral-800 border-neutral-700"
              />

              <Button
                onClick={() => createCodeMutation.mutate()}
                disabled={createCodeMutation.isPending || !codeEmail.trim() || !Number(codeDays)}
              >
                {createCodeMutation.isPending ? "Creating..." : "Generate Code"}
              </Button>
            </div>

            <div className="space-y-2">
              {codes.map((code) => (
                <div key={code.id} className="bg-neutral-800 border border-neutral-700 rounded-lg p-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-all">{code.mailboxEmail || "Email unavailable"}</p>
                    <p className="text-xs text-neutral-400">
                      {(code.codeValue || code.codePreview || "").toUpperCase()} • Expires: {formatDate(code.expiresAt)}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {code.expired ? "Expired" : code.disabled ? "Disabled" : "Active"}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:justify-end">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="text-xs"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText((code.codeValue || "").toUpperCase());
                        } catch (_error) {
                          setError("Could not copy code.");
                        }
                      }}
                      disabled={!code.codeValue}
                    >
                      <Copy className="w-4 h-4 mr-1" />
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="text-xs"
                      onClick={() => regenerateCodeMutation.mutate(code.id)}
                      disabled={regenerateCodeMutation.isPending}
                    >
                      <RefreshCw className="w-4 h-4 mr-1" />
                      Regenerate
                    </Button>
                    <Button
                      size="sm"
                      variant={code.disabled ? "default" : "secondary"}
                      className="text-xs"
                      disabled={toggleCodeMutation.isPending || code.expired}
                      onClick={() => toggleCodeMutation.mutate({ id: code.id, disabled: !code.disabled })}
                    >
                      {code.disabled ? "Enable" : "Disable"}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="text-xs"
                      onClick={() => deleteMailboxMutation.mutate(code.mailboxId)}
                      disabled={deleteMailboxMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
              {codes.length === 0 ? (
                <p className="text-sm text-neutral-400">No activation codes yet.</p>
              ) : null}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

import Imap from "imap";
import { simpleParser } from "mailparser";
import crypto from "crypto";
import { google } from "googleapis";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { getServerDb, getFirebaseServerConfig } from "./firebase.js";

const MAILBOXES_COLLECTION = "mailboxes";
const ACTIVATION_CODES_COLLECTION = "activationCodes";
const ADMIN_USERS_COLLECTION = "adminUsers";

function decodeHtmlEntities(html) {
  if (!html) return "";
  return html
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x22;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&#x26;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&#x3C;/g, "<")
    .replace(/&lt;/g, "<")
    .replace(/&#x3E;/g, ">")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function getUserFriendlyError(error) {
  const errorMessage = error?.message || String(error);

  if (errorMessage.includes("AUTHENTICATIONFAILED") || errorMessage.includes("Invalid credentials")) {
    return "Mailbox connection needs attention. Please contact support.";
  }
  if (errorMessage.includes("ENOTFOUND") || errorMessage.includes("getaddrinfo")) {
    return "Mailbox service is temporarily unavailable. Please try again later.";
  }
  if (errorMessage.includes("ETIMEDOUT") || errorMessage.includes("timeout")) {
    return "Mailbox service is taking too long. Please try again.";
  }
  if (errorMessage.includes("ECONNREFUSED")) {
    return "Mailbox service is temporarily unavailable. Please try again later.";
  }
  if (errorMessage.includes("certificate")) {
    return "Mailbox connection needs attention. Please contact support.";
  }

  return "Unable to load messages right now. Please try again.";
}

function normalizeEmailSearchText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hasFourDigitCode(content) {
  const normalized = normalizeEmailSearchText(content);
  return /(?:^|\D)\d{4}(?!\d)/.test(normalized);
}

function hasSixOrMoreDigitCode(content) {
  const normalized = normalizeEmailSearchText(content);
  return /(?:^|\D)\d{6,}(?!\d)/.test(normalized);
}

function isTemporaryOrHouseholdEmail(email) {
  const subject = String(email?.subject || "").toLowerCase();
  const html = String(email?.html || "").toLowerCase();
  const text = String(email?.text || "").toLowerCase();
  const content = `${subject}
${html}
${text}`;

  const keywords = [
    "temporary",
    "temporarily",
    "household",
    "travel",
    "watch temporarily",
    "i'm traveling",
    "verify-device",
    "temporary-access",
    "update-primary-location",
    "account/travel/verify",
    "account/update-primary-location",
    "yesitwasme",
    "yes-it-was-me",
  ];

  return (
    (keywords.some((item) => content.includes(item)) || hasFourDigitCode(content)) &&
    !hasSixOrMoreDigitCode(content)
  );
}

function decodeBase64Url(value) {
  if (!value) return "";
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function extractGmailBody(payload) {
  let html = "";
  let text = "";

  function walk(part) {
    if (!part) return;
    if (part.mimeType === "text/html" && part.body?.data) {
      html = decodeBase64Url(part.body.data);
    } else if (part.mimeType === "text/plain" && part.body?.data) {
      text = decodeBase64Url(part.body.data);
    }
    if (Array.isArray(part.parts)) {
      part.parts.forEach(walk);
    }
  }

  walk(payload);
  return { html, text };
}

function getGmailClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const oauth2 = new google.auth.OAuth2(
    clientId,
    clientSecret,
    "https://developers.google.com/oauthplayground"
  );
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth2 });
}

async function searchNetflixEmailsGmail(mailboxEmail, pageToken = null, pageSize = 10) {
  const gmail = getGmailClient();
  if (!gmail) {
    throw new Error("Mailbox service is unavailable.");
  }

  const query = `from:netflix.com to:${mailboxEmail} newer_than:365d`;
  const list = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: pageSize,
    pageToken: pageToken || undefined,
  });

  const messageRefs = list.data.messages || [];
  if (!messageRefs.length) return { emails: [], nextPageToken: null };

  const fullMessages = await Promise.all(
    messageRefs.map(async (item) => {
      try {
        const full = await gmail.users.messages.get({
          userId: "me",
          id: item.id,
          format: "full",
        });
        return full.data;
      } catch (_error) {
        return null;
      }
    })
  );

  const parsed = fullMessages
    .filter(Boolean)
    .map((msg) => {
      const headers = msg.payload?.headers || [];
      const getHeader = (name) =>
        headers.find((h) => String(h.name || "").toLowerCase() === name)?.value || "";
      const body = extractGmailBody(msg.payload || {});
      return {
        id: msg.id,
        subject: getHeader("subject") || "Netflix Email",
        receivedAt: new Date(Number(msg.internalDate || Date.now())).toISOString(),
        from: getHeader("from"),
        to: getHeader("to"),
        html: body.html || "",
        text: body.text || "",
      };
    })
    .filter((mail) => isTemporaryOrHouseholdEmail(mail))
    .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))
    .map((mail) => ({
      id: mail.id,
      subject: decodeHtmlEntities(mail.subject),
      receivedAt: mail.receivedAt,
      from: mail.from,
      to: mail.to,
      rawHtml: `<div class="netflix-email-original">${decodeHtmlEntities(mail.html)}</div>`,
    }));

  return {
    emails: parsed,
    nextPageToken: list.data.nextPageToken || null,
  };
}

function hashCode(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function generateActivationCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function getSessionSecret() {
  return process.env.APP_SESSION_SECRET || crypto.randomBytes(32).toString("hex");
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(input) {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function signAccessToken(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerEncoded}.${payloadEncoded}`;
  const signature = crypto
    .createHmac("sha256", getSessionSecret())
    .update(signingInput)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${signingInput}.${signature}`;
}

function verifyAccessToken(token) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token format");
  }

  const [headerEncoded, payloadEncoded, signature] = parts;
  const signingInput = `${headerEncoded}.${payloadEncoded}`;
  const expectedSignature = crypto
    .createHmac("sha256", getSessionSecret())
    .update(signingInput)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  if (signature !== expectedSignature) {
    throw new Error("Invalid token signature");
  }

  const payload = JSON.parse(base64UrlDecode(payloadEncoded));
  if (!payload.exp || Date.now() >= payload.exp) {
    throw new Error("Token expired");
  }

  return payload;
}

async function verifyFirebaseIdToken(idToken) {
  const firebaseConfig = getFirebaseServerConfig();
  const apiKey = firebaseConfig.apiKey;

  if (!apiKey) {
    throw new Error("Sign-in service is unavailable.");
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    }
  );

  const data = await response.json();
  if (!response.ok || !data?.users?.length) {
    throw new Error(data?.error?.message || "Invalid Firebase token");
  }

  const user = data.users[0];
  return {
    uid: user.localId,
    email: (user.email || "").toLowerCase(),
    displayName: user.displayName || "",
  };
}

function getConfiguredAdminEmails() {
  const fromEnv = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (fromEnv.length > 0) return fromEnv;

  const fallback = (process.env.EMAIL_ADDRESS || "").trim().toLowerCase();
  return fallback ? [fallback] : [];
}

async function getDbAdminUsers(db) {
  const snapshot = await getDocs(collection(db, ADMIN_USERS_COLLECTION));
  return snapshot.docs
    .map((docSnap) => ({
      id: docSnap.id,
      email: String(docSnap.data().email || "").toLowerCase(),
      createdAt: docSnap.data().createdAt || Date.now(),
      createdBy: docSnap.data().createdBy || "",
    }))
    .filter((item) => item.email.includes("@"))
    .sort((a, b) => a.email.localeCompare(b.email));
}

async function getAdminEmails(db) {
  const configured = getConfiguredAdminEmails();
  const dbUsers = await getDbAdminUsers(db);
  const set = new Set([...configured, ...dbUsers.map((item) => item.email)]);
  return Array.from(set);
}

async function requireAdminUser(req, res) {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing admin authorization token." });
      return null;
    }

    const idToken = authHeader.slice(7);
    const user = await verifyFirebaseIdToken(idToken);
    const db = getServerDb();
    const adminEmails = await getAdminEmails(db);

    if (!adminEmails.includes(user.email)) {
      res.status(403).json({ error: "This account is not allowed as admin." });
      return null;
    }

    return user;
  } catch (error) {
    res.status(401).json({ error: "Admin authentication failed." });
    return null;
  }
}

function requireAccessSession(req, res) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing user session token." });
    return null;
  }

  try {
    const payload = verifyAccessToken(authHeader.slice(7));
    return payload;
  } catch (_error) {
    res.status(401).json({ error: "Invalid or expired user session." });
    return null;
  }
}

function normalizeMailbox(docSnap) {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    email: data.email,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    createdBy: data.createdBy,
  };
}

function normalizeCode(docSnap) {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    mailboxId: data.mailboxId,
    codeValue: data.codeValue || "",
    codePreview: data.codePreview,
    expiresAt: data.expiresAt,
    disabled: Boolean(data.disabled),
    createdAt: data.createdAt,
    createdBy: data.createdBy,
    ttlType: data.ttlType,
    customDays: data.customDays ?? null,
  };
}

async function getMailboxes(db) {
  const snapshot = await getDocs(collection(db, MAILBOXES_COLLECTION));
  return snapshot.docs.map(normalizeMailbox).sort((a, b) => a.email.localeCompare(b.email));
}

async function getCodes(db) {
  const snapshot = await getDocs(collection(db, ACTIVATION_CODES_COLLECTION));
  return snapshot.docs.map(normalizeCode).sort((a, b) => b.createdAt - a.createdAt);
}

function searchNetflixEmails(imapConfig, mailboxEmail) {
  return new Promise((resolve, reject) => {
    const imap = new Imap(imapConfig);

    const timeoutId = setTimeout(() => {
      try {
        imap.end();
      } catch (_error) {}
      reject(new Error("timeout"));
    }, 25000);

    imap.once("ready", () => {
      imap.openBox("INBOX", true, (openError) => {
        if (openError) {
          clearTimeout(timeoutId);
          imap.end();
          reject(openError);
          return;
        }

        const searchDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

        imap.search([["SINCE", searchDate]], (searchError, results) => {
          if (searchError) {
            clearTimeout(timeoutId);
            imap.end();
            reject(searchError);
            return;
          }

          if (!results?.length) {
            clearTimeout(timeoutId);
            imap.end();
            resolve([]);
            return;
          }

          const latestEmails = results.slice(-250);
          const fetchRequest = imap.fetch(latestEmails, { bodies: "", struct: true });
          const emailPromises = [];

          fetchRequest.on("message", (msg) => {
            const emailPromise = new Promise((resolveEmail) => {
              let parsedEmail = null;

              msg.on("body", (stream) => {
                simpleParser(stream, (parseError, parsed) => {
                  if (parseError) {
                    resolveEmail(null);
                    return;
                  }
                  parsedEmail = parsed;
                });
              });

              msg.once("end", () => {
                setTimeout(() => resolveEmail(parsedEmail), 50);
              });
            });

            emailPromises.push(emailPromise);
          });

          fetchRequest.once("error", (fetchError) => {
            clearTimeout(timeoutId);
            imap.end();
            reject(fetchError);
          });

          fetchRequest.once("end", async () => {
            clearTimeout(timeoutId);

            try {
              const mailboxLower = mailboxEmail.toLowerCase();
              const emails = await Promise.all(emailPromises);

              const matches = emails
                .filter(Boolean)
                .filter((email) => {
                  const fromAddress = (email.from?.text || "").toLowerCase();
                  return fromAddress.includes("netflix");
                })
                .filter((email) => {
                  const toAddress = (email.to?.text || "").toLowerCase();
                  const ccAddress = (email.cc?.text || "").toLowerCase();
                  const htmlContent = (email.html || "").toLowerCase();
                  return (
                    toAddress.includes(mailboxLower) ||
                    ccAddress.includes(mailboxLower) ||
                    htmlContent.includes(mailboxLower)
                  );
                })
                .filter((email) => isTemporaryOrHouseholdEmail(email))
                .map((email) => {
                  const htmlContent = decodeHtmlEntities(email.html || "");
                  return {
                    id: email.messageId || `${Date.now()}-${Math.random()}`,
                    subject: decodeHtmlEntities(email.subject || "Netflix Email"),
                    receivedAt: email.date
                      ? new Date(email.date).toISOString()
                      : new Date().toISOString(),
                    from: email.from?.text || "",
                    to: email.to?.text || "",
                    rawHtml: `<div class="netflix-email-original">${htmlContent}</div>`,
                  };
                })
                .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))
                .slice(0, 30);

              imap.end();
              resolve(matches);
            } catch (error) {
              imap.end();
              reject(error);
            }
          });
        });
      });
    });

    imap.once("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });

    imap.connect();
  });
}

function getExpiryFromRequest(ttlType, customDays) {
  const now = Date.now();

  if (ttlType === "30") return now + 30 * 24 * 60 * 60 * 1000;
  if (ttlType === "90") return now + 90 * 24 * 60 * 60 * 1000;

  const days = Number(customDays);
  if (!Number.isFinite(days) || days <= 0 || days > 3650) {
    throw new Error("Custom expiry must be between 1 and 3650 days.");
  }

  return now + days * 24 * 60 * 60 * 1000;
}

export async function registerRoutes(httpServer, app) {
  app.get("/api/config/firebase", (_req, res) => {
    const config = getFirebaseServerConfig();
    res.json({
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId,
      measurementId: config.measurementId,
    });
  });

  app.post("/api/auth/access", async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim().toUpperCase();

    if (!email || !code) {
      res.status(400).json({ error: "Email and activation code are required." });
      return;
    }

    const db = getServerDb();

    const mailboxQuery = query(collection(db, MAILBOXES_COLLECTION), where("email", "==", email));
    const mailboxSnapshot = await getDocs(mailboxQuery);
    const mailboxDoc = mailboxSnapshot.docs[0];

    if (!mailboxDoc) {
      res.status(401).json({ error: "Invalid email or code." });
      return;
    }

    const codeQuery = query(
      collection(db, ACTIVATION_CODES_COLLECTION),
      where("mailboxId", "==", mailboxDoc.id),
      where("codeHash", "==", hashCode(code)),
      where("disabled", "==", false)
    );

    const codeSnapshot = await getDocs(codeQuery);
    const now = Date.now();
    const matchingCode = codeSnapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .find((item) => Number(item.expiresAt) > now);

    if (!matchingCode) {
      res.status(401).json({ error: "Invalid email or code." });
      return;
    }

    const token = signAccessToken({
      mailboxId: mailboxDoc.id,
      email,
      exp: Date.now() + 12 * 60 * 60 * 1000,
    });

    res.json({
      token,
      mailbox: {
        id: mailboxDoc.id,
        email,
      },
      expiresAt: matchingCode.expiresAt,
    });
  });

  app.get("/api/user/emails", async (req, res) => {
    const session = requireAccessSession(req, res);
    if (!session) return;

    const pageToken = String(req.query?.pageToken || "");
    const pageSize = Math.min(Math.max(parseInt(String(req.query?.limit || "10"), 10) || 10, 1), 10);

    try {
      let emails = [];
      let nextPageToken = null;

      try {
        const gmailResult = await searchNetflixEmailsGmail(session.email, pageToken, pageSize);
        emails = gmailResult.emails;
        nextPageToken = gmailResult.nextPageToken;
      } catch (_gmailError) {
        const imapConfig = {
          user: process.env.EMAIL_ADDRESS,
          password: process.env.EMAIL_PASSWORD,
          host: process.env.EMAIL_SERVER || "imap.gmail.com",
          port: parseInt(process.env.EMAIL_PORT || "993", 10),
          tls: process.env.EMAIL_TLS !== "false",
          tlsOptions: { rejectUnauthorized: false },
          connTimeout: 10000,
          authTimeout: 8000,
        };

        if (!imapConfig.user || !imapConfig.password) {
          res.status(500).json({ error: "Mailbox service is not ready yet. Please contact support." });
          return;
        }

        emails = (await searchNetflixEmails(imapConfig, session.email)).slice(0, pageSize);
      }

      res.json({ emails, totalCount: emails.length, nextPageToken, pageSize });
    } catch (error) {
      res.status(500).json({ error: getUserFriendlyError(error) });
    }
  });

  app.get("/api/admin/bootstrap", async (req, res) => {
    const user = await requireAdminUser(req, res);
    if (!user) return;

    const db = getServerDb();
    const [mailboxes, codes, adminUsers, adminEmails] = await Promise.all([
      getMailboxes(db),
      getCodes(db),
      getDbAdminUsers(db),
      getAdminEmails(db),
    ]);

    const mailboxById = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));
    const codesWithMailbox = codes.map((code) => ({
      ...code,
      mailboxEmail: mailboxById.get(code.mailboxId)?.email || "",
      expired: Number(code.expiresAt) <= Date.now(),
    }));

    res.json({
      adminUser: user,
      mailboxes,
      codes: codesWithMailbox,
      adminUsers,
      adminEmails,
    });
  });

  app.post("/api/admin/admin-users", async (req, res) => {
    const user = await requireAdminUser(req, res);
    if (!user) return;

    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      res.status(400).json({ error: "Please enter a valid admin email." });
      return;
    }

    const db = getServerDb();
    const existsInEnv = getConfiguredAdminEmails().includes(email);
    if (existsInEnv) {
      res.status(409).json({ error: "This email is already an admin." });
      return;
    }

    const existing = await getDocs(query(collection(db, ADMIN_USERS_COLLECTION), where("email", "==", email)));
    if (!existing.empty) {
      res.status(409).json({ error: "This email is already an admin." });
      return;
    }

    const now = Date.now();
    const created = await addDoc(collection(db, ADMIN_USERS_COLLECTION), {
      email,
      createdAt: now,
      createdBy: user.email,
    });

    res.status(201).json({
      adminUser: {
        id: created.id,
        email,
        createdAt: now,
        createdBy: user.email,
      },
    });
  });

  app.delete("/api/admin/admin-users/:id", async (req, res) => {
    const user = await requireAdminUser(req, res);
    if (!user) return;

    const id = req.params.id;
    const db = getServerDb();
    await deleteDoc(doc(db, ADMIN_USERS_COLLECTION, id));
    res.json({ success: true });
  });

  app.post("/api/admin/mailboxes", async (req, res) => {
    const user = await requireAdminUser(req, res);
    if (!user) return;

    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      res.status(400).json({ error: "Please enter a valid email." });
      return;
    }

    const db = getServerDb();
    const existingQuery = query(collection(db, MAILBOXES_COLLECTION), where("email", "==", email));
    const existing = await getDocs(existingQuery);
    if (!existing.empty) {
      res.status(409).json({ error: "This email is already added." });
      return;
    }

    const now = Date.now();
    const created = await addDoc(collection(db, MAILBOXES_COLLECTION), {
      email,
      createdAt: now,
      updatedAt: now,
      createdBy: user.email,
    });

    res.status(201).json({
      mailbox: {
        id: created.id,
        email,
        createdAt: now,
        updatedAt: now,
        createdBy: user.email,
      },
    });
  });

  app.delete("/api/admin/mailboxes/:id", async (req, res) => {
    const user = await requireAdminUser(req, res);
    if (!user) return;

    const mailboxId = req.params.id;
    const db = getServerDb();

    await deleteDoc(doc(db, MAILBOXES_COLLECTION, mailboxId));

    const codesQuery = query(collection(db, ACTIVATION_CODES_COLLECTION), where("mailboxId", "==", mailboxId));
    const codesSnapshot = await getDocs(codesQuery);
    await Promise.all(codesSnapshot.docs.map((item) => deleteDoc(doc(db, ACTIVATION_CODES_COLLECTION, item.id))));

    res.json({ success: true });
  });

  app.post("/api/admin/codes", async (req, res) => {
    const user = await requireAdminUser(req, res);
    if (!user) return;

    let mailboxId = String(req.body?.mailboxId || "");
    const mailboxEmail = String(req.body?.email || "").trim().toLowerCase();
    const ttlType = String(req.body?.ttlType || "30");
    const customDays = req.body?.customDays;

    if (!mailboxId && (!mailboxEmail || !mailboxEmail.includes("@"))) {
      res.status(400).json({ error: "Please enter a valid email." });
      return;
    }

    let expiresAt;
    try {
      expiresAt = getExpiryFromRequest(ttlType, customDays);
    } catch (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    const db = getServerDb();
    let mailboxData = null;

    if (mailboxEmail) {
      const existingQuery = query(collection(db, MAILBOXES_COLLECTION), where("email", "==", mailboxEmail));
      const existing = await getDocs(existingQuery);
      if (existing.empty) {
        const now = Date.now();
        const createdMailbox = await addDoc(collection(db, MAILBOXES_COLLECTION), {
          email: mailboxEmail,
          createdAt: now,
          updatedAt: now,
          createdBy: user.email,
        });
        mailboxId = createdMailbox.id;
        mailboxData = {
          id: createdMailbox.id,
          email: mailboxEmail,
          createdAt: now,
          updatedAt: now,
          createdBy: user.email,
        };
      } else {
        const mailboxDoc = existing.docs[0];
        mailboxId = mailboxDoc.id;
        mailboxData = normalizeMailbox(mailboxDoc);
        const codeQuery = query(collection(db, ACTIVATION_CODES_COLLECTION), where("mailboxId", "==", mailboxId));
        const codeSnapshot = await getDocs(codeQuery);
        const hasActiveCode = codeSnapshot.docs.some((codeDoc) => {
          const codeData = codeDoc.data();
          return !codeData.disabled && Number(codeData.expiresAt) > Date.now();
        });
        if (hasActiveCode) {
          res.status(409).json({ error: "This email already has an active code. Remove it first to create a new one." });
          return;
        }
      }
    } else {
      const mailboxDoc = await getDoc(doc(db, MAILBOXES_COLLECTION, mailboxId));
      if (!mailboxDoc.exists()) {
        res.status(404).json({ error: "Mailbox not found." });
        return;
      }
      mailboxData = normalizeMailbox(mailboxDoc);
    }

    const code = generateActivationCode();
    const codePreview = `${code.slice(0, 2)}****`;
    const now = Date.now();

    const created = await addDoc(collection(db, ACTIVATION_CODES_COLLECTION), {
      mailboxId,
      codeHash: hashCode(code),
      codeValue: code,
      codePreview,
      expiresAt,
      disabled: false,
      createdAt: now,
      createdBy: user.email,
      ttlType,
      customDays: ttlType === "custom" ? Number(customDays) : null,
    });

    res.status(201).json({
      code: {
        id: created.id,
        mailboxId,
        codeValue: code,
        codePreview,
        expiresAt,
        disabled: false,
        createdAt: now,
        createdBy: user.email,
        ttlType,
        customDays: ttlType === "custom" ? Number(customDays) : null,
      },
      generatedCode: code,
      mailbox: mailboxData,
    });
  });

  app.patch("/api/admin/codes/:id", async (req, res) => {
    const user = await requireAdminUser(req, res);
    if (!user) return;

    const id = req.params.id;
    const disabled = Boolean(req.body?.disabled);
    const db = getServerDb();

    await updateDoc(doc(db, ACTIVATION_CODES_COLLECTION, id), { disabled });

    res.json({ success: true });
  });

  app.post("/api/admin/codes/:id/regenerate", async (req, res) => {
    const user = await requireAdminUser(req, res);
    if (!user) return;

    const id = req.params.id;
    const db = getServerDb();
    const codeRef = doc(db, ACTIVATION_CODES_COLLECTION, id);
    const codeSnap = await getDoc(codeRef);

    if (!codeSnap.exists()) {
      res.status(404).json({ error: "Code not found." });
      return;
    }

    const current = codeSnap.data();
    const nextCode = generateActivationCode();
    const now = Date.now();
    const expiresAt = getExpiryFromRequest(current.ttlType || "30", current.customDays);

    await updateDoc(codeRef, {
      codeHash: hashCode(nextCode),
      codeValue: nextCode,
      codePreview: `${nextCode.slice(0, 2)}****`,
      expiresAt,
      disabled: false,
      updatedAt: now,
      updatedBy: user.email,
    });

    res.json({
      code: {
        id,
        mailboxId: current.mailboxId,
        codeValue: nextCode,
        codePreview: `${nextCode.slice(0, 2)}****`,
        expiresAt,
        disabled: false,
        createdAt: current.createdAt,
        createdBy: current.createdBy,
        ttlType: current.ttlType || "30",
        customDays: current.customDays ?? null,
      },
      generatedCode: nextCode,
    });
  });

  app.post("/api/admin/codes/regenerate-missing", async (req, res) => {
    const user = await requireAdminUser(req, res);
    if (!user) return;

    const db = getServerDb();
    const codesSnapshot = await getDocs(collection(db, ACTIVATION_CODES_COLLECTION));
    const now = Date.now();

    const updated = [];
    const updates = codesSnapshot.docs.map(async (docSnap) => {
      const current = docSnap.data();
      if (current.codeValue) return;

      const nextCode = generateActivationCode();
      const expiresAt = getExpiryFromRequest(current.ttlType || "30", current.customDays);

      await updateDoc(doc(db, ACTIVATION_CODES_COLLECTION, docSnap.id), {
        codeHash: hashCode(nextCode),
        codeValue: nextCode,
        codePreview: `${nextCode.slice(0, 2)}****`,
        expiresAt,
        disabled: false,
        updatedAt: now,
        updatedBy: user.email,
      });

      updated.push({
        id: docSnap.id,
        mailboxId: current.mailboxId,
        codeValue: nextCode,
        codePreview: `${nextCode.slice(0, 2)}****`,
        expiresAt,
        disabled: false,
        createdAt: current.createdAt,
        createdBy: current.createdBy,
        ttlType: current.ttlType || "30",
        customDays: current.customDays ?? null,
      });
    });

    await Promise.all(updates);
    res.json({ updatedCount: updated.length, codes: updated });
  });

  return httpServer;
}

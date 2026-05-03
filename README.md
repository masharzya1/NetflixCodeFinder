# Netflix Mailbox Access

A React + Express mailbox access tool for authorized users. Admins can sign in with Google, generate activation codes for customer emails, and let customers view matched Netflix access emails through a clean inbox UI.

## Features

- Google-admin protected dashboard
- Activation code generation with expiry days
- Customer login by email and activation code
- Gmail-style inbox with click-to-open email details
- Gmail API mailbox fetching with IMAP fallback
- Firebase-backed mailbox, admin, and activation-code storage

## Environment

Copy `.env.example` and provide production values in your hosting provider.

## Development

```bash
npm install
npm run dev
```

## Vercel

The project uses `vercel.json` to build the Vite frontend and route all `/api/*` calls to the unified serverless API handler.
